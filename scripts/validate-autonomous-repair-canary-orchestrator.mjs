import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAutonomousRepairCanaryOrchestrator } = require(path.join(process.cwd(), 'resilience/autonomous-repair-canary-orchestrator.cjs'));
const d = (v) => createHash('sha256').update(String(v)).digest('hex');

function recorder() {
  const records = [];
  return {
    records,
    capabilities: () => ({ appendOnly: true, durable: true, tamperEvident: true, customerDataStored: false, productionAuthority: false, customerWriteAuthority: false, incrementalCostZero: true }),
    async record(payload) { records.push(structuredClone(payload)); return { receiptDigest: d(JSON.stringify(payload)) }; },
  };
}

const pipelineCaps = Object.freeze({
  independentVerificationRequired: true,
  exactArtifactStagingRequired: true,
  isolatedStagingOnly: true,
  productionAuthority: false,
  productionMutation: false,
  customerMutation: false,
  incrementalCostZero: true,
});

const repairResult = Object.freeze({
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
});

const repairPipeline = (result = repairResult, caps = pipelineCaps) => ({
  capabilities: () => ({ ...caps }),
  process: async () => structuredClone(result),
});

const canaryCaps = () => ({
  canary: { simulationOnly: true, productionWriteAuthority: false, customerWriteAuthority: false, incrementalCostZero: true, modelCanGrantAuthority: false },
  rollback: { simulationOnly: true, productionWriteAuthority: false, customerWriteAuthority: false, incrementalCostZero: true, modelCanGrantAuthority: false },
  attestor: { productionAuthority: false, customerWriteAuthority: false, modelCanGrantAuthority: false },
});

function canaryController(resultFactory, caps = canaryCaps()) {
  return {
    limits: () => ({ maxInstances: 1, maxTrafficPercent: 5 }),
    capabilities: () => structuredClone(caps),
    run: async (input) => resultFactory(input),
  };
}

function proven(input) {
  return {
    status: 'canary_proven',
    artifactDigest: input.artifactDigest,
    rollbackDigest: input.rollbackDigest,
    stagingReceiptDigest: input.stagingReceiptDigest,
    canaryEvidenceDigest: d('canary'),
    outcomeReceiptDigest: d('canary-outcome'),
    productionAuthority: false,
    productionMutation: false,
    customerMutation: false,
  };
}
function rolledBack(input) {
  return {
    status: 'rolled_back_to_known_good',
    artifactDigest: input.artifactDigest,
    rollbackDigest: input.rollbackDigest,
    stagingReceiptDigest: input.stagingReceiptDigest,
    canaryEvidenceDigest: d('canary-bad'),
    rollbackEvidenceDigest: d('rollback-evidence'),
    outcomeReceiptDigest: d('rollback-outcome'),
    productionAuthority: false,
    productionMutation: false,
    customerMutation: false,
  };
}

const base = {
  incidentId: 'inc-1', tenant: 'tenant-a', targetTenant: 'tenant-a',
  workerId: 'repair-worker', verifierId: 'independent-verifier', releaseAuthorityId: 'release-authority', stagingControllerId: 'staging-controller',
  canaryControllerId: 'canary-controller', rollbackControllerId: 'rollback-controller',
};

let outRec = recorder();
let orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController(proven),
  outcomeRecorder: outRec,
});
let out = await orchestrator.run(base);
assert.equal(out.status, 'canary_proven');
assert.equal(out.promotionAuthorityGranted, false);
assert.equal(out.productionAuthorityGranted, false);
assert.equal(outRec.records.at(-1).status, 'canary_proven');
assert.match(out.compositionReceiptDigest, /^[a-f0-9]{64}$/);

outRec = recorder();
orchestrator = createAutonomousRepairCanaryOrchestrator({ repairPipeline: repairPipeline(), canaryController: canaryController(rolledBack), outcomeRecorder: outRec });
out = await orchestrator.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.match(out.rollbackEvidenceDigest, /^[a-f0-9]{64}$/);
assert.equal(out.promotionAuthorityGranted, false);

await assert.rejects(() => orchestrator.run({ ...base, rollbackControllerId: base.canaryControllerId }), (err) => err.code === 'WFM_POSTSTAGING_SEPARATION');
await assert.rejects(() => orchestrator.run({ ...base, targetTenant: 'tenant-b' }), (err) => err.code === 'WFM_POSTSTAGING_CROSS_TENANT');

outRec = recorder();
const containedPipelineResult = { status: 'contained', phase: 'independent-verifier', reason: 'security-failed', productionAuthorityGranted: false, productionMutation: false, customerMutation: false };
orchestrator = createAutonomousRepairCanaryOrchestrator({ repairPipeline: repairPipeline(containedPipelineResult), canaryController: canaryController(() => { throw new Error('must not run'); }), outcomeRecorder: outRec });
out = await orchestrator.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.phase, 'independent-verifier');
assert.equal(outRec.records.length, 0);

outRec = recorder();
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController((input) => ({ ...proven(input), artifactDigest: d('drifted') })),
  outcomeRecorder: outRec,
});
out = await orchestrator.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.reason, 'post-staging-evidence-drift');

outRec = recorder();
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController((input) => ({ ...proven(input), productionAuthority: true })),
  outcomeRecorder: outRec,
});
out = await orchestrator.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.reason, 'canary-authority-violation');

assert.throws(() => createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(repairResult, { ...pipelineCaps, exactArtifactStagingRequired: false }),
  canaryController: canaryController(proven), outcomeRecorder: recorder(),
}), (err) => err.code === 'WFM_POSTSTAGING_PIPELINE');

assert.throws(() => createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: { ...canaryController(proven), limits: () => ({ maxInstances: 2, maxTrafficPercent: 5 }) },
  outcomeRecorder: recorder(),
}), (err) => err.code === 'WFM_POSTSTAGING_CANARY');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-repair-to-canary-decision-composition',
  status: 'PASS',
  exactStagedArtifactFeedsCanary: true,
  exactRollbackArtifactBound: true,
  sixActorSeparationRequired: true,
  repairContainmentStopsCanary: true,
  evidenceDriftContained: true,
  canaryAuthorityEscalationContained: true,
  boundedCanaryContractPinned: true,
  automaticKnownGoodRollbackTerminalSupported: true,
  promotionAuthorityGranted: false,
  productionAuthorityGranted: false,
  productionMutation: false,
  customerMutation: false,
  incrementalCostZero: true,
}, null, 2));
