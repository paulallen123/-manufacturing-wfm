'use strict';

const { createHash } = require('node:crypto');

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

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
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

  async function evaluate({ token, tenant, scenarioId, proposalDigest, approverId, currentStateDigest, dryRun } = {}) {
    if (!isDigest(currentStateDigest)) deny('WFM_T3_READINESS_STATE', 'Current state digest is required.');

    const consent = await authorisationGate.consume({ token, tenant, scenarioId, proposalDigest, approverId });
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

    const preflight = preflightVerifier.verify(consent, currentStateDigest, dryRun);
    if (!preflight || preflight.verified !== true) {
      const containedCore = {
        schemaVersion: 1,
        status: 'contained',
        reason: preflight?.reason || 'execution-preflight-failed',
        tenant: consent.tenant,
        scenarioId: consent.scenarioId,
        incidentId: consent.incidentId,
        proposalDigest: consent.proposalDigest,
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
      || preflight.authorisationReceiptDigest !== consent.authorisationReceiptDigest
      || preflight.currentStateDigest !== currentStateDigest
    ) deny('WFM_T3_READINESS_BINDING', 'Execution preflight does not bind to the exact consumed consent and state.');
    if (!isDigest(preflight.verificationDigest) || !isDigest(preflight.rollbackDigest) || !isDigest(preflight.idempotencyKeyDigest) || !isDigest(preflight.executionPlanDigest)) {
      deny('WFM_T3_READINESS_EVIDENCE', 'Execution preflight evidence is incomplete.');
    }

    const evaluatedAt = Number(now());
    const core = {
      schemaVersion: 1,
      status: 'execution-ready-awaiting-external-authority',
      tenant: consent.tenant,
      scenarioId: consent.scenarioId,
      incidentId: consent.incidentId,
      proposedAction: consent.proposedAction,
      affectedRecords: consent.affectedRecords,
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
    return receiptDigest === digest(core);
  }

  return { evaluate, verifyReceipt };
}

module.exports = { createT3ExecutionReadinessGate, canonical, digest };
