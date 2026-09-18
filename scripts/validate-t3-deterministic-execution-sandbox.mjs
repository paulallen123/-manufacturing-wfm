import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3DeterministicExecutionSandbox, digest } = require('../resilience/t3-deterministic-execution-sandbox.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');

const readinessReceipt = {
  schemaVersion: 1,
  status: 'execution-ready-awaiting-external-authority',
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  incidentId: 'inc-t3-exec-001',
  proposedAction: 'payroll.correct-export',
  affectedRecords: 12,
  proposalDigest: d('proposal'),
  authorisationReceiptDigest: d('authorisation'),
  preflightVerificationDigest: d('preflight'),
  currentStateDigest: d('before'),
  expectedAfterStateDigest: d('after'),
  compensationPlanDigest: d('compensation'),
  rollbackDigest: d('rollback'),
  idempotencyKeyDigest: d('idempotency'),
  executionPlanDigest: d('execution-plan'),
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
  evaluatedAt: 1000,
  validUntil: 100000,
};
{
  const core = { ...readinessReceipt };
  readinessReceipt.readinessReceiptDigest = digest(core);
}

const readinessGate = {
  verifyReceipt(receipt) {
    if (!receipt?.readinessReceiptDigest) return false;
    const core = { ...receipt };
    const expected = core.readinessReceiptDigest;
    delete core.readinessReceiptDigest;
    return expected === digest(core);
  },
};

function createAuthorityGate({ hostile = false } = {}) {
  let consumed = false;
  return {
    async consume(input) {
      if (consumed) throw new Error('replayed');
      consumed = true;
      const core = {
        authorised: true,
        scope: 'isolated-t3-sandbox-only',
        executorType: 'deterministic-sandbox-executor',
        executorId: input.executorId,
        tenant: input.tenant,
        scenarioId: input.scenarioId,
        proposalDigest: input.proposalDigest,
        readinessReceiptDigest: input.readinessReceiptDigest,
        executionPlanDigest: input.executionPlanDigest,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        oneShot: true,
        durableReplayProtection: true,
        sandboxMutationAllowed: true,
        executionAuthority: false,
        productionAuthorityGranted: hostile,
        modelAuthorityGranted: false,
        customerMutation: false,
        productionMutation: false,
      };
      return { ...core, authorityReceiptDigest: digest(core) };
    },
  };
}

function createAdapter({ failPostcondition = false, failRollback = false, initialState = readinessReceipt.currentStateDigest } = {}) {
  let state = initialState;
  let applyCount = 0;
  let rollbackCount = 0;
  return {
    capability: {
      scope: 'isolated-t3-sandbox-only',
      isolated: true,
      zeroIncrementalCost: true,
      networkAccess: false,
      customerDataVisible: false,
      productionDataVisible: false,
      customerWriteAuthority: false,
      productionWriteAuthority: false,
    },
    get applyCount() { return applyCount; },
    get rollbackCount() { return rollbackCount; },
    get state() { return state; },
    async readStateDigest() { return state; },
    async applyExactPlan(input) {
      applyCount += 1;
      const after = failPostcondition ? d('unexpected-after') : input.expectedAfterStateDigest;
      state = after;
      return {
        accepted: true,
        tenant: input.tenant,
        scenarioId: input.scenarioId,
        proposalDigest: input.proposalDigest,
        executionPlanDigest: input.executionPlanDigest,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        beforeStateDigest: input.expectedBeforeStateDigest,
        afterStateDigest: after,
        affectedRecords: input.affectedRecords,
        sandboxMutation: true,
        customerMutation: false,
        productionMutation: false,
        productionDataTouched: false,
        customerDataTouched: false,
        networkUsed: false,
        businessInvariantPassed: !failPostcondition,
        securityPassed: true,
        tenantIsolationPassed: true,
      };
    },
    async rollbackKnownGood(input) {
      rollbackCount += 1;
      if (failRollback) {
        return {
          verified: false,
          tenant: input.tenant,
          restoredStateDigest: state,
          rollbackDigest: input.rollbackDigest,
          compensationPlanDigest: input.compensationPlanDigest,
          sandboxMutation: true,
          customerMutation: false,
          productionMutation: false,
          productionDataTouched: false,
          customerDataTouched: false,
          networkUsed: false,
        };
      }
      state = input.expectedRestoreStateDigest;
      return {
        verified: true,
        tenant: input.tenant,
        restoredStateDigest: state,
        rollbackDigest: input.rollbackDigest,
        compensationPlanDigest: input.compensationPlanDigest,
        sandboxMutation: true,
        customerMutation: false,
        productionMutation: false,
        productionDataTouched: false,
        customerDataTouched: false,
        networkUsed: false,
      };
    },
  };
}

let now = 5000;
const successAdapter = createAdapter();
const successGate = createAuthorityGate();
const successSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: successGate, sandboxAdapter: successAdapter, now: () => ++now });
const success = await successSandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-1', executorId: 'deterministic-executor-1' });
assert.equal(success.status, 'sandbox-execution-verified');
assert.equal(success.postconditionReconciled, true);
assert.equal(success.automaticKnownGoodRollbackUsed, false);
assert.equal(success.sandboxMutation, true);
assert.equal(success.customerMutation, false);
assert.equal(success.productionMutation, false);
assert.equal(success.productionExecutionReady, false);
assert.equal(successSandbox.verifyReceipt(success), true);
assert.equal(successAdapter.state, readinessReceipt.expectedAfterStateDigest);

