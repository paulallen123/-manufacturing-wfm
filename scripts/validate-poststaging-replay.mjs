import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createDurableReplayGuard } = require('../resilience/durable-poststaging-replay-guard.cjs');
const { createAutonomousRepairCanaryOrchestrator } = require('../resilience/autonomous-repair-canary-orchestrator.cjs');
const { createCanaryRollbackController } = require('../resilience/canary-rollback-controller.cjs');

const d = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const dirs = [];
function fixture(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-poststaging-' + label + '-'));
  dirs.push(dir);
  const file = path.join(dir, 'state.sqlite');
  let db = new DatabaseSync(file);
  return {
    dir,
    file,
    get db() { return db; },
    set db(value) { db = value; },
    guard() { return createDurableReplayGuard({ db }); },
    reopen() { db.close(); db = new DatabaseSync(file); },
    close() { try { db.close(); } catch {} }
  };
}
process.on('exit', () => {
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function recorder(counter) {
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
      counter.count += 1;
      return { receiptDigest: d(JSON.stringify(payload)) };
    },
  };
}

const post = fixture('orchestrator');
let repairCalls = 0;
let postCanaryCalls = 0;
const postRecords = { count: 0 };
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
    return {
      status: 'verified_candidate_staged',
      independentlyVerified: true,
      exactArtifactStaged: true,
      artifactDigest: d('artifact'),
      rollbackDigest: d('rollback'),
      stagingReceiptDigest: d('staging'),
      verificationDigest: d('verification'),
      outcomeReceiptDigest: d('repair-outcome'),
      productionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    };
  },
};
const canaryStub = {
  limits: () => ({ maxInstances: 1, maxTrafficPercent: 5 }),
  capabilities: () => ({
    canary: {
      simulationOnly: true,
      productionWriteAuthority: false,
      customerWriteAuthority: false,
      incrementalCostZero: true,
      modelCanGrantAuthority: false,
    },
    rollback: {
      simulationOnly: true,
      productionWriteAuthority: false,
      customerWriteAuthority: false,
      incrementalCostZero: true,
      modelCanGrantAuthority: false,
    },
    attestor: {
      productionAuthority: false,
      customerWriteAuthority: false,
      modelCanGrantAuthority: false,
    },
  }),
  async run(input) {
    postCanaryCalls += 1;
    return {
      status: 'rolled_back_to_known_good',
      artifactDigest: input.artifactDigest,
      rollbackDigest: input.rollbackDigest,
      stagingReceiptDigest: input.stagingReceiptDigest,
      canaryEvidenceDigest: d('bad-canary'),
      rollbackEvidenceDigest: d('rollback-evidence'),
      outcomeReceiptDigest: d('canary-outcome'),
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
    };
  },
};
const postInput = {
  incidentId: 'post-replay',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  workerId: 'repair-worker',
  verifierId: 'independent-verifier',
  releaseAuthorityId: 'release-authority',
  stagingControllerId: 'staging-controller',
  canaryControllerId: 'canary-controller',
  rollbackControllerId: 'rollback-controller',
};
function postController() {
  return createAutonomousRepairCanaryOrchestrator({
    repairPipeline,
    canaryController: canaryStub,
    outcomeRecorder: recorder(postRecords),
    replayGuard: post.guard(),
  });
}
let controller = postController();
const postFirst = await controller.run(postInput);
const postDuplicate = await controller.run(postInput);
assert.deepEqual(postDuplicate, postFirst);
assert.equal(repairCalls, 1);
assert.equal(postCanaryCalls, 1);
assert.equal(postRecords.count, 1);
post.reopen();
controller = postController();
const postRestart = await controller.run(postInput);
assert.deepEqual(postRestart, postFirst);
assert.equal(repairCalls, 1);
assert.equal(postCanaryCalls, 1);
assert.equal(postRecords.count, 1);

const canaryFx = fixture('canary');
let canaryCalls = 0;
let rollbackCalls = 0;
const canaryRecords = { count: 0 };
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
    return {
      status: 'unhealthy',
      acceptedArtifactDigest: job.artifactDigest,
      acceptedRollbackDigest: job.rollbackDigest,
      acceptedTenantDigest: job.tenantDigest,
      touchedInstances: 1,
      observedTrafficPercent: 5,
      canaryEvidenceDigest: d('canary-evidence'),
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
      attestationDigest: d('attestation'),
      acceptedArtifactDigest: input.artifactDigest,
      acceptedRollbackDigest: input.rollbackDigest,
      acceptedTenantDigest: input.tenantDigest,
      acceptedStagingReceiptDigest: input.stagingReceiptDigest,
    };
  },
};
const canaryInput = {
  incidentId: 'canary-replay',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  canaryControllerId: 'canary-controller',
  rollbackControllerId: 'rollback-controller',
  artifactDigest: d('artifact'),
  rollbackDigest: d('rollback'),
  stagingReceiptDigest: d('staging'),
  maxInstances: 1,
  trafficPercent: 5,
};
function canaryController() {
  return createCanaryRollbackController({
    canaryExecutor,
    rollbackExecutor,
    knownGoodAttestor: attestor,
    outcomeRecorder: recorder(canaryRecords),
    replayGuard: canaryFx.guard(),
  });
}
let canaryCtl = canaryController();
const canaryFirst = await canaryCtl.run(canaryInput);
const canaryDuplicate = await canaryCtl.run(canaryInput);
assert.deepEqual(canaryDuplicate, canaryFirst);
assert.equal(canaryCalls, 1);
assert.equal(rollbackCalls, 1);
assert.equal(canaryRecords.count, 1);
canaryFx.reopen();
canaryCtl = canaryController();
const canaryRestart = await canaryCtl.run(canaryInput);
assert.deepEqual(canaryRestart, canaryFirst);
assert.equal(canaryCalls, 1);
assert.equal(rollbackCalls, 1);
assert.equal(canaryRecords.count, 1);

