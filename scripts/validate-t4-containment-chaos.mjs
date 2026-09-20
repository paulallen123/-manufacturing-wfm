import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT4ContainmentController, createWriteOnceForensicStore } = require('../resilience/t4-containment-controller.cjs');
const { createT4RuntimeContainmentController, digest: t4Digest } = require('../resilience/t4-forensic-failover-store.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const canarySecret = 'executor-only-secret-canary';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-t4-forensics-'));
const forensicStore = createWriteOnceForensicStore({ rootDir: tmpRoot, now: () => 1700000000000 });

const executorCalls = [];
const containmentExecutor = {
  execute: async (request) => {
    executorCalls.push(structuredClone(request));
    assert.equal(JSON.stringify(request).includes(canarySecret), false);
    assert.equal(request.tenant, 'tenant-a');
    return { verified: true, containmentDigest: d(['containment', request.incidentId, request.actions.join(',')].join('|')), productionAuthorityGranted: false, crossTenantMutation: false };
  },
};
const rollbackCalls = [];
const rollbackExecutor = {
  rollback: async (request) => {
    rollbackCalls.push(structuredClone(request));
    assert.equal(request.tenant, 'tenant-a');
    assert.equal(JSON.stringify(request).includes(canarySecret), false);
    return { verified: true, rollbackDigest: d(['rollback', request.incidentId, request.knownGoodArtifactDigest].join('|')), productionAuthorityGranted: false, crossTenantMutation: false };
  },
};

let tick = 1000;
const controller = createT4ContainmentController({ containmentExecutor, rollbackExecutor, forensicStore, now: () => ++tick, maxActions: 4 });
const base = { tenant: 'tenant-a', evidenceDigest: d('evidence') };

const prompt = await controller.handle({
  ...base,
  incidentId: 't4-prompt',
  scenarioId: 'prompt-injection-or-untrusted-influence',
  requestedAction: 'production.force-promote',
  threat: { promptInjection: true, untrustedToolInstruction: true },
});
assert.equal(prompt.outcome, 'contained');
assert.equal(prompt.requestedActionExecuted, false);
assert.equal(prompt.modelAuthorityGranted, false);
assert(prompt.plannedContainmentActions.includes('deny-model-tool-authority'));
assert(prompt.plannedContainmentActions.includes('quarantine-support-context'));
assert.equal(prompt.forensicReceipt.immutable, true);
assert.equal(prompt.forensicReceipt.storageMode, 'write-once-exclusive');
assert.equal(controller.verifyReceipt(prompt), true);

const memory = await controller.handle({
  ...base,
  incidentId: 't4-memory',
  scenarioId: 'prompt-injection-or-untrusted-influence',
  threat: { memoryPoisoning: true },
});
assert.equal(memory.outcome, 'contained');
assert(memory.plannedContainmentActions.includes('quarantine-support-context'));
assert.equal(controller.verifyReceipt(memory), true);

const exfil = await controller.handle({
  ...base,
  incidentId: 't4-exfil',
  scenarioId: 'prompt-injection-or-untrusted-influence',
  threat: { credentialExfiltrationAttempt: true, credentialDisclosureConfirmed: false },
});
assert.equal(exfil.outcome, 'contained');
assert.equal(exfil.credentialMaterialExposedToModel, false);
assert.equal(JSON.stringify(exfil).includes(canarySecret), false);
assert.equal(controller.verifyReceipt(exfil), true);

const disclosed = await controller.handle({
  ...base,
  incidentId: 't4-credential-disclosed',
  scenarioId: 'permission-or-identity-anomaly',
  threat: { credentialDisclosureConfirmed: true, credentialReferenceDigest: d('credential-reference'), revocationPreauthorised: false },
});
assert.equal(disclosed.outcome, 'security_or_legal_authority_required');
assert(disclosed.plannedContainmentActions.includes('quarantine-confirmed-credential-reference'));
assert.equal(controller.verifyReceipt(disclosed), true);

const provenance = await controller.handle({
  ...base,
  incidentId: 't4-provenance',
  scenarioId: 'artifact-tampering-or-provenance-drift',
  provenance: { expectedArtifactDigest: d('expected-artifact'), observedArtifactDigest: d('tampered-artifact'), signatureVerified: false },
});
assert.equal(provenance.outcome, 'contained');
assert(provenance.plannedContainmentActions.includes('quarantine-candidate-artifact'));
assert.equal(controller.verifyReceipt(provenance), true);

