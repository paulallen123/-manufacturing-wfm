'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash, randomBytes, scryptSync } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { Worker } = require('node:worker_threads');
const { createOwnerAccessRecovery, API_PATH, PAGE_PATH, ACCOUNT } = require('./owner-access-recovery.cjs');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const password = 'A private new password for this synthetic test only!';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'owner-recovery-'));
  const dbPath = join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,person_id TEXT,role TEXT,costs INTEGER,permissions TEXT,salt TEXT,password_hash TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY,tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT);`);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(ACCOUNT.email, ACCOUNT.tenant, ACCOUNT.personId, ACCOUNT.role, 1, '["company.configure"]', 'old-salt', 'old-hash');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('other@isolation.example', 'isolation-test', 'm1', 'manager', 1, '[]', 'other-salt', 'other-hash');
  const guard = createIdentitySurvivalGuard({ dbPath });
  const controls = guard.securityControlForTests();
  controls.setFreeze(ACCOUNT.tenant, false);
  const now = Date.now();
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session', ACCOUNT.email, now + 3600000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('other-session', 'other@isolation.example', now + 3600000);
  db.prepare('INSERT INTO identity_session_bindings VALUES(?,?,?,?,?,?,?)').run('old-session', ACCOUNT.tenant, 'wfm-local-auth', 'wfm-api', 1, 1, new Date(now).toISOString());
  const token = randomBytes(32).toString('base64url');
  const grant = { id: randomBytes(16).toString('hex'), tokenHash: hash(token), issuedAt: now - 1000, expiresAt: now + 600000, sessionEpoch: 1, policyVersion: 1 };
  const env = { NODE_ENV: 'staging', WFM_HOSTED_STAGING: 'true', WFM_DB: dbPath, WFM_PUBLIC_ORIGIN: 'https://vector.example', WFM_OWNER_RECOVERY_JSON: JSON.stringify(grant) };
  const handler = createOwnerAccessRecovery({ env });
  t.after(() => { controls.db.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, env, handler, token, grant, controls };
}
async function request(handler, { url = API_PATH, method = 'POST', headers = {}, body, ...rest } = {}) {
  const req = Readable.from([body === undefined ? '{}' : typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(req, { url, method, headers: { host: 'vector.example', origin: 'https://vector.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...headers }, ...rest });
  const res = { statusCode: 0, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(value) { this.body = value; } };
  const handled = await handler.handleRequest(req, res);
  return { ...res, handled };
}
const valid = f => ({ body: { token: f.token, password } });
const count = (db, table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

test('atomic reset preserves authority, revokes only target sessions, audits, and survives restart replay', async t => {
  const f = fixture(t);
  const original = f.db.prepare('SELECT * FROM users WHERE email=?').get(ACCOUNT.email);
  const response = await request(f.handler, valid(f));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['set-cookie'].length, 2);
  assert.ok(response.headers['set-cookie'].every(value => value.includes('Max-Age=0')));
  const account = f.db.prepare('SELECT * FROM users WHERE email=?').get(ACCOUNT.email);
  assert.equal(account.password_hash, scryptSync(password, account.salt, 64).toString('hex'));
  assert.deepEqual({ ...account, salt: original.salt, password_hash: original.password_hash }, { ...original });
  assert.equal(count(f.db, 'sessions'), 1);
  assert.equal(count(f.db, 'identity_session_bindings'), 0);
  assert.equal(count(f.db, 'owner_recovery_ledger'), 1);
  assert.equal(count(f.db, 'audit_events'), 1);
  const audit = JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all());
  assert.ok(!audit.includes(f.token) && !audit.includes(password));
  assert.equal((await request(createOwnerAccessRecovery({ env: f.env }), valid(f))).statusCode, 403);
  assert.equal(count(f.db, 'audit_events'), 1);
  const other = f.db.prepare('SELECT password_hash FROM users WHERE email=?').get('other@isolation.example');
  assert.equal(other.password_hash, 'other-hash');
  assert.throws(() => f.db.exec('DELETE FROM owner_recovery_ledger'));
});

test('absent/malformed/non-staging/expired configuration never enables recovery', async t => {
  const f = fixture(t);
  for (const env of [
    { ...f.env, WFM_OWNER_RECOVERY_JSON: '' },
    { ...f.env, WFM_OWNER_RECOVERY_JSON: '{}' },
    { ...f.env, WFM_OWNER_RECOVERY_JSON: '{' },
    { ...f.env, NODE_ENV: 'production' },
    { ...f.env, WFM_HOSTED_STAGING: 'false' },
    { ...f.env, WFM_IDENTITY_SURVIVAL_GUARD: 'off' },
    { ...f.env, WFM_PUBLIC_ORIGIN: 'https://vector.example/path' },
    ...[
      { tokenHash: f.token }, { tokenHash: '206b067c57a91d14c0dedee7a717e907ada9b04b5d964a4b3aa2d94da7aa58b8' }, { expiresAt: f.grant.issuedAt - 1 },
      { issuedAt: Date.now() + 10000 }, { expiresAt: f.grant.issuedAt + 1800001 },
      { issuedAt: Date.now() - 20000, expiresAt: Date.now() - 10000 },
      { sessionEpoch: 0 }, { extra: true }
    ].map(patch => ({ ...f.env, WFM_OWNER_RECOVERY_JSON: JSON.stringify({ ...f.grant, ...patch }) }))
  ]) {
    assert.notEqual((await request(createOwnerAccessRecovery({ env }), valid(f))).statusCode, 200);
  }
  assert.equal(count(f.db, 'sessions'), 2);
  assert.equal(count(f.db, 'audit_events'), 0);
});

test('rejects wrong host, origin, transport, method, injected identity, content type, body and token', async t => {
  const f = fixture(t);
  for (const patch of [
    { headers: { host: 'attacker.example' } }, { headers: { origin: 'https://attacker.example' } },
    { headers: { origin: undefined } }, { headers: { 'x-forwarded-proto': 'http' } },
    { headers: { 'x-forwarded-proto': 'https,http' } }, { headers: { 'x-wfm-role': 'director' } },
    { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { 'content-type': 'text/plain' } },
    { headers: { 'content-encoding': 'gzip' } }, { method: 'GET' },
    { url: API_PATH + '?token=' + f.token },
    { body: '{' }, { body: ' '.repeat(4097) },
    { body: { token: randomBytes(32).toString('base64url'), password } },
    { body: { token: f.token, password: 'short' } },
    { body: { token: f.token, password: 'x'.repeat(257) } },
    { body: { token: f.token, password, tenant: 'isolation-test' } }
  ]) assert.notEqual((await request(f.handler, { ...valid(f), ...patch })).statusCode, 200);
  assert.equal(count(f.db, 'audit_events'), 0);
  assert.equal(count(f.db, 'sessions'), 2);
});

test('frozen, rotated, deleted, or tenant/role/person reassigned account fails closed', async t => {
  for (const statement of [
    "UPDATE identity_tenant_control SET privileged_freeze=1", "UPDATE identity_tenant_control SET session_epoch=2",
    "UPDATE identity_tenant_control SET policy_version=2", "DELETE FROM identity_tenant_control",
    "UPDATE users SET tenant='isolation-test'", "UPDATE users SET role='employee'", "UPDATE users SET person_id='different'",
    "DELETE FROM users WHERE email='superuser@northstar.example'"
  ]) {
    const f = fixture(t);
    f.db.exec(statement);
    assert.equal((await request(f.handler, valid(f))).statusCode, 403);
    assert.equal(count(f.db, 'owner_recovery_ledger'), 0);
    assert.equal(count(f.db, 'sessions'), 2);
    assert.equal(count(f.db, 'audit_events'), 0);
  }
});

test('audit failure rolls back consumption, password update and session revocation', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
  assert.equal((await request(f.handler, valid(f))).statusCode, 503);
  assert.equal(count(f.db, 'owner_recovery_ledger'), 0);
  assert.equal(count(f.db, 'sessions'), 2);
  assert.equal(count(f.db, 'identity_session_bindings'), 1);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(ACCOUNT.email).password_hash, 'old-hash');
});

test('durable revocation and token re-keying cannot resurrect a used grant', async t => {
  const f = fixture(t);
  assert.equal((await request(f.handler, valid(f))).statusCode, 200);
  f.env.WFM_OWNER_RECOVERY_JSON = JSON.stringify({ ...f.grant, id: randomBytes(16).toString('hex') });
  assert.equal((await request(f.handler, valid(f))).statusCode, 403);
  const newToken = randomBytes(32).toString('base64url');
  const next = { ...f.grant, id: randomBytes(16).toString('hex'), tokenHash: hash(newToken) };
  f.env.WFM_OWNER_RECOVERY_JSON = JSON.stringify(next);
  f.db.prepare('INSERT INTO owner_recovery_ledger VALUES(?,?,?,?)').run(next.tokenHash, next.id, 'revoked', new Date().toISOString());
  assert.equal((await request(f.handler, { body: { token: newToken, password } })).statusCode, 403);
  f.env.WFM_OWNER_RECOVERY_JSON = '';
  assert.equal((await request(f.handler, valid(f))).statusCode, 404);
});

test('expiry is rechecked after request body and within reset transaction', async t => {
  const f = fixture(t);
  let calls = 0;
  const handler = createOwnerAccessRecovery({ env: f.env, clock: () => ++calls >= 4 ? f.grant.expiresAt : f.grant.issuedAt + 1 });
  assert.equal((await request(handler, valid(f))).statusCode, 403);
  assert.equal(count(f.db, 'sessions'), 2);
});

test('recovery page exposes no secret and accepts no token in request URL', async t => {
  const f = fixture(t);
  const page = await request(f.handler, { url: PAGE_PATH, method: 'GET' });
  assert.equal(page.statusCode, 200);
  assert.ok(page.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.ok(!page.body.includes(f.token));
  assert.equal((await request(f.handler, { url: PAGE_PATH + '?token=bad', method: 'GET' })).statusCode, 403);
  assert.equal((await request(f.handler, { url: '/api/login' })).handled, false);
});

test('concurrent independent workers can consume a grant only once', async t => {
  const f = fixture(t);
  const gate = new SharedArrayBuffer(4);
  const workerCode = `const {workerData,parentPort}=require('node:worker_threads');const {Readable}=require('node:stream');const {createOwnerAccessRecovery}=require(workerData.module);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.gate),0,0);const req=Readable.from([JSON.stringify(workerData.body)]);Object.assign(req,{url:'/api/owner-access-recovery',method:'POST',headers:{host:'vector.example',origin:'https://vector.example','x-forwarded-proto':'https','content-type':'application/json'}});const res={setHeader(){},end(){parentPort.postMessage(this.statusCode)}};createOwnerAccessRecovery({env:workerData.env}).handleRequest(req,res);`;
  const workers = Array.from({ length: 4 }, () => new Worker(workerCode, { eval: true, workerData: { module: require.resolve('./owner-access-recovery.cjs'), env: f.env, body: valid(f).body, gate } }));
  const ready = workers.map(worker => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
  await Promise.all(ready);
  const results = workers.map(worker => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  assert.deepEqual((await Promise.all(results)).sort(), [200, 403, 403, 403]);
  await Promise.all(workers.map(worker => worker.terminate()));
  assert.equal(count(f.db, 'owner_recovery_ledger'), 1);
  assert.equal(count(f.db, 'audit_events'), 1);
});
