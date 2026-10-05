import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop, digest, canonical } = require('../resilience/autonomy-control-loop.cjs');
const { createAutonomousRepairCanaryOrchestrator } = require('../resilience/autonomous-repair-canary-orchestrator.cjs');
const { createCanaryRollbackController } = require('../resilience/canary-rollback-controller.cjs');
const { createDurableReplayGuard } = require('../resilience/durable-poststaging-replay-guard.cjs');
const contract = require('../resilience/support-tier-contract.json');
const failureScenarios = require('../resilience/failure-scenarios.json');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-t2-poststaging-'));
const dbPath = path.join(dir, 'authority.sqlite');
const keys = generateKeyPairSync('ed25519');
let db = new DatabaseSync(dbPath);
let repairCalls = 0;
let canaryCalls = 0;
let rollbackCalls = 0;
let recordCalls = 0;

const controlInput = Object.freeze({
  incidentId: 't2-poststaging-incident',
  tenant: 'isolated-a',
  scenarioId: 'unknown-customer-reported-issue',
  evidenceDigest: digest('detected-synthetic-fault'),
});
const postInput = Object.freeze({
  incidentId: controlInput.incidentId,
  tenant: controlInput.tenant,
  targetTenant: controlInput.tenant,
  workerId: 'repair-worker',
  verifierId: 'independent-verifier',
  releaseAuthorityId: 'release-authority',
  stagingControllerId: 'staging-controller',
  canaryControllerId: 'canary-controller',
  rollbackControllerId: 'rollback-controller',
});
const stagedCore = Object.freeze({
  status: 'verified_candidate_staged',
  independentlyVerified: true,
  exactArtifactStaged: true,
  candidateDigest: d('candidate'),
  artifactDigest: d('artifact'),
  rollbackDigest: d('rollback'),
  stagingReceiptDigest: d('staging'),
  verificationDigest: d('verification'),
  outcomeReceiptDigest: d('repair-outcome'),
  productionAuthorityGranted: false,
  productionMutation: false,
  customerMutation: false,
});

function signedRepair() {
  const report = { ...stagedCore };
  const payload = {
    schemaVersion: 1,
    tenant: controlInput.tenant,
    incidentId: controlInput.incidentId,
    scenarioId: controlInput.scenarioId,
    evidenceDigest: controlInput.evidenceDigest,
    requestDigest: digest(controlInput),
    action: 'repair.process',
    resultDigest: digest(report),
    verificationDigest: report.verificationDigest,
    issuedAt: 900,
    expiresAt: 2000,
  };
  return {
    ...report,
    verificationReceipt: {
      payload,
      signature: sign(
        null,
        Buffer.from('VECTOR_AUTONOMY_VERIFICATION_V1\n' + canonical(payload)),
        keys.privateKey
      ).toString('base64url'),
    },
  };
}

function recorder() {
  return {
    capabilities: () => ({
      appendOnly: true,
      durable: true,
      tamperEvident: true,
      customerDataStored: false,
      productionAuthority: false,
      customerWriteAuthority: false,
      incrementalCostZero: true,
    }),
    async record(payload) {
      recordCalls += 1;
      return { receiptDigest: d(JSON.stringify(payload)) };
    },
  };
}

