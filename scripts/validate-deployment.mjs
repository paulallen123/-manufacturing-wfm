import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';

const manifest = JSON.parse(fs.readFileSync('DEPLOYMENT_MANIFEST.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('resilience/security-baseline.json', 'utf8'));
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

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

const fromImage = dockerfile.match(/^FROM\s+(\S+)\s*$/m)?.[1];
assert.equal(fromImage, manifest.node_image, 'Docker base image and deployment manifest must match exactly.');
const imageMatch = String(manifest.node_image).match(/^node:(\d+\.\d+\.\d+)-([^@]+)@sha256:([a-f0-9]{64})$/i);
assert.ok(imageMatch, 'Deployment manifest must pin an exact Node image version and immutable sha256 digest.');
assert.equal(Number(imageMatch[1].split('.')[0]), baseline.node.major, 'Node major differs from the approved resilience baseline.');
assert.ok(gte(imageMatch[1], baseline.node.minimum), `Node ${imageMatch[1]} is below security floor ${baseline.node.minimum}.`);
assert.equal(imageMatch[2], baseline.node.image_suffix, 'Node image family differs from the approved resilience baseline.');
assert.match(imageMatch[3], /^[a-f0-9]{64}$/i, 'Node image digest is invalid.');

assert.equal(manifest.runtime_user, 'node', 'Runtime must use the unprivileged node account.');
assert.match(dockerfile, /^USER\s+node\s*$/m, 'Dockerfile must switch to USER node.');

assert.match(manifest.runtime_sha256, /^[a-f0-9]{64}$/i, 'Runtime SHA-256 is invalid.');
const dockerRuntimeSha = dockerfile.match(/echo\s+"([a-f0-9]{64})\s+\/tmp\/runtime\.tgz"/i)?.[1];
assert.equal(dockerRuntimeSha, manifest.runtime_sha256, 'Docker runtime checksum must equal the deployment manifest checksum.');

const copyMatch = dockerfile.match(/^COPY\s+artifact\/([^\s]+)\s+\/tmp\/runtime\.tgz\s*$/m);
assert.ok(copyMatch, 'Dockerfile must copy the sealed runtime from the private repository build context.');
const artifactPath = path.join('artifact', copyMatch[1]);
assert.equal(artifactPath, manifest.runtime_artifact, 'Docker runtime artifact path must equal the deployment manifest artifact path.');
assert.equal(path.basename(artifactPath), `wfm-${manifest.candidate}.tar.gz`, 'Runtime artifact identity must exactly match the manifest candidate.');
assert.ok(fs.existsSync(artifactPath), 'Sealed runtime artifact is missing from the private repository.');
const artifactSha = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
assert.equal(artifactSha, manifest.runtime_sha256, 'Private repository runtime artifact checksum mismatch.');

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
  candidate: manifest.candidate,
  runtimeArtifact: manifest.runtime_artifact,
  runtimeSha256: manifest.runtime_sha256,
  nodeImage: manifest.node_image,
  runtimeUser: manifest.runtime_user,
  nodeSecurityFloor: baseline.node.minimum,
  packageManagersPresent: baseline.external_intelligence.runtime_dependency_expectation.package_managers_present,
  productionApproved: manifest.production_approved,
  stagingOnly: manifest.staging_only
}, null, 2));
