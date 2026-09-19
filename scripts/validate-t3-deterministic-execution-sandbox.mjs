import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3DeterministicExecutionSandbox, createT3ExternalExecutionReconciler, digest } = require('../resilience/t3-deterministic-execution-sandbox.cjs');
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

function seal(value, field) {
  const core = { ...value };
  delete core[field];
  return { ...core, [field]: digest(core) };
}

function externalExecution(overrides = {}) {
  return seal({
    schemaVersion: 1,
    status: 'executed',
    executorType: 'deterministic-external-executor',
    authoritySource: 'customer-controlled-external-authority',
    executorId: 'external-executor-1',
    tenant: readinessReceipt.tenant,
    scenarioId: readinessReceipt.scenarioId,
    incidentId: readinessReceipt.incidentId,
    proposalDigest: readinessReceipt.proposalDigest,
    readinessReceiptDigest: readinessReceipt.readinessReceiptDigest,
    executionPlanDigest: readinessReceipt.executionPlanDigest,
    idempotencyKeyDigest: readinessReceipt.idempotencyKeyDigest,
    beforeStateDigest: readinessReceipt.currentStateDigest,
    afterStateDigest: readinessReceipt.expectedAfterStateDigest,
    affectedRecords: readinessReceipt.affectedRecords,
    oneShotAuthorityConsumed: true,
    durableReplayProtection: true,
    externalAuthorityReceiptDigest: d('external-authority'),
    modelAuthorityUsed: false,
    llmDecisionAuthorityUsed: false,
    executedAt: 5000,
    ...overrides,
  }, 'executionReceiptDigest');
}

function externalObservation(executionReceipt, overrides = {}) {
  return seal({
    schemaVersion: 1,
    observerType: 'independent-read-only-reconciler',
    observerId: 'independent-observer-1',
    readOnly: true,
    writeAuthority: false,
    modelAuthorityUsed: false,
    tenant: readinessReceipt.tenant,
    scenarioId: readinessReceipt.scenarioId,
    incidentId: readinessReceipt.incidentId,
    proposalDigest: readinessReceipt.proposalDigest,
    readinessReceiptDigest: readinessReceipt.readinessReceiptDigest,
    executionReceiptDigest: executionReceipt.executionReceiptDigest,
    observedStateDigest: readinessReceipt.expectedAfterStateDigest,
    businessInvariantPassed: true,
    securityPassed: true,
    tenantIsolationPassed: true,
    observedAt: 6000,
    ...overrides,
  }, 'observationDigest');
}

let reconcileNow = 7000;
const reconciler = createT3ExternalExecutionReconciler({ readinessGate, now: () => reconcileNow, maxObservationAgeMs: 60_000 });

const externalGoodExecution = externalExecution();
const externalGoodObservation = externalObservation(externalGoodExecution);
const externalGood = reconciler.reconcile({ readinessReceipt, executionReceipt: externalGoodExecution, observation: externalGoodObservation });
assert.equal(externalGood.status, 'externally-executed-reconciled');
assert.equal(externalGood.postconditionReconciled, true);
assert.equal(externalGood.rollbackRequired, false);
assert.equal(externalGood.executionAuthority, false);
assert.equal(externalGood.rollbackAuthority, false);
assert.equal(externalGood.productionAuthorityGranted, false);
assert.equal(externalGood.modelAuthorityGranted, false);
assert.equal(externalGood.customerMutation, false);
assert.equal(externalGood.productionMutation, false);
assert.equal(reconciler.verifyReceipt(externalGood), true);

const mismatchExecution = externalExecution({ afterStateDigest: d('unexpected-after') });
const mismatchObservation = externalObservation(mismatchExecution, { observedStateDigest: d('unexpected-after') });
const mismatch = reconciler.reconcile({ readinessReceipt, executionReceipt: mismatchExecution, observation: mismatchObservation });
assert.equal(mismatch.status, 'rollback-required-awaiting-external-authority');
assert.equal(mismatch.reason, 'post-execution-state-mismatch');
assert.equal(mismatch.rollbackRequired, true);
assert.equal(mismatch.rollbackAuthority, false);

