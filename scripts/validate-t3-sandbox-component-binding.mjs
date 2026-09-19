import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3DeterministicExecutionSandbox, digest } = require('../resilience/t3-deterministic-execution-sandbox.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');

function readinessReceipt() {
  return {
    schemaVersion: 2,
    status: 'execution-ready-awaiting-external-authority',
    tenant: 'tenant-a',
    scenarioId: 'payroll-calculation-or-export-anomaly',
    incidentId: 'inc-t3-component-binding',
    proposedAction: 'payroll.correct-export',
    affectedRecords: 1,
    actionPolicyDigest: d('policy'),
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
    evaluatedAt: 1000,
    validUntil: 100000,
    readinessReceiptDigest: d('readiness'),
  };
}

function authorityReceipt(input) {
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
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    productionMutation: false,
  };
  return { ...core, authorityReceiptDigest: digest(core) };
}

function createAuthorityGate() {
  return {
    async consume(input) {
      return authorityReceipt(input);
    },
  };
}

function createAdapter(receipt, hooks = {}) {
  let state = receipt.currentStateDigest;
  let applyCount = 0;
  let rollbackCount = 0;
  const adapter = {
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
    async readStateDigest() {
      if (hooks.onRead) hooks.onRead(adapter);
      return state;
    },
    async applyExactPlan(input) {
      applyCount += 1;
      if (hooks.onApply) hooks.onApply(adapter);
      state = hooks.failPostcondition ? d('unexpected-after') : input.expectedAfterStateDigest;
      return {
        accepted: true,
        tenant: input.tenant,
        scenarioId: input.scenarioId,
        proposalDigest: input.proposalDigest,
        executionPlanDigest: input.executionPlanDigest,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        beforeStateDigest: input.expectedBeforeStateDigest,
        afterStateDigest: state,
        affectedRecords: input.affectedRecords,
        sandboxMutation: true,
        customerMutation: false,
        productionMutation: false,
        productionDataTouched: false,
        customerDataTouched: false,
        networkUsed: false,
        businessInvariantPassed: !hooks.failPostcondition,
        securityPassed: true,
        tenantIsolationPassed: true,
      };
    },
    async rollbackKnownGood(input) {
      rollbackCount += 1;
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
  return adapter;
}

let now = 5000;

// A readiness verifier replaced after trust establishment is rejected before it can execute.
{
  const receipt = readinessReceipt();
  const readinessGate = { verifyReceipt: () => true };
  const authorityGate = createAuthorityGate();
  const adapter = createAdapter(receipt);
  const sandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate, sandboxAdapter: adapter, now: () => ++now });
  let forgedCalled = false;
  readinessGate.verifyReceipt = () => { forgedCalled = true; return true; };
  const result = await sandbox.execute({ readinessReceipt: receipt, authorityToken: 'a', executorId: 'executor-a' });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-component-drift-before-execution');
  assert.equal(forgedCalled, false);
  assert.equal(adapter.applyCount, 0);
}

// A trusted readiness component cannot swap execution authority mid-verification.
{
  const receipt = readinessReceipt();
  const authorityGate = createAuthorityGate();
  let forgedAuthorityCalled = false;
  const originalConsume = authorityGate.consume;
  const readinessGate = {
    verifyReceipt() {
      authorityGate.consume = async () => { forgedAuthorityCalled = true; return { authorised: true }; };
      return true;
    },
  };
  const adapter = createAdapter(receipt);
  const sandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate, sandboxAdapter: adapter, now: () => ++now });
  const result = await sandbox.execute({ readinessReceipt: receipt, authorityToken: 'b', executorId: 'executor-b' });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-component-drift-before-execution');
  assert.equal(forgedAuthorityCalled, false);
  assert.equal(adapter.applyCount, 0);
  authorityGate.consume = originalConsume;
}

// A read-only adapter method cannot replace the mutation method before authority consumption/application.
{
  const receipt = readinessReceipt();
  const readinessGate = { verifyReceipt: () => true };
  const authorityGate = createAuthorityGate();
  let forgedApplyCalled = false;
  const adapter = createAdapter(receipt, {
    onRead(target) {
      target.applyExactPlan = async () => { forgedApplyCalled = true; return { accepted: true }; };
    },
  });
  const sandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate, sandboxAdapter: adapter, now: () => ++now });
  const result = await sandbox.execute({ readinessReceipt: receipt, authorityToken: 'c', executorId: 'executor-c' });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-component-drift-before-execution');
  assert.equal(forgedApplyCalled, false);
  assert.equal(adapter.applyCount, 0);
}

// If component drift occurs only after an isolated apply, the captured known-good rollback path is used.
{
  const receipt = readinessReceipt();
  const readinessGate = { verifyReceipt: () => true };
  const authorityGate = createAuthorityGate();
  let forgedRollbackCalled = false;
  const adapter = createAdapter(receipt, {
    failPostcondition: true,
    onApply(target) {
      target.rollbackKnownGood = async () => { forgedRollbackCalled = true; return { verified: true }; };
    },
  });
  const sandbox = createT3DeterministicExecutionSandbox({ readinessGate, authorityGate, sandboxAdapter: adapter, now: () => ++now });
  const result = await sandbox.execute({ readinessReceipt: receipt, authorityToken: 'd', executorId: 'executor-d' });
  assert.equal(result.status, 'sandbox-rolled-back-known-good');
  assert.equal(result.reason, 'trusted-component-drift-after-sandbox-apply');
  assert.equal(result.automaticKnownGoodRollbackUsed, true);
  assert.equal(forgedRollbackCalled, false);
  assert.equal(adapter.applyCount, 1);
  assert.equal(adapter.rollbackCount, 1);
  assert.equal(result.productionMutation, false);
  assert.equal(result.customerMutation, false);
  assert.equal(sandbox.verifyReceipt(result), true);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier3-deterministic-sandbox-runtime-component-binding',
  status: 'PASS',
  postConstructionReadinessSubstitutionRejected: true,
  midReadinessAuthoritySubstitutionRejected: true,
  midReadAdapterMutationSubstitutionRejected: true,
  postApplyRollbackSubstitutionRejected: true,
  capturedKnownGoodRollbackUsedAfterIsolatedMutation: true,
  productionMutation: false,
  customerMutation: false,
  modelAuthorityGranted: false,
}, null, 2));
