'use strict';

const { createHash } = require('node:crypto');
const { T3_SCENARIO_POLICY, policyDigest } = require('./t3-shadow-simulator.cjs');

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

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function boundReceiptValid(receipt, digestField) {
  if (!receipt || typeof receipt !== 'object' || !isDigest(receipt[digestField])) return false;
  const core = { ...receipt };
  const expected = core[digestField];
  delete core[digestField];
  return expected === digest(core);
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function currentActionPolicyValid(subject) {
  const policy = T3_SCENARIO_POLICY[subject?.scenarioId];
  return Boolean(
    policy
    && policy.allowedActions.includes(subject.proposedAction)
    && isDigest(subject.actionPolicyDigest)
    && subject.actionPolicyDigest === policyDigest(subject.scenarioId)
  );
}

function createT3ExecutionReadinessGate({ authorisationGate, preflightVerifier, now = Date.now, maxValidityMs = 60_000 } = {}) {
  if (!authorisationGate || typeof authorisationGate.consume !== 'function') {
    throw new Error('T3 execution readiness requires the customer authorisation gate.');
  }
  if (!preflightVerifier || typeof preflightVerifier.verify !== 'function') {
    throw new Error('T3 execution readiness requires an independent preflight verifier.');
  }
  if (!Number.isSafeInteger(maxValidityMs) || maxValidityMs < 1000 || maxValidityMs > 5 * 60_000) {
    throw new Error('T3 execution readiness maxValidityMs must be between 1 second and 5 minutes.');
  }

  const componentBinding = Object.freeze({
    authorisationConsume: authorisationGate.consume,
    preflightVerify: preflightVerifier.verify,
  });

  function assertRuntimeComponentBinding() {
    if (
      authorisationGate.consume !== componentBinding.authorisationConsume
      || preflightVerifier.verify !== componentBinding.preflightVerify
    ) {
      deny(
        'WFM_T3_READINESS_COMPONENT_DRIFT',
        'T3 execution-readiness trusted component method identity changed after trust establishment.',
      );
    }
  }

  async function evaluate({ token, tenant, scenarioId, proposalDigest, approverId, currentStateDigest, dryRun } = {}) {
    assertRuntimeComponentBinding();
    if (!isDigest(currentStateDigest)) deny('WFM_T3_READINESS_STATE', 'Current state digest is required.');

    assertRuntimeComponentBinding();
    const consent = await authorisationGate.consume({ token, tenant, scenarioId, proposalDigest, approverId });
    assertRuntimeComponentBinding();
    if (!boundReceiptValid(consent, 'authorisationReceiptDigest')) {
      deny('WFM_T3_READINESS_CONSENT_EVIDENCE', 'Consumed customer consent receipt failed its cryptographic binding.');
    }
    const consumedConsentReceiptDigest = consent.authorisationReceiptDigest;
    if (
      consent.customerConsentRecorded !== true
      || consent.durableReplayProtection !== true
      || consent.executionAuthority !== false
      || consent.automaticExecutionEligible !== false
      || consent.productionAuthorityGranted !== false
      || consent.modelAuthorityGranted !== false
      || consent.customerMutation !== false
      || consent.productionMutation !== false
    ) deny('WFM_T3_READINESS_CONSENT', 'Consumed customer consent exceeded its authority boundary.');
    if (!currentActionPolicyValid(consent)) {
      const containedCore = {
        schemaVersion: 2,
        status: 'contained',
        reason: 'action-policy-revoked-or-drifted',
        tenant: consent.tenant,
        scenarioId: consent.scenarioId,
        incidentId: consent.incidentId,
        proposalDigest: consent.proposalDigest,
        actionPolicyDigest: consent.actionPolicyDigest || null,
        authorisationReceiptDigest: consent.authorisationReceiptDigest,
        currentStateDigest,
        executionReady: false,
        externalExecutionAuthorityRequired: true,
        executionAuthority: false,
        productionAuthorityGranted: false,
        modelAuthorityGranted: false,
        customerMutation: false,
        productionMutation: false,
      };
      return { ...containedCore, readinessReceiptDigest: digest(containedCore) };
    }

    assertRuntimeComponentBinding();
    const preflight = preflightVerifier.verify(consent, currentStateDigest, dryRun);
    assertRuntimeComponentBinding();
    if (
      consent.authorisationReceiptDigest !== consumedConsentReceiptDigest
      || !boundReceiptValid(consent, 'authorisationReceiptDigest')
    ) {
      deny('WFM_T3_READINESS_CONSENT_DRIFT', 'Consumed customer consent changed during independent preflight verification.');
    }
    if (!preflight || preflight.verified !== true) {
      const containedCore = {
        schemaVersion: 2,
        status: 'contained',
        reason: preflight?.reason || 'execution-preflight-failed',
        tenant: consent.tenant,
        scenarioId: consent.scenarioId,
        incidentId: consent.incidentId,
        proposalDigest: consent.proposalDigest,
        actionPolicyDigest: consent.actionPolicyDigest,
        authorisationReceiptDigest: consent.authorisationReceiptDigest,
        currentStateDigest,
        executionReady: false,
        externalExecutionAuthorityRequired: true,
        executionAuthority: false,
        productionAuthorityGranted: false,
        modelAuthorityGranted: false,
        customerMutation: false,
        productionMutation: false,
      };
      return { ...containedCore, readinessReceiptDigest: digest(containedCore) };
    }
    if (
      preflight.executionAuthority !== false
      || preflight.productionAuthorityGranted !== false
      || preflight.modelAuthorityGranted !== false
      || preflight.customerMutation !== false
      || preflight.productionMutation !== false
    ) deny('WFM_T3_READINESS_AUTHORITY', 'Independent preflight verifier exceeded authority.');
    if (
      preflight.tenant !== consent.tenant
      || preflight.scenarioId !== consent.scenarioId
      || preflight.proposalDigest !== consent.proposalDigest
      || preflight.proposedAction !== consent.proposedAction
      || preflight.affectedRecords !== consent.affectedRecords
      || preflight.actionPolicyDigest !== consent.actionPolicyDigest
      || preflight.currentActionPolicyVerified !== true
      || preflight.authorisationReceiptDigest !== consent.authorisationReceiptDigest
      || preflight.currentStateDigest !== currentStateDigest
    ) deny('WFM_T3_READINESS_BINDING', 'Execution preflight does not bind to the exact consumed consent, action policy and state.');
    if (!isDigest(preflight.verificationDigest) || !isDigest(preflight.rollbackDigest) || !isDigest(preflight.idempotencyKeyDigest) || !isDigest(preflight.executionPlanDigest)) {
      deny('WFM_T3_READINESS_EVIDENCE', 'Execution preflight evidence is incomplete.');
    }

    const evaluatedAt = Number(now());
    const core = {
      schemaVersion: 2,
      status: 'execution-ready-awaiting-external-authority',
      tenant: consent.tenant,
      scenarioId: consent.scenarioId,
      incidentId: consent.incidentId,
      proposedAction: consent.proposedAction,
      affectedRecords: consent.affectedRecords,
      actionPolicyDigest: consent.actionPolicyDigest,
      proposalDigest: consent.proposalDigest,
      authorisationReceiptDigest: consent.authorisationReceiptDigest,
      preflightVerificationDigest: preflight.verificationDigest,
      currentStateDigest,
      expectedAfterStateDigest: consent.afterStateDigest,
      compensationPlanDigest: consent.compensationPlanDigest,
      rollbackDigest: preflight.rollbackDigest,
      idempotencyKeyDigest: preflight.idempotencyKeyDigest,
      executionPlanDigest: preflight.executionPlanDigest,
      customerConsentVerified: true,
      currentActionPolicyVerified: true,
      currentStateMatchesConsent: true,
      independentPreflightVerified: true,
      compensationVerified: true,
      rollbackReady: true,
      executionReady: true,
      externalExecutionAuthorityRequired: true,
      deterministicExecutorRequired: true,
      executionAuthority: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
      evaluatedAt,
      validUntil: evaluatedAt + maxValidityMs,
    };
    return { ...core, readinessReceiptDigest: digest(core) };
  }

  function verifyReceipt(receipt) {
    if (!receipt || !receipt.readinessReceiptDigest) return false;
    if (
      receipt.executionAuthority !== false
      || receipt.productionAuthorityGranted !== false
      || receipt.modelAuthorityGranted !== false
      || receipt.customerMutation !== false
      || receipt.productionMutation !== false
    ) return false;
    const core = { ...receipt };
    const receiptDigest = core.readinessReceiptDigest;
    delete core.readinessReceiptDigest;
    if (receiptDigest !== digest(core)) return false;
    if (receipt.status === 'execution-ready-awaiting-external-authority') {
      if (receipt.currentActionPolicyVerified !== true || !currentActionPolicyValid(receipt)) return false;
    }
    return true;
  }

  return { evaluate, verifyReceipt };
}

module.exports = { createT3ExecutionReadinessGate, canonical, digest };
