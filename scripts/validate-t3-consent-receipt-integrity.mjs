import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3ExecutionReadinessGate, digest } = require('../resilience/t3-execution-readiness-gate.cjs');
const { policyDigest } = require('../resilience/t3-shadow-simulator.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');

const expectAsyncCode = async (fn, code) => {
  try { await fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

function sealConsent(overrides = {}) {
  const core = {
    authorisationId: 'auth-integrity-1',
    tenant: 'tenant-a',
    incidentId: 'inc-integrity-1',
    scenarioId: 'payroll-calculation-or-export-anomaly',
    proposedAction: 'payroll.correct-export',
    affectedRecords: 4,
    evidenceDigest: d('evidence'),
    actionPolicyDigest: policyDigest('payroll-calculation-or-export-anomaly'),
    proposalDigest: d('proposal'),
    simulationDigest: d('simulation'),
    verificationDigest: d('shadow-verification'),
    beforeStateDigest: d('before'),
    afterStateDigest: d('after'),
    compensationPlanDigest: d('compensation'),
    approverId: 'customer-payroll-approver-1',
    approverRole: 'payroll',
    scope: 'customer-consent-record-only',
    customerConsentRecorded: true,
    durableReplayProtection: true,
    executionAuthority: false,
    automaticExecutionEligible: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    productionMutation: false,
    consumedAt: 1000,
    ...overrides,
  };
  return { ...core, authorisationReceiptDigest: digest(core) };
}

function makeDryRun(consent) {
  const core = {
    tenant: consent.tenant,
    scenarioId: consent.scenarioId,
    proposalDigest: consent.proposalDigest,
    proposedAction: consent.proposedAction,
    actionPolicyDigest: consent.actionPolicyDigest,
    affectedRecords: consent.affectedRecords,
    beforeStateDigest: consent.beforeStateDigest,
    currentStateDigest: consent.beforeStateDigest,
    afterStateDigest: consent.afterStateDigest,
    compensationPlanDigest: consent.compensationPlanDigest,
    rollbackDigest: d('rollback'),
    idempotencyKeyDigest: d('idempotency'),
    executionPlanDigest: d('execution-plan'),
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
  return { ...core, dryRunDigest: digest(core) };
}

function preflightResult(consent, currentStateDigest, dryRun) {
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

function authorisationGate(receipt) {
  return { async consume() { return structuredClone(receipt); } };
}

const consent = sealConsent();
const normalGate = createT3ExecutionReadinessGate({
  authorisationGate: authorisationGate(consent),
  preflightVerifier: { verify: preflightResult },
  now: () => 5000,
});
const ready = await normalGate.evaluate({
  token: 'opaque',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun(consent),
});
assert.equal(ready.status, 'execution-ready-awaiting-external-authority');
assert.equal(normalGate.verifyReceipt(ready), true);
assert.equal(ready.executionAuthority, false);
assert.equal(ready.productionAuthorityGranted, false);
assert.equal(ready.modelAuthorityGranted, false);

const staleDigestConsent = structuredClone(consent);
staleDigestConsent.approverRole = 'company-admin';
const staleDigestGate = createT3ExecutionReadinessGate({
  authorisationGate: authorisationGate(staleDigestConsent),
  preflightVerifier: { verify: preflightResult },
});
await expectAsyncCode(() => staleDigestGate.evaluate({
  token: 'opaque',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun(consent),
}), 'WFM_T3_READINESS_CONSENT_EVIDENCE');

const mutatingVerifier = {
  verify(consumed, currentStateDigest, dryRun) {
    consumed.approverRole = 'company-admin';
    const core = { ...consumed };
    delete core.authorisationReceiptDigest;
    consumed.authorisationReceiptDigest = digest(core);
    return preflightResult(consumed, currentStateDigest, dryRun);
  },
};
const driftGate = createT3ExecutionReadinessGate({
  authorisationGate: authorisationGate(consent),
  preflightVerifier: mutatingVerifier,
});
await expectAsyncCode(() => driftGate.evaluate({
  token: 'opaque',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun(consent),
}), 'WFM_T3_READINESS_CONSENT_DRIFT');

console.log(JSON.stringify({
  status: 'PASS',
  cases: 3,
  staleReceiptRejected: true,
  consentMutationDuringPreflightRejected: true,
  executionAuthority: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
}, null, 2));
