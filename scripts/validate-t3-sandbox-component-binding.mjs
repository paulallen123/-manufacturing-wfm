import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createT3DeterministicExecutionSandbox,
  createT3ExternalExecutionReconciler,
  digest,
} = require('../resilience/t3-deterministic-execution-sandbox.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');

function seal(value, field) {
  const core = { ...value };
  delete core[field];
  return { ...core, [field]: digest(core) };
}

function verifySealed(receipt, field) {
  if (!receipt?.[field]) return false;
  const core = { ...receipt };
  const expected = core[field];
  delete core[field];
  return expected === digest(core);
}

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

function externalReadinessReceipt() {
  return seal(readinessReceipt(), 'readinessReceiptDigest');
}

function externalExecution(rr, overrides = {}) {
  return seal({
    schemaVersion: 1,
    status: 'executed',
    executorType: 'deterministic-external-executor',
    authoritySource: 'customer-controlled-external-authority',
    executorId: 'external-executor-1',
    tenant: rr.tenant,
    scenarioId: rr.scenarioId,
    incidentId: rr.incidentId,
    proposalDigest: rr.proposalDigest,
    readinessReceiptDigest: rr.readinessReceiptDigest,
    executionPlanDigest: rr.executionPlanDigest,
    idempotencyKeyDigest: rr.idempotencyKeyDigest,
    beforeStateDigest: rr.currentStateDigest,
    afterStateDigest: rr.expectedAfterStateDigest,
    affectedRecords: rr.affectedRecords,
    oneShotAuthorityConsumed: true,
    durableReplayProtection: true,
    externalAuthorityReceiptDigest: d('external-authority'),
    modelAuthorityUsed: false,
    llmDecisionAuthorityUsed: false,
    executedAt: 5000,
    ...overrides,
  }, 'executionReceiptDigest');
}

function externalObservation(rr, executionReceipt, overrides = {}) {
  return seal({
    schemaVersion: 1,
    observerType: 'independent-read-only-reconciler',
    observerId: 'independent-observer-1',
    readOnly: true,
    writeAuthority: false,
    modelAuthorityUsed: false,
    tenant: rr.tenant,
    scenarioId: rr.scenarioId,
    incidentId: rr.incidentId,
    proposalDigest: rr.proposalDigest,
    readinessReceiptDigest: rr.readinessReceiptDigest,
    executionReceiptDigest: executionReceipt.executionReceiptDigest,
    observedStateDigest: rr.expectedAfterStateDigest,
    businessInvariantPassed: true,
    securityPassed: true,
    tenantIsolationPassed: true,
    observedAt: 6000,
    ...overrides,
  }, 'observationDigest');
}

function createExecutionVerifier(hooks = {}) {
  const verifier = {
    capability: {
      verifierId: 'execution-provenance-verifier-1',
      scope: 'external-execution-receipt-provenance-only',
      readOnly: true,
      writeAuthority: false,
      modelAuthority: false,
      customerMutation: false,
      productionMutation: false,
    },
    verifyExecutionReceipt({ readinessReceipt: rr, executionReceipt }) {
      if (hooks.onVerify) hooks.onVerify(verifier);
      return seal({
        schemaVersion: 1,
        verified: true,
        verifierId: 'execution-provenance-verifier-1',
        scope: 'external-execution-receipt-provenance-only',
        readOnly: true,
        writeAuthority: false,
        modelAuthorityUsed: false,
        customerMutation: false,
        productionMutation: false,
        tenant: rr.tenant,
        scenarioId: rr.scenarioId,
        incidentId: rr.incidentId,
        proposalDigest: rr.proposalDigest,
        readinessReceiptDigest: rr.readinessReceiptDigest,
        executionReceiptDigest: executionReceipt.executionReceiptDigest,
        externalAuthorityReceiptDigest: executionReceipt.externalAuthorityReceiptDigest,
        trustRootDigest: d('customer-controlled-execution-trust-root'),
        attestedAt: 5500,
      }, 'attestationDigest');
    },
  };
  return verifier;
}

function createObservationVerifier(hooks = {}) {
  const verifier = {
    capability: {
      verifierId: 'observation-provenance-verifier-1',
      scope: 'external-observation-provenance-only',
      readOnly: true,
      writeAuthority: false,
      modelAuthority: false,
      customerMutation: false,
      productionMutation: false,
    },
    verifyObservation({ readinessReceipt: rr, executionReceipt, observation }) {
      if (hooks.onVerify) hooks.onVerify(verifier);
      return seal({
        schemaVersion: 1,
        verified: true,
        verifierId: 'observation-provenance-verifier-1',
        scope: 'external-observation-provenance-only',
        readOnly: true,
        writeAuthority: false,
        modelAuthorityUsed: false,
        customerMutation: false,
        productionMutation: false,
        tenant: rr.tenant,
        scenarioId: rr.scenarioId,
        incidentId: rr.incidentId,
        proposalDigest: rr.proposalDigest,
        readinessReceiptDigest: rr.readinessReceiptDigest,
        executionReceiptDigest: executionReceipt.executionReceiptDigest,
        observationDigest: observation.observationDigest,
        trustRootDigest: d('independent-observation-trust-root'),
        attestedAt: 6500,
      }, 'attestationDigest');
    },
  };
  return verifier;
}

function createReadinessGate(hook = null) {
  return {
    verifyReceipt(receipt) {
      if (hook) hook();
      return verifySealed(receipt, 'readinessReceiptDigest');
    },
  };
}

