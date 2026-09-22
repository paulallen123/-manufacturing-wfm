'use strict';

const { createHmac, randomUUID, timingSafeEqual, createHash } = require('node:crypto');
const { T3_SCENARIO_POLICY, policyDigest } = require('./t3-shadow-simulator.cjs');

const SCENARIO_POLICY = T3_SCENARIO_POLICY;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function unb64(value) {
  return Buffer.from(value, 'base64url').toString();
}

function verifyShadowEvidence(simulation, verification) {
  if (!simulation || simulation.status !== 'customer_authorisation_required') {
    deny('WFM_T3_AUTH_SIMULATION', 'Verified customer-authorisation simulation required.');
  }
  if (!verification || verification.verified !== true) {
    deny('WFM_T3_AUTH_VERIFICATION', 'Independent T3 verification required.');
  }
  const policy = SCENARIO_POLICY[simulation.scenarioId];
  if (!policy) deny('WFM_T3_AUTH_SCENARIO', 'Unsupported T3 customer-authorisation scenario.');
  if (simulation.tenant !== simulation.targetTenant) deny('WFM_T3_AUTH_TENANT', 'Cross-tenant simulation cannot be authorised.');
  if (simulation.customerMutation !== false || simulation.productionMutation !== false || simulation.productionAuthorityGranted !== false || simulation.modelAuthorityGranted !== false || simulation.automaticExecutionEligible !== false || simulation.graduatedAutomaticAction !== false) {
    deny('WFM_T3_AUTH_BOUNDARY', 'Simulation exceeded the non-mutating authority boundary.');
  }
  if (
    verification.customerMutation !== false ||
    verification.productionMutation !== false ||
    verification.productionAuthorityGranted !== false ||
    verification.modelAuthorityGranted !== false ||
    verification.executionAuthority !== false ||
    verification.automaticExecutionEligible !== false ||
    verification.verifierRole !== 'independent-read-only-t3-shadow-verifier'
  ) {
    deny('WFM_T3_AUTH_BOUNDARY', 'Verification exceeded the independent non-mutating boundary.');
  }
  if (!policy.allowedActions.includes(simulation.proposedAction)) {
    deny('WFM_T3_AUTH_ACTION', 'Proposed action is not explicitly allowlisted for this scenario.');
  }
  if (simulation.actionPolicyDigest !== policyDigest(simulation.scenarioId) || simulation.exactActionAllowlistBound !== true) {
    deny('WFM_T3_AUTH_ACTION_POLICY', 'T3 simulation is not bound to the exact action policy.');
  }
  if (verification.tenant !== simulation.tenant || verification.scenarioId !== simulation.scenarioId || verification.evidenceDigest !== simulation.evidenceDigest || verification.proposalDigest !== simulation.proposalDigest || verification.simulationDigest !== simulation.simulationDigest) {
    deny('WFM_T3_AUTH_BINDING', 'T3 verification does not bind to the exact simulation.');
  }
  if (!Number.isSafeInteger(simulation.affectedRecords) || simulation.affectedRecords < 1 || simulation.affectedRecords > policy.maxAffectedRecords || simulation.maxAffectedRecords !== policy.maxAffectedRecords) {
    deny('WFM_T3_AUTH_CARDINALITY', 'Affected-record bound is invalid.');
  }

  const proposal = {
    incidentId: simulation.incidentId,
    tenant: simulation.tenant,
    scenarioId: simulation.scenarioId,
    evidenceDigest: simulation.evidenceDigest,
    proposedAction: simulation.proposedAction,
    beforeStateDigest: simulation.beforeStateDigest,
    afterStateDigest: simulation.afterStateDigest,
    compensationPlanDigest: simulation.compensationPlanDigest,
    affectedRecords: simulation.affectedRecords,
    actionPrefix: policy.actionPrefix,
    maxAffectedRecords: policy.maxAffectedRecords,
  };
  if (simulation.proposalDigest !== digest(proposal)) deny('WFM_T3_AUTH_PROPOSAL_DIGEST', 'T3 proposal digest is invalid.');

  const simulationCore = { ...simulation };
  const simulationDigest = simulationCore.simulationDigest;
  delete simulationCore.simulationDigest;
  if (simulationDigest !== digest(simulationCore)) deny('WFM_T3_AUTH_SIMULATION_DIGEST', 'T3 simulation digest is invalid.');

  const verificationCore = {
    incidentId: simulation.incidentId,
    tenant: simulation.tenant,
    scenarioId: simulation.scenarioId,
    evidenceDigest: simulation.evidenceDigest,
    proposalDigest: simulation.proposalDigest,
    simulationDigest,
    verifierRole: 'independent-read-only-t3-shadow-verifier',
    verified: true,
    customerMutation: false,
    productionMutation: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    executionAuthority: false,
    automaticExecutionEligible: false,
  };
  if (verification.verificationDigest !== digest(verificationCore)) deny('WFM_T3_AUTH_VERIFICATION_DIGEST', 'T3 verification digest is invalid.');
  return policy;
}

