'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const launcher = require('./launcher.cjs');

function dependencyRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-pw-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, 'package-lock.json'), path.join(root, 'package-lock.json'));
  for (const [name, value] of Object.entries({
    playwright: { name: 'playwright', version: '1.63.0', dependencies: { 'playwright-core': '1.63.0' } },
    'playwright-core': { name: 'playwright-core', version: '1.63.0' }
  })) { const dir = path.join(root, 'node_modules', name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(value)); }
  return root;
}

test('exact committed two-package closure is accepted', t => {
  const root = dependencyRoot(t);
  assert.equal(launcher.validateInstalledDependencies(root), undefined);
});
test('altered integrity lock is rejected before third-party import', t => {
  const root = dependencyRoot(t);
  fs.appendFileSync(path.join(root, 'package-lock.json'), ' ');
  assert.throws(() => launcher.validateInstalledDependencies(root), /PLAYWRIGHT_LOCK_MISMATCH/);
});
test('extra, missing, forged-version and symlink package closures are rejected', t => {
  for (const mutate of [
    root => fs.mkdirSync(path.join(root, 'node_modules', 'malicious-extra')),
    root => fs.rmSync(path.join(root, 'node_modules', 'playwright-core'), { recursive: true }),
    root => fs.writeFileSync(path.join(root, 'node_modules', 'playwright', 'package.json'), JSON.stringify({ name: 'playwright', version: '1.63.1', dependencies: { 'playwright-core': '1.63.0' } })),
    root => { fs.rmSync(path.join(root, 'node_modules', 'playwright-core'), { recursive: true }); fs.symlinkSync(path.join(root, 'node_modules', 'playwright'), path.join(root, 'node_modules', 'playwright-core')); }
  ]) { const root = dependencyRoot(t); mutate(root); assert.throws(() => launcher.validateInstalledDependencies(root), /PLAYWRIGHT_/); }
});
test('signer accepts only canonical Ed25519 private keys', () => {
  const ed = crypto.generateKeyPairSync('ed25519').privateKey;
  const encoded = Buffer.from(ed.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  assert.equal(launcher.decodePrivateKey(encoded).asymmetricKeyType, 'ed25519');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const value of ['', 'not-base64', Buffer.from(rsa.export({ type: 'pkcs8', format: 'pem' })).toString('base64')])
    assert.throws(() => launcher.decodePrivateKey(value), /SIGNER_PRIVATE_KEY_INVALID/);
});

function request(port, token, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/assertion', method: 'POST', headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-vector-signer-token': token
    } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) })); });
    req.on('error', reject); req.end(data);
  });
}
function admittedRequest(port, token, email) {
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request({ hostname: '127.0.0.1', port, path: '/assertion', method: 'POST', headers: {
      'content-type': 'application/json', 'x-vector-signer-token': token
    } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) })); });
    req.on('error', reject);
  });
  req.write('{"email":"');
  return { finish: () => req.end(email + '"}'), response };
}
test('different-UID bounded broker signs only fixed-origin allowlisted actors and browser child never receives the key', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-signer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const authDir = path.join(root, 'security/runtime'); fs.mkdirSync(authDir, { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../../../security/runtime/proof-runner-auth.cjs'), path.join(authDir, 'proof-runner-auth.cjs'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const actors = ['manager','employee','payroll','company-admin','isolation-manager'].map((slug, index) => ({ slug, role: index === 2 ? 'payroll_admin' : 'manager', tenant: index === 4 ? 'other' : 'fixture', email: slug + '@fixture.invalid' }));
  const env = { VECTOR_PROOF_URL: 'https://proof.fixture.invalid/', VECTOR_PROOF_ACTORS_JSON: JSON.stringify(actors),
    PROOF_PRIVATE_KEY_B64: Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  let clock = Date.now();
  const broker = await launcher.createSignerBroker(env, root, { now: () => clock, lifetimeMs: 60_000 }); t.after(() => broker.close());
  assert.ok(Number.isInteger(broker.port));
  assert.equal((await request(broker.port, 'wrong', { email: actors[0].email })).status, 403);
  assert.equal((await request(broker.port, broker.token, { email: 'unknown@fixture.invalid' })).status, 403);
  assert.equal((await request(broker.port, broker.token, { email: actors[0].email, origin: 'https://evil.invalid' })).status, 403);
  const accepted = await request(broker.port, broker.token, { email: actors[0].email });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.origin, 'https://proof.fixture.invalid');
  const auth = require(path.join(authDir, 'proof-runner-auth.cjs'));
  assert.equal(crypto.verify(null, Buffer.from(auth.canonicalAssertion(accepted.body)), keys.publicKey, Buffer.from(accepted.body.signature, 'base64url')), true);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-child-work-')); t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const child = launcher.proofChildEnvironment({ PATH: '/bin', VECTOR_PROOF_URL: env.VECTOR_PROOF_URL, VECTOR_PROOF_ACTORS_JSON: env.VECTOR_PROOF_ACTORS_JSON,
    PROOF_PRIVATE_KEY_B64: env.PROOF_PRIVATE_KEY_B64 }, broker, work);
  assert.equal(child.PROOF_PRIVATE_KEY_B64, undefined); assert.equal(child.VECTOR_PROOF_SIGNER_PORT, String(broker.port));
  assert.equal(child.VECTOR_PROOF_SIGNER_EXPIRES_AT, String(broker.expiresAt));
  assert.equal(JSON.stringify(child).includes(env.PROOF_PRIVATE_KEY_B64), false);
  clock = broker.expiresAt;
  assert.equal((await request(broker.port, broker.token, { email: actors[0].email })).body.error, 'SIGNER_CAPABILITY_EXPIRED');
  await broker.close();
});