const supportFailure = await controller.handle({
  ...base,
  incidentId: 't4-support-down',
  scenarioId: 'support-system-failure',
  supportSystem: { available: false, contextIntegrity: false },
});
assert.equal(supportFailure.outcome, 'contained');
assert(supportFailure.plannedContainmentActions.includes('use-static-safe-runbook'));
assert.equal(controller.verifyReceipt(supportFailure), true);

const rollback = await controller.handle({
  ...base,
  incidentId: 't4-bad-release',
  scenarioId: 'bad-release',
  rollbackRequested: true,
  knownGood: {
    available: true,
    schemaCompatible: true,
    independentlyVerified: true,
    signatureVerified: true,
    artifactDigest: d('known-good-artifact'),
    verificationDigest: d('known-good-verification'),
  },
});
assert.equal(rollback.outcome, 'rolled_back_to_known_good');
assert.equal(rollback.rollbackReceipt.verified, true);
assert.equal(controller.verifyReceipt(rollback), true);

const rollbackDenied = await controller.handle({
  ...base,
  incidentId: 't4-bad-release-unsafe-rollback',
  scenarioId: 'bad-release',
  rollbackRequested: true,
  knownGood: {
    available: true,
    schemaCompatible: false,
    independentlyVerified: true,
    signatureVerified: true,
    artifactDigest: d('known-good-artifact'),
    verificationDigest: d('known-good-verification'),
  },
});
assert.equal(rollbackDenied.outcome, 'contained');
assert.equal(rollbackDenied.rollbackReceipt, null);
assert.equal(controller.verifyReceipt(rollbackDenied), true);

const crossTenant = await controller.handle({
  ...base,
  incidentId: 't4-cross-tenant',
  scenarioId: 'cross-tenant-access-attempt',
  targetTenant: 'tenant-b',
  rollbackRequested: true,
  knownGood: {
    available: true,
    schemaCompatible: true,
    independentlyVerified: true,
    signatureVerified: true,
    artifactDigest: d('known-good-artifact'),
    verificationDigest: d('known-good-verification'),
  },
});
assert.equal(crossTenant.outcome, 'contained');
assert(crossTenant.plannedContainmentActions.includes('deny-cross-tenant-action'));
assert.equal(crossTenant.rollbackReceipt, null);
assert.equal(controller.verifyReceipt(crossTenant), true);

const runaway = await controller.handle({
  ...base,
  incidentId: 't4-runaway',
  scenarioId: 'runaway-repair-loop',
  threat: { repairBudgetExceeded: true },
});
assert.equal(runaway.outcome, 'contained');
assert(runaway.plannedContainmentActions.includes('halt-repair-mutations'));
assert.equal(controller.verifyReceipt(runaway), true);

const unknown = await controller.handle({
  ...base,
  incidentId: 't4-unknown',
  scenarioId: 'novel-never-seen-before',
});
assert.equal(unknown.outcome, 'contained');
assert(unknown.plannedContainmentActions.includes('unknown-fault-isolation'));
assert.equal(controller.verifyReceipt(unknown), true);

const tampered = structuredClone(prompt);
tampered.plannedContainmentActions.push('production.force-promote');
assert.equal(controller.verifyReceipt(tampered), false);

const hostileController = createT4ContainmentController({
  forensicStore,
  containmentExecutor: {
    execute: async () => ({ verified: true, containmentDigest: d('hostile'), productionAuthorityGranted: true }),
  },
  now: () => ++tick,
});
await assert.rejects(
  hostileController.handle({ ...base, incidentId: 't4-hostile-executor', scenarioId: 'prompt-injection-or-untrusted-influence', threat: { promptInjection: true } }),
  (error) => error?.code === 'WFM_T4_CONTAINMENT_VERIFY',
);

const mutableForensicsController = createT4ContainmentController({
  forensicStore: {
    preserve: async () => ({ verified: true, immutable: false, forensicDigest: d('mutable-evidence') }),
  },
  now: () => ++tick,
});
await assert.rejects(
  mutableForensicsController.handle({ ...base, incidentId: 't4-mutable-forensics', scenarioId: 'audit-trail-degraded' }),
  (error) => error?.code === 'WFM_T4_FORENSICS_VERIFY',
);

const missingForensicsController = createT4ContainmentController({ now: () => ++tick });
await assert.rejects(
  missingForensicsController.handle({ ...base, incidentId: 't4-no-forensics', scenarioId: 'audit-trail-degraded' }),
  (error) => error?.code === 'WFM_T4_FORENSICS_UNAVAILABLE',
);

const retryStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-t4-idempotent-'));
const retryStore = createWriteOnceForensicStore({ rootDir: retryStoreRoot, now: () => 1800000000000 });
const preservationRequest = {
  incidentId: 'forensic-idempotent-retry',
  tenant: 'tenant-a',
  scenarioId: 'audit-trail-degraded',
  evidenceDigest: d('retry-evidence'),
  eventHeadDigest: d('retry-event-head'),
};
const firstPreserve = retryStore.preserve(preservationRequest);
const secondPreserve = retryStore.preserve(preservationRequest);
assert.equal(firstPreserve.forensicDigest, secondPreserve.forensicDigest);
assert.equal(firstPreserve.storageKey, secondPreserve.storageKey);
assert.equal(retryStore.verify(firstPreserve), true);
const forensicFile = path.join(retryStoreRoot, firstPreserve.tenantDigest, `${firstPreserve.storageKey}.json`);
fs.chmodSync(forensicFile, 0o600);
fs.appendFileSync(forensicFile, 'tamper');
assert.equal(retryStore.verify(firstPreserve), false);

const runtimeEvidenceDigest = d('pre-existing-zero-cost-forensic-runtime-evidence');
const runtimeCapability = (identity) => Object.freeze({
  preExisting: true,
  sameTenantOnly: true,
  isolated: true,
  writeOnce: true,
  independentlyVerifiable: true,
  incrementalCostZero: true,
  productionWriteAuthority: false,
  modelVisibleReusableSecrets: false,
  createsResources: false,
  eligibilityEvidenceDigest: runtimeEvidenceDigest,
  storeIdentityDigest: d(`forensic-runtime-identity:${identity}`),
});
const runtimePrimaryBase = createWriteOnceForensicStore({ rootDir: path.join(tmpRoot, 'runtime-primary'), now: () => 1900000000000 });
const runtimeSecondary = createWriteOnceForensicStore({ rootDir: path.join(tmpRoot, 'runtime-secondary'), now: () => 1900000000000 });
let runtimePrimaryAttempts = 0;
const runtimeFailingPrimary = {
  preserve: async () => {
    runtimePrimaryAttempts += 1;
    const error = new Error('synthetic strict-runtime primary forensic outage');
    error.code = 'WFM_T4_FORENSICS_SYNTHETIC_RUNTIME_OUTAGE';
    throw error;
  },
  verify: runtimePrimaryBase.verify,
};

assert.throws(
  () => createT4RuntimeContainmentController({
    stores: [{ id: 'only-runtime-sink', capability: runtimeCapability('only'), store: runtimeSecondary }],
  }),
  (error) => error?.code === 'WFM_T4_FORENSICS_RUNTIME_ATTESTATION',
  'Actual T4 runtime construction must refuse a single forensic sink.',
);
assert.throws(
  () => createT4RuntimeContainmentController({
    stores: [
      { id: 'runtime-alias-a', capability: runtimeCapability('same-sink'), store: runtimePrimaryBase },
      { id: 'runtime-alias-b', capability: runtimeCapability('same-sink'), store: runtimeSecondary },
    ],
  }),
  (error) => error?.code === 'WFM_T4_FORENSICS_RUNTIME_IDENTITY',
  'Actual T4 runtime construction must refuse duplicate attested forensic identity.',
);

const runtimeController = createT4RuntimeContainmentController({
  stores: [
    { id: 'runtime-primary', capability: runtimeCapability('primary'), store: runtimeFailingPrimary },
    { id: 'runtime-secondary', capability: runtimeCapability('secondary'), store: runtimeSecondary },
  ],
  maxAttempts: 2,
  requiredEligibleStores: 2,
  now: () => ++tick,
});
const runtimeTerminal = await runtimeController.handle({
  ...base,
  incidentId: 't4-runtime-primary-forensic-outage',
  scenarioId: 'support-system-failure',
  supportSystem: { available: false, contextIntegrity: false },
});
assert.equal(runtimePrimaryAttempts, 1, 'Strict T4 runtime may make only the bounded primary forensic attempt before failover.');
assert.equal(runtimeTerminal.safeTerminal, true);
assert.equal(runtimeTerminal.runtimeForensicReady, true);
assert.match(runtimeTerminal.runtimeForensicReadinessDigest, /^[a-f0-9]{64}$/);
assert.match(runtimeTerminal.runtimeForensicFailoverContractDigest, /^[a-f0-9]{64}$/);
assert.match(runtimeTerminal.runtimeForensicBindingDigest, /^[a-f0-9]{64}$/);
assert.match(runtimeTerminal.innerContainmentReceiptDigest, /^[a-f0-9]{64}$/);
assert.equal(runtimeTerminal.runtimeRequiredEligibleStores, 2);
assert.equal(runtimeTerminal.runtimeExecutableStoreCount, 2);
assert.equal(runtimeTerminal.runtimeFinalReadbackRecoveryMaxAttempts, 1);
assert.equal(runtimeTerminal.forensicReceipt.storageMode, 'write-once-failover:runtime-secondary');
assert.equal(runtimeTerminal.productionAuthorityGranted, false);
assert.equal(runtimeTerminal.customerMutation, false);
assert.equal(runtimeController.verifyReceipt(runtimeTerminal), true);

