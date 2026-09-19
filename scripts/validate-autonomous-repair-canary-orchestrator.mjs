import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createAutonomousRepairCanaryOrchestrator,
} = require(path.join(process.cwd(), 'resilience/autonomous-repair-canary-orchestrator.cjs'));
const {
  T2_COORDINATOR_CAPABILITY_CONTRACT,
  computeRepairEvidenceChainDigest,
  computeT2CoordinatorCapabilityDigest,
  computePostStagingDecisionDigest,
} = require(path.join(process.cwd(), 'resilience/autonomous-repair-pipeline.cjs'));

const sha = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

function recorder() {
  const records = [];
  return {
    records,
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
      records.push(structuredClone(payload));
      return { receiptDigest: sha(payload) };
    },
  };
}

const pipelineCaps = Object.freeze({
  independentVerificationRequired: true,
  exactArtifactStagingRequired: true,
  signedProvenanceRequired: true,
  repairEvidenceChainRequired: true,
  isolatedStagingOnly: true,
  productionAuthority: false,
  productionMutation: false,
  customerMutation: false,
  incrementalCostZero: true,
});

const base = {
  incidentId: 'inc-1',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  workerId: 'repair-worker',
  verifierId: 'independent-verifier',
  releaseAuthorityId: 'release-authority',
  stagingControllerId: 'staging-controller',
  canaryControllerId: 'canary-controller',
  rollbackControllerId: 'rollback-controller',
};

function makeRepairResult(overrides = {}) {
  const evidence = {
    tenantDigest: sha(base.tenant),
    actorSetDigest: sha([
      base.workerId,
      base.verifierId,
      base.releaseAuthorityId,
      base.stagingControllerId,
    ]),
    evidenceDigest: sha('source-evidence'),
    failingTestDigest: sha('failing-test'),
    observedFailureDigest: sha('observed-failure'),
    sourceSnapshotDigest: sha('source-snapshot'),
    repairIntentDigest: sha('repair-intent'),
    patchDigest: sha('patch'),
    candidateDigest: sha('candidate'),
    artifactDigest: sha('artifact'),
    provenanceDigest: sha('provenance'),
    rollbackDigest: sha('rollback'),
    verificationDigest: sha('verification'),
    permitDigest: sha('permit'),
    signatureDigest: sha('signature'),
    stagingReceiptDigest: sha('staging'),
  };
  const repairChainDigest = computeRepairEvidenceChainDigest(evidence);
  assert.match(repairChainDigest, /^[a-f0-9]{64}$/);
  return Object.freeze({
    status: 'verified_candidate_staged',
    phase: 'complete',
    ...evidence,
    repairChainDigest,
    outcomeReceiptDigest: sha('repair-outcome'),
    independentlyVerified: true,
    exactArtifactStaged: true,
    productionAuthorityGranted: false,
    productionMutation: false,
    customerMutation: false,
    ...overrides,
  });
}

const repairPipeline = (result = makeRepairResult(), caps = pipelineCaps) => ({
  capabilities: () => ({ ...caps }),
  process: async () => structuredClone(result),
});

const canaryCaps = () => ({
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
    canaryEvidenceDigest: sha('canary'),
    outcomeReceiptDigest: sha('canary-outcome'),
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
    canaryEvidenceDigest: sha('canary-bad'),
    rollbackEvidenceDigest: sha('rollback-evidence'),
    outcomeReceiptDigest: sha('rollback-outcome'),
    productionAuthority: false,
    productionMutation: false,
    customerMutation: false,
  };
}

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
assert.equal(computeRepairEvidenceChainDigest(out), out.repairChainDigest);
assert.equal(computePostStagingDecisionDigest(out), out.decisionChainDigest);
assert.equal(out.tenantDigest, sha(base.tenant));
assert.equal(out.actorSetDigest, sha([base.workerId, base.verifierId, base.releaseAuthorityId, base.stagingControllerId]));
assert.equal(out.postStagingActorSetDigest, sha(Object.values({
  workerId: base.workerId,
  verifierId: base.verifierId,
  releaseAuthorityId: base.releaseAuthorityId,
  stagingControllerId: base.stagingControllerId,
  canaryControllerId: base.canaryControllerId,
  rollbackControllerId: base.rollbackControllerId,
})));
assert.deepEqual(out.coordinatorCapabilities, T2_COORDINATOR_CAPABILITY_CONTRACT);
assert.equal(out.coordinatorCapabilityDigest, computeT2CoordinatorCapabilityDigest(T2_COORDINATOR_CAPABILITY_CONTRACT));
assert.equal(outRec.records.at(-1).coordinatorCapabilityDigest, out.coordinatorCapabilityDigest);
assert.equal(outRec.records.at(-1).repairChainDigest, out.repairChainDigest);
assert.equal(outRec.records.at(-1).decisionChainDigest, out.decisionChainDigest);
const tamperedCapabilities = structuredClone(out);
tamperedCapabilities.coordinatorCapabilities.canaryMaxInstances = 2;
assert.equal(computePostStagingDecisionDigest(tamperedCapabilities), null);
const tamperedCapabilityDigest = structuredClone(out);
tamperedCapabilityDigest.coordinatorCapabilityDigest = sha('forged-capability-digest');
assert.equal(computePostStagingDecisionDigest(tamperedCapabilityDigest), null);

