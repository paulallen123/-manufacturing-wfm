'use strict';
// This real-bootstrap proof requires the installed passkey dependency closure.
// Docker prepares it before selecting this file; ordinary source Forge selects
// the separate stateless service suite and does not skip this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROUTE = '/api/operations/scheduling/order-start-variance/scenario';
const hash = value => createHash('sha256').update(value).digest('hex');
function state() {
  return { version: 1, org: [{ id: 'root', parent: null, role: 'Director' }, { id: 'left', parent: 'root', role: 'Team leader' }, { id: 'right', parent: 'root', role: 'Team leader' }], staff: [{ id: 'w1', manager: 'left', site: 'a' }, { id: 'w2', manager: 'right', site: 'b' }], operations: { siteAccess: {} } };
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
function noPersistence(f) { for (const table of ['vector_schedule_plans', 'vector_schedule_repairs', 'vector_schedule_reconciliations']) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0); }
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