const recoveryPrimaryBase = createWriteOnceForensicStore({ rootDir: path.join(tmpRoot, 'runtime-final-recovery-primary'), now: () => 1910000000000 });
const recoverySecondaryBase = createWriteOnceForensicStore({ rootDir: path.join(tmpRoot, 'runtime-final-recovery-secondary'), now: () => 1910000000000 });
let recoveryPrimaryVerifyCalls = 0;
let recoverySecondaryPreserveCalls = 0;
let recoveryContainmentCalls = 0;
const recoveryPrimary = {
  preserve: recoveryPrimaryBase.preserve,
  verify: async (receipt) => {
    recoveryPrimaryVerifyCalls += 1;
    if (recoveryPrimaryVerifyCalls >= 2) return false;
    return recoveryPrimaryBase.verify(receipt);
  },
};
const recoverySecondary = {
  preserve: async (request) => {
    recoverySecondaryPreserveCalls += 1;
    return recoverySecondaryBase.preserve(request);
  },
  verify: recoverySecondaryBase.verify,
};
const recoveryController = createT4RuntimeContainmentController({
  stores: [
    { id: 'recovery-primary', capability: runtimeCapability('recovery-primary'), store: recoveryPrimary },
    { id: 'recovery-secondary', capability: runtimeCapability('recovery-secondary'), store: recoverySecondary },
  ],
  maxAttempts: 2,
  requiredEligibleStores: 2,
  containmentExecutor: {
    execute: async (request) => {
      recoveryContainmentCalls += 1;
      return { verified: true, containmentDigest: d(`recovery-containment:${request.incidentId}`), productionAuthorityGranted: false, crossTenantMutation: false };
    },
  },
  now: () => ++tick,
});
const recoveredTerminal = await recoveryController.handle({
  ...base,
  incidentId: 't4-final-readback-corrupted-after-preservation',
  scenarioId: 'support-system-failure',
  supportSystem: { available: false, contextIntegrity: false },
});
assert.equal(recoveryPrimaryVerifyCalls, 2, 'Primary sink must pass initial verification then fail the terminal read-back once.');
assert.equal(recoverySecondaryPreserveCalls, 1, 'Final read-back recovery must make only one bounded re-preservation attempt.');
assert.equal(recoveryContainmentCalls, 1, 'Forensic recovery must not replay or duplicate the containment business outcome.');
assert.equal(recoveredTerminal.safeTerminal, true);
assert.equal(recoveredTerminal.forensicReceipt.finalReadbackRecoveryUsed, true);
assert.equal(recoveredTerminal.forensicReceipt.finalReadbackRecoveryFromStoreId, 'recovery-primary');
assert.equal(recoveredTerminal.forensicReceipt.selectedStoreId, 'recovery-secondary');
assert.match(recoveredTerminal.forensicReceipt.finalReadbackRecoveryAttemptDigest, /^[a-f0-9]{64}$/);
assert.equal(recoveryController.verifyReceipt(recoveredTerminal), true);