function buildRuntime({ executeRepair = true, executeCanary = true } = {}) {
  const repairCoordinator = {
    async process() {
      repairCalls += 1;
      if (!executeRepair) throw new Error('repair must not re-execute');
      return signedRepair();
    },
  };
  const loop = createAutonomyControlLoop({
    contract,
    failureScenarios,
    authorityDb: db,
    verificationPublicKey: keys.publicKey,
    now: () => 1000,
    repairCoordinator,
  });

  const canaryExecutor = {
    capabilities: () => ({
      sameTenantEnforced: true,
      exactArtifactRequired: true,
      rollbackPreverifiedRequired: true,
      networkMode: 'none',
      reusableCredentialsVisible: false,
      modelCanGrantAuthority: false,
      customerDataVisible: false,
      incrementalCostZero: true,
      simulationOnly: true,
      productionWriteAuthority: false,
      customerWriteAuthority: false,
    }),
    async run(job) {
      canaryCalls += 1;
      if (!executeCanary) throw new Error('canary must not re-execute');
      return {
        status: 'unhealthy',
        acceptedArtifactDigest: job.artifactDigest,
        acceptedRollbackDigest: job.rollbackDigest,
        acceptedTenantDigest: job.tenantDigest,
        touchedInstances: 1,
        observedTrafficPercent: 5,
        canaryEvidenceDigest: d('failed-canary'),
        businessInvariantPassed: false,
        securityInvariantPassed: true,
        tenantInvariantPassed: true,
        duplicateOutcomeCount: 0,
        productionMutation: false,
        customerMutation: false,
        productionAuthority: false,
      };
    },
  };
  const rollbackExecutor = {
    capabilities: () => ({
      sameTenantEnforced: true,
      knownGoodOnly: true,
      schemaCompatibilityRequired: true,
      networkMode: 'none',
      reusableCredentialsVisible: false,
      modelCanGrantAuthority: false,
      customerDataVisible: false,
      incrementalCostZero: true,
      simulationOnly: true,
      productionWriteAuthority: false,
      customerWriteAuthority: false,
    }),
    async run(job) {
      rollbackCalls += 1;
      if (!executeCanary) throw new Error('rollback must not re-execute');
      return {
        status: 'rolled-back',
        acceptedRollbackDigest: job.rollbackDigest,
        acceptedArtifactDigest: job.artifactDigest,
        acceptedTenantDigest: job.tenantDigest,
        rollbackEvidenceDigest: d('rollback-evidence'),
        schemaCompatible: true,
        knownGoodVerified: true,
        productionMutation: false,
        customerMutation: false,
        productionAuthority: false,
      };
    },
  };
  const attestor = {
    capabilities: () => ({
      readOnly: true,
      networkMode: 'none',
      reusableCredentialsVisible: false,
      modelCanGrantAuthority: false,
      productionAuthority: false,
      customerWriteAuthority: false,
    }),
    async verify(input) {
      return {
        verified: true,
        schemaCompatible: true,
        signatureVerified: true,
        provenanceVerified: true,
        attestationDigest: d('known-good-attestation'),
        acceptedArtifactDigest: input.artifactDigest,
        acceptedRollbackDigest: input.rollbackDigest,
        acceptedTenantDigest: input.tenantDigest,
        acceptedStagingReceiptDigest: input.stagingReceiptDigest,
      };
    },
  };
  const canaryController = createCanaryRollbackController({
    canaryExecutor,
    rollbackExecutor,
    knownGoodAttestor: attestor,
    outcomeRecorder: recorder(),
    replayGuard: createDurableReplayGuard({ db }),
  });

  // The full repair pipeline is deliberately unavailable on this resume-only proof
  // path. Calling it would make the test fail and prove the handoff reran repair.
  const repairPipeline = {
    capabilities: () => ({
      independentVerificationRequired: true,
      exactArtifactStagingRequired: true,
      isolatedStagingOnly: true,
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      incrementalCostZero: true,
    }),
    async process() {
      repairCalls += 1;
      throw new Error('post-staging resume must not invoke repair pipeline');
    },
  };
  const orchestrator = createAutonomousRepairCanaryOrchestrator({
    repairPipeline,
    canaryController,
    outcomeRecorder: recorder(),
    replayGuard: createDurableReplayGuard({ db }),
  });
  return { loop, orchestrator };
}

let runtime = buildRuntime();
const tierReceipt = await runtime.loop.run(controlInput);
assert.equal(tierReceipt.tier, 'T2');
assert.equal(tierReceipt.outcome, 'verified_candidate_staged');
assert.equal(repairCalls, 1);
assert.equal(tierReceipt.repair.independentlyVerified, true);

const postReceipt = await runtime.orchestrator.resumeVerifiedRepair(postInput, tierReceipt.repair);
assert.equal(postReceipt.status, 'rolled_back_to_known_good');
assert.match(postReceipt.rollbackEvidenceDigest, /^[a-f0-9]{64}$/);
assert.equal(repairCalls, 1, 'post-staging handoff reran repair');
assert.equal(canaryCalls, 1);
assert.equal(rollbackCalls, 1);

const duplicatePost = await runtime.orchestrator.resumeVerifiedRepair(postInput, tierReceipt.repair);
assert.deepEqual(duplicatePost, postReceipt);
assert.equal(repairCalls, 1);
assert.equal(canaryCalls, 1);
assert.equal(rollbackCalls, 1);

db.close();
db = new DatabaseSync(dbPath);
runtime = buildRuntime({ executeRepair: false, executeCanary: false });
const tierAfterRestart = await runtime.loop.run(controlInput);
assert.deepEqual(tierAfterRestart, tierReceipt);
const postAfterRestart = await runtime.orchestrator.resumeVerifiedRepair(postInput, tierAfterRestart.repair);
assert.deepEqual(postAfterRestart, postReceipt);
assert.equal(repairCalls, 1);
assert.equal(canaryCalls, 1);
assert.equal(rollbackCalls, 1);

assert.equal(runtime.orchestrator.capabilities().verifiedRepairResumeSupported, true);
assert.equal(runtime.orchestrator.capabilities().productionAuthority, false);
assert.equal(runtime.orchestrator.capabilities().customerMutation, false);

db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 't2-to-poststaging-single-execution-handoff',
  status: 'PASS',
  sequence: [
    'T2_CLASSIFIED',
    'REPAIR_STAGED_ONCE',
    'INDEPENDENT_VERIFICATION_ACCEPTED',
    'VERIFIED_REPAIR_RESUMED',
    'CANARY_VERIFY_FAILED',
    'KNOWN_GOOD_ROLLBACK',
    'DURABLE_RESTART_READBACK',
    'DUPLICATE_REPLAY_NO_ACTION',
  ],
  repairCalls,
  canaryCalls,
  rollbackCalls,
  restartReadback: true,
  replayIdempotent: true,
  verifiedRepairResumeSupported: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
