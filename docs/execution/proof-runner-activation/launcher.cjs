'use strict';
// Deployment preparation for the EXISTING isolated browser runner; no product claims.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawnSync, spawn } = require('node:child_process');

const PROOF_CHILD_UID = 65534;
const PROOF_CHILD_GID = 65534;
const PROOF_CHILD_TIMEOUT_MS = 30 * 60_000;
const SIGNER_BROKER_LIFETIME_MS = PROOF_CHILD_TIMEOUT_MS;
const PROOF_CHILD_CLEANUP_GRACE_MS = 5_000;

const TRANSPORT_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_USE_ENV_PROXY',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
]);

// Published immutable source contains the six exact pinned files below.
// Runner-code provenance is distinct from the reviewed application target.
const SOURCE = '497a5b3707389dcef0bdd72cb3bad7eeb6781a11';
const FILES = Object.freeze({
  'scripts/current-candidate-role-browser-proof.mjs': 'c7d6b6b8ef3c2adb6e6aebfbca9da2dda61246608c115095b3e3029d99f7583c',
  'scripts/current-candidate-role-browser-proof-server.mjs': '9f945ad2e768ad0645b493015f03fd85022e79b5c1f51038dcb485d6191b9e06',
  'scripts/vector-proof-result.mjs': '6feddbe9a318eae12f79e0374d0bfa13fdace67fd610a6e26abd6a0c4a09205e',
  'security/runtime/proof-runner-auth.cjs': '0701e4d5d01a211bde865dce2256b9892475f95ae27a415a02132700f1d4fa5b',
  'docs/execution/proof-runner-activation/package.json': '7c80f48a766c87ff0ceb74bfb8e3c166b593a6321bf996085459b1ed4c350b32',
  'docs/execution/proof-runner-activation/package-lock.json': 'a0e7cf7a75adbc2f209e8fb2461c3eccc4c9a118d5b8176d8cea691b8b4bdbf5'
});
const DEPENDENCY_ROOT = 'docs/execution/proof-runner-activation/';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function requireThat(ok, code) { if (!ok) throw new Error(code); }
function validateRunnerSource(source = SOURCE) {
  requireThat(typeof source === 'string' && /^[0-9a-f]{40}$/.test(source) && source !== '0'.repeat(40), 'UNPUBLISHED_RUNNER_SOURCE');
}
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
  requireThat(Array.isArray(bundle.files) && bundle.files.length === Object.keys(FILES).length, 'BUNDLE_FILE_SET_MISMATCH');
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
    for (const name of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(root, DEPENDENCY_ROOT, name), path.join(root, name), fs.constants.COPYFILE_EXCL);
      fs.chmodSync(path.join(root, name), 0o600);
    }
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
function readJsonFile(file, code) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(code); }
  requireThat(value && typeof value === 'object' && !Array.isArray(value), code);
  return value;
}
function validateInstalledDependencies(root) {
  const lock = path.join(root, 'package-lock.json');
  requireThat(hash(fs.readFileSync(lock)) === FILES[DEPENDENCY_ROOT + 'package-lock.json'], 'PLAYWRIGHT_LOCK_MISMATCH');
  const modules = path.join(root, 'node_modules');
  const entries = fs.readdirSync(modules, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.')).map(entry => entry.name).sort();
  requireThat(JSON.stringify(entries) === JSON.stringify(['playwright', 'playwright-core']), 'PLAYWRIGHT_CLOSURE_MISMATCH');
  for (const name of entries) requireThat(fs.lstatSync(path.join(modules, name)).isDirectory(), 'PLAYWRIGHT_CLOSURE_MISMATCH');
  const playwright = readJsonFile(path.join(modules, 'playwright', 'package.json'), 'PLAYWRIGHT_PACKAGE_INVALID');
  const core = readJsonFile(path.join(modules, 'playwright-core', 'package.json'), 'PLAYWRIGHT_CORE_PACKAGE_INVALID');
  requireThat(playwright.name === 'playwright' && playwright.version === '1.63.0' &&
    playwright.dependencies?.['playwright-core'] === '1.63.0', 'PLAYWRIGHT_VERSION_MISMATCH');
  requireThat(core.name === 'playwright-core' && core.version === '1.63.0', 'PLAYWRIGHT_CORE_VERSION_MISMATCH');
}
function proofChildIdentity(proc = process) {
  requireThat(proc.platform === 'linux' && typeof proc.getuid === 'function' && typeof proc.getgid === 'function', 'PROOF_CHILD_ISOLATION_UNAVAILABLE');
  requireThat(proc.getuid() === 0, 'PROOF_CHILD_ISOLATION_UNAVAILABLE');
  requireThat(PROOF_CHILD_UID !== proc.getuid() && PROOF_CHILD_GID !== proc.getgid(), 'PROOF_CHILD_ISOLATION_UNAVAILABLE');
  return Object.freeze({ uid: PROOF_CHILD_UID, gid: PROOF_CHILD_GID });
}
function prepareProofFilesystem(root, identity = proofChildIdentity()) {
  // The untrusted dependency process gets read-only code and a separate writable home.
  // Internal npm symlinks are allowed only when their canonical target stays inside root.
  fs.rmSync(path.join(root, 'npm-cache'), { recursive: true, force: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-browser-proof-work-'));
  try { fs.chownSync(work, identity.uid, identity.gid); fs.chmodSync(work, 0o700); }
  catch (error) { fs.rmSync(work, { recursive: true, force: true }); throw error; }
  const prefix = path.resolve(root) + path.sep;
  const harden = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        requireThat(fs.realpathSync(target).startsWith(prefix), 'PLAYWRIGHT_TREE_SYMLINK_ESCAPE');
      } else if (stat.isDirectory()) {
        harden(target); fs.chmodSync(target, 0o555);
      } else if (stat.isFile()) {
        fs.chmodSync(target, 0o444);
      } else throw new Error('PLAYWRIGHT_TREE_INVALID');
    }
  };
  try { harden(root); fs.chmodSync(root, 0o555); }
  catch (error) { restoreProofFilesystem(root); fs.rmSync(work, { recursive: true, force: true }); throw error; }
  return work;
}
function restoreProofFilesystem(root) {
  if (!fs.existsSync(root)) return;
  const restore = directory => {
    fs.chmodSync(directory, 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name), stat = fs.lstatSync(target);
      if (stat.isDirectory() && !stat.isSymbolicLink()) restore(target);
      else if (stat.isFile()) fs.chmodSync(target, 0o600);
    }
  };
  restore(root);
}
function parseSignerActors(env) {
  let actors;
  try { actors = JSON.parse(env.VECTOR_PROOF_ACTORS_JSON); } catch { throw new Error('SIGNER_ACTOR_SCOPE_INVALID'); }
  requireThat(Array.isArray(actors) && actors.length === 5, 'SIGNER_ACTOR_SCOPE_INVALID');
  const emails = new Set();
  for (const actor of actors) {
    requireThat(actor && typeof actor === 'object' && !Array.isArray(actor) &&
      typeof actor.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email), 'SIGNER_ACTOR_SCOPE_INVALID');
    const email = actor.email.toLowerCase();
    requireThat(!emails.has(email), 'SIGNER_ACTOR_SCOPE_INVALID');
    emails.add(email);
  }
  return emails;
}
function decodePrivateKey(value) {
  try {
    requireThat(typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 8192, 'SIGNER_PRIVATE_KEY_INVALID');
    const decoded = Buffer.from(value, 'base64');
    requireThat(decoded.toString('base64') === value, 'SIGNER_PRIVATE_KEY_INVALID');
    const key = crypto.createPrivateKey(decoded.toString('utf8'));
    requireThat(key.asymmetricKeyType === 'ed25519', 'SIGNER_PRIVATE_KEY_INVALID');
    return key;
  } catch (error) {
    if (error?.message === 'SIGNER_PRIVATE_KEY_INVALID') throw error;
    throw new Error('SIGNER_PRIVATE_KEY_INVALID');
  }
}
async function createSignerBroker(env, root, {
  now = Date.now,
  lifetimeMs = SIGNER_BROKER_LIFETIME_MS,
  sign = crypto.sign,
  onRequestAdmitted = () => {}
} = {}) {
  requireThat(Number.isSafeInteger(lifetimeMs) && lifetimeMs >= 1_000 && lifetimeMs <= PROOF_CHILD_TIMEOUT_MS, 'SIGNER_LIFETIME_INVALID');
  requireThat(typeof now === 'function' && typeof sign === 'function' && typeof onRequestAdmitted === 'function', 'SIGNER_BROKER_OPTIONS_INVALID');
  const privateKey = decodePrivateKey(env.PROOF_PRIVATE_KEY_B64);
  const allowed = parseSignerActors(env);
  const origin = new URL(env.VECTOR_PROOF_URL).origin;
  const auth = require(path.join(root, 'security/runtime/proof-runner-auth.cjs'));
  requireThat(typeof auth.canonicalAssertion === 'function' && typeof auth.PROOF_RUNNER_PATH === 'string', 'SIGNER_AUTH_MODULE_INVALID');
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now() + lifetimeMs;
  const counts = new Map(); let total = 0;
  let revoked = false, closePromise, expiryTimer;
  const sockets = new Set();
  const active = () => !revoked && now() < expiresAt;
  const server = http.createServer((req, res) => {
    const reject = code => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify({ error: code }));
    };
    if (!active()) return reject('SIGNER_CAPABILITY_EXPIRED');
    if (req.method !== 'POST' || req.url !== '/assertion' || req.headers['x-vector-signer-token'] !== token) return reject('SIGNER_REQUEST_REJECTED');
    try { onRequestAdmitted(); } catch { return reject('SIGNER_REQUEST_REJECTED'); }
    let body = '', bytes = 0, stopped = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk); if (bytes > 1024) { stopped = true; req.destroy(); }
      else body += chunk;
    });
    req.on('end', () => {
      if (stopped) return;
      if (!active()) return reject('SIGNER_CAPABILITY_EXPIRED');
      let input;
      try { input = JSON.parse(body); } catch { return reject('SIGNER_REQUEST_REJECTED'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.email !== 'string') return reject('SIGNER_REQUEST_REJECTED');
      const email = input.email.trim().toLowerCase(), count = counts.get(email) || 0;
      if (!allowed.has(email) || count >= 4 || total >= 20) return reject('SIGNER_SCOPE_REJECTED');
      if (!active()) return reject('SIGNER_CAPABILITY_EXPIRED');
      const issuedAt = now();
      const assertion = { email, origin, nonce: crypto.randomBytes(24).toString('base64url'), issuedAt, expiresAt: issuedAt + 45_000 };
      if (!active()) return reject('SIGNER_CAPABILITY_EXPIRED');
      assertion.signature = sign(null, Buffer.from(auth.canonicalAssertion(assertion), 'utf8'), privateKey).toString('base64url');
      if (!active()) return reject('SIGNER_CAPABILITY_EXPIRED');
      counts.set(email, count + 1); total++;
      res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(assertion));
    });
    req.on('error', () => {});
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address()?.port;
  requireThat(Number.isInteger(port) && port > 0 && port <= 65535, 'SIGNER_BROKER_BIND_FAILED');
  const close = () => {
    if (closePromise) return closePromise;
    revoked = true;
    clearTimeout(expiryTimer);
    for (const socket of sockets) socket.destroy();
    closePromise = new Promise(resolve => {
      if (!server.listening) return resolve();
      server.close(resolve);
    });
    return closePromise;
  };
  expiryTimer = setTimeout(() => { void close(); }, lifetimeMs);
  expiryTimer.unref?.();
  return Object.freeze({ port, token, expiresAt, close });
}
function signalProofProcessGroup(child, signal, kill = process.kill) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return false;
  try { kill(-child.pid, signal); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
}
function proofProcessGroupExists(child, kill = process.kill) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return false;
  try { kill(-child.pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; if (error?.code === 'EPERM') return true; throw error; }
}
async function stopProofProcessGroup(child, {
  kill = process.kill,
  now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  graceMs = PROOF_CHILD_CLEANUP_GRACE_MS,
  initialSignal = 'SIGTERM'
} = {}) {
  requireThat(Number.isSafeInteger(graceMs) && graceMs >= 1 && graceMs <= 30_000, 'PROOF_CHILD_CLEANUP_GRACE_INVALID');
  requireThat(['SIGTERM', 'SIGINT', 'SIGKILL'].includes(initialSignal), 'PROOF_CHILD_CLEANUP_SIGNAL_INVALID');
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return;
  if (!signalProofProcessGroup(child, initialSignal, kill)) return;
  if (initialSignal !== 'SIGKILL') {
    const termDeadline = now() + graceMs;
    while (now() < termDeadline && proofProcessGroupExists(child, kill)) await wait(25);
    if (!proofProcessGroupExists(child, kill)) return;
    signalProofProcessGroup(child, 'SIGKILL', kill);
  }
  const killDeadline = now() + graceMs;
  while (now() < killDeadline && proofProcessGroupExists(child, kill)) await wait(25);
  requireThat(!proofProcessGroupExists(child, kill), 'PROOF_CHILD_CLEANUP_FAILED');
}
function proofChildEnvironment(env, signer, work) {
  // Signed navigation needs only its explicit proof scope, browser and transport.
  // Provider/worker authority, obsolete eval inputs and Node preload hooks stay out.
  const clean = {};
  for (const key of [...TRANSPORT_ENVIRONMENT_KEYS, 'PORT', 'PLAYWRIGHT_BROWSERS_PATH',
    'VECTOR_PROOF_URL', 'WFM_EXPECTED_CANDIDATE_SHA', 'VECTOR_PROOF_AUTH_PROFILE',
    'VECTOR_PROOF_ACTORS_JSON', 'EXPECTED_DEPLOYMENT_ID',
    'EXPECTED_IMPLEMENTATION_TENANT', 'EXPECTED_IMPLEMENTATION_RUN_ID', 'EXPECTED_CONFIGURATION_DIGEST',
    'WFM_REQUIRE_VECTOR_ASSET_DIGESTS', 'WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE',
    'VECTOR_CANONICAL_JS_SHA256', 'VECTOR_CANONICAL_CSS_SHA256', 'VECTOR_WORKFLOW_JS_SHA256'])
    if (typeof env[key] === 'string') clean[key] = env[key];
  requireThat(signer && Number.isInteger(signer.port) && typeof signer.token === 'string', 'SIGNER_BROKER_REQUIRED');
  requireThat(typeof work === 'string' && path.isAbsolute(work), 'PROOF_CHILD_WORK_REQUIRED');
  clean.HOME = work; clean.TMPDIR = work; clean.TMP = work; clean.TEMP = work;
  clean.VECTOR_PROOF_SIGNER_PORT = String(signer.port);
  clean.VECTOR_PROOF_SIGNER_TOKEN = signer.token;
  clean.VECTOR_PROOF_SIGNER_EXPIRES_AT = String(signer.expiresAt);
  return Object.freeze(clean);
}
async function run(encoded, expectedHash, {
  fetchImpl = globalThis.fetch,
  timeoutMs = PREFLIGHT_TIMEOUT_MS,
  childTimeoutMs = PROOF_CHILD_TIMEOUT_MS,
  cleanupGraceMs = PROOF_CHILD_CLEANUP_GRACE_MS
} = {}) {
  // Freeze reviewed inputs across the asynchronous preflight and child lifetime.
  const env = Object.freeze({ ...process.env });
  validateEnvironment(env);
  validateRunnerSource();
  validateBundle(encoded, expectedHash);
  await preflightRuntimeIdentity(env, { fetchImpl, timeoutMs });
  require('node:sqlite');
  const root = materialize(encoded, expectedHash);
  let signer, work, child, cleanupVerified = true;
  try {
    const installation = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', root],
      { cwd: root, env: installerEnvironment(env, root), stdio: 'inherit', timeout: 120000, killSignal: 'SIGKILL' });
    requireThat(!installation.error && installation.status === 0, 'PLAYWRIGHT_INSTALL_FAILED');
    validateInstalledDependencies(root);
    const identity = proofChildIdentity();
    work = prepareProofFilesystem(root, identity);
    signer = await createSignerBroker(env, root);
    console.log('VECTOR_PROOF_RUNNER_SOURCE=' + SOURCE + '|targetSha=' + env.WFM_EXPECTED_CANDIDATE_SHA + '|bundleSha256=' + expectedHash);
    child = spawn(process.execPath, [path.join(root, 'scripts/current-candidate-role-browser-proof-server.mjs')],
      { cwd: work, env: proofChildEnvironment(env, signer, work), uid: identity.uid, gid: identity.gid, detached: true, stdio: 'inherit' });
    cleanupVerified = false;
    let gracefulShutdownPromise, killShutdownPromise, signerClosePromise;
    const requestShutdown = initialSignal => {
      signerClosePromise ||= signer.close(); // Revocation and socket destruction happen synchronously.
      if (initialSignal === 'SIGKILL') {
        killShutdownPromise ||= (async () => {
          await stopProofProcessGroup(child, { graceMs: cleanupGraceMs, initialSignal: 'SIGKILL' });
          await signerClosePromise;
        })();
        return killShutdownPromise;
      }
      if (killShutdownPromise) return killShutdownPromise;
      gracefulShutdownPromise ||= (async () => {
        await stopProofProcessGroup(child, { graceMs: cleanupGraceMs, initialSignal });
        await signerClosePromise;
      })();
      return gracefulShutdownPromise;
    };
    let rejectShutdownFailure;
    const shutdownFailure = new Promise((resolve, reject) => { rejectShutdownFailure = reject; });
    const notifyShutdown = initialSignal => {
      void requestShutdown(initialSignal).catch(rejectShutdownFailure);
    };
    const onTerm = () => notifyShutdown('SIGTERM');
    const onInt = () => notifyShutdown('SIGINT');
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onInt);
    let timedOut = false;
    const childTimer = setTimeout(() => {
      timedOut = true;
      process.exitCode = 124;
      notifyShutdown('SIGKILL');
    }, childTimeoutMs);
    childTimer.unref?.();
    try {
      const childExit = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          process.exitCode = timedOut ? 124 : Number.isInteger(code) ? code : (signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : 130);
          resolve();
        });
      });
      await Promise.race([childExit, shutdownFailure]);
    } finally {
      try {
        await (killShutdownPromise || gracefulShutdownPromise || requestShutdown('SIGTERM'));
        if (gracefulShutdownPromise) await gracefulShutdownPromise;
        if (killShutdownPromise) await killShutdownPromise;
        cleanupVerified = true;
      } finally {
        clearTimeout(childTimer);
        process.off('SIGTERM', onTerm);
        process.off('SIGINT', onInt);
      }
    }
  } finally {
    await signer?.close();
    if (!child || cleanupVerified) {
      restoreProofFilesystem(root);
      fs.rmSync(root, { recursive: true, force: true });
      if (work) fs.rmSync(work, { recursive: true, force: true });
    }
  }
}
module.exports = { SOURCE, FILES, hash, validateRunnerSource, validateBundle, materialize, validateEnvironment, preflightRuntimeIdentity, MAX_IDENTITY_BYTES, PREFLIGHT_TIMEOUT_MS, PROOF_CHILD_UID, PROOF_CHILD_GID, PROOF_CHILD_TIMEOUT_MS, SIGNER_BROKER_LIFETIME_MS, PROOF_CHILD_CLEANUP_GRACE_MS, installerEnvironment, validateInstalledDependencies, proofChildIdentity, prepareProofFilesystem, restoreProofFilesystem, decodePrivateKey, createSignerBroker, signalProofProcessGroup, stopProofProcessGroup, proofChildEnvironment, run };
