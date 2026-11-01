'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSchedulingIntelligenceService } = require(process.env.V095_SERVICE_MODULE || './scheduling-intelligence-service.cjs');
const ROUTE = '/api/operations/scheduling/order-start-variance/scenario';
const hash = value => createHash('sha256').update(value).digest('hex');
let native;
function nativeHelpers() {
  if (native) return native;
  const packaged = '/app/public';
  let directory = packaged, temporary = false;
  if (!fs.existsSync(path.join(packaged, 'engine.js'))) {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-native-')); temporary = true;
    execFileSync('tar', ['--no-same-owner', '-xzf', path.resolve(__dirname, '../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'), '-C', directory], { stdio: 'pipe' });
    directory = path.join(directory, 'public');
  }
  try { native = { allowedPeople: require(path.join(directory, 'engine.js')).allowedPeople, descendants: require(path.join(directory, 'engine.js')).descendants, approvedSite: require(path.join(directory, 'operations-engine.js')).approvedSite }; }
  finally { if (temporary) fs.rmSync(path.dirname(directory), { recursive: true, force: true }); }
  return native;
}
function state() {
  return { version: 1, org: [{ id: 'root', parent: null, role: 'Director' }, { id: 'left', parent: 'root', role: 'Team leader' }, { id: 'right', parent: 'root', role: 'Team leader' }], staff: [{ id: 'w1', manager: 'left', site: 'a' }, { id: 'w2', manager: 'right', site: 'b' }], operations: { siteAccess: {} } };
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-consumer-')), dbPath = path.join(directory, 'db.sqlite'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT,person_id TEXT,costs INTEGER,permissions TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);');
  for (const tenant of ['alpha', 'bravo']) db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant, 1, JSON.stringify(state()));
  for (const [email, tenant, role, person, costs] of [['left', 'alpha', 'manager', 'left', 0], ['root', 'alpha', 'director', 'root', 1], ['supervisor', 'alpha', 'supervisor', 'left', 0], ['employee', 'alpha', 'employee', 'left', 0], ['admin', 'alpha', 'admin', 'root', 1], ['hr', 'alpha', 'hr', 'root', 1], ['payroll', 'alpha', 'payroll_admin', 'root', 1], ['unknown', 'alpha', 'unknown', 'root', 1], ['bravo', 'bravo', 'manager', 'left', 0]]) {
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(email, tenant, role, person, costs, '[]');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(email), email, Date.now() + 120000);
  }
  const service = createSchedulingIntelligenceService({ dbPath, internalToken: 'synthetic-worker-token', nativeHelpers: nativeHelpers() });
  return { db, service, close() { service.close(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}
function input({ tenantId = 'alpha', siteId = 'a', department = 'left', delta = 30, age = 0 } = {}) {
  const minute = Math.floor(Date.now() / 60000) * 60000 - age * 60000;
  const at = offset => new Date(minute + offset * 60000).toISOString();
  const scope = { tenantId, siteId, lineId: 'declared-line', orderId: 'declared-order' };
  const plannedStart = -60;
  return { siteId, lineId: scope.lineId, orderId: scope.orderId, department,
    plan: { ...scope, source: 'ERP', recordId: 'p1', revision: 'r1', recordSha256: 'a'.repeat(64), observedAt: at(-100), complete: true, state: 'PUBLISHED', plannedStart: at(plannedStart), plannedEnd: at(60) },
    actual: { ...scope, source: 'MES', recordId: 'a1', revision: 'r1', recordSha256: 'b'.repeat(64), observedAt: at(0), complete: true, state: 'STARTED', plannedRevision: 'r1', plannedRecordSha256: 'a'.repeat(64), actualStart: at(plannedStart + delta) } };
}
async function call(f, body = input(), { who = 'left', suffix = '', mutate, raw } = {}) {
  const req = Readable.from((async function* () { if (mutate) mutate(f); yield raw === undefined ? JSON.stringify(body) : raw; })());
  req.method = 'POST'; req.url = ROUTE + suffix; req.headers = who ? { cookie: 'wfm_session=' + who } : {};
  const res = { statusCode: 200, headers: {}, headersSent: false, writableEnded: false, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); this.writableEnded = true; } };
  await f.service.handleRequest(req, res); return res;
}
function noPersistence(f) { for (const table of ['vector_schedule_plans', 'vector_schedule_repairs', 'vector_schedule_reconciliations']) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0); }
test('real service consumes declared order records with server policy and explicit advisory boundaries', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const [delta, status] of [[30, 'STARTED_LATE'], [-15, 'STARTED_EARLY'], [0, 'ON_TIME']]) {
    const body = input({ delta }), before = JSON.stringify(body), start = Date.now(), r = await call(f, body);
    assert.equal(r.statusCode, 200); assert.equal(r.body.result.startVarianceMinutes, delta); assert.equal(r.body.result.status, status);
    assert.equal(r.body.result.tenantId, 'alpha'); assert.equal(r.body.result.plannedRecordSha256, body.plan.recordSha256);
    for (const key of ['sourceAuthenticated', 'causeVerified', 'costVerified', 'scheduleAuthority', 'executionAuthority']) assert.equal(r.body.result[key], false, key);
    assert.equal(r.body.scenarioOnly, true); assert.equal(r.body.persisted, false); assert.equal(r.body.authority, 'NO_EXECUTION');
    assert.equal(r.body.sourceBasis, 'CALLER_DECLARED_ERP_MES_RECORDS'); assert.equal(r.body.freshnessPolicyMinutes, 120);
    assert.ok(Date.parse(r.body.asOf) >= start && Date.parse(r.body.asOf) <= Date.now());
    assert.equal(JSON.stringify(body), before); assert.equal(r.headers['Cache-Control'], 'no-store');
  }
  noPersistence(f);
});
test('manager, director and supervisor use current native department/site scope; other roles are refused', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const who of ['left', 'root', 'supervisor']) assert.equal((await call(f, input(), { who })).statusCode, 200);
  for (const who of ['employee', 'admin', 'hr', 'payroll', 'unknown']) assert.equal((await call(f, input(), { who })).statusCode, 403);
  for (const who of ['', 'absent']) assert.equal((await call(f, input(), { who })).statusCode, 401);
});
test('site existence elsewhere in the tenant cannot substitute for a current department/site binding', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const body of [input({ siteId: 'b' }), input({ department: 'right', siteId: 'b' }), input({ siteId: 'missing' }), input({ department: 'missing' })]) {
    const r = await call(f, body); assert.equal(r.statusCode, 403); assert.equal(r.body.result, undefined);
  }
  assert.equal((await call(f, input({ department: 'right', siteId: 'b' }), { who: 'root' })).statusCode, 200);
  assert.equal((await call(f, input({ department: 'right', siteId: 'a' }), { who: 'root' })).statusCode, 403);
});
test('strict request schema rejects caller time, age, tenant, authority, source and result overrides', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const extra of [{ asOf: new Date().toISOString() }, { maxAgeMinutes: 1440 }, { tenantId: 'bravo' }, { sourceAuthenticated: true }, { result: { executionAuthority: true } }, { scope: 'right' }]) assert.equal((await call(f, { ...input(), ...extra })).statusCode, 400);
  for (const body of [null, [], {}, { ...input(), extra: 'unrecognized' }]) assert.equal((await call(f, body)).statusCode, 400);
  for (const which of ['plan', 'actual']) { const body = input(); body[which].sourceAuthenticated = true; assert.equal((await call(f, body)).statusCode, 400); }
});
test('query scope cannot silently broaden or inject request authority', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const suffix of ['?scope=right', '?scope=left&scope=right', '?branch=left&scope=right']) assert.equal((await call(f, input(), { suffix })).statusCode, 403);
  for (const suffix of ['?tenant=bravo', '?asOf=2026-01-01']) assert.equal((await call(f, input(), { suffix })).statusCode, 400);
  assert.equal((await call(f, input(), { suffix: '?branch=left' })).statusCode, 200);
});
test('tenant and record scope mismatches are denied without rewriting supplied record scope', async t => {
  const f = fixture(); t.after(() => f.close());
  assert.equal((await call(f, input({ tenantId: 'bravo' }))).statusCode, 400);
  assert.equal((await call(f, input(), { who: 'bravo' })).statusCode, 400);
  for (const [which, key] of [['plan', 'siteId'], ['actual', 'lineId'], ['actual', 'orderId']]) { const b = input(); b[which][key] = 'foreign'; assert.equal((await call(f, b)).statusCode, 400); }
});
test('fixed wall clock freshness, source distinction and revision/chronology guards remain in force', async t => {
  const f = fixture(); t.after(() => f.close());
  const changes = [b => b.plan.observedAt = new Date(Date.now() - 121 * 60000).toISOString(), b => b.actual.observedAt = new Date(Date.now() + 60000).toISOString(), b => b.actual.recordSha256 = b.plan.recordSha256, b => b.actual.plannedRevision = 'old', b => b.actual.source = 'ERP', b => b.actual.complete = false, b => b.actual.actualStart = new Date(Date.parse(b.plan.observedAt) - 60000).toISOString()];
  for (const change of changes) { const b = input(); change(b); const r = await call(f, b); assert.equal(r.statusCode, 400); assert.equal(r.body.result, undefined); }
  assert.equal((await call(f, input({ age: 30 }))).statusCode, 400, 'The ERP observation is 130 minutes old even if the MES observation remains fresh');
  noPersistence(f);
});
test('post-body session, principal and hierarchy changes are fenced before any advisory', async t => {
  const changes = [f => f.db.exec("DELETE FROM sessions WHERE email='left'"), f => f.db.exec("UPDATE sessions SET expires=0 WHERE email='left'"), f => f.db.exec("DELETE FROM users WHERE email='left'"), f => f.db.exec("UPDATE users SET role='employee' WHERE email='left'"), f => f.db.exec("UPDATE users SET person_id='root' WHERE email='left'"), f => f.db.exec("UPDATE users SET costs=1 WHERE email='left'"), f => { const s = state(); s.staff[0].site = 'other'; f.db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(s), 'alpha'); }];
  for (const mutate of changes) { const f = fixture(); try { const r = await call(f, input(), { mutate }); assert.ok([401, 403].includes(r.statusCode)); assert.equal(r.body.result, undefined); noPersistence(f); } finally { f.close(); } }
});
test('malformed and oversized JSON fail before calculation', async t => {
  const f = fixture(); t.after(() => f.close());
  assert.equal((await call(f, null, { raw: '{' })).statusCode, 400);
  assert.equal((await call(f, null, { raw: JSON.stringify({ excess: 'x'.repeat(17000) }) })).statusCode, 413);
});
test('HTTP service route executes exact service bytes without fabricating a saved assessment', async t => {
  const f = fixture(); t.after(() => f.close());
  const server = http.createServer(async (req, res) => { if (!await f.service.handleRequest(req, res)) { res.statusCode = 404; res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch('http://127.0.0.1:' + server.address().port + ROUTE, { method: 'POST', headers: { cookie: 'wfm_session=left', 'content-type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(response.status, 200); assert.equal((await response.json()).result.startVarianceMinutes, 30); noPersistence(f);
});
test('actual security bootstrap mounts the declared scenario with packaged helper and native role/site checks', async t => {
  const root = process.env.V095_SOURCE_ROOT || path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-bootstrap-')), dbPath = path.join(directory, 'state.sqlite');
  const composer = path.join(root, 'scripts/compose-vector-local-runtime.mjs');
  const sourceMode = fs.existsSync(composer), runtime = sourceMode ? path.join(directory, 'runtime') : '/app';
  let child, db, diagnostics = '';
  t.after(async () => {
    db?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  if (sourceMode) execFileSync(process.execPath, [composer, runtime], { stdio: 'pipe' });
  else assert.ok(fs.existsSync(path.join(runtime, 'security-runtime/bootstrap.cjs')), 'Actual installed runtime is required; absent proof cannot be skipped');
  for (const file of ['scheduling-intelligence-service.cjs', 'scheduling-authority.cjs', 'order-start-variance.cjs']) {
    assert.deepEqual(fs.readFileSync(path.join(runtime, 'operations-runtime', file)), fs.readFileSync(sourceMode ? path.join(root, 'operations/runtime', file) : path.join(__dirname, file)), 'Packaged ' + file + ' must be exact');
  }
  const nonce = hash(directory), probe = path.join(directory, 'owned-endpoint.cjs');
  // Test-only OS-assigned endpoint observation; real bootstrap/auth/route bytes execute.
  fs.writeFileSync(probe, "const http=require('node:http'),listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){this.once('listening',()=>process.send({nonce:" + JSON.stringify(nonce) + ",pid:process.pid,address:this.address()}));return listen.call(this,{port:0,host:'127.0.0.1'},...args.filter(x=>typeof x==='function'));};");
  child = spawn(process.execPath, [...(sourceMode ? ['--require', path.join(runtime, 'local-paths.cjs')] : []), '--require', probe, path.join(runtime, 'security-runtime/bootstrap.cjs')], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, WFM_DB: dbPath, PORT: '0', WFM_HOSTED_STAGING: 'false', NODE_ENV: 'test', WFM_IDENTITY_SURVIVAL_GUARD: 'enforce', WFM_AGENTS_API_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-8000); });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('Actual bootstrap endpoint unavailable: ' + diagnostics)), 30000);
    const finish = (error, value) => { clearTimeout(timer); child.off('message', message); child.off('exit', exited); child.off('error', failed); error ? reject(error) : resolve(value); };
    const exited = (code, signal) => finish(Error('Actual bootstrap exited: ' + JSON.stringify({ code, signal }) + ' ' + diagnostics));
    const failed = error => finish(error);
    const message = value => {
      const address = value?.address;
      if (value?.nonce !== nonce || value.pid !== child.pid || address?.address !== '127.0.0.1' || address.family !== 'IPv4' || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535) return finish(Error('Unowned bootstrap listener'));
      finish(null, address);
    };
    child.on('message', message); child.once('exit', exited); child.once('error', failed);
  });
  const origin = 'http://127.0.0.1:' + endpoint.port;
  assert.equal((await fetch(origin + '/api/health')).status, 200, diagnostics);
  db = new DatabaseSync(dbPath); db.exec('PRAGMA busy_timeout=1500;');
  db.prepare('INSERT INTO tenants(id,version,state) VALUES(?,?,?)').run('alpha', 1, JSON.stringify(state()));
  for (const [token, role, person] of [['manager', 'manager', 'left'], ['director', 'director', 'root'], ['supervisor', 'supervisor', 'left'], ['employee', 'employee', 'left'], ['hr', 'hr', 'root'], ['payroll', 'payroll_admin', 'root']]) {
    const email = token + '@order.fixture';
    db.prepare('INSERT INTO users(email,tenant,person_id,role,costs,salt,password_hash,permissions) VALUES(?,?,?,?,?,?,?,?)').run(email, 'alpha', person, role, 0, 'synthetic-disabled', '00', '[]');
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('order-' + token), email, Date.now() + 120000);
  }
  async function request(who, body = input(), headers = {}) {
    const response = await fetch(origin + ROUTE, { method: 'POST', headers: { ...(who ? { cookie: 'wfm_session=order-' + who } : {}), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  for (const who of ['manager', 'director', 'supervisor']) { const response = await request(who); assert.equal(response.status, 200); assert.equal(response.body.result.startVarianceMinutes, 30); assert.equal(response.body.result.sourceAuthenticated, false); assert.equal(response.body.result.costVerified, false); assert.equal(response.body.persisted, false); }
  for (const who of ['employee', 'hr', 'payroll']) assert.equal((await request(who)).status, 403);
  assert.equal((await request('')).status, 401);
  assert.equal((await request('manager', input(), { 'x-wfm-role': 'director' })).status, 400, 'Existing security header-spoof guard executes before the consumer');
  assert.equal((await request('manager', input({ siteId: 'b' }))).status, 403);
  assert.equal((await request('director', input({ department: 'right', siteId: 'a' }))).status, 403);
  noPersistence({ db }); assert.equal(child.exitCode, null);
});