const invariantExecution = externalExecution();
const invariantObservation = externalObservation(invariantExecution, { securityPassed: false });
const invariant = reconciler.reconcile({ readinessReceipt, executionReceipt: invariantExecution, observation: invariantObservation });
assert.equal(invariant.status, 'rollback-required-awaiting-external-authority');
assert.equal(invariant.reason, 'post-execution-invariant-failure');

const modelExecution = externalExecution({ modelAuthorityUsed: true });
const modelObservation = externalObservation(modelExecution);
const model = reconciler.reconcile({ readinessReceipt, executionReceipt: modelExecution, observation: modelObservation });
assert.equal(model.status, 'rollback-required-awaiting-external-authority');
assert.equal(model.reason, 'model-authority-used-for-external-execution');
assert.equal(model.rollbackAuthority, false);

const hostileObserverExecution = externalExecution();
const hostileObserver = externalObservation(hostileObserverExecution, { writeAuthority: true });
const hostileObservationResult = reconciler.reconcile({ readinessReceipt, executionReceipt: hostileObserverExecution, observation: hostileObserver });
assert.equal(hostileObservationResult.status, 'rollback-required-awaiting-external-authority');
assert.equal(hostileObservationResult.reason, 'independent-post-execution-observation-boundary-invalid');

const staleExecution = externalExecution();
const staleObservation = externalObservation(staleExecution, { observedAt: 6000 });
reconcileNow = 70000;
const stale = reconciler.reconcile({ readinessReceipt, executionReceipt: staleExecution, observation: staleObservation });
assert.equal(stale.status, 'rollback-required-awaiting-external-authority');
assert.equal(stale.reason, 'independent-post-execution-observation-stale');
reconcileNow = 7000;

const crossTenantExecution = externalExecution({ tenant: 'tenant-b' });
const crossTenantObservation = externalObservation(crossTenantExecution, { tenant: 'tenant-b' });
const crossTenant = reconciler.reconcile({ readinessReceipt, executionReceipt: crossTenantExecution, observation: crossTenantObservation });
assert.equal(crossTenant.status, 'contained');
assert.equal(crossTenant.reason, 'external-execution-binding-invalid');
assert.equal(crossTenant.executionObserved, false);

const outOfWindowExecution = externalExecution({ executedAt: 100001 });
const outOfWindowObservation = externalObservation(outOfWindowExecution, { observedAt: 100002 });
const outOfWindow = reconciler.reconcile({ readinessReceipt, executionReceipt: outOfWindowExecution, observation: outOfWindowObservation });
assert.equal(outOfWindow.status, 'rollback-required-awaiting-external-authority');
assert.equal(outOfWindow.reason, 'external-execution-outside-readiness-window');

const externalTampered = { ...externalGood, rollbackAuthority: true };
assert.equal(reconciler.verifyReceipt(externalTampered), false);

const tamperedExternalExecution = { ...externalGoodExecution, afterStateDigest: d('tampered') };
const invalidExternalExecution = reconciler.reconcile({ readinessReceipt, executionReceipt: tamperedExternalExecution, observation: externalGoodObservation });
assert.equal(invalidExternalExecution.status, 'contained');
assert.equal(invalidExternalExecution.reason, 'external-execution-receipt-invalid');

assert.throws(() => createT3ExternalExecutionReconciler({ readinessGate, maxObservationAgeMs: 999 }), /between 1 second and 10 minutes/);

console.log(JSON.stringify({
  schemaVersion: 2,
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
  externalExecutionPostChangeReconciliationAdded: true,
  customerControlledExternalAuthorityRequired: true,
  independentReadOnlyObserverRequired: true,
  executorObserverSeparationRequired: true,
  exactExpectedPostStateRequired: true,
  businessSecurityTenantInvariantRequired: true,
  staleObservationFailsSafeToRollbackRequired: true,
  crossTenantExternalExecutionContained: true,
  outOfWindowExternalExecutionFailsSafeToRollbackRequired: true,
  modelExecutionAuthorityFailsSafeToRollbackRequired: true,
  rollbackRecommendationDoesNotGrantAuthority: true,
  customerMutation: false,
  productionMutation: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
}, null, 2));
