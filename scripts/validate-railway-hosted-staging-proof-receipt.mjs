import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assessHostedStagingProof,
  verifyHostedStagingProofReceipt,
  digest,
} = require('../resilience/railway-hosted-staging-proof-receipt.cjs');

const observed = {
  deploymentId: '4aee9171-3122-4ecb-af15-b820437a61ad',
  deploymentSnapshotId: '1eb53cee-7b34-4993-83a4-91f4552d18ee',
  sourceCommitSha: 'be1bac99b3a0a02e6a56e2a995fff76872cdb841',
  imageDigest: 'sha256:887528f74f0df9d1574c4d0cb12a0dc171639135b5267e50b15c4a5337fa40df',
  engineGitBlobSha: 'd3688d27841a28d3b8801b7d4c63f254e8bf7edd',
  engineExpectedGitBlobSha: 'd3688d27841a28d3b8801b7d4c63f254e8bf7edd',
  deploymentStatus: 'SUCCESS',
  testsTotal: 96,
  testsPassed: 96,
  testsFailed: 0,
  testsSkipped: 0,
  cloudScaleProofStatus: 'PASS',
  engineIdentityExact: true,
  scale: { employees: 10000, sites: 50, punches: 100000, timecards: 40000 },
  massAssignmentCoverage: 1,
  cleanPayrollUnexplainedVariance: 0,
  cleanPayrollVarianceCount: 0,
  deliberateCorruptionDetected: true,
  hostileStructureBlockedAutoApply: true,
  payrollRulesRemainProtected: true,
  containerStarted: true,
  httpsPublicOriginObserved: true,
  healthcheckSucceeded: true,
  fixtureDemoOnly: true,
  productionApproved: false,
  productionMutation: false,
  customerMutation: false,
};

const receipt = assessHostedStagingProof(observed);
assert.equal(receipt.stagingExecutionEvidenceProven, true);
assert.equal(receipt.identityBound, true);
assert.equal(receipt.tests.proven, true);
assert.equal(receipt.cloudScaleProofProven, true);
assert.equal(receipt.hostedRuntimeProven, true);
assert.equal(receipt.safetyBoundaryProven, true);
assert.equal(receipt.syntheticTimingModelIsExecutionProof, false);
assert.equal(receipt.releaseProven, false);
assert.equal(receipt.releaseClaimAllowed, false);
assert.equal(receipt.customerProductionImplementationProven, false);
assert.equal(verifyHostedStagingProofReceipt(receipt), true);

const branchSubstitution = assessHostedStagingProof({ ...observed, sourceCommitSha: 'not-a-commit' });
assert.equal(branchSubstitution.stagingExecutionEvidenceProven, false);
assert.equal(verifyHostedStagingProofReceipt(branchSubstitution), true);

const engineSubstitution = assessHostedStagingProof({
  ...observed,
  engineExpectedGitBlobSha: '1111111111111111111111111111111111111111',
});
assert.equal(engineSubstitution.identityBound, false);
assert.equal(engineSubstitution.stagingExecutionEvidenceProven, false);
assert.equal(verifyHostedStagingProofReceipt(engineSubstitution), true);

const failedTest = assessHostedStagingProof({ ...observed, testsPassed: 95, testsFailed: 1 });
assert.equal(failedTest.tests.proven, false);
assert.equal(failedTest.stagingExecutionEvidenceProven, false);

const missingHealth = assessHostedStagingProof({ ...observed, healthcheckSucceeded: false });
assert.equal(missingHealth.hostedRuntimeProven, false);
assert.equal(missingHealth.stagingExecutionEvidenceProven, false);

const productionApproved = assessHostedStagingProof({ ...observed, productionApproved: true });
assert.equal(productionApproved.safetyBoundaryProven, false);
assert.equal(productionApproved.stagingExecutionEvidenceProven, false);

const payrollMutation = assessHostedStagingProof({ ...observed, productionMutation: true });
assert.equal(payrollMutation.safetyBoundaryProven, false);
assert.equal(payrollMutation.stagingExecutionEvidenceProven, false);

const resealedReleaseEscalation = structuredClone(receipt);
resealedReleaseEscalation.releaseProven = true;
resealedReleaseEscalation.releaseClaimAllowed = true;
const releaseCore = { ...resealedReleaseEscalation };
delete releaseCore.receiptDigest;
resealedReleaseEscalation.receiptDigest = digest(releaseCore);
assert.equal(verifyHostedStagingProofReceipt(resealedReleaseEscalation), false);

const resealedTimingEscalation = structuredClone(receipt);
resealedTimingEscalation.syntheticTimingModelIsExecutionProof = true;
const timingCore = { ...resealedTimingEscalation };
delete timingCore.receiptDigest;
resealedTimingEscalation.receiptDigest = digest(timingCore);
assert.equal(verifyHostedStagingProofReceipt(resealedTimingEscalation), false);

const resealedAuthorityEscalation = structuredClone(receipt);
resealedAuthorityEscalation.executionAuthorityGranted = true;
const authorityCore = { ...resealedAuthorityEscalation };
delete authorityCore.receiptDigest;
resealedAuthorityEscalation.receiptDigest = digest(authorityCore);
assert.equal(verifyHostedStagingProofReceipt(resealedAuthorityEscalation), false);

console.log(JSON.stringify({
  validator: 'railway-hosted-staging-proof-receipt',
  result: 'PASS',
  cases: 10,
  observedDeploymentId: receipt.deploymentId,
  exactHostedStagingExecutionEvidence: receipt.stagingExecutionEvidenceProven,
  claimBoundary: receipt.claimBoundary,
  releaseProven: receipt.releaseProven,
  customerProductionImplementationProven: receipt.customerProductionImplementationProven,
  syntheticTimingModelIsExecutionProof: receipt.syntheticTimingModelIsExecutionProof,
}, null, 2));