test('broker expiry and close revoke requests already admitted before the deadline', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-signer-revoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const authDir = path.join(root, 'security/runtime'); fs.mkdirSync(authDir, { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../../../security/runtime/proof-runner-auth.cjs'), path.join(authDir, 'proof-runner-auth.cjs'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const actors = ['manager','employee','payroll','company-admin','isolation-manager'].map(slug => ({ email: slug + '@fixture.invalid' }));
  const env = { VECTOR_PROOF_URL: 'https://proof.fixture.invalid/', VECTOR_PROOF_ACTORS_JSON: JSON.stringify(actors),
    PROOF_PRIVATE_KEY_B64: Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  let clock = Date.now(), admittedResolve;
  const admitted = new Promise(resolve => { admittedResolve = resolve; });
  let signCalls = 0;
  const broker = await launcher.createSignerBroker(env, root, {
    now: () => clock, lifetimeMs: 60_000, onRequestAdmitted: admittedResolve,
    sign: (...args) => { signCalls++; return crypto.sign(...args); }
  });
  t.after(() => broker.close());
  const late = admittedRequest(broker.port, broker.token, actors[0].email);
  await admitted;
  clock = broker.expiresAt;
  late.finish();
  assert.deepEqual(await late.response, { status: 403, body: { error: 'SIGNER_CAPABILITY_EXPIRED' } });
  assert.equal(signCalls, 0);

  let admittedCloseResolve;
  const admittedClose = new Promise(resolve => { admittedCloseResolve = resolve; });
  const closeBroker = await launcher.createSignerBroker(env, root, {
    now: () => Date.now(), lifetimeMs: 60_000, onRequestAdmitted: admittedCloseResolve,
    sign: (...args) => { signCalls++; return crypto.sign(...args); }
  });
  const revoked = admittedRequest(closeBroker.port, closeBroker.token, actors[1].email);
  await admittedClose;
  const firstClose = closeBroker.close(), secondClose = closeBroker.close();
  assert.strictEqual(secondClose, firstClose, 'all close callers must await the same completion');
  await Promise.all([firstClose, secondClose]);
  revoked.finish();
  await assert.rejects(revoked.response);
  assert.equal(signCalls, 0);
});

test('proof process-group cleanup terminates and waits for descendants', async () => {
  const child = { pid: 32123 };
  const calls = [];
  let alive = true, clock = 0;
  const kill = (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGKILL') alive = false;
    if (signal === 0 && !alive) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
  };
  await launcher.stopProofProcessGroup(child, {
    kill, now: () => clock, wait: async milliseconds => { clock += milliseconds; }, graceMs: 100
  });
  assert.ok(calls.some(([pid, signal]) => pid === -child.pid && signal === 'SIGTERM'));
  assert.ok(calls.some(([pid, signal]) => pid === -child.pid && signal === 'SIGKILL'));
  assert.equal(launcher.signalProofProcessGroup({}, 'SIGTERM', kill), false);
});

test('proof child requires a Linux root parent and a distinct nobody identity', () => {
  assert.deepEqual(launcher.proofChildIdentity({ platform: 'linux', getuid: () => 0, getgid: () => 0 }),
    { uid: launcher.PROOF_CHILD_UID, gid: launcher.PROOF_CHILD_GID });
  for (const proc of [
    { platform: 'darwin', getuid: () => 0, getgid: () => 0 },
    { platform: 'linux', getuid: () => 1000, getgid: () => 1000 },
    { platform: 'linux', getuid: () => 0, getgid: () => launcher.PROOF_CHILD_GID }
  ]) assert.throws(() => launcher.proofChildIdentity(proc), /PROOF_CHILD_ISOLATION_UNAVAILABLE/);
});

test('materialized dependency tree is read-only and child work is owned by the isolated identity', t => {
  const root = dependencyRoot(t);
  const identity = { uid: process.getuid(), gid: process.getgid() };
  const work = launcher.prepareProofFilesystem(root, identity);
  try {
    assert.equal(fs.statSync(root).mode & 0o777, 0o555);
    assert.equal(fs.statSync(path.join(root, 'node_modules/playwright/package.json')).mode & 0o777, 0o444);
    const stat = fs.statSync(work);
    assert.equal(stat.mode & 0o777, 0o700); assert.equal(stat.uid, identity.uid); assert.equal(stat.gid, identity.gid);
  } finally {
    launcher.restoreProofFilesystem(root); fs.rmSync(work, { recursive: true, force: true });
  }
});

test('different-UID proof child cannot read the root parent process environment on Linux', t => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return t.skip('requires Linux root parent');
  const probe = "const fs=require('node:fs');try{fs.readFileSync('/proc/'+process.ppid+'/environ');process.stdout.write('READABLE');process.exitCode=2}catch(e){process.stdout.write(e.code||'ERROR')}";
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', probe], {
    uid: launcher.PROOF_CHILD_UID, gid: launcher.PROOF_CHILD_GID, encoding: 'utf8'
  });
  if (result.error && ['EINVAL','EPERM'].includes(result.error.code)) return t.skip('executor cannot spawn the deployment UID: ' + result.error.code);
  assert.equal(result.status, 0); assert.match(result.stdout, /^(?:EACCES|EPERM)$/);
});
