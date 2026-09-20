import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assessHostedStagingProof,
  verifyHostedStagingProofReceipt,
  assessHostedBrowserProof,
  verifyHostedBrowserProofReceipt,
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

const observedBrowser = {
  deploymentId: '73f7d8d2-3b0d-455e-a83d-1fe3e33ebb55',
  deploymentSnapshotId: 'bbd57a4c-18d8-4b4a-ae36-d71c5fb52338',
  sourceCommitSha: '338e07b24d3096d30dcc97fe14c33a03261b7e86',
  imageDigest: 'sha256:593af64338766b65334f0c32a6b7491273a148f6a4dd20b15219a9e1d4e38bf9',
  managerScreenshotSha256: '3c1ac1bc81caaef93d6bb05e6a6ad75b6c5a1c6e195a8fd49b4f26bc503cc68c',
  deploymentStatus: 'SUCCESS',
  matrixStatus: 'PASS',
  roles: 5,
  navClicks: 4,
  activeActionJourneys: 0,
  emptyStateJourneys: 1,
  affordanceCoverage: 'UNEXERCISED',
  reviewVerified: false,
  viewStatusVerified: false,
  proofServerPassed: true,
  healthcheckSucceeded: true,
  layoutOverflowAssertionsPassed: true,
  tenantIsolationRoleObserved: true,
};

const browserReceipt = assessHostedBrowserProof(observedBrowser);
assert.equal(browserReceipt.roleRenderNavigationProven, true);
assert.equal(browserReceipt.activeWorkflowInteractionProven, false);
assert.equal(browserReceipt.browserFunctionalReadinessProven, false);
assert.equal(browserReceipt.passiveProofOnly, true);
assert.equal(browserReceipt.claimBoundary, 'hosted-browser-role-render-navigation-only');
assert.equal(verifyHostedBrowserProofReceipt(browserReceipt), true);

const futureInteractiveFixture = assessHostedBrowserProof({
  ...observedBrowser,
  activeActionJourneys: 2,
  affordanceCoverage: 'EXERCISED',
  reviewVerified: true,
  viewStatusVerified: true,
});
assert.equal(futureInteractiveFixture.activeWorkflowInteractionProven, true);
assert.equal(futureInteractiveFixture.browserFunctionalReadinessProven, true);
assert.equal(futureInteractiveFixture.claimBoundary, 'hosted-browser-role-render-navigation-and-active-workflow-interaction');
assert.equal(verifyHostedBrowserProofReceipt(futureInteractiveFixture), true);

for (const candidate of [
  assessHostedBrowserProof({ ...observedBrowser, deploymentStatus: 'FAILED' }),
  assessHostedBrowserProof({ ...observedBrowser, sourceCommitSha: 'bad' }),
  assessHostedBrowserProof({ ...observedBrowser, managerScreenshotSha256: 'bad' }),
  assessHostedBrowserProof({ ...observedBrowser, roles: 4 }),
  assessHostedBrowserProof({ ...observedBrowser, tenantIsolationRoleObserved: false }),
]) {
  assert.equal(candidate.roleRenderNavigationProven, false);
  assert.equal(candidate.browserFunctionalReadinessProven, false);
  assert.equal(verifyHostedBrowserProofReceipt(candidate), true);
}

const fakeActionCoverage = assessHostedBrowserProof({ ...observedBrowser, activeActionJourneys: 2 });
assert.equal(fakeActionCoverage.roleRenderNavigationProven, true);
assert.equal(fakeActionCoverage.activeWorkflowInteractionProven, false);
assert.equal(fakeActionCoverage.browserFunctionalReadinessProven, false);

const fakeVerification = assessHostedBrowserProof({
  ...observedBrowser,
  activeActionJourneys: 2,
  affordanceCoverage: 'EXERCISED',
  reviewVerified: true,
  viewStatusVerified: false,
});
assert.equal(fakeVerification.activeWorkflowInteractionProven, false);

const resealedBrowserEscalation = structuredClone(browserReceipt);
resealedBrowserEscalation.activeWorkflowInteractionProven = true;
resealedBrowserEscalation.browserFunctionalReadinessProven = true;
resealedBrowserEscalation.passiveProofOnly = false;
resealedBrowserEscalation.claimBoundary = 'hosted-browser-role-render-navigation-and-active-workflow-interaction';
const browserEscalationCore = { ...resealedBrowserEscalation };
delete browserEscalationCore.receiptDigest;
resealedBrowserEscalation.receiptDigest = digest(browserEscalationCore);
assert.equal(verifyHostedBrowserProofReceipt(resealedBrowserEscalation), false);

const resealedBrowserRelease = structuredClone(browserReceipt);
resealedBrowserRelease.releaseClaimAllowed = true;
const browserReleaseCore = { ...resealedBrowserRelease };
delete browserReleaseCore.receiptDigest;
resealedBrowserRelease.receiptDigest = digest(browserReleaseCore);
assert.equal(verifyHostedBrowserProofReceipt(resealedBrowserRelease), false);

const resealedBrowserAuthority = structuredClone(browserReceipt);
resealedBrowserAuthority.executionAuthorityGranted = true;
const browserAuthorityCore = { ...resealedBrowserAuthority };
delete browserAuthorityCore.receiptDigest;
resealedBrowserAuthority.receiptDigest = digest(browserAuthorityCore);
assert.equal(verifyHostedBrowserProofReceipt(resealedBrowserAuthority), false);

console.log(JSON.stringify({
  validator: 'railway-hosted-staging-and-browser-proof-receipt',
  result: 'PASS',
  stagingCases: 10,
  browserCases: 12,
  observedDeploymentId: receipt.deploymentId,
  exactHostedStagingExecutionEvidence: receipt.stagingExecutionEvidenceProven,
  stagingClaimBoundary: receipt.claimBoundary,
  observedBrowserDeploymentId: browserReceipt.deploymentId,
  browserRoleRenderNavigationProven: browserReceipt.roleRenderNavigationProven,
  browserFunctionalReadinessProven: browserReceipt.browserFunctionalReadinessProven,
  browserClaimBoundary: browserReceipt.claimBoundary,
  releaseProven: receipt.releaseProven,
  releaseClaimAllowed: browserReceipt.releaseClaimAllowed,
  customerProductionImplementationProven: receipt.customerProductionImplementationProven,
  syntheticTimingModelIsExecutionProof: receipt.syntheticTimingModelIsExecutionProof,
}, null, 2));
