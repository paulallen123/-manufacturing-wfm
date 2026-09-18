import fs from 'node:fs';

const policy = JSON.parse(fs.readFileSync(new URL('../release/release-policy.json', import.meta.url), 'utf8'));

const fail = (message) => {
  console.error('RELEASE_POLICY_FAIL:', message);
  process.exitCode = 1;
};

if (policy.schemaVersion !== 1) fail('unsupported schemaVersion');
if (policy.sourceOfTruth !== 'github') fail('GitHub must remain source of truth');
if (policy.executionProvider !== 'railway') fail('Railway must remain the canonical execution provider');

const branches = policy.canonicalBranches || {};
for (const key of ['integration', 'staging', 'production']) {
  if (!branches[key] || typeof branches[key] !== 'string') fail(`missing canonical branch: ${key}`);
}
if (new Set([branches.integration, branches.staging, branches.production]).size !== 3) fail('canonical release branches must be distinct');
if (branches.stagingDeployMirror !== 'main') fail('main must be the staging deploy mirror');

const rules = policy.rules || {};
for (const key of [
  'featureBranchesMayDeployOnlyToDisposablePreviewServices',
  'canonicalStagingAcceptsOnlyReleaseStagingBranch',
  'canonicalProductionAcceptsOnlyReleaseProductionBranch',
  'productionMustUseExactStagingCommit',
  'legacyPinnedShaWorkflowsAreProofOnly',
  'mainIsStagingMirrorOnly',
  'mainMustMatchReleaseStagingBeforeCanonicalDeploy',
  'canonicalRailwayCliOnlyFromReleaseWorkflow'
]) {
  if (rules[key] !== true) fail(`required rule is not enabled: ${key}`);
}
if (rules.manualRailwayUpToCanonicalServices !== false) {
  fail('manual Railway uploads to canonical services must be disabled by policy');
}
if (!Number.isInteger(rules.previewTtlHours) || rules.previewTtlHours < 1 || rules.previewTtlHours > 72) {
  fail('previewTtlHours must be an integer from 1 to 72');
}

const staging = policy.canonicalRailway?.staging;
if (!staging?.projectId || !staging?.environmentId || staging?.serviceId !== '3bea5411-cebb-4878-adcc-766f5fd58cc7') {
  fail('canonical staging target is incomplete or changed');
}
if (staging?.sourceBranch !== 'main') fail('canonical staging must remain bound to main mirror');
if (staging?.authorityAlias !== 'wfm-canonical-staging') fail('canonical staging authority alias missing');
if (staging?.deploymentAuthority !== '.github/workflows/canonical-staging-release.yml') fail('canonical staging deployment authority drifted');

if (!process.exitCode) console.log('RELEASE_POLICY=PASS');
