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
const hash = value => createHash('sha256').update(value).digest('hex');
function state() {
  return { version: 1, org: [{ id: 'root', parent: null, role: 'Director' }, { id: 'left', parent: 'root', role: 'Team leader' }, { id: 'right', parent: 'root', role: 'Team leader' }], staff: [{ id: 'w1', manager: 'left', site: 'a' }, { id: 'w2', manager: 'right', site: 'b' }], operations: { siteAccess: {} } };
}
function clock(offset) { return new Date(Math.floor(Date.now() / 1000) * 1000 + offset * 60000).toISOString().replace('.000Z', 'Z'); }
function outputInput({ tenantId = 'alpha', siteId = 'a', department = 'left' } = {}) {
  const scope = { tenantId, siteId, lineId: 'declared-line', productId: 'declared-product', orderId: 'declared-order' };
  const window = { start: clock(-120), end: clock(-60) };
  return { siteId, lineId: scope.lineId, productId: scope.productId, orderId: scope.orderId, department, window,
    plan: { ...scope, window: { ...window }, sourceName: 'ERP_PLAN', revision: 'p1', digest: 'sha256:plan', observedAt: clock(-30), complete: true, evidenceRef: 'plan:1', targetUnits: 120 },
    production: { ...scope, window: { ...window }, sourceName: 'MES_OUTPUT', revision: 'a1', digest: 'sha256:actual', observedAt: clock(-20), complete: true, evidenceRef: 'actual:1', acceptedUnits: 90 } };
}
function materialInput({ tenantId = 'alpha', siteId = 'a', department = 'left' } = {}) {
  const scope = { tenantId, siteId, orderId: 'declared-order' };
  return { siteId, orderId: scope.orderId, department,
    bom: { ...scope, source: 'ERP_BOM', revision: 'b1', digest: 'sha256:bom', complete: true,
      observedAt: clock(-30), effectiveStart: clock(-60), effectiveEnd: clock(60),
      components: [{ ...scope, componentId: 'part-a', unit: 'KG', requiredMilliunits: 3000, evidenceRef: 'bom:part-a', evidenceDigest: 'sha256:bom-part-a' }] },
    inventory: { ...scope, source: 'STOCK', revision: 'i1', digest: 'sha256:stock', complete: true, bomRevision: 'b1', bomDigest: 'sha256:bom', observedAt: clock(-5),
      balances: [{ ...scope, componentId: 'part-a', unit: 'KG', allocatableMilliunits: 1000, evidenceRef: 'stock:part-a', evidenceDigest: 'sha256:stock-part-a' }] } };
}
const cases = [
  { name: 'output', route: '/api/operations/scheduling/production-output-gap/scenario', input: outputInput, contract: 'DECLARED_PRODUCTION_OUTPUT_GAP_SCENARIO_V1', source: 'CALLER_DECLARED_ERP_MES_RECORDS', groups: ['plan', 'production'], result: r => { assert.equal(r.gapUnits, 30); assert.equal(r.overPlanUnits, 0); assert.equal(r.status, 'PLANNED_OUTPUT_GAP'); } },
  { name: 'material', route: '/api/operations/scheduling/order-material-availability/scenario', input: materialInput, contract: 'DECLARED_ORDER_MATERIAL_AVAILABILITY_SCENARIO_V1', source: 'CALLER_DECLARED_BOM_STOCK_RECORDS', groups: ['bom', 'inventory'], result: r => { assert.equal(r.shortfallCount, 1); assert.equal(r.shortfalls[0].missingMilliunits, 2000); assert.equal(r.status, 'DECLARED_MATERIAL_SHORTFALL'); } }
];
function noPersistence(f) { for (const table of ['vector_schedule_plans', 'vector_schedule_repairs', 'vector_schedule_reconciliations']) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0); }
test('actual security bootstrap mounts declared output and material scenarios with exact packaged helpers and native role/site checks', async t => {
  const root = process.env.V095_FACTORY_SOURCE_ROOT || path.resolve(__dirname, '../..');
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
  for (const file of ['scheduling-intelligence-service.cjs', 'scheduling-authority.cjs', 'order-start-variance.cjs', 'production-output-gap.cjs', 'order-material-availability.cjs']) {
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
  async function request(item, who, body = item.input(), headers = {}) {
    const response = await fetch(origin + item.route, { method: 'POST', headers: { ...(who ? { cookie: 'wfm_session=order-' + who } : {}), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  for (const item of cases) {
    for (const who of ['manager', 'director', 'supervisor']) { const response = await request(item, who); assert.equal(response.status, 200); item.result(response.body.result); assert.equal(response.body.result.sourceAuthenticated, false); assert.equal(response.body.sourceAuthenticated, false); assert.equal(response.body.costVerified, false); assert.equal(response.body.persisted, false); }
    for (const who of ['employee', 'hr', 'payroll']) assert.equal((await request(item, who)).status, 403);
    assert.equal((await request(item, '')).status, 401);
    assert.equal((await request(item, 'manager', item.input(), { 'x-wfm-role': 'director' })).status, 400, 'Security header-spoof guard executes before either consumer');
    assert.equal((await request(item, 'manager', item.input({ siteId: 'b' }))).status, 403);
    assert.equal((await request(item, 'director', item.input({ department: 'right', siteId: 'a' }))).status, 403);
  }
  noPersistence({ db }); assert.equal(child.exitCode, null);
});
