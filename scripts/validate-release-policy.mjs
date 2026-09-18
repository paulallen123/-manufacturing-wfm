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
if (new Set(Object.values(branches)).size !== 3) fail('canonical branches must be distinct');

const rules = policy.rules || {};
for (const key of [
  'featureBranchesMayDeployOnlyToDisposablePreviewServices',
  'canonicalStagingAcceptsOnlyReleaseStagingBranch',
  'canonicalProductionAcceptsOnlyReleaseProductionBranch',
  'productionMustUseExactStagingCommit',
  'legacyPinnedShaWorkflowsAreProofOnly'
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
if (!staging?.projectId || !staging?.environmentId || staging?.serviceName !== 'wfm-canonical-staging') {
  fail('canonical staging target is incomplete or renamed');
}

if (!process.exitCode) console.log('RELEASE_POLICY=PASS');
