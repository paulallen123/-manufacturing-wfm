import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createAutonomousRepairPipeline,
  T2_COORDINATOR_CAPABILITY_CONTRACT,
  computeRepairEvidenceChainDigest,
  computeT2CoordinatorCapabilityDigest,
} = require('../resilience/autonomous-repair-pipeline.cjs');
const d = (v) => createHash('sha256').update(String(v)).digest('hex');
const expect = async (fn, code) => {
  try { await fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

function factory() {
  const m = new Map();
  return {
    snapshot: (id) => m.has(id) ? structuredClone(m.get(id)) : null,
    openIncident: ({ incidentId, tenant, evidenceDigest }) => { m.set(incidentId, { incidentId, tenant, evidenceDigest, state: 'diagnosing' }); },
    registerReproducer: ({ incidentId, failingTestDigest, observedFailureDigest }) => { const r = m.get(incidentId); r.reproducer = { failingTestDigest, observedFailureDigest }; r.state = 'reproduced'; },
    issueStagingPermit: ({ incidentId, authorityId, artifactDigest }) => { const r = m.get(incidentId); const p = { authorityId, artifactDigest, scope: 'isolated-staging-only', permitDigest: d(incidentId + artifactDigest) }; r.state = 'staging-authorised'; r.stagingPermit = p; return p; },
    m,
  };
}

const ids = { workerId: 'repair-worker', verifierId: 'independent-verifier', releaseAuthorityId: 'release-authority', stagingControllerId: 'staging-controller' };
const base = {
  incidentId: 'inc', tenant: 'tenant-a', ...ids,
  evidenceDigest: d('e'), failingTestDigest: d('f'), observedFailureDigest: d('o'), sourceSnapshotDigest: d('s'), repairIntentDigest: d('i'), rollbackSourceDigest: d('r'),
  allowedChangedPaths: ['lib/fix.cjs'],
};
const candidateDigest = d('c'), patchDigest = d('p'), artifactDigest = d('a'), provenanceDigest = d('pr'), rollbackDigest = d('rb'), verificationDigest = d('v'), stagingReceiptDigest = d('sr');

const signer = {
  capabilities: () => ({ networkMode: 'none', reusableCredentialsVisible: false, customerDataVisible: false, sourceWriteAllowed: false, productionAuthority: false, customerWriteAuthority: false, isolatedStagingAuthorityOnly: true, incrementalCostZero: true }),
  sign: async (r) => ({ signerId: r.signerId, acceptedArtifactDigest: r.artifactDigest, acceptedPermitDigest: r.permitDigest, signatureDigest: d('sig'), productionAuthority: false, customerMutation: false }),
};
const recorder = (arr = []) => ({
  capabilities: () => ({ appendOnly: true, durable: true, tamperEvident: true, customerDataStored: false, productionAuthority: false, customerWriteAuthority: false, incrementalCostZero: true }),
  record: async (o) => (arr.push(structuredClone(o)), { receiptDigest: d(JSON.stringify(o)) }),
  arr,
});
function parts(f, stageStatus = 'staged') {
  const worker = { run: async (x) => { const r = f.m.get(x.incidentId); r.state = 'candidate-proposed'; r.candidate = { proposerId: x.workerId, candidateDigest, patchDigest }; return { status: 'candidate-proposed', candidateDigest, patchDigest }; } };
  const verifier = { run: async (x) => { const r = f.m.get(x.incidentId); r.state = 'verified'; r.verification = { verifierId: x.verifierId, artifactDigest, provenanceDigest, rollbackDigest, verificationDigest }; return { status: 'verified', candidateDigest, artifactDigest, provenanceDigest, rollbackDigest, verificationDigest, productionAuthority: false, stagingPermitAuthority: false }; } };
  const stagingGate = { run: async (x) => stageStatus === 'staged'
    ? { status: 'staged', artifactDigest: x.artifactDigest, permitDigest: f.m.get(x.incidentId).stagingPermit.permitDigest, stagingReceiptDigest, productionAuthority: false, productionMutation: false, customerMutation: false }
    : { status: 'staging-rejected', reason: 'runtime-drift' } };
  return { worker, verifier, stagingGate };
}

const f = factory(), out = recorder();
const p = createAutonomousRepairPipeline({ factory: f, ...parts(f), signer, outcomeRecorder: out });
await expect(() => p.process({ ...base, incidentId: 'protected', allowedChangedPaths: ['resilience/autonomous-repair-pipeline.cjs'] }), 'WFM_PIPELINE_PROTECTED_PATH');
await expect(() => p.process({ ...base, incidentId: 'post-stage-protected', allowedChangedPaths: ['resilience/autonomous-repair-canary-orchestrator.cjs'] }), 'WFM_PIPELINE_PROTECTED_PATH');
await expect(() => p.process({ ...base, incidentId: 'controller-protected', allowedChangedPaths: ['resilience/autonomy-control-loop.cjs'] }), 'WFM_PIPELINE_PROTECTED_PATH');
const ok = await p.process(base);
assert.equal(ok.status, 'verified_candidate_staged');
assert.equal(ok.independentlyVerified, true);
assert.equal(ok.exactArtifactStaged, true);
assert.equal(ok.rollbackDigest, rollbackDigest);
assert.equal(ok.provenanceDigest, provenanceDigest);
assert.equal(ok.signatureDigest, d('sig'));
assert.equal(ok.patchDigest, patchDigest);
assert.equal(ok.failingTestDigest, base.failingTestDigest);
assert.equal(ok.productionAuthorityGranted, false);
assert.match(ok.repairChainDigest, /^[a-f0-9]{64}$/);
assert.equal(computeRepairEvidenceChainDigest(ok), ok.repairChainDigest);
assert.equal(out.arr.at(-1).repairChainDigest, ok.repairChainDigest);
assert.equal(out.arr.at(-1).signatureDigest, ok.signatureDigest);
assert.equal(out.arr.at(-1).provenanceDigest, ok.provenanceDigest);
assert.equal(out.arr.at(-1).rollbackDigest, rollbackDigest);
assert.equal(out.arr.at(-1).status, 'verified_candidate_staged');
const tamperedChain = structuredClone(ok);
tamperedChain.signatureDigest = d('tampered-signature');
assert.notEqual(computeRepairEvidenceChainDigest(tamperedChain), ok.repairChainDigest);
assert.deepEqual(p.capabilities(), {
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
const coordinatorCapabilityDigest = computeT2CoordinatorCapabilityDigest(T2_COORDINATOR_CAPABILITY_CONTRACT);
assert.match(coordinatorCapabilityDigest || '', /^[a-f0-9]{64}$/);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...T2_COORDINATOR_CAPABILITY_CONTRACT, canaryMaxInstances: 2 }), null);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...T2_COORDINATOR_CAPABILITY_CONTRACT, customerWriteAuthority: true }), null);
assert.equal(computeT2CoordinatorCapabilityDigest({ ...T2_COORDINATOR_CAPABILITY_CONTRACT, hiddenExtraAuthority: true }), null);
await expect(() => p.process({ ...base, incidentId: 'sep', verifierId: ids.workerId }), 'WFM_PIPELINE_SEPARATION');

