import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

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
const imageMatch = String(manifest.node_image).match(/^node:(\d+\.\d+\.\d+)-(.+)$/);
assert.ok(imageMatch, 'Deployment manifest must pin an exact Node image version.');
assert.equal(Number(imageMatch[1].split('.')[0]), baseline.node.major, 'Node major differs from the approved resilience baseline.');
assert.ok(gte(imageMatch[1], baseline.node.minimum), `Node ${imageMatch[1]} is below security floor ${baseline.node.minimum}.`);
assert.equal(imageMatch[2], baseline.node.image_suffix, 'Node image family differs from the approved resilience baseline.');

assert.match(manifest.runtime_sha256, /^[a-f0-9]{64}$/i, 'Runtime SHA-256 is invalid.');
const dockerRuntimeSha = dockerfile.match(/echo\s+"([a-f0-9]{64})\s+\/tmp\/runtime\.tgz"/i)?.[1];
assert.equal(dockerRuntimeSha, manifest.runtime_sha256, 'Docker runtime checksum must equal the deployment manifest checksum.');

const runtimeUrl = dockerfile.match(/const u='([^']+)'/)?.[1];
assert.ok(runtimeUrl?.startsWith('https://'), 'Runtime artifact must be fetched over HTTPS.');
const artifactName = path.basename(new URL(runtimeUrl).pathname, '.tgz');
assert.equal(artifactName, `wfm-${manifest.candidate}`, 'Runtime artifact name and manifest candidate must match exactly.');

for (const [key, expected] of Object.entries(baseline.deployment)) {
  if (key.startsWith('require_')) continue;
  assert.equal(manifest[key], expected, `Deployment safety invariant changed: ${key}.`);
}
assert.equal(baseline.autonomy.language_model_direct_authority, false, 'Language models must never receive direct execution authority.');
assert.ok(baseline.autonomy.require_reversible_action, 'Autonomous remediation must remain reversible.');
assert.ok(baseline.autonomy.require_verified_dry_run, 'Autonomous remediation must require a verified dry run.');
assert.ok(baseline.autonomy.require_independent_evidence, 'Autonomous remediation must require independent evidence.');
assert.ok(Number(baseline.autonomy.minimum_confidence) >= 0.98, 'Autonomy confidence floor must not be weakened below 0.98.');

console.log(JSON.stringify({
  ok: true,
  candidate: manifest.candidate,
  runtimeSha256: manifest.runtime_sha256,
  nodeImage: manifest.node_image,
  nodeSecurityFloor: baseline.node.minimum,
  productionApproved: manifest.production_approved,
  stagingOnly: manifest.staging_only
}, null, 2));
