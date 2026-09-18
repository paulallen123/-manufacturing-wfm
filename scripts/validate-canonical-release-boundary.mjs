import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanonicalReleaseBoundary, validateCanonicalReleasePolicy } = require('../resilience/canonical-release-boundary.cjs');
const root = process.cwd();
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'resilience/canonical-release-policy-snapshot.json'), 'utf8'));

function loadPolicyEvidence() {
  const liveFile = process.env.WFM_CANONICAL_RELEASE_POLICY_FILE;
  const liveBaseSha = process.env.WFM_CANONICAL_BASE_SHA;
  const liveBlobSha = process.env.WFM_CANONICAL_POLICY_BLOB_SHA;
  if (liveFile || liveBaseSha || liveBlobSha) {
    assert.ok(liveFile && liveBaseSha && liveBlobSha, 'Live canonical release evidence must provide file, base SHA and policy blob SHA together.');
    return {
      sourceRef: snapshot.sourceRef,
      sourceBaseSha: liveBaseSha,
      sourcePolicyBlobSha: liveBlobSha,
      policy: JSON.parse(fs.readFileSync(liveFile, 'utf8')),
      live: true,
    };
  }
  return {
    sourceRef: snapshot.sourceRef,
    sourceBaseSha: snapshot.sourceBaseSha,
    sourcePolicyBlobSha: snapshot.sourcePolicyBlobSha,
    policy: snapshot.policy,
    live: false,
  };
}

const evidence = loadPolicyEvidence();
const policyCheck = validateCanonicalReleasePolicy(evidence.policy);
assert.equal(policyCheck.valid, true);

const boundary = createCanonicalReleaseBoundary(evidence);
const featureBranch = 'autonomy/zero-engineer-support-sprint-20260918';

const preview = boundary.assess({
  actorBranch: featureBranch,
  requestedTarget: 'disposable-preview',
  isDisposablePreview: true,
});
assert.equal(preview.allowed, true);
assert.equal(boundary.verifyReceipt(preview), true);

const featureToStaging = boundary.assess({
  actorBranch: featureBranch,
  requestedTarget: 'canonical-staging',
  executionPath: evidence.policy.canonicalRailway.staging.deploymentAuthority,
});
assert.equal(featureToStaging.allowed, false);
assert.equal(featureToStaging.reason, 'feature-branch-canonical-deploy-denied');
assert.equal(boundary.verifyReceipt(featureToStaging), true);

const featureToProduction = boundary.assess({
  actorBranch: featureBranch,
  requestedTarget: 'canonical-production',
});
assert.equal(featureToProduction.allowed, false);
assert.equal(boundary.verifyReceipt(featureToProduction), true);

const stagingWrongWorkflow = boundary.assess({
  actorBranch: evidence.policy.canonicalBranches.staging,
  requestedTarget: 'canonical-staging',
  executionPath: '.github/workflows/wfm-zero-engineer-support-contract.yml',
});
assert.equal(stagingWrongWorkflow.allowed, false);
assert.equal(stagingWrongWorkflow.reason, 'canonical-staging-authority-denied');

const stagingCorrectWorkflow = boundary.assess({
  actorBranch: evidence.policy.canonicalBranches.staging,
  requestedTarget: 'canonical-staging',
  executionPath: evidence.policy.canonicalRailway.staging.deploymentAuthority,
});
assert.equal(stagingCorrectWorkflow.allowed, true);
assert.equal(stagingCorrectWorkflow.deploymentAuthorityGranted, false);
assert.equal(boundary.verifyReceipt(stagingCorrectWorkflow), true);

const productionUnconfigured = boundary.assess({
  actorBranch: evidence.policy.canonicalBranches.production,
  requestedTarget: 'canonical-production',
});
assert.equal(productionUnconfigured.allowed, false);
assert.equal(productionUnconfigured.reason, 'canonical-production-unconfigured');

const modelEscape = boundary.assess({
  actorBranch: featureBranch,
  requestedTarget: 'disposable-preview',
  isDisposablePreview: true,
  modelAuthorityRequested: true,
});
assert.equal(modelEscape.allowed, false);
assert.equal(modelEscape.reason, 'model-authority-denied');

const futurePolicy = structuredClone(evidence.policy);
futurePolicy.canonicalRailway.production = {
  projectId: 'future-production-project',
  environmentId: 'future-production-environment',
  serviceId: 'future-production-service',
  deploymentAuthority: '.github/workflows/canonical-production-release.yml',
};
const futureBoundary = createCanonicalReleaseBoundary({ ...evidence, policy: futurePolicy });
const stagedSha = 'a'.repeat(40);
const changedSha = 'b'.repeat(40);
const wrongCommit = futureBoundary.assess({
  actorBranch: futurePolicy.canonicalBranches.production,
  requestedTarget: 'canonical-production',
  executionPath: futurePolicy.canonicalRailway.production.deploymentAuthority,
  stagedCommitSha: stagedSha,
  requestedCommitSha: changedSha,
});
assert.equal(wrongCommit.allowed, false);
const exactCommit = futureBoundary.assess({
  actorBranch: futurePolicy.canonicalBranches.production,
  requestedTarget: 'canonical-production',
  executionPath: futurePolicy.canonicalRailway.production.deploymentAuthority,
  stagedCommitSha: stagedSha,
  requestedCommitSha: stagedSha,
});
assert.equal(exactCommit.allowed, true);
assert.equal(exactCommit.productionAuthorityGranted, false);

const tampered = structuredClone(stagingCorrectWorkflow);
tampered.reason = 'forged';
assert.equal(boundary.verifyReceipt(tampered), false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'canonical-release-boundary-compatibility',
  status: 'PASS',
  liveCanonicalEvidence: evidence.live,
  sourceRef: evidence.sourceRef,
  sourceBaseSha: evidence.sourceBaseSha,
  sourcePolicyBlobSha: evidence.sourcePolicyBlobSha,
  policyDigest: policyCheck.policyDigest,
  featureBranchCanonicalDeployDenied: true,
  disposablePreviewOnlyForFeatureBranch: true,
  canonicalStagingRequiresDedicatedReleaseWorkflow: true,
  canonicalProductionUnconfiguredDenied: true,
  futureProductionRequiresExactStagingCommit: true,
  modelAuthorityDenied: true,
  releaseBoundaryGrantsNoDeploymentAuthority: true,
  receiptTamperDetected: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
