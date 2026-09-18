import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('DEPLOYMENT_MANIFEST.json', 'utf8'));
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
const bootstrap = fs.readFileSync('security/runtime/bootstrap.cjs', 'utf8');
const attestation = fs.readFileSync('security/runtime/runtime-attestation.cjs', 'utf8');

assert.match(String(manifest.runtime_sha256 || ''), /^[a-f0-9]{64}$/i, 'Manifest runtime SHA-256 is invalid.');
assert.match(
  dockerfile,
  /COPY security\/runtime\/runtime-attestation\.cjs \/app\/security-runtime\/runtime-attestation\.cjs/,
  'Runtime attestation module must be copied into the final image.'
);

const bakedDigest = dockerfile.match(/RUN printf '%s\\n' '([a-f0-9]{64})' > \/app\/security-runtime\/runtime-sha256/i)?.[1];
assert.equal(bakedDigest, manifest.runtime_sha256, 'Image-baked runtime identity must equal the deployment manifest runtime SHA-256.');
assert.doesNotMatch(dockerfile, /WFM_IMAGE_RUNTIME_SHA256/, 'Image runtime identity must not be overrideable through environment configuration.');

const attestationCall = bootstrap.indexOf('assertRuntimeAttestation()');
const serverStart = bootstrap.indexOf("require('/app/server.cjs')");
assert.ok(attestationCall >= 0, 'Bootstrap must execute runtime attestation.');
assert.ok(serverStart > attestationCall, 'Runtime attestation must execute before the application server can start.');
assert.match(bootstrap, /WFM_RUNTIME_ATTESTATION_FAILED/, 'Bootstrap must emit a deterministic attestation failure event.');
assert.match(attestation, /process\.env\.WFM_RUNTIME_SHA256/, 'Runtime must require the independently configured runtime identity.');
assert.match(attestation, /\/app\/security-runtime\/runtime-sha256/, 'Runtime must read the image-baked runtime identity from the sealed filesystem.');
assert.match(attestation, /timingSafeEqual/, 'Runtime identity comparison must use constant-time digest comparison.');

execFileSync(process.execPath, ['--test', 'security/runtime/runtime-attestation.test.cjs'], { stdio: 'inherit' });

console.log(JSON.stringify({
  ok: true,
  prevention: 'runtime-source-to-config-attestation',
  runtimeSha256: manifest.runtime_sha256,
  startupOrder: 'attestation-before-server',
  externalIdentityVariable: 'WFM_RUNTIME_SHA256',
  failClosed: true
}, null, 2));