function createReconcilerFixture({ readinessHook = null, executionHooks = {}, observationHooks = {} } = {}) {
  const rr = externalReadinessReceipt();
  const execution = externalExecution(rr);
  const observation = externalObservation(rr, execution);
  const executionVerifier = createExecutionVerifier(executionHooks);
  const observationVerifier = createObservationVerifier(observationHooks);
  const readinessGate = createReadinessGate(readinessHook);
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate,
    executionProvenanceVerifier: executionVerifier,
    observationProvenanceVerifier: observationVerifier,
    now: () => 7000,
    maxObservationAgeMs: 60_000,
  });
  return { rr, execution, observation, executionVerifier, observationVerifier, readinessGate, reconciler };
}

// Normal external reconciliation carries the pinned component binding into its receipt.
{
  const fixture = createReconcilerFixture();
  const result = fixture.reconciler.reconcile({
    readinessReceipt: fixture.rr,
    executionReceipt: fixture.execution,
    observation: fixture.observation,
  });
  assert.equal(result.status, 'externally-executed-reconciled');
  assert.equal(result.trustedComponentBindingVerified, true);
  assert.match(result.reconciliationComponentBindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(fixture.reconciler.verifyReceipt(result), true);
}

// A readiness verifier replaced after reconciler construction is rejected before it can influence evidence.
{
  const fixture = createReconcilerFixture();
  let forgedCalled = false;
  fixture.readinessGate.verifyReceipt = () => { forgedCalled = true; return true; };
  const result = fixture.reconciler.reconcile({
    readinessReceipt: fixture.rr,
    executionReceipt: fixture.execution,
    observation: fixture.observation,
  });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-before-reconcile');
  assert.equal(result.executionObserved, false);
  assert.equal(forgedCalled, false);
}

// A trusted readiness verifier cannot swap the execution-provenance verifier during the check.
{
  let executionVerifier;
  let forgedExecutionVerifierCalled = false;
  const rr = externalReadinessReceipt();
  const execution = externalExecution(rr);
  const observation = externalObservation(rr, execution);
  executionVerifier = createExecutionVerifier();
  const observationVerifier = createObservationVerifier();
  const readinessGate = createReadinessGate(() => {
    executionVerifier.verifyExecutionReceipt = () => {
      forgedExecutionVerifierCalled = true;
      return null;
    };
  });
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate,
    executionProvenanceVerifier: executionVerifier,
    observationProvenanceVerifier: observationVerifier,
    now: () => 7000,
  });
  const result = reconciler.reconcile({ readinessReceipt: rr, executionReceipt: execution, observation });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-during-readiness-verification');
  assert.equal(result.executionObserved, false);
  assert.equal(forgedExecutionVerifierCalled, false);
}

// The execution-provenance verifier cannot replace the independent observation verifier before execution evidence is trusted.
{
  let observationVerifier;
  let forgedObservationVerifierCalled = false;
  observationVerifier = createObservationVerifier();
  const executionVerifier = createExecutionVerifier({
    onVerify() {
      observationVerifier.verifyObservation = () => {
        forgedObservationVerifierCalled = true;
        return null;
      };
    },
  });
  const rr = externalReadinessReceipt();
  const execution = externalExecution(rr);
  const observation = externalObservation(rr, execution);
  const readinessGate = createReadinessGate();
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate,
    executionProvenanceVerifier: executionVerifier,
    observationProvenanceVerifier: observationVerifier,
    now: () => 7000,
  });
  const result = reconciler.reconcile({ readinessReceipt: rr, executionReceipt: execution, observation });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-during-execution-provenance-verification');
  assert.equal(result.executionObserved, false);
  assert.equal(forgedObservationVerifierCalled, false);
}

// If the observation verifier changes its own capability after external execution is authenticated, fail safe to rollback-required without minting rollback authority.
{
  const observationVerifier = createObservationVerifier({
    onVerify(verifier) {
      verifier.capability = { ...verifier.capability, modelAuthority: true };
    },
  });
  const rr = externalReadinessReceipt();
  const execution = externalExecution(rr);
  const observation = externalObservation(rr, execution);
  const readinessGate = createReadinessGate();
  const executionVerifier = createExecutionVerifier();
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate,
    executionProvenanceVerifier: executionVerifier,
    observationProvenanceVerifier: observationVerifier,
    now: () => 7000,
  });
  const result = reconciler.reconcile({ readinessReceipt: rr, executionReceipt: execution, observation });
  assert.equal(result.status, 'rollback-required-awaiting-external-authority');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-during-observation-provenance-verification');
  assert.equal(result.executionObserved, true);
  assert.equal(result.externalMutationObserved, true);
  assert.equal(result.trustedComponentBindingVerified, false);
  assert.equal(result.rollbackRequired, true);
  assert.equal(result.rollbackAuthority, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.productionAuthorityGranted, false);
  assert.equal(result.modelAuthorityGranted, false);
}

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'tier3-runtime-component-binding-sandbox-and-external-reconciliation',
  status: 'PASS',
  postConstructionReadinessSubstitutionRejected: true,
  midReadinessAuthoritySubstitutionRejected: true,
  midReadAdapterMutationSubstitutionRejected: true,
  postApplyRollbackSubstitutionRejected: true,
  capturedKnownGoodRollbackUsedAfterIsolatedMutation: true,
  externalReconcilerSuccessBindsTrustedComponents: true,
  externalReconcilerPostConstructionReadinessSubstitutionRejected: true,
  externalReconcilerMidReadinessExecutionVerifierSubstitutionRejected: true,
  externalReconcilerExecutionToObservationVerifierSubstitutionRejected: true,
  externalReconcilerVerifierCapabilityDriftRejected: true,
  postExecutionVerifierDriftFailsSafeToRollbackRequired: true,
  rollbackAuthorityGrantedOnDrift: false,
  productionMutation: false,
  customerMutation: false,
  modelAuthorityGranted: false,
}, null, 2));
