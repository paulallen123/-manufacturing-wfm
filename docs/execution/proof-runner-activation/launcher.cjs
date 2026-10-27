'use strict';
// Deployment preparation for the EXISTING isolated browser runner; no product claims.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync, spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const SOURCE = '4ed5eb3668452a0229469b8e1d426e84eea18187';
const FILES = Object.freeze({
  'scripts/current-candidate-role-browser-proof.mjs': '5d5921f54b3e501f70004d324036e3c5fbd336b1f04550cb0ec390434252d903',
  'scripts/current-candidate-role-browser-proof-server.mjs': '9f945ad2e768ad0645b493015f03fd85022e79b5c1f51038dcb485d6191b9e06',
  'scripts/vector-proof-result.mjs': '6feddbe9a318eae12f79e0374d0bfa13fdace67fd610a6e26abd6a0c4a09205e',
  'security/runtime/proof-runner-auth.cjs': '0701e4d5d01a211bde865dce2256b9892475f95ae27a415a02132700f1d4fa5b'
});
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function requireThat(ok, code) { if (!ok) throw new Error(code); }
function decode(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 300000, 'INVALID_BASE64');
  const bytes = Buffer.from(value, 'base64');
  requireThat(bytes.toString('base64') === value, 'INVALID_BASE64');
  return bytes;
}
function validateBundle(encoded, expectedHash) {
  requireThat(/^[0-9a-f]{64}$/.test(expectedHash), 'INVALID_BUNDLE_HASH');
  const compressed = decode(encoded);
  requireThat(hash(compressed) === expectedHash, 'BUNDLE_HASH_MISMATCH');
  const bundle = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: 200000 }).toString('utf8'));
  requireThat(bundle.source === SOURCE && bundle.schema === 1, 'BUNDLE_SOURCE_MISMATCH');
  requireThat(Array.isArray(bundle.files) && bundle.files.length === 4, 'BUNDLE_FILE_SET_MISMATCH');
  const seen = new Set();
  const files = bundle.files.map(file => {
    requireThat(file && Object.hasOwn(FILES, file.path) && !seen.has(file.path), 'BUNDLE_FILE_SET_MISMATCH');
    seen.add(file.path);
    const bytes = decode(file.base64);
    requireThat(hash(bytes) === FILES[file.path], 'SOURCE_FILE_HASH_MISMATCH');
    return { path: file.path, bytes };
  });
  return files;
}
function materialize(encoded, expectedHash) {
  // Validate the entire payload before creating any files. Never unpack an archive.
  const files = validateBundle(encoded, expectedHash);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-browser-proof-'));
  fs.chmodSync(root, 0o700);
  try {
    for (const file of files) {
      const target = path.join(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, file.bytes, { flag: 'wx', mode: 0o600 });
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true }), { flag: 'wx', mode: 0o600 });
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
function validateEnvironment(env) {
  requireThat(env.RAILWAY_SERVICE_ID === 'f84fe27d-af17-451c-b164-54dfef6b6a4b', 'WRONG_EXISTING_RUNNER');
  requireThat(env.RAILWAY_ENVIRONMENT_ID === 'eed9f097-610a-416e-83b9-6bc7bdb3eeef', 'WRONG_PROOF_ENVIRONMENT');
  requireThat(env.VECTOR_PROOF_URL === 'https://vector-hardening-proof-production.up.railway.app/', 'WRONG_ISOLATED_TARGET');
  requireThat(env.WFM_EXPECTED_CANDIDATE_SHA === SOURCE, 'WRONG_TARGET_SOURCE');
  requireThat(env.VECTOR_PROOF_AUTH_PROFILE === 'signed', 'SIGNED_PROFILE_REQUIRED');
  for (const name of ['WFM_REQUIRE_VECTOR_ASSET_DIGESTS', 'WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE'])
    requireThat(env[name] === 'true', 'STRICT_PROOF_GATES_REQUIRED');
  for (const name of ['VECTOR_PROOF_ACTORS_JSON', 'PROOF_PRIVATE_KEY_B64', 'EXPECTED_DEPLOYMENT_ID',
    'EXPECTED_IMPLEMENTATION_TENANT', 'EXPECTED_IMPLEMENTATION_RUN_ID', 'EXPECTED_CONFIGURATION_DIGEST',
    'VECTOR_CANONICAL_JS_SHA256', 'VECTOR_CANONICAL_CSS_SHA256', 'VECTOR_WORKFLOW_JS_SHA256'])
    requireThat(typeof env[name] === 'string' && env[name].trim().length > 0, 'MISSING_REQUIRED_BINDING_' + name);
  // The canonical client still validates the signer, actors and actual server identities.
  // Do not log environment values or convert these presence checks into proof receipts.
}
async function run(encoded, expectedHash) {
  validateEnvironment(process.env);
  require('node:sqlite');
  const root = materialize(encoded, expectedHash);
  try {
    const installation = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', root, 'playwright@1.63.0'],
      { cwd: root, stdio: 'inherit', timeout: 120000, killSignal: 'SIGKILL' });
    requireThat(!installation.error && installation.status === 0, 'PLAYWRIGHT_INSTALL_FAILED');
    const requireHere = createRequire(path.join(root, 'package.json'));
    requireThat(requireHere('playwright/package.json').version === '1.63.0', 'PLAYWRIGHT_VERSION_MISMATCH');
    requireThat(fs.existsSync(requireHere('playwright').chromium.executablePath()), 'PLAYWRIGHT_BROWSER_MISSING');
    console.log('VECTOR_PROOF_RUNNER_SOURCE=' + SOURCE + '|bundleSha256=' + expectedHash);
    const child = spawn(process.execPath, [path.join(root, 'scripts/current-candidate-role-browser-proof-server.mjs')],
      { cwd: root, stdio: 'inherit' });
    const onTerm = () => child.kill('SIGTERM');
    const onInt = () => child.kill('SIGINT');
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onInt);
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          process.exitCode = Number.isInteger(code) ? code : (signal === 'SIGTERM' ? 143 : 130);
          resolve();
        });
      });
    } finally {
      process.off('SIGTERM', onTerm);
      process.off('SIGINT', onInt);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { SOURCE, FILES, hash, validateBundle, materialize, validateEnvironment, run };