const exhaustedPrimaryBase = createWriteOnceForensicStore({ rootDir: path.join(tmpRoot, 'runtime-final-recovery-exhausted-primary'), now: () => 1920000000000 });
let exhaustedPrimaryVerifyCalls = 0;
let exhaustedSecondaryPreserveCalls = 0;
let exhaustedContainmentCalls = 0;
const exhaustedPrimary = {
  preserve: exhaustedPrimaryBase.preserve,
  verify: async (receipt) => {
    exhaustedPrimaryVerifyCalls += 1;
    if (exhaustedPrimaryVerifyCalls >= 2) return false;
    return exhaustedPrimaryBase.verify(receipt);
  },
};
const exhaustedSecondary = {
  preserve: async () => {
    exhaustedSecondaryPreserveCalls += 1;
    const error = new Error('synthetic final-readback recovery sink outage');
    error.code = 'WFM_T4_FORENSICS_SYNTHETIC_FINAL_RECOVERY_OUTAGE';
    throw error;
  },
  verify: async () => false,
};
const exhaustedRecoveryController = createT4RuntimeContainmentController({
  stores: [
    { id: 'exhausted-primary', capability: runtimeCapability('exhausted-primary'), store: exhaustedPrimary },
    { id: 'exhausted-secondary', capability: runtimeCapability('exhausted-secondary'), store: exhaustedSecondary },
  ],
  maxAttempts: 2,
  requiredEligibleStores: 2,
  containmentExecutor: {
    execute: async (request) => {
      exhaustedContainmentCalls += 1;
      return { verified: true, containmentDigest: d(`exhausted-containment:${request.incidentId}`), productionAuthorityGranted: false, crossTenantMutation: false };
    },
  },
  now: () => ++tick,
});
await assert.rejects(
  exhaustedRecoveryController.handle({
    ...base,
    incidentId: 't4-final-readback-recovery-exhausted',
    scenarioId: 'support-system-failure',
    supportSystem: { available: false, contextIntegrity: false },
  }),
  (error) => error?.code === 'WFM_T4_FORENSICS_FINAL_VERIFY'
    && error?.causeCode === 'WFM_T4_FORENSICS_FINAL_RECOVERY_EXHAUSTED',
  'If the one different-sink recovery attempt fails, T4 must remain fail closed rather than emit safeTerminal:true.',
);
assert.equal(exhaustedPrimaryVerifyCalls, 2);
assert.equal(exhaustedSecondaryPreserveCalls, 1, 'Recovery exhaustion must not retry the failed secondary blindly.');
assert.equal(exhaustedContainmentCalls, 1, 'Fail-closed forensic recovery must not duplicate the containment outcome.');

const forgedRuntimeBinding = structuredClone(runtimeTerminal);
forgedRuntimeBinding.runtimeForensicReadinessDigest = d('forged-runtime-readiness');
forgedRuntimeBinding.runtimeForensicBindingDigest = t4Digest({
  innerContainmentReceiptDigest: forgedRuntimeBinding.innerContainmentReceiptDigest,
  forensicDigest: forgedRuntimeBinding.forensicReceipt?.forensicDigest || null,
  runtimeForensicReadinessDigest: forgedRuntimeBinding.runtimeForensicReadinessDigest,
  runtimeForensicFailoverContractDigest: forgedRuntimeBinding.runtimeForensicFailoverContractDigest,
  requiredEligibleStores: forgedRuntimeBinding.runtimeRequiredEligibleStores,
  executableStoreCount: forgedRuntimeBinding.runtimeExecutableStoreCount,
  finalReadbackRecoveryMaxAttempts: forgedRuntimeBinding.runtimeFinalReadbackRecoveryMaxAttempts,
});
delete forgedRuntimeBinding.receiptDigest;
forgedRuntimeBinding.receiptDigest = t4Digest(forgedRuntimeBinding);
assert.equal(
  runtimeController.verifyReceipt(forgedRuntimeBinding),
  false,
  'Recomputed outer receipt digests must not allow a terminal to migrate to a different forensic runtime contract.',
);

assert.equal(rollbackCalls.length, 1, 'Only the independently verified schema-safe known-good case may roll back.');
assert.equal(executorCalls.some((call) => call.tenant !== 'tenant-a'), false);

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(retryStoreRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 'tier4-adversarial-containment-chaos',
  status: 'PASS',
  cases: 23,
  promptInjectionContained: true,
  memoryPoisoningContained: true,
  credentialExfiltrationContainedWithoutSecretVisibility: true,
  confirmedCredentialDisclosureRequiresNarrowSecurityAuthority: true,
  provenanceTamperQuarantined: true,
  supportSystemFailureHasStaticSafePath: true,
  badReleaseKnownGoodRollbackVerified: true,
  unsafeRollbackDenied: true,
  crossTenantRollbackDenied: true,
  runawayRepairContained: true,
  unknownFailureContained: true,
  receiptTamperDetected: true,
  hostileContainmentAuthorityRejected: true,
  writeOnceForensicsVerified: true,
  mutableForensicsRejected: true,
  missingForensicsRejected: true,
  forensicRetryIdempotent: true,
  forensicPostWriteTamperDetected: true,
  strictRuntimeRequiresIndependentForensicSinks: true,
  strictRuntimePrimaryToSecondaryFailoverBounded: true,
  finalReadbackCorruptionRecoveredToDistinctSink: true,
  finalReadbackRecoveryExhaustionFailsClosed: true,
  finalReadbackRecoveryDoesNotDuplicateContainment: true,
  safeTerminalBoundToRuntimeReadinessDigest: true,
  recomputedRuntimeBindingForgeryRejected: true,
  productionAuthorityGranted: false,
  customerMutation: false,
}, null, 2));