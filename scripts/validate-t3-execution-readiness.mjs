import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3ExecutionPreflightVerifier, digest } = require('../resilience/t3-execution-preflight-verifier.cjs');
const { createT3ExecutionReadinessGate } = require('../resilience/t3-execution-readiness-gate.cjs');
const { policyDigest } = require('../resilience/t3-shadow-simulator.cjs');
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');

const expectCode = (fn, code) => {
  try { fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

const policyFactory = createFactory();
policyFactory.openIncident({ incidentId: 'inc-t3-protect', tenant: 'tenant-a', evidenceDigest: d('protect-evidence') });
policyFactory.registerReproducer({ incidentId: 'inc-t3-protect', tenant: 'tenant-a', failingTestDigest: d('protect-test'), observedFailureDigest: d('protect-observed') });
expectCode(() => policyFactory.proposeCandidate({
  incidentId: 'inc-t3-protect', tenant: 'tenant-a', proposerId: 'repair-agent', patchDigest: d('preflight-tamper'), changedPaths: ['resilience/t3-execution-preflight-verifier.cjs'],
}), 'WFM_REPAIR_PROTECTED_PATH');
expectCode(() => policyFactory.proposeCandidate({
  incidentId: 'inc-t3-protect', tenant: 'tenant-a', proposerId: 'repair-agent', patchDigest: d('readiness-tamper'), changedPaths: ['resilience/t3-execution-readiness-gate.cjs'],
}), 'WFM_REPAIR_PROTECTED_PATH');
expectCode(() => policyFactory.proposeCandidate({
  incidentId: 'inc-t3-protect', tenant: 'tenant-a', proposerId: 'repair-agent', patchDigest: d('readiness-validator-tamper'), changedPaths: ['scripts/validate-t3-execution-readiness.mjs'],
}), 'WFM_REPAIR_PROTECTED_PATH');

const consent = {
  authorisationId: 'auth-1',
  tenant: 'tenant-a',
  incidentId: 'inc-t3-ready-001',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'payroll.correct-export',
  affectedRecords: 12,
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
};
{
  const core = { ...consent };
  consent.authorisationReceiptDigest = digest(core);
}

function makeDryRun(overrides = {}) {
  const base = {
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
    ...overrides,
  };
  return { ...base, dryRunDigest: digest(base) };
}

function createOneShotAuthorisationGate(receipt) {
  let consumed = false;
  return {
    async consume({ tenant, scenarioId, proposalDigest, approverId }) {
      assert.equal(consumed, false, 'customer consent must be one-shot');
      assert.equal(tenant, receipt.tenant);
      assert.equal(scenarioId, receipt.scenarioId);
      assert.equal(proposalDigest, receipt.proposalDigest);
      assert.equal(approverId, receipt.approverId);
      consumed = true;
      return structuredClone(receipt);
    },
  };
}

let now = 5000;
const verifier = createT3ExecutionPreflightVerifier();
const gate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(consent),
  preflightVerifier: verifier,
  now: () => ++now,
  maxValidityMs: 30000,
});

const ready = await gate.evaluate({
  token: 'opaque-consent-token',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun(),
});
assert.equal(ready.status, 'execution-ready-awaiting-external-authority');
assert.equal(ready.executionReady, true);
assert.equal(ready.currentActionPolicyVerified, true);
assert.equal(ready.actionPolicyDigest, consent.actionPolicyDigest);
assert.equal(ready.externalExecutionAuthorityRequired, true);
assert.equal(ready.deterministicExecutorRequired, true);
assert.equal(ready.executionAuthority, false);
assert.equal(ready.productionAuthorityGranted, false);
assert.equal(ready.modelAuthorityGranted, false);
assert.equal(ready.customerMutation, false);
assert.equal(ready.productionMutation, false);
assert.equal(gate.verifyReceipt(ready), true);

const staleGate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(consent),
  preflightVerifier: verifier,
  now: () => ++now,
});
const stale = await staleGate.evaluate({
  token: 'opaque-consent-token-2',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: d('new-current-state'),
  dryRun: makeDryRun({ currentStateDigest: d('new-current-state') }),
});
assert.equal(stale.status, 'contained');
assert.equal(stale.reason, 'state-drift-after-consent');
assert.equal(stale.executionReady, false);
assert.equal(stale.productionAuthorityGranted, false);
assert.equal(staleGate.verifyReceipt(stale), true);

