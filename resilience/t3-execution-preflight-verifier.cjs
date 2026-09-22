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

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function containsReusableSecretSurface(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (/(password|secret|credential|api.?key|access.?token|refresh.?token)/i.test(key) && child != null && String(child) !== '') return true;
    if (child && typeof child === 'object' && containsReusableSecretSurface(child)) return true;
  }
  return false;
}

function fail(reason, detail = {}) {
  return {
    schemaVersion: 2,
    verified: false,
    reason,
    verifierRole: 'independent-read-only-t3-execution-preflight-verifier',
    executionAuthority: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    productionMutation: false,
    ...detail,
  };
}

function currentActionPolicyValid(consent) {
  const policy = T3_SCENARIO_POLICY[consent?.scenarioId];
  return Boolean(
    policy
    && policy.allowedActions.includes(consent.proposedAction)
    && isDigest(consent.actionPolicyDigest)
    && consent.actionPolicyDigest === policyDigest(consent.scenarioId)
  );
}

function createT3ExecutionPreflightVerifier() {
  function verify(consent, currentStateDigest, dryRun) {
    if (!consent || typeof consent !== 'object') return fail('consumed-customer-consent-required');
    if (consent.customerConsentRecorded !== true || consent.durableReplayProtection !== true) return fail('consent-not-durably-consumed');
    if (consent.scope !== 'customer-consent-record-only') return fail('consent-scope-invalid');
    if (
      consent.executionAuthority !== false
      || consent.automaticExecutionEligible !== false
      || consent.productionAuthorityGranted !== false
      || consent.modelAuthorityGranted !== false
      || consent.customerMutation !== false
      || consent.productionMutation !== false
    ) return fail('consent-authority-boundary-invalid');
    if (!currentActionPolicyValid(consent)) return fail('action-policy-revoked-or-drifted');
    if (!isDigest(consent.authorisationReceiptDigest)) return fail('consent-receipt-digest-invalid');
    if (!isDigest(currentStateDigest)) return fail('current-state-digest-required');
    if (currentStateDigest !== consent.beforeStateDigest) return fail('state-drift-after-consent');
    if (!dryRun || typeof dryRun !== 'object') return fail('deterministic-dry-run-required');
    if (containsReusableSecretSurface(dryRun)) return fail('reusable-secret-surface-detected');

    const exactMatches = [
      ['tenant', consent.tenant],
      ['scenarioId', consent.scenarioId],
      ['proposalDigest', consent.proposalDigest],
      ['proposedAction', consent.proposedAction],
      ['actionPolicyDigest', consent.actionPolicyDigest],
      ['beforeStateDigest', consent.beforeStateDigest],
      ['afterStateDigest', consent.afterStateDigest],
      ['compensationPlanDigest', consent.compensationPlanDigest],
    ];
    for (const [key, expected] of exactMatches) {
      if (dryRun[key] !== expected) return fail(`dry-run-${key}-mismatch`);
    }
    if (dryRun.affectedRecords !== consent.affectedRecords) return fail('dry-run-affected-records-mismatch');
    if (dryRun.currentStateDigest !== currentStateDigest) return fail('dry-run-current-state-mismatch');
    if (
      dryRun.dryRunOnly !== true
      || dryRun.businessInvariantPassed !== true
      || dryRun.securityPassed !== true
      || dryRun.tenantIsolationPassed !== true
      || dryRun.compensationVerified !== true
      || dryRun.rollbackReady !== true
      || dryRun.idempotencyPrepared !== true
    ) return fail('dry-run-safety-preconditions-incomplete');
    if (
      dryRun.executionAuthority !== false
      || dryRun.productionAuthorityGranted !== false
      || dryRun.modelAuthorityGranted !== false
      || dryRun.customerMutation !== false
      || dryRun.productionMutation !== false
    ) return fail('dry-run-authority-boundary-invalid');
    for (const key of ['rollbackDigest', 'idempotencyKeyDigest', 'executionPlanDigest']) {
      if (!isDigest(dryRun[key])) return fail(`dry-run-${key}-invalid`);
    }

    const dryRunCore = {
      tenant: consent.tenant,
      scenarioId: consent.scenarioId,
      proposalDigest: consent.proposalDigest,
      proposedAction: consent.proposedAction,
      actionPolicyDigest: consent.actionPolicyDigest,
      affectedRecords: consent.affectedRecords,
      beforeStateDigest: consent.beforeStateDigest,
      currentStateDigest,
      afterStateDigest: consent.afterStateDigest,
      compensationPlanDigest: consent.compensationPlanDigest,
      rollbackDigest: dryRun.rollbackDigest,
      idempotencyKeyDigest: dryRun.idempotencyKeyDigest,
      executionPlanDigest: dryRun.executionPlanDigest,
      dryRunOnly: true,
      businessInvariantPassed: true,
      securityPassed: true,
      tenantIsolationPassed: true,
      compensationVerified: true,
      rollbackReady: true,
      idempotencyPrepared: true,
      executionAuthority: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
    };
    if (dryRun.dryRunDigest !== digest(dryRunCore)) return fail('dry-run-digest-mismatch');

    const core = {
      schemaVersion: 2,
      tenant: consent.tenant,
      scenarioId: consent.scenarioId,
      incidentId: consent.incidentId,
      proposalDigest: consent.proposalDigest,
      proposedAction: consent.proposedAction,
      affectedRecords: consent.affectedRecords,
      actionPolicyDigest: consent.actionPolicyDigest,
      authorisationReceiptDigest: consent.authorisationReceiptDigest,
      currentStateDigest,
      dryRunDigest: dryRun.dryRunDigest,
      rollbackDigest: dryRun.rollbackDigest,
      idempotencyKeyDigest: dryRun.idempotencyKeyDigest,
      executionPlanDigest: dryRun.executionPlanDigest,
      verifierRole: 'independent-read-only-t3-execution-preflight-verifier',
      verified: true,
      currentActionPolicyVerified: true,
      compensationVerified: true,
      rollbackReady: true,
      executionAuthority: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
    };
    return { ...core, verificationDigest: digest(core) };
  }

  return { verify };
}

module.exports = { createT3ExecutionPreflightVerifier, canonical, digest };