const pending = fixture('pending');
const pendingGuard = pending.guard();
const pendingKey = {
  scope: 'pending-proof',
  tenantDigest: d('tenant-a'),
  incidentId: 'pending-incident',
  inputDigest: d('pending-input'),
};
const pendingClaim = pendingGuard.claim(pendingKey);
assert.equal(pendingClaim.status, 'claimed');
pending.reopen();
assert.throws(
  () => pending.guard().claim(pendingKey),
  (error) => error.code === 'WFM_REPLAY_GUARD_RECONCILIATION_REQUIRED'
);

const lost = fixture('witness-loss');
const lostGuard = lost.guard();
const lostKey = {
  scope: 'loss-proof',
  tenantDigest: d('tenant-a'),
  incidentId: 'first',
  inputDigest: d('first-input'),
};
const lostClaim = lostGuard.claim(lostKey);
lostGuard.complete({ ...lostKey, token: lostClaim.token, receipt: { status: 'done' } });
fs.unlinkSync(lost.file + '.poststaging-witness.sqlite');
const reopenedLost = createDurableReplayGuard({ db: lost.db });
assert.throws(
  () => reopenedLost.claim({
    scope: 'loss-proof',
    tenantDigest: d('tenant-a'),
    incidentId: 'second',
    inputDigest: d('second-input'),
  }),
  (error) => error.code === 'WFM_REPLAY_GUARD_WITNESS'
);

const restore = fixture('restore');
const restoreGuard = restore.guard();
const restoreKey = {
  scope: 'restore-proof',
  tenantDigest: d('tenant-a'),
  incidentId: 'restore-incident',
  inputDigest: d('restore-input'),
};
const backup = path.join(restore.dir, 'pre-claim.sqlite');
restore.db.prepare('VACUUM INTO ?').run(backup);
const restoreClaim = restoreGuard.claim(restoreKey);
const restoredReceipt = { status: 'rolled_back_to_known_good', receipt: d('terminal') };
restoreGuard.complete({ ...restoreKey, token: restoreClaim.token, receipt: restoredReceipt });
restore.db.close();
fs.copyFileSync(backup, restore.file);
restore.db = new DatabaseSync(restore.file);
const restoredReplay = restore.guard().claim(restoreKey);
assert.equal(restoredReplay.status, 'replay');
assert.deepEqual(restoredReplay.receipt, restoredReceipt);

assert.throws(
  () => restore.guard().claim({ ...restoreKey, inputDigest: d('different-input') }),
  (error) => error.code === 'WFM_REPLAY_GUARD_CONFLICT'
);

const tamper = fixture('tamper');
const tamperGuard = tamper.guard();
const tamperKey = {
  scope: 'tamper-proof',
  tenantDigest: d('tenant-a'),
  incidentId: 'tamper-incident',
  inputDigest: d('tamper-input'),
};
const tamperClaim = tamperGuard.claim(tamperKey);
tamperGuard.complete({ ...tamperKey, token: tamperClaim.token, receipt: { status: 'done' } });
const forgedJson = JSON.stringify({ status: 'forged' });
tamper.db.prepare(`UPDATE poststaging_replay_claims SET receipt_json=?,receipt_digest=? WHERE scope=? AND tenant_digest=? AND incident_id=?`).run(
  forgedJson, d(forgedJson), tamperKey.scope, tamperKey.tenantDigest, tamperKey.incidentId
);
assert.throws(
  () => tamper.guard().claim(tamperKey),
  (error) => error.code === 'WFM_REPLAY_GUARD_INTEGRITY'
);

const commitGap = fixture('commit-gap');
const commitGapGuard = commitGap.guard();
const commitGapKey = {
  scope: 'commit-gap-proof',
  tenantDigest: d('tenant-a'),
  incidentId: 'commit-gap-incident',
  inputDigest: d('commit-gap-input'),
};
const commitGapClaim = commitGapGuard.claim(commitGapKey);
commitGap.db.exec("CREATE TRIGGER replay_main_commit_outage BEFORE UPDATE ON poststaging_replay_claims BEGIN SELECT RAISE(ABORT,'injected main replay commit outage'); END;");
assert.throws(
  () => commitGapGuard.complete({ ...commitGapKey, token: commitGapClaim.token, receipt: { status: 'done-after-gap' } }),
  /injected main replay commit outage/
);
commitGap.db.exec('DROP TRIGGER replay_main_commit_outage');
const recoveredGap = commitGapGuard.claim(commitGapKey);
assert.equal(recoveredGap.status, 'replay');
assert.deepEqual(recoveredGap.receipt, { status: 'done-after-gap' });

for (const fx of [post, canaryFx, pending, lost, restore, tamper, commitGap]) fx.close();

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'durable-poststaging-replay-guard',
  status: 'PASS',
  postStagingDuplicateCalls: { repair: repairCalls, canary: postCanaryCalls, record: postRecords.count },
  canaryDuplicateCalls: { canary: canaryCalls, rollback: rollbackCalls, record: canaryRecords.count },
  restartReplayReturnsRetainedReceipt: true,
  pendingClaimFailsClosed: true,
  missingIndependentWitnessFailsClosed: true,
  olderSnapshotRecoveredFromIndependentWitness: true,
  changedInputReplayDenied: true,
  retainedReceiptTamperDenied: true,
  witnessFirstCommitGapRecoveredWithoutReplay: true,
  replayIdempotent: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
