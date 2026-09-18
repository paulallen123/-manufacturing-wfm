import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT4ContainmentController } = require('../resilience/t4-containment-controller.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const canarySecret = 'executor-only-secret-canary';

const executorCalls = [];
const containmentExecutor = {
  execute: async (request) => {
    executorCalls.push(structuredClone(request));
    assert.equal(JSON.stringify(request).includes(canarySecret), false);
    assert.equal(request.tenant, 'tenant-a');
    return { verified: true, containmentDigest: d(['containment', request.incidentId, request.actions.join(',')].join('|')), productionAuthorityGranted: false, crossTenantMutation: false };
  },
};
const forensicStore = {
  preserve: async ({ incidentId, tenant, evidenceDigest }) => ({
    verified: true,
    immutable: true,
    forensicDigest: d(['forensic', incidentId, tenant, evidenceDigest].join('|')),
  }),
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

assert.equal(rollbackCalls.length, 1, 'Only the independently verified schema-safe known-good case may roll back.');
assert.equal(executorCalls.some((call) => call.tenant !== 'tenant-a'), false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier4-adversarial-containment-chaos',
  status: 'PASS',
  cases: 13,
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
  productionAuthorityGranted: false,
  customerMutation: false,
}, null, 2));
