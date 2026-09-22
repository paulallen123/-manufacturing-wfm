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

function readinessReceipt() {
  return seal({
    schemaVersion: 2,
    status: 'execution-ready-awaiting-external-authority',
    tenant: 'tenant-a',
    scenarioId: 'payroll-calculation-or-export-anomaly',
    incidentId: 'inc-t3-capability-poisoning',
    proposedAction: 'payroll.correct-export',
    affectedRecords: 1,
    proposalDigest: d('proposal'),
    executionPlanDigest: d('execution-plan'),
    idempotencyKeyDigest: d('idempotency'),
    currentStateDigest: d('before'),
    expectedAfterStateDigest: d('after'),
    rollbackDigest: d('rollback'),
    compensationPlanDigest: d('compensation'),
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
  }, 'readinessReceiptDigest');
}

function sandboxAdapter(receipt) {
  let applyCount = 0;
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
    async readStateDigest() { return receipt.currentStateDigest; },
    async applyExactPlan() { applyCount += 1; return null; },
    async rollbackKnownGood() { return null; },
  };
}

// The low-level digest helper must convert cyclic graphs into an invalid digest,
// never an exception that escapes the support terminal path.
{
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(digest(cyclic), null);
}

// Invalid capability graphs are rejected before trust establishment.
{
  const receipt = readinessReceipt();
  const adapter = sandboxAdapter(receipt);
  adapter.capability.self = adapter.capability;
  assert.throws(
    () => createT3DeterministicExecutionSandbox({
      readinessGate: { verifyReceipt: () => true },
      authorityGate: { consume: async () => null },
      sandboxAdapter: adapter,
    }),
    /capability must be safely digestible/,
  );
}

// Capability poisoning after trust establishment must reach containment before mutation.
{
  const receipt = readinessReceipt();
  const adapter = sandboxAdapter(receipt);
  const sandbox = createT3DeterministicExecutionSandbox({
    readinessGate: { verifyReceipt: () => true },
    authorityGate: { consume: async () => null },
    sandboxAdapter: adapter,
    now: () => 5000,
  });
  adapter.capability.self = adapter.capability;
  const result = await sandbox.execute({
    readinessReceipt: receipt,
    authorityToken: 'never-consumed',
    executorId: 'deterministic-sandbox-executor-1',
  });
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-component-drift-before-execution');
  assert.equal(result.sandboxMutation, false);
  assert.equal(result.productionMutation, false);
  assert.equal(result.customerMutation, false);
  assert.equal(result.modelAuthorityGranted, false);
  assert.equal(adapter.applyCount, 0);
  assert.equal(sandbox.verifyReceipt(result), true);
}

function executionVerifier() {
  return {
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
        trustRootDigest: d('execution-trust-root'),
        attestedAt: 5500,
      }, 'attestationDigest');
    },
  };
}

function observationVerifier({ poisonDuringVerification = false } = {}) {
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
      if (poisonDuringVerification) verifier.capability.self = verifier.capability;
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
        trustRootDigest: d('observation-trust-root'),
        attestedAt: 6500,
      }, 'attestationDigest');
    },
  };
  return verifier;
}

function executionReceipt(rr) {
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
  }, 'executionReceiptDigest');
}

function observationReceipt(rr, execution) {
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
    executionReceiptDigest: execution.executionReceiptDigest,
    observedStateDigest: rr.expectedAfterStateDigest,
    businessInvariantPassed: true,
    securityPassed: true,
    tenantIsolationPassed: true,
    observedAt: 6000,
  }, 'observationDigest');
}

// A cyclic verifier capability introduced after construction must not throw.
{
  const rr = readinessReceipt();
  const execVerifier = executionVerifier();
  const obsVerifier = observationVerifier();
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate: { verifyReceipt: () => true },
    executionProvenanceVerifier: execVerifier,
    observationProvenanceVerifier: obsVerifier,
    now: () => 7000,
  });
  execVerifier.capability.self = execVerifier.capability;
  const result = reconciler.reconcile({});
  assert.equal(result.status, 'contained');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-before-reconcile');
  assert.equal(result.executionObserved, false);
  assert.equal(result.productionMutation, false);
  assert.equal(result.customerMutation, false);
  assert.equal(result.rollbackAuthority, false);
  assert.equal(reconciler.verifyReceipt(result), true);
}

// If capability poisoning occurs only while independently observing an already
// authenticated external execution, fail safely to rollback-required and never
// mint rollback or production authority.
{
  const rr = readinessReceipt();
  const execution = executionReceipt(rr);
  const observation = observationReceipt(rr, execution);
  const reconciler = createT3ExternalExecutionReconciler({
    readinessGate: { verifyReceipt: () => true },
    executionProvenanceVerifier: executionVerifier(),
    observationProvenanceVerifier: observationVerifier({ poisonDuringVerification: true }),
    now: () => 7000,
    maxObservationAgeMs: 60_000,
  });
  const result = reconciler.reconcile({ readinessReceipt: rr, executionReceipt: execution, observation });
  assert.equal(result.status, 'rollback-required-awaiting-external-authority');
  assert.equal(result.reason, 'trusted-reconciliation-component-drift-during-observation-provenance-verification');
  assert.equal(result.executionObserved, true);
  assert.equal(result.externalMutationObserved, true);
  assert.equal(result.rollbackRequired, true);
  assert.equal(result.rollbackAuthority, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.productionAuthorityGranted, false);
  assert.equal(result.modelAuthorityGranted, false);
  assert.equal(result.customerMutation, false);
  assert.equal(result.productionMutation, false);
  assert.equal(reconciler.verifyReceipt(result), true);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier3-capability-graph-poisoning-safe-terminal',
  status: 'PASS',
  cyclicDigestEscapes: 0,
  preTrustPoisonRejected: true,
  postTrustSandboxPoisonContained: true,
  postTrustReconcilerPoisonContained: true,
  postExecutionObservationPoisonRequiresExternalRollbackAuthority: true,
  rollbackAuthorityGranted: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
  customerMutation: false,
  productionMutation: false,
}, null, 2));
