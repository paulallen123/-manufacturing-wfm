import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createCanonicalReleaseBoundary,
  validateCanonicalReleasePolicy,
  validateCanonicalTrustAnchorGovernance,
} = require('../resilience/canonical-release-boundary.cjs');
const root = process.cwd();
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'resilience/canonical-release-policy-snapshot.json'), 'utf8'));

const CONTROL_PATHS = Object.freeze({
  policy: 'release/release-policy.json',
  deploymentPointer: 'release/deployment-pointer.json',
  stagingWorkflow: '.github/workflows/canonical-staging-release.yml',
  releaseValidator: 'scripts/validate-release-policy.mjs',
});

function runGit(args, label) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${label}: ${run.stderr || 'unknown git error'}`);
  return String(run.stdout || '');
}

function gitBlobSha(file) {
  return runGit(['hash-object', file], 'Unable to hash canonical release policy file').trim().toLowerCase();
}

function gitObjectBlobSha(commitSha, repoPath) {
  return runGit(['rev-parse', `${commitSha}:${repoPath}`], `Unable to resolve ${repoPath} at canonical commit`).trim().toLowerCase();
}

function gitShow(commitSha, repoPath) {
  return runGit(['show', `${commitSha}:${repoPath}`], `Unable to read ${repoPath} from canonical commit`);
}

function assertDeploymentPointerSemantics(policy, deploymentPointer) {
  const branches = policy.canonicalBranches;
  const staging = policy.canonicalRailway?.staging;

  assert.equal(deploymentPointer.schemaVersion, 1);
  assert.equal(deploymentPointer.purpose, 'canonical-release-path-proof');
  assert.equal(deploymentPointer.integrationBranch, branches.integration);
  assert.equal(deploymentPointer.stagingCandidateRef, branches.staging);
  assert.equal(deploymentPointer.stagingDeployMirror, branches.stagingDeployMirror);
  assert.equal(deploymentPointer.productionRef, branches.production);
  assert.equal(deploymentPointer.canonicalRailwayServiceId, staging.serviceId);
  assert.equal(deploymentPointer.requiresExactShaMatch, true);
  assert.equal(deploymentPointer.customerMutation, false);
  assert.equal(deploymentPointer.productionMutation, false);
}

function assertControlBundleSemantics({ policy, deploymentPointer, stagingWorkflow, releaseValidator }) {
  assertDeploymentPointerSemantics(policy, deploymentPointer);
  const staging = policy.canonicalRailway?.staging;

  for (const marker of [
    'name: Canonical staging release',
    'branches: [main]',
    'contents: read',
    'if: github.actor == github.repository_owner',
    'persist-credentials: false',
    'ref: ${{ github.sha }}',
    'git/ref/heads/release/staging',
    'test "$staging_sha" = "$GITHUB_SHA"',
    'node scripts/validate-release-policy.mjs',
    `RAILWAY_SERVICE_ID: '${staging.serviceId}'`,
    "health.productionApproved !== false",
  ]) {
    assert.ok(stagingWorkflow.includes(marker), `Canonical staging workflow missing required invariant: ${marker}`);
  }

  for (const marker of [
    "../release/release-policy.json",
    "GitHub must remain source of truth",
    "Railway must remain the canonical execution provider",
    staging.serviceId,
    staging.deploymentAuthority,
  ]) {
    assert.ok(releaseValidator.includes(marker), `Canonical release validator missing required invariant: ${marker}`);
  }
}

function loadControlBundleFromCanonicalCommit(baseSha) {
  assert.match(baseSha, /^[a-f0-9]{40}$/);
  const policyRaw = gitShow(baseSha, CONTROL_PATHS.policy);
  const deploymentPointerRaw = gitShow(baseSha, CONTROL_PATHS.deploymentPointer);
  const stagingWorkflow = gitShow(baseSha, CONTROL_PATHS.stagingWorkflow);
  const releaseValidator = gitShow(baseSha, CONTROL_PATHS.releaseValidator);
  const policy = JSON.parse(policyRaw);
  const deploymentPointer = JSON.parse(deploymentPointerRaw);
  const blobShas = {
    policy: gitObjectBlobSha(baseSha, CONTROL_PATHS.policy),
    deploymentPointer: gitObjectBlobSha(baseSha, CONTROL_PATHS.deploymentPointer),
    stagingWorkflow: gitObjectBlobSha(baseSha, CONTROL_PATHS.stagingWorkflow),
    releaseValidator: gitObjectBlobSha(baseSha, CONTROL_PATHS.releaseValidator),
  };
  assertControlBundleSemantics({ policy, deploymentPointer, stagingWorkflow, releaseValidator });
  return { policy, deploymentPointer, stagingWorkflow, releaseValidator, blobShas };
}

function loadPolicyEvidence() {
  const liveFile = process.env.WFM_CANONICAL_RELEASE_POLICY_FILE;
  const liveBaseSha = String(process.env.WFM_CANONICAL_BASE_SHA || '').trim().toLowerCase();
  const liveBlobSha = String(process.env.WFM_CANONICAL_POLICY_BLOB_SHA || '').trim().toLowerCase();
  const liveClaimed = Boolean(liveFile || liveBaseSha || liveBlobSha);

  if (liveClaimed) {
    assert.ok(liveFile && liveBaseSha && liveBlobSha, 'Live canonical release evidence must provide file, base SHA and policy blob SHA together.');
    assert.match(liveBaseSha, /^[a-f0-9]{40}$/, 'Live canonical base SHA must be an exact git commit SHA.');
    assert.match(liveBlobSha, /^[a-f0-9]{40}$/, 'Live canonical policy blob SHA must be an exact git blob SHA.');
    assert.equal(gitBlobSha(liveFile), liveBlobSha, 'Live canonical policy bytes do not match the claimed Git blob SHA.');

    const bundle = loadControlBundleFromCanonicalCommit(liveBaseSha);
    assert.equal(bundle.blobShas.policy, liveBlobSha, 'Live canonical policy blob does not belong to the claimed canonical commit.');
    assert.deepEqual(JSON.parse(fs.readFileSync(liveFile, 'utf8')), bundle.policy, 'Live canonical policy file differs from the exact canonical commit.');

    return {
      sourceRef: snapshot.sourceRef,
      sourceBaseSha: liveBaseSha,
      sourcePolicyBlobSha: liveBlobSha,
      sourceDeploymentPointerBlobSha: bundle.blobShas.deploymentPointer,
      sourceStagingWorkflowBlobSha: bundle.blobShas.stagingWorkflow,
      sourceReleaseValidatorBlobSha: bundle.blobShas.releaseValidator,
      policy: bundle.policy,
      deploymentPointer: bundle.deploymentPointer,
      live: true,
      exactCanonicalControlBundleBound: true,
    };
  }

  assert.match(snapshot.sourceBaseSha, /^[a-f0-9]{40}$/);
  assert.match(snapshot.sourcePolicyBlobSha, /^[a-f0-9]{40}$/);
  assert.match(snapshot.sourceDeploymentPointerBlobSha, /^[a-f0-9]{40}$/);
  assert.match(snapshot.sourceStagingWorkflowBlobSha, /^[a-f0-9]{40}$/);
  assert.match(snapshot.sourceReleaseValidatorBlobSha, /^[a-f0-9]{40}$/);
  assertDeploymentPointerSemantics(snapshot.policy, snapshot.deploymentPointer);
  return {
    sourceRef: snapshot.sourceRef,
    sourceBaseSha: snapshot.sourceBaseSha,
    sourcePolicyBlobSha: snapshot.sourcePolicyBlobSha,
    sourceDeploymentPointerBlobSha: snapshot.sourceDeploymentPointerBlobSha,
    sourceStagingWorkflowBlobSha: snapshot.sourceStagingWorkflowBlobSha,
    sourceReleaseValidatorBlobSha: snapshot.sourceReleaseValidatorBlobSha,
    policy: snapshot.policy,
    deploymentPointer: snapshot.deploymentPointer,
    live: false,
    exactCanonicalControlBundleBound: false,
  };
}

const evidence = loadPolicyEvidence();
const policyCheck = validateCanonicalReleasePolicy(evidence.policy);
assert.equal(policyCheck.valid, true);

const strongGovernance = {
  protected: true,
  pullRequestRequired: true,
  requiredApprovingReviewCount: 1,
  dismissStaleReviews: true,
  requiredStatusChecksEnforced: true,
  requiredStatusChecksStrict: true,
  requiredStatusCheckCount: 3,
  enforceAdmins: true,
  allowForcePushes: false,
  allowDeletions: false,
  bypassActorCount: 0,
};
const governanceReceipt = validateCanonicalTrustAnchorGovernance(strongGovernance);
assert.equal(governanceReceipt.governanceVerified, true);
assert.equal(governanceReceipt.releaseAuthorityGranted, false);
assert.equal(governanceReceipt.productionAuthorityGranted, false);
assert.match(governanceReceipt.governanceDigest, /^[a-f0-9]{64}$/);

for (const [field, unsafeValue] of [
  ['protected', false],
  ['pullRequestRequired', false],
  ['requiredApprovingReviewCount', 0],
  ['dismissStaleReviews', false],
  ['requiredStatusChecksEnforced', false],
  ['requiredStatusChecksStrict', false],
  ['requiredStatusCheckCount', 0],
  ['enforceAdmins', false],
  ['allowForcePushes', true],
  ['allowDeletions', true],
  ['bypassActorCount', 1],
]) {
  assert.throws(
    () => validateCanonicalTrustAnchorGovernance({ ...strongGovernance, [field]: unsafeValue }),
    (error) => error?.code === 'WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE',
    `Governance downgrade must fail closed: ${field}`,
  );
}

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
  schemaVersion: 3,
  proof: 'canonical-release-boundary-compatibility',
  status: 'PASS',
  liveCanonicalEvidence: evidence.live,
  livePolicyBytesBoundToBlob: evidence.live,
  exactCanonicalControlBundleBound: evidence.exactCanonicalControlBundleBound,
  sourceRef: evidence.sourceRef,
  sourceBaseSha: evidence.sourceBaseSha,
  sourcePolicyBlobSha: evidence.sourcePolicyBlobSha,
  sourceDeploymentPointerBlobSha: evidence.sourceDeploymentPointerBlobSha,
  sourceStagingWorkflowBlobSha: evidence.sourceStagingWorkflowBlobSha,
  sourceReleaseValidatorBlobSha: evidence.sourceReleaseValidatorBlobSha,
  policyDigest: policyCheck.policyDigest,
  deploymentPointerSemanticsBound: true,
  stagingWorkflowSemanticsBound: true,
  canonicalReleaseValidatorSemanticsBound: true,
  releaseGradeTrustAnchorRequiresPrGate: true,
  releaseGradeTrustAnchorRequiresApprovals: true,
  releaseGradeTrustAnchorRequiresStrictStatusChecks: true,
  releaseGradeTrustAnchorRequiresAdminEnforcement: true,
  releaseGradeTrustAnchorRejectsForcePushes: true,
  releaseGradeTrustAnchorRejectsDeletions: true,
  releaseGradeTrustAnchorRejectsBypassActors: true,
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
