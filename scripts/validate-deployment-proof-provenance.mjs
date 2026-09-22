import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyDeploymentProofEvidence, sealDeploymentEvidence } = require('../resilience/deployment-proof-provenance-verifier.cjs');
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const clone = value => structuredClone(value);
const expectCode = (fn, code) => {
  try { fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

const expected = Object.freeze({
  provider: 'railway',
  repository: 'paulallen123/-manufacturing-wfm',
  branch: 'proof/frozen-0676-20260919-1006',
  commitSha: '19675a939bfc35b80152e61473462f2fb5eabc3a',
  serviceName: 'wfm-proof-frozen-0676-private',
  environmentName: 'production',
  builder: 'DOCKERFILE',
  dockerfilePath: 'Dockerfile',
  healthcheckPath: '/api/health',
  candidate: '0.6.76-hosted-staging-rc1',
  runtimeSha256: '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d',
});

const observation = {
  schemaVersion: 1,
  proof: 'external-deployment-proof-observation',
  provider: 'railway',
  observedBy: {
    principalId: 'railway-readonly-observer',
    source: 'read-only-provider-api',
    readOnly: true,
    writeAuthority: false,
    deployAuthority: false,
    productionAuthority: false,
    customerMutationAuthority: false,
    modelAuthority: false,
  },
  deployment: {
    deploymentId: '00eeb38f-e9b4-42e5-9daf-a33666e287b0',
    status: 'SUCCESS',
    repository: expected.repository,
    branch: expected.branch,
    commitSha: expected.commitSha,
    serviceName: expected.serviceName,
    environmentName: expected.environmentName,
    builder: expected.builder,
    dockerfilePath: expected.dockerfilePath,
    healthcheckPath: expected.healthcheckPath,
    healthcheckSucceeded: true,
    candidate: expected.candidate,
    runtimeSha256: expected.runtimeSha256,
    productionApproved: false,
    stagingOnly: true,
    fixtureOnly: true,
  },
  functionalEvidence: null,
};

const sealedHealthOnly = sealDeploymentEvidence(observation);
const healthOnlyReceipt = verifyDeploymentProofEvidence({ evidence: sealedHealthOnly, expected });
assert.equal(healthOnlyReceipt.status, 'PASS');
assert.equal(healthOnlyReceipt.sourceProvenanceBound, true);
assert.equal(healthOnlyReceipt.deploymentHealthy, true);
assert.equal(healthOnlyReceipt.functionalEvidenceBound, false);
assert.equal(healthOnlyReceipt.claimScope, 'DEPLOYMENT_HEALTH_ONLY');
assert.equal(healthOnlyReceipt.releaseAuthorityGranted, false);
assert.equal(healthOnlyReceipt.productionAuthorityGranted, false);
assert.equal(healthOnlyReceipt.modelAuthorityGranted, false);
assert.match(healthOnlyReceipt.receiptDigest, /^[a-f0-9]{64}$/);

for (const [label, mutate, code] of [
  ['service-label-confusion', e => { e.deployment.serviceName = 'wfm-integration-fabric-v1-proof'; }, 'WFM_DEPLOY_PROOF_BINDING'],
  ['wrong-source-branch', e => { e.deployment.branch = 'feature/one-day-enterprise-implementation-v1'; }, 'WFM_DEPLOY_PROOF_BINDING'],
  ['wrong-source-commit', e => { e.deployment.commitSha = 'f463604393086b99dbb38aa8f351a48fa594c9f1'; }, 'WFM_DEPLOY_PROOF_BINDING'],
  ['builder-drift-to-railpack', e => { e.deployment.builder = 'RAILPACK'; }, 'WFM_DEPLOY_PROOF_BINDING'],
  ['production-claim-escalation', e => { e.deployment.productionApproved = true; }, 'WFM_DEPLOY_PROOF_CLAIM'],
  ['fixture-boundary-removed', e => { e.deployment.fixtureOnly = false; }, 'WFM_DEPLOY_PROOF_CLAIM'],
  ['provider-observer-write-authority', e => { e.observedBy.writeAuthority = true; }, 'WFM_DEPLOY_PROOF_OBSERVER'],
]) {
  const changed = clone(observation);
  mutate(changed);
  expectCode(() => verifyDeploymentProofEvidence({ evidence: sealDeploymentEvidence(changed), expected }), code);
  assert.ok(label);
}

const digestTampered = sealDeploymentEvidence(observation);
digestTampered.deployment.healthcheckSucceeded = false;
expectCode(() => verifyDeploymentProofEvidence({ evidence: digestTampered, expected }), 'WFM_DEPLOY_PROOF_HEALTH');

const forgedDigest = sealDeploymentEvidence(observation);
forgedDigest.evidenceDigest = digest('forged');
expectCode(() => verifyDeploymentProofEvidence({ evidence: forgedDigest, expected }), 'WFM_DEPLOY_PROOF_DIGEST');

const sameObserverFunctional = clone(observation);
sameObserverFunctional.functionalEvidence = {
  status: 'PASS',
  observerId: observation.observedBy.principalId,
  readOnly: true,
  writeAuthority: false,
  deployAuthority: false,
  productionAuthority: false,
  customerMutationAuthority: false,
  modelAuthority: false,
  deploymentId: observation.deployment.deploymentId,
  commitSha: expected.commitSha,
  runtimeSha256: expected.runtimeSha256,
  candidate: expected.candidate,
  proofDigest: digest('functional-proof'),
};
expectCode(() => verifyDeploymentProofEvidence({ evidence: sealDeploymentEvidence(sameObserverFunctional), expected }), 'WFM_DEPLOY_PROOF_FUNCTIONAL');

const mismatchedFunctional = clone(observation);
mismatchedFunctional.functionalEvidence = {
  status: 'PASS',
  observerId: 'independent-functional-verifier',
  readOnly: true,
  writeAuthority: false,
  deployAuthority: false,
  productionAuthority: false,
  customerMutationAuthority: false,
  modelAuthority: false,
  deploymentId: observation.deployment.deploymentId,
  commitSha: expected.commitSha,
  runtimeSha256: digest('wrong-runtime'),
  candidate: expected.candidate,
  proofDigest: digest('functional-proof'),
};
expectCode(() => verifyDeploymentProofEvidence({ evidence: sealDeploymentEvidence(mismatchedFunctional), expected }), 'WFM_DEPLOY_PROOF_FUNCTIONAL');

const independentlyBound = clone(observation);
independentlyBound.functionalEvidence = {
  status: 'PASS',
  observerId: 'independent-functional-verifier',
  readOnly: true,
  writeAuthority: false,
  deployAuthority: false,
  productionAuthority: false,
  customerMutationAuthority: false,
  modelAuthority: false,
  deploymentId: observation.deployment.deploymentId,
  commitSha: expected.commitSha,
  runtimeSha256: expected.runtimeSha256,
  candidate: expected.candidate,
  proofDigest: digest('independent-functional-proof'),
};
const functionalReceipt = verifyDeploymentProofEvidence({ evidence: sealDeploymentEvidence(independentlyBound), expected });
assert.equal(functionalReceipt.functionalEvidenceBound, true);
assert.equal(functionalReceipt.claimScope, 'FUNCTIONAL_EVIDENCE_BOUND_NOT_RELEASE_AUTHORITY');
assert.equal(functionalReceipt.releaseAuthorityGranted, false);
assert.equal(functionalReceipt.productionAuthorityGranted, false);
assert.equal(functionalReceipt.customerMutationAuthorityGranted, false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'external-deployment-proof-provenance-and-claim-boundary',
  status: 'PASS',
  provider: expected.provider,
  deploymentHealthCannotSelfPromoteToFunctionalProof: true,
  serviceLabelConfusionRejected: true,
  wrongBranchRejected: true,
  wrongCommitRejected: true,
  builderDriftRejected: true,
  productionClaimEscalationRejected: true,
  fixtureBoundaryRemovalRejected: true,
  providerObserverWriteAuthorityRejected: true,
  evidenceDigestTamperRejected: true,
  functionalSelfVerificationRejected: true,
  functionalRuntimeMisbindingRejected: true,
  independentlyBoundFunctionalEvidenceStillGrantsNoReleaseAuthority: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