function validateReplayStore(replayStore) {
  if (!replayStore || replayStore.durable !== true || replayStore.atomic !== true || typeof replayStore.consumeOnce !== 'function') {
    throw new Error('T3 customer authorisation requires a durable atomic replay store.');
  }
}

function createT3CustomerAuthorisationGate({ key, replayStore, now = Date.now, maxTtlMs = 15 * 60 * 1000 } = {}) {
  const secret = Buffer.from(String(key || ''));
  if (secret.length < 32) throw new Error('T3 customer authorisation key must be at least 32 bytes.');
  validateReplayStore(replayStore);
  if (!Number.isSafeInteger(maxTtlMs) || maxTtlMs < 1000 || maxTtlMs > 60 * 60 * 1000) {
    throw new Error('T3 customer authorisation maxTtlMs must be between 1 second and 1 hour.');
  }

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  const tokenFor = (claims) => {
    const payload = b64(canonical(claims));
    return `${payload}.${sign(payload)}`;
  };

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) deny('WFM_T3_AUTH_TOKEN', 'Invalid customer authorisation token.');
    const [payload, signature] = parts;
    const expected = sign(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      deny('WFM_T3_AUTH_SIGNATURE', 'Customer authorisation signature is invalid.');
    }
    try {
      return JSON.parse(unb64(payload));
    } catch {
      deny('WFM_T3_AUTH_TOKEN', 'Customer authorisation payload is invalid.');
    }
  }

  function issue({ simulation, verification, approver, ttlMs = 5 * 60 * 1000 } = {}) {
    const policy = verifyShadowEvidence(simulation, verification);
    const actorType = clean(approver?.actorType, 80);
    const actorId = clean(approver?.actorId, 120);
    const role = clean(approver?.role, 80).toLowerCase();
    const tenant = clean(approver?.tenant, 100);
    if (actorType !== 'customer-authorised-approver' || !actorId || tenant !== simulation.tenant) {
      deny('WFM_T3_AUTH_APPROVER', 'Customer approver identity and tenant binding are required.');
    }
    if (!policy.approverRoles.includes(role)) {
      deny('WFM_T3_AUTH_ROLE', 'Customer approver role is not authorised for this T3 scenario.');
    }

    const issuedAt = Number(now());
    const requestedTtl = Number(ttlMs);
    if (!Number.isFinite(requestedTtl) || requestedTtl < 1000) deny('WFM_T3_AUTH_TTL', 'Authorisation TTL is invalid.');
    const expiresAt = issuedAt + Math.min(Math.floor(requestedTtl), maxTtlMs);
    const claims = {
      v: 2,
      jti: randomUUID(),
      scope: 'customer-consent-record-only',
      tenant: simulation.tenant,
      scenarioId: simulation.scenarioId,
      incidentId: simulation.incidentId,
      proposedAction: simulation.proposedAction,
      affectedRecords: simulation.affectedRecords,
      evidenceDigest: simulation.evidenceDigest,
      actionPolicyDigest: simulation.actionPolicyDigest,
      proposalDigest: simulation.proposalDigest,
      simulationDigest: simulation.simulationDigest,
      verificationDigest: verification.verificationDigest,
      beforeStateDigest: simulation.beforeStateDigest,
      afterStateDigest: simulation.afterStateDigest,
      compensationPlanDigest: simulation.compensationPlanDigest,
      approverId: actorId,
      approverRole: role,
      issuedAt,
      expiresAt,
      executionAuthority: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
    };

    return {
      token: tokenFor(claims),
      publicReceipt: {
        authorisationId: claims.jti,
        tenant: claims.tenant,
        scenarioId: claims.scenarioId,
        actionPolicyDigest: claims.actionPolicyDigest,
        proposalDigest: claims.proposalDigest,
        verificationDigest: claims.verificationDigest,
        approverRole: role,
        expiresAt,
        scope: claims.scope,
        executionAuthority: false,
        productionAuthorityGranted: false,
        customerMutation: false,
        productionMutation: false,
        receiptDigest: digest({
          jti: claims.jti,
          tenant: claims.tenant,
          scenarioId: claims.scenarioId,
          actionPolicyDigest: claims.actionPolicyDigest,
          proposalDigest: claims.proposalDigest,
          verificationDigest: claims.verificationDigest,
          approverId: claims.approverId,
          approverRole: role,
          expiresAt,
          scope: claims.scope,
        }),
      },
    };
  }

  async function consume({ token, tenant, scenarioId, proposalDigest, approverId } = {}) {
    const claims = verifyToken(token);
    const at = Number(now());
    if (claims.scope !== 'customer-consent-record-only') deny('WFM_T3_AUTH_SCOPE', 'Customer authorisation scope is invalid.');
    if (claims.executionAuthority !== false || claims.productionAuthorityGranted !== false || claims.modelAuthorityGranted !== false || claims.customerMutation !== false || claims.productionMutation !== false) {
      deny('WFM_T3_AUTH_BOUNDARY', 'Customer authorisation token contains forbidden authority.');
    }
    const policy = SCENARIO_POLICY[claims.scenarioId];
    if (!policy || !policy.allowedActions.includes(claims.proposedAction) || claims.actionPolicyDigest !== policyDigest(claims.scenarioId)) {
      deny('WFM_T3_AUTH_ACTION_POLICY', 'Customer authorisation token is outside the exact T3 action policy.');
    }
    if (claims.tenant !== clean(tenant, 100) || claims.scenarioId !== clean(scenarioId, 120) || claims.proposalDigest !== clean(proposalDigest, 64).toLowerCase()) {
      deny('WFM_T3_AUTH_BINDING', 'Customer authorisation token does not match the expected proposal.');
    }
    if (claims.approverId !== clean(approverId, 120)) deny('WFM_T3_AUTH_APPROVER', 'Customer authorisation approver changed.');
    if (!Number.isSafeInteger(claims.expiresAt) || at > claims.expiresAt) deny('WFM_T3_AUTH_EXPIRED', 'Customer authorisation token expired.');

    let firstUse;
    try {
      firstUse = await replayStore.consumeOnce({
        jti: claims.jti,
        tenant: claims.tenant,
        scenarioId: claims.scenarioId,
        proposalDigest: claims.proposalDigest,
        expiresAt: claims.expiresAt,
        consumedAt: at,
      });
    } catch {
      deny('WFM_T3_AUTH_REPLAY_STORE', 'Durable replay store unavailable; customer consent fails closed.');
    }
    const consumed = firstUse === true || firstUse?.consumed === true;
    if (!consumed) deny('WFM_T3_AUTH_REPLAY', 'Customer authorisation token was already consumed.');

    const core = {
      authorisationId: claims.jti,
      tenant: claims.tenant,
      incidentId: claims.incidentId,
      scenarioId: claims.scenarioId,
      proposedAction: claims.proposedAction,
      affectedRecords: claims.affectedRecords,
      evidenceDigest: claims.evidenceDigest,
      actionPolicyDigest: claims.actionPolicyDigest,
      proposalDigest: claims.proposalDigest,
      simulationDigest: claims.simulationDigest,
      verificationDigest: claims.verificationDigest,
      beforeStateDigest: claims.beforeStateDigest,
      afterStateDigest: claims.afterStateDigest,
      compensationPlanDigest: claims.compensationPlanDigest,
      approverId: claims.approverId,
      approverRole: claims.approverRole,
      scope: claims.scope,
      customerConsentRecorded: true,
      durableReplayProtection: true,
      executionAuthority: false,
      automaticExecutionEligible: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
      consumedAt: at,
    };
    return { ...core, authorisationReceiptDigest: digest(core) };
  }

  return { issue, consume, scenarioPolicy: SCENARIO_POLICY };
}

module.exports = { createT3CustomerAuthorisationGate, canonical, digest, SCENARIO_POLICY };