const rollbackAdapter = createAdapter({ failPostcondition: true });
const rollbackSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: createAuthorityGate(), sandboxAdapter: rollbackAdapter, now: () => ++now });
const rolledBack = await rollbackSandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-2', executorId: 'deterministic-executor-2' });
assert.equal(rolledBack.status, 'sandbox-rolled-back-known-good');
assert.equal(rolledBack.automaticKnownGoodRollbackUsed, true);
assert.equal(rolledBack.restoredStateDigest, readinessReceipt.currentStateDigest);
assert.equal(rollbackAdapter.state, readinessReceipt.currentStateDigest);
assert.equal(rollbackSandbox.verifyReceipt(rolledBack), true);

const driftAdapter = createAdapter({ initialState: d('drifted-before') });
const driftSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: createAuthorityGate(), sandboxAdapter: driftAdapter, now: () => ++now });
const drift = await driftSandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-3', executorId: 'deterministic-executor-3' });
assert.equal(drift.status, 'contained');
assert.equal(drift.reason, 'sandbox-state-drift-before-execution');
assert.equal(driftAdapter.applyCount, 0);
assert.equal(drift.customerMutation, false);
assert.equal(drift.productionMutation, false);

const hostileAdapter = createAdapter();
const hostileSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: createAuthorityGate({ hostile: true }), sandboxAdapter: hostileAdapter, now: () => ++now });
const hostile = await hostileSandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-4', executorId: 'deterministic-executor-4' });
assert.equal(hostile.status, 'contained');
assert.equal(hostile.reason, 'external-execution-authority-invalid');
assert.equal(hostileAdapter.applyCount, 0);

const replayAdapter = createAdapter();
const replayAuthority = createAuthorityGate();
const replaySandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: replayAuthority, sandboxAdapter: replayAdapter, now: () => ++now });
const first = await replaySandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-5', executorId: 'deterministic-executor-5' });
assert.equal(first.status, 'sandbox-execution-verified');
const secondReadiness = { ...readinessReceipt, currentStateDigest: readinessReceipt.expectedAfterStateDigest, expectedAfterStateDigest: d('after-2') };
{
  const core = { ...secondReadiness };
  delete core.readinessReceiptDigest;
  secondReadiness.readinessReceiptDigest = digest(core);
}
const second = await replaySandbox.execute({ readinessReceipt: secondReadiness, authorityToken: 'sandbox-authority-5', executorId: 'deterministic-executor-5' });
assert.equal(second.status, 'contained');
assert.equal(second.reason, 'external-execution-authority-unavailable-or-replayed');

const resetAdapter = createAdapter({ failPostcondition: true, failRollback: true });
const resetSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: createAuthorityGate(), sandboxAdapter: resetAdapter, now: () => ++now });
const reset = await resetSandbox.execute({ readinessReceipt, authorityToken: 'sandbox-authority-6', executorId: 'deterministic-executor-6' });
assert.equal(reset.status, 'sandbox-contained-reset-required');
assert.equal(reset.isolatedResetRequired, true);
assert.equal(reset.productionMutation, false);
assert.equal(reset.customerMutation, false);

const expiredReceipt = { ...readinessReceipt, validUntil: 1 };
{
  const core = { ...expiredReceipt };
  delete core.readinessReceiptDigest;
  expiredReceipt.readinessReceiptDigest = digest(core);
}
const expiredAdapter = createAdapter();
const expiredSandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate: createAuthorityGate(), sandboxAdapter: expiredAdapter, now: () => 5000 });
const expired = await expiredSandbox.execute({ readinessReceipt: expiredReceipt, authorityToken: 'sandbox-authority-7', executorId: 'deterministic-executor-7' });
assert.equal(expired.status, 'contained');
assert.equal(expired.reason, 'readiness-receipt-expired');
assert.equal(expiredAdapter.applyCount, 0);

const tampered = structuredClone(success);
tampered.productionExecutionReady = true;
assert.equal(successSandbox.verifyReceipt(tampered), false);

assert.throws(() => createT3DeterministicExecutionSandbox({
  readinessGate,
  authorityGate: createAuthorityGate(),
  sandboxAdapter: {
    capability: { scope: 'isolated-t3-sandbox-only', isolated: true, zeroIncrementalCost: false },
    readStateDigest() {}, applyExactPlan() {}, rollbackKnownGood() {},
  },
}), /zero-cost isolated/);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier3-deterministic-execution-sandbox-with-reconciliation-and-known-good-rollback',
  status: 'PASS',
  exactReadinessReceiptRequired: true,
  separateOneShotAuthorityRequired: true,
  durableReplayProtectionRequired: true,
  staleStateContainedBeforeMutation: true,
  exactExecutionPlanBound: true,
  postconditionReconciliationRequired: true,
  automaticKnownGoodRollbackOnMismatch: true,
  failedRollbackContainedToIsolatedReset: true,
  authorityEscalationDenied: true,
  receiptTamperEvidence: true,
  zeroIncrementalCostAdapterRequired: true,
  customerDataVisible: false,
  productionDataVisible: false,
  customerMutation: false,
  productionMutation: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
}, null, 2));
