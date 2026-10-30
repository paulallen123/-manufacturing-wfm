'use strict';
// Deployment preparation for the EXISTING isolated browser runner; no product claims.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync, spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const TRANSPORT_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_USE_ENV_PROXY',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
]);

// Runner-code provenance is distinct from the reviewed application target.
const SOURCE = 'ca05f1017c1e10f9b164c58a044d2cd4159d4ea3';
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
  requireThat(/^[0-9a-f]{40}$/.test(env.WFM_EXPECTED_CANDIDATE_SHA || '') && env.WFM_EXPECTED_CANDIDATE_SHA !== '0'.repeat(40), 'INVALID_EXPECTED_TARGET_SOURCE');
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
const MAX_IDENTITY_BYTES = 8192;
const PREFLIGHT_TIMEOUT_MS = 5000;
async function preflightRuntimeIdentity(env, { fetchImpl = globalThis.fetch, timeoutMs = PREFLIGHT_TIMEOUT_MS } = {}) {
  validateEnvironment(env);
  requireThat(typeof fetchImpl === 'function', 'RUNTIME_IDENTITY_FETCH_UNAVAILABLE');
  requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= PREFLIGHT_TIMEOUT_MS, 'INVALID_PREFLIGHT_TIMEOUT');
  const expectedSha = env.WFM_EXPECTED_CANDIDATE_SHA;
  const url = new URL('/api/runtime-identity', env.VECTOR_PROOF_URL).href;
  const controller = new AbortController();
  let reader, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new Error('RUNTIME_IDENTITY_TIMEOUT')); controller.abort(); }, timeoutMs);
  });
  const inspect = async () => {
    let response;
    try {
      // This is public identity inspection only: no signer, cookie or bearer token.
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit',
        cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch { throw new Error('RUNTIME_IDENTITY_FETCH_FAILED'); }
    requireThat(response && response.status === 200 && !response.redirected && response.url === url, 'RUNTIME_IDENTITY_RESPONSE_REJECTED');
    requireThat(/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type') || ''), 'RUNTIME_IDENTITY_CONTENT_TYPE_REJECTED');
    const declaredSize = response.headers.get('content-length');
    requireThat(declaredSize === null || (/^\d+$/.test(declaredSize) && Number(declaredSize) <= MAX_IDENTITY_BYTES), 'RUNTIME_IDENTITY_TOO_LARGE');
    requireThat(response.body && typeof response.body.getReader === 'function', 'RUNTIME_IDENTITY_BODY_REQUIRED');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch { throw new Error('RUNTIME_IDENTITY_BODY_FAILED'); }
      const { value, done } = chunk;
      if (done) break;
      requireThat(value instanceof Uint8Array, 'RUNTIME_IDENTITY_BODY_INVALID');
      size += value.byteLength;
      requireThat(size <= MAX_IDENTITY_BYTES, 'RUNTIME_IDENTITY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    let identity;
    try { identity = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('RUNTIME_IDENTITY_INVALID_JSON'); }
    requireThat(identity && typeof identity === 'object' && !Array.isArray(identity), 'RUNTIME_IDENTITY_INVALID_JSON');
    requireThat(identity.candidateSha === expectedSha, 'RUNTIME_IDENTITY_TARGET_MISMATCH');
    requireThat(identity.sourceBinding === 'build-file-matched', 'RUNTIME_IDENTITY_SOURCE_UNBOUND');
    requireThat(identity.fixtureOnly === true && identity.productionApproved === false && identity.pilotReady === false, 'RUNTIME_IDENTITY_SCOPE_MISMATCH');
    return Object.freeze({ candidateSha: expectedSha, sourceBinding: identity.sourceBinding,
      fixtureOnly: true, productionApproved: false, pilotReady: false });
  };
  try { return await Promise.race([inspect(), deadline]); }
  finally {
    clearTimeout(timer); controller.abort();
    try { reader?.cancel().catch(() => {}); } catch {}
  }
}
function installerEnvironment(env, root) {
  // Package retrieval needs transport/CA settings, not the proof signer's authority.
  const clean = {};
  for (const key of TRANSPORT_ENVIRONMENT_KEYS)
    if (typeof env[key] === 'string') clean[key] = env[key];
  clean.npm_config_cache = path.join(root, 'npm-cache');
  return Object.freeze(clean);
}
function proofChildEnvironment(env) {
  // Signed navigation needs only its explicit proof scope, browser and transport.
  // Provider/worker authority, obsolete eval inputs and Node preload hooks stay out.
  const clean = {};
  for (const key of [...TRANSPORT_ENVIRONMENT_KEYS, 'PORT', 'PLAYWRIGHT_BROWSERS_PATH',
    'VECTOR_PROOF_URL', 'WFM_EXPECTED_CANDIDATE_SHA', 'VECTOR_PROOF_AUTH_PROFILE',
    'VECTOR_PROOF_ACTORS_JSON', 'PROOF_PRIVATE_KEY_B64', 'EXPECTED_DEPLOYMENT_ID',
    'EXPECTED_IMPLEMENTATION_TENANT', 'EXPECTED_IMPLEMENTATION_RUN_ID', 'EXPECTED_CONFIGURATION_DIGEST',
    'WFM_REQUIRE_VECTOR_ASSET_DIGESTS', 'WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE',
    'VECTOR_CANONICAL_JS_SHA256', 'VECTOR_CANONICAL_CSS_SHA256', 'VECTOR_WORKFLOW_JS_SHA256'])
    if (typeof env[key] === 'string') clean[key] = env[key];
  return Object.freeze(clean);
}
async function run(encoded, expectedHash, { fetchImpl = globalThis.fetch, timeoutMs = PREFLIGHT_TIMEOUT_MS } = {}) {
  // Freeze reviewed inputs across the asynchronous preflight and child lifetime.
  const env = Object.freeze({ ...process.env });
  validateEnvironment(env);
  validateBundle(encoded, expectedHash);
  await preflightRuntimeIdentity(env, { fetchImpl, timeoutMs });
  require('node:sqlite');
  const root = materialize(encoded, expectedHash);
  try {
    const installation = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', root, 'playwright@1.63.0'],
      { cwd: root, env: installerEnvironment(env, root), stdio: 'inherit', timeout: 120000, killSignal: 'SIGKILL' });
    requireThat(!installation.error && installation.status === 0, 'PLAYWRIGHT_INSTALL_FAILED');
    const requireHere = createRequire(path.join(root, 'package.json'));
    requireThat(requireHere('playwright/package.json').version === '1.63.0', 'PLAYWRIGHT_VERSION_MISMATCH');
    requireThat(fs.existsSync(requireHere('playwright').chromium.executablePath()), 'PLAYWRIGHT_BROWSER_MISSING');
    console.log('VECTOR_PROOF_RUNNER_SOURCE=' + SOURCE + '|targetSha=' + env.WFM_EXPECTED_CANDIDATE_SHA + '|bundleSha256=' + expectedHash);
    const child = spawn(process.execPath, [path.join(root, 'scripts/current-candidate-role-browser-proof-server.mjs')],
      { cwd: root, env: proofChildEnvironment(env), stdio: 'inherit' });
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
module.exports = { SOURCE, FILES, hash, validateBundle, materialize, validateEnvironment, preflightRuntimeIdentity, MAX_IDENTITY_BYTES, PREFLIGHT_TIMEOUT_MS, installerEnvironment, proofChildEnvironment, run };
