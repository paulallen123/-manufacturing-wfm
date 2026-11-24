import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';

const manifest = JSON.parse(fs.readFileSync('DEPLOYMENT_MANIFEST.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('resilience/security-baseline.json', 'utf8'));
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireSha = (key, value) => assert.match(String(value || ''), /^[a-f0-9]{64}$/i, `${key} must be a SHA-256 digest.`);
const parseVersion = value => {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, `Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
};
const gte = (actual, minimum) => {
  const a = parseVersion(actual), b = parseVersion(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
};

// Provenance and claim-boundary checks fail closed so a later artifact replacement
// cannot silently weaken the evidence contract.
assert.equal(manifest.schema_version, 4, 'Deployment manifest must use provenance schema version 4.');
assert.match(String(manifest.candidate), /^0\.6\.76-hosted-staging-rc\d+$/, 'Unexpected hosted staging candidate identity.');
for (const key of [
  'parent_archive_sha256',
  'parent_source_content_sha256',
  'parent_artifact_manifest_sha256',
  'canonical_source_sha256',
  'hosted_source_sha256',
  'hosted_full_source_content_sha256',
  'hosted_full_package_manifest_sha256',
  'runtime_source_content_sha256',
  'runtime_manifest_sha256',
  'runtime_package_manifest_sha256',
  'runtime_sha256'
]) requireSha(key, manifest[key]);
assert.equal(manifest.parent_source_content_sha256, manifest.canonical_source_sha256, 'Canonical source provenance must match the parent source identity.');
assert.equal(manifest.hosted_source_sha256, manifest.hosted_full_source_content_sha256, 'Hosted source provenance fields disagree.');

const fromImage = dockerfile.match(/^FROM\s+(\S+)\s*$/m)?.[1];
assert.equal(fromImage, manifest.node_image, 'Docker base image and deployment manifest must match exactly.');
const imageMatch = String(manifest.node_image).match(/^node:(\d+\.\d+\.\d+)-([^@]+)@sha256:([a-f0-9]{64})$/i);
assert.ok(imageMatch, 'Deployment manifest must pin an exact Node image version and immutable sha256 digest.');
assert.equal(Number(imageMatch[1].split('.')[0]), baseline.node.major, 'Node major differs from the approved resilience baseline.');
assert.ok(gte(imageMatch[1], baseline.node.minimum), `Node ${imageMatch[1]} is below security floor ${baseline.node.minimum}.`);
assert.equal(imageMatch[2], baseline.node.image_suffix, 'Node image family differs from the approved resilience baseline.');
requireSha('node image digest', imageMatch[3]);

assert.equal(manifest.runtime_user, 'node', 'Runtime must use the unprivileged node account.');
assert.match(dockerfile, /^USER\s+node\s*$/m, 'Dockerfile must switch to USER node.');

const copyMatch = dockerfile.match(/^COPY\s+artifact\/([^\s]+)\s+\/tmp\/runtime\.tgz\s*$/m);
assert.ok(copyMatch, 'Dockerfile must copy the sealed runtime from the private repository build context.');
const artifactPath = path.join('artifact', copyMatch[1]);
assert.equal(artifactPath, manifest.runtime_artifact, 'Docker runtime artifact path must equal the deployment manifest artifact path.');
assert.equal(path.basename(artifactPath), `wfm-${manifest.candidate}.tar.gz`, 'Runtime artifact identity must exactly match the manifest candidate.');
assert.ok(fs.existsSync(artifactPath), 'Sealed runtime artifact is missing from the private repository.');
const artifactBytes = fs.readFileSync(artifactPath);
assert.equal(sha256(artifactBytes), manifest.runtime_sha256, 'Private repository runtime artifact checksum mismatch.');
assert.equal(artifactBytes.length, manifest.runtime_size_bytes, 'Private repository runtime artifact size mismatch.');

const dockerRuntimeSha = dockerfile.match(/echo\s+"([a-f0-9]{64})\s+\/tmp\/runtime\.tgz"/i)?.[1];
assert.equal(dockerRuntimeSha, manifest.runtime_sha256, 'Docker runtime checksum must equal the deployment manifest checksum.');
assert.match(dockerfile, /tar\s+-xzf\s+\/tmp\/runtime\.tgz\s+-C\s+\/app/, 'Dockerfile must extract the verified runtime into /app.');
assert.match(dockerfile, /rm\s+-f\s+\/tmp\/runtime\.tgz/, 'Dockerfile must remove the packaged runtime after extraction.');
assert.doesNotMatch(dockerfile, /\b(?:curl|wget)\b|https?:\/\//i, 'Dockerfile must not fetch candidate runtime from the network.');

assert.equal(manifest.production_approved, false, 'Customer-proof staging must not claim production approval.');
assert.equal(manifest.pilot_ready, false, 'Customer-proof staging must not claim pilot readiness.');
assert.equal(manifest.fixture_only, true, 'Customer-proof staging must remain fixture-only until real-provider evidence is accepted.');
assert.equal(manifest.staging_only, true, 'Customer-proof candidate must remain staging-only.');
assert.match(String(manifest.claim_boundary || ''), /Customer-proof staging only/i, 'Claim boundary must explicitly remain staging-only.');

for (const [key, expected] of Object.entries(baseline.deployment)) {
  if (key.startsWith('require_')) continue;
  assert.equal(manifest[key], expected, `Deployment safety invariant changed: ${key}.`);
}
assert.equal(baseline.deployment.require_runtime_sha256, true, 'Runtime checksum requirement must remain enabled.');
assert.equal(baseline.deployment.require_manifest_image_match, true, 'Manifest/image match requirement must remain enabled.');
assert.equal(baseline.deployment.require_image_digest, true, 'Immutable image digest requirement must remain enabled.');
assert.equal(baseline.deployment.require_non_root_user, true, 'Non-root runtime requirement must remain enabled.');
assert.equal(baseline.deployment.require_package_managers_removed, true, 'Package-manager removal requirement must remain enabled.');
assert.equal(baseline.external_intelligence?.runtime_dependency_expectation?.package_managers_present, false, 'Runtime baseline must forbid package managers.');
assert.match(dockerfile, /rm -rf\s+\/usr\/local\/lib\/node_modules\/npm\s+\/usr\/local\/lib\/node_modules\/corepack/, 'Dockerfile must remove npm and corepack module trees from the final image.');
for (const bin of ['npm','npx','corepack','yarn','yarnpkg','pnpm','pnpx']) {
  assert.ok(dockerfile.includes(`/usr/local/bin/${bin}`), `Dockerfile must remove package-manager entry point: ${bin}.`);
}
assert.equal(baseline.autonomy.language_model_direct_authority, false, 'Language models must never receive direct execution authority.');
assert.ok(baseline.autonomy.require_reversible_action, 'Autonomous remediation must remain reversible.');
assert.ok(baseline.autonomy.require_verified_dry_run, 'Autonomous remediation must require a verified dry run.');
assert.ok(baseline.autonomy.require_independent_evidence, 'Autonomous remediation must require independent evidence.');
assert.ok(Number(baseline.autonomy.minimum_confidence) >= 0.98, 'Autonomy confidence floor must not be weakened below 0.98.');

console.log(JSON.stringify({
  ok: true,
  schemaVersion: manifest.schema_version,
  candidate: manifest.candidate,
  runtimeArtifact: manifest.runtime_artifact,
  runtimeSha256: manifest.runtime_sha256,
  runtimeSizeBytes: manifest.runtime_size_bytes,
  runtimeManifestSha256: manifest.runtime_manifest_sha256,
  canonicalSourceSha256: manifest.canonical_source_sha256,
  hostedSourceSha256: manifest.hosted_source_sha256,
  nodeImage: manifest.node_image,
  runtimeUser: manifest.runtime_user,
  nodeSecurityFloor: baseline.node.minimum,
  packageManagersPresent: baseline.external_intelligence.runtime_dependency_expectation.package_managers_present,
  productionApproved: manifest.production_approved,
  stagingOnly: manifest.staging_only
}, null, 2));