outRec = recorder();
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController(rolledBack),
  outcomeRecorder: outRec,
});
out = await orchestrator.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.match(out.rollbackEvidenceDigest, /^[a-f0-9]{64}$/);
assert.equal(computeRepairEvidenceChainDigest(out), out.repairChainDigest);
assert.equal(computePostStagingDecisionDigest(out), out.decisionChainDigest);
assert.equal(out.promotionAuthorityGranted, false);

await assert.rejects(
  () => orchestrator.run({ ...base, rollbackControllerId: base.canaryControllerId }),
  (error) => error.code === 'WFM_POSTSTAGING_SEPARATION',
);
await assert.rejects(
  () => orchestrator.run({ ...base, targetTenant: 'tenant-b' }),
  (error) => error.code === 'WFM_POSTSTAGING_CROSS_TENANT',
);

outRec = recorder();
const containedPipelineResult = {
  status: 'contained',
  phase: 'independent-verifier',
  reason: 'security-failed',
  productionAuthorityGranted: false,
  productionMutation: false,
  customerMutation: false,
};
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(containedPipelineResult),
  canaryController: canaryController(() => { throw new Error('must not run'); }),
  outcomeRecorder: outRec,
});
out = await orchestrator.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.phase, 'independent-verifier');
assert.equal(outRec.records.length, 0);

outRec = recorder();
const tamperedRepair = structuredClone(makeRepairResult());
tamperedRepair.signatureDigest = sha('tampered-signature');
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(tamperedRepair),
  canaryController: canaryController(() => { throw new Error('must not run'); }),
  outcomeRecorder: outRec,
});
out = await orchestrator.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.reason, 'repair-pipeline-evidence-chain-invalid');
assert.equal(outRec.records.at(-1).reason, 'repair-pipeline-evidence-chain-invalid');

outRec = recorder();
orchestrator = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController((input) => ({ ...proven(input), artifactDigest: sha('drifted') })),
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
  repairPipeline: repairPipeline(makeRepairResult(), { ...pipelineCaps, repairEvidenceChainRequired: false }),
  canaryController: canaryController(proven),
  outcomeRecorder: recorder(),
}), (error) => error.code === 'WFM_POSTSTAGING_PIPELINE');

assert.throws(() => createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: { ...canaryController(proven), limits: () => ({ maxInstances: 2, maxTrafficPercent: 5 }) },
  outcomeRecorder: recorder(),
}), (error) => error.code === 'WFM_POSTSTAGING_CANARY');

const caps = createAutonomousRepairCanaryOrchestrator({
  repairPipeline: repairPipeline(),
  canaryController: canaryController(proven),
  outcomeRecorder: recorder(),
}).capabilities();
assert.deepEqual(caps, T2_COORDINATOR_CAPABILITY_CONTRACT);
assert.match(computeT2CoordinatorCapabilityDigest(caps), /^[a-f0-9]{64}$/);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...caps, canaryMaxInstances: 2 }), null);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...caps, productionWriteAuthority: true }), null);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...caps, hiddenExtraAuthority: true }), null);

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 'tier2-repair-to-canary-decision-composition',
  status: 'PASS',
  exactStagedArtifactFeedsCanary: true,
  fullRepairEvidenceChainBound: true,
  reproducibleFailureBound: true,
  patchEvidenceBound: true,
  signedProvenanceBound: true,
  repairEvidenceTamperContained: true,
  postStagingDecisionDigestRequired: true,
  postStagingDecisionDigestVerified: true,
  coordinatorCapabilityContractPinned: true,
  coordinatorCapabilityDigestBound: true,
  coordinatorCapabilityTamperDetected: true,
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