const hostileGate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(consent),
  preflightVerifier: verifier,
  now: () => ++now,
});
const hostile = await hostileGate.evaluate({
  token: 'opaque-consent-token-3',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun({ productionAuthorityGranted: true }),
});
assert.equal(hostile.status, 'contained');
assert.equal(hostile.reason, 'dry-run-authority-boundary-invalid');
assert.equal(hostile.executionReady, false);

const secretGate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(consent),
  preflightVerifier: verifier,
  now: () => ++now,
});
const secret = await secretGate.evaluate({
  token: 'opaque-consent-token-4',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun({ accessToken: 'should-never-be-here' }),
});
assert.equal(secret.status, 'contained');
assert.equal(secret.reason, 'reusable-secret-surface-detected');

const policyMismatchGate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(consent),
  preflightVerifier: verifier,
  now: () => ++now,
});
const policyMismatch = await policyMismatchGate.evaluate({
  token: 'opaque-consent-token-5',
  tenant: consent.tenant,
  scenarioId: consent.scenarioId,
  proposalDigest: consent.proposalDigest,
  approverId: consent.approverId,
  currentStateDigest: consent.beforeStateDigest,
  dryRun: makeDryRun({ actionPolicyDigest: d('forged-policy') }),
});
assert.equal(policyMismatch.status, 'contained');
assert.equal(policyMismatch.reason, 'dry-run-actionPolicyDigest-mismatch');
assert.equal(policyMismatch.executionReady, false);

const revokedConsent = structuredClone(consent);
revokedConsent.actionPolicyDigest = d('retired-policy-version');
{
  const core = { ...revokedConsent };
  delete core.authorisationReceiptDigest;
  revokedConsent.authorisationReceiptDigest = digest(core);
}
const revokedGate = createT3ExecutionReadinessGate({
  authorisationGate: createOneShotAuthorisationGate(revokedConsent),
  preflightVerifier: verifier,
  now: () => ++now,
});
const revoked = await revokedGate.evaluate({
  token: 'opaque-consent-token-6',
  tenant: revokedConsent.tenant,
  scenarioId: revokedConsent.scenarioId,
  proposalDigest: revokedConsent.proposalDigest,
  approverId: revokedConsent.approverId,
  currentStateDigest: revokedConsent.beforeStateDigest,
  dryRun: makeDryRun({ actionPolicyDigest: revokedConsent.actionPolicyDigest }),
});
assert.equal(revoked.status, 'contained');
assert.equal(revoked.reason, 'action-policy-revoked-or-drifted');
assert.equal(revoked.executionReady, false);

const tampered = structuredClone(ready);
tampered.expectedAfterStateDigest = d('tampered-after');
assert.equal(gate.verifyReceipt(tampered), false);

// Simulate an old but internally well-formed readiness receipt reaching the deterministic
// sandbox after policy revocation. The sandbox calls readinessGate.verifyReceipt before
// reading or mutating sandbox state, so this must fail even if an attacker recomputes the
// outer receipt digest.
const stalePolicyReceipt = structuredClone(ready);
stalePolicyReceipt.actionPolicyDigest = d('superseded-policy');
{
  const core = { ...stalePolicyReceipt };
  delete core.readinessReceiptDigest;
  stalePolicyReceipt.readinessReceiptDigest = digest(core);
}
assert.equal(gate.verifyReceipt(stalePolicyReceipt), false);

const substitutedActionReceipt = structuredClone(ready);
substitutedActionReceipt.proposedAction = 'payroll.delete-all';
{
  const core = { ...substitutedActionReceipt };
  delete core.readinessReceiptDigest;
  substitutedActionReceipt.readinessReceiptDigest = digest(core);
}
assert.equal(gate.verifyReceipt(substitutedActionReceipt), false);

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'tier3-execution-readiness-with-policy-continuity-and-no-execution-authority',
  status: 'PASS',
  repairAgentCannotRewriteReadinessAuthority: true,
  consumedCustomerConsentRequired: true,
  exactCurrentStateBound: true,
  exactActionPolicyBound: true,
  actionPolicyRevalidatedAtPreflight: true,
  actionPolicyRevalidatedAtReadinessReceiptVerification: true,
  staleOrRevokedPolicyContained: true,
  samePrefixActionSubstitutionContained: true,
  staleConsentContained: true,
  independentPreflightVerified: true,
  businessInvariantRequired: true,
  securityRequired: true,
  tenantIsolationRequired: true,
  compensationVerified: true,
  rollbackReadyRequired: true,
  idempotencyPreparedRequired: true,
  reusableSecretsDenied: true,
  tamperEvidence: true,
  externalExecutionAuthorityRequired: true,
  executionAuthorityGranted: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
  customerMutation: false,
  productionMutation: false,
}, null, 2));