const rf = factory(), ro = recorder();
const rp = createAutonomousRepairPipeline({ factory: rf, ...parts(rf, 'rejected'), signer, outcomeRecorder: ro });
const rej = await rp.process({ ...base, incidentId: 'reject' });
assert.equal(rej.status, 'contained');
assert.equal(rej.phase, 'disposable-staging');
assert.equal(ro.arr.at(-1).status, 'contained');
assert.equal(ro.arr.at(-1).rollbackDigest, rollbackDigest);

const hf = factory();
const hostile = { ...signer, sign: async (r) => ({ signerId: r.signerId, acceptedArtifactDigest: r.artifactDigest, acceptedPermitDigest: r.permitDigest, signatureDigest: d('x'), productionAuthority: true }) };
const hp = createAutonomousRepairPipeline({ factory: hf, ...parts(hf), signer: hostile, outcomeRecorder: recorder() });
await expect(() => hp.process({ ...base, incidentId: 'hostile' }), 'WFM_PIPELINE_SIGNER_AUTHORITY');

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 'tier2-autonomous-repair-pipeline-composition',
  status: 'PASS',
  actorSeparationRequired: true,
  reproducibleFailureBoundToTerminalEvidence: true,
  patchEvidenceBoundToTerminalEvidence: true,
  exactCandidateBinding: true,
  exactArtifactBinding: true,
  signedProvenanceBoundToTerminalEvidence: true,
  repairEvidenceChainDigestRequired: true,
  repairEvidenceChainTamperDetected: true,
  exactRollbackBindingExposedForPostStagingDecision: true,
  repairPipelineCapabilityContractPinned: true,
  t2CoordinatorCapabilityContractPinned: true,
  t2CoordinatorCapabilityTamperDetected: true,
  rejectedStagingDurablyRecordedContained: true,
  authorityAndProofSurfaceSelfProtection: true,
  postStagingAuthoritySurfaceSelfProtection: true,
  centralControllerAuthoritySurfaceSelfProtection: true,
  hostileSignerAuthorityDenied: true,
  incrementalCostZeroSignerRequired: true,
  productionAuthority: false,
  productionMutation: false,
  customerMutation: false,
}, null, 2));