'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSchedulingIntelligenceService } = require(process.env.V095_FACTORY_SERVICE_MODULE || './scheduling-intelligence-service.cjs');
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
  const events = [];
  const service = createSchedulingIntelligenceService({ dbPath, internalToken: 'synthetic-worker-token', nativeHelpers: nativeHelpers(), publishEvent: event => events.push(event) });
  return { db, service, events, close() { service.close(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
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
async function call(f, item, body = item.input(), { who = 'left', suffix = '', mutate, raw, method = 'POST' } = {}) {
  const req = Readable.from((async function* () { if (mutate) mutate(f); yield raw === undefined ? JSON.stringify(body) : raw; })());
  req.method = method; req.url = item.route + suffix; req.headers = who ? { cookie: 'wfm_session=' + who } : {};
  const res = { statusCode: 200, headers: {}, headersSent: false, writableEnded: false, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); this.writableEnded = true; } };
  await f.service.handleRequest(req, res); return res;
}
function noPersistence(f) {
  for (const table of ['vector_schedule_plans', 'vector_schedule_repairs', 'vector_schedule_reconciliations']) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0);
  for (const tenant of ['alpha', 'bravo']) assert.equal(f.db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state, JSON.stringify(state()));
  assert.deepEqual(f.events, []);
}
for (const item of cases) {
  test(item.name + ' declared scenario calculates using exact records and server time without storage or source authority', async t => {
    const f = fixture(); t.after(() => f.close());
    const body = item.input(), before = JSON.stringify(body), start = Math.floor(Date.now() / 1000) * 1000, r = await call(f, item, body);
    assert.equal(r.statusCode, 200); item.result(r.body.result);
    assert.equal(r.body.contractVersion, item.contract); assert.equal(r.body.result.tenantId, 'alpha'); assert.equal(r.body.result.sourceAuthenticated, false);
    assert.equal(r.body.result.actionAuthority, false); assert.equal(r.body.result.claimedSavingsPence, null);
    for (const key of ['sourceAuthenticated', 'lineOrderAuthority', 'causeVerified', 'costVerified', 'scheduleAuthority', 'executionAuthority']) assert.equal(r.body[key], false, key);
    assert.equal(r.body.scenarioOnly, true); assert.equal(r.body.persisted, false); assert.equal(r.body.authority, 'NO_EXECUTION'); assert.equal(r.body.sourceBasis, item.source);
    assert.equal(r.body.asOf, r.body.result.asOf); assert.match(r.body.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(r.body.asOf) >= start && Date.parse(r.body.asOf) <= Date.now());
    assert.equal(JSON.stringify(body), before); assert.equal(r.headers['Cache-Control'], 'no-store'); noPersistence(f);
  });
  test(item.name + ' accepts native operational roles and refuses nonoperational, missing and expired sessions', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const who of ['left', 'root', 'supervisor']) assert.equal((await call(f, item, item.input(), { who })).statusCode, 200);
    for (const who of ['employee', 'admin', 'hr', 'payroll', 'unknown']) assert.equal((await call(f, item, item.input(), { who })).statusCode, 403);
    for (const who of ['', 'absent']) assert.equal((await call(f, item, item.input(), { who })).statusCode, 401);
    f.db.exec("UPDATE sessions SET expires=0 WHERE email='left'"); assert.equal((await call(f, item)).statusCode, 401); noPersistence(f);
  });
  test(item.name + ' requires current native department/site binding and exact tenant and order declarations', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const body of [item.input({ siteId: 'b' }), item.input({ department: 'right', siteId: 'b' }), item.input({ department: 'missing' })]) assert.equal((await call(f, item, body)).statusCode, 403);
    assert.equal((await call(f, item, item.input({ department: 'right', siteId: 'b' }), { who: 'root' })).statusCode, 200);
    assert.equal((await call(f, item, item.input({ department: 'right', siteId: 'a' }), { who: 'root' })).statusCode, 403);
    for (const body of [item.input({ tenantId: 'bravo' }), item.input()]) assert.equal((await call(f, item, body, { who: body.plan?.tenantId === 'bravo' || body.bom?.tenantId === 'bravo' ? 'left' : 'bravo' })).statusCode, 400);
    for (const group of item.groups) for (const key of ['tenantId', 'siteId', 'orderId']) { const b = item.input(); b[group][key] = 'foreign'; assert.equal((await call(f, item, b)).statusCode, 400); }
    noPersistence(f);
  });
  test(item.name + ' rejects exact-schema, request-clock, policy and authority overrides including nested records', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const extra of [{ asOf: clock(0) }, { maxAgeMinutes: 999 }, { tenantId: 'bravo' }, { sourceAuthenticated: true }, { result: {} }, { scope: 'right' }, { constructor: {} }]) assert.equal((await call(f, item, { ...item.input(), ...extra })).statusCode, 400);
    for (const body of [null, [], {}, { ...item.input(), department: null }]) assert.ok([400,403].includes((await call(f, item, body)).statusCode));
    for (const group of item.groups) { const b = item.input(); b[group].sourceAuthenticated = true; assert.equal((await call(f, item, b)).statusCode, 400); }
    if (item.name === 'output') { const b = item.input(); b.window.asOf = clock(0); assert.equal((await call(f, item, b)).statusCode, 400); }
    else for (const [group, collection] of [['bom', 'components'], ['inventory', 'balances']]) { const b = item.input(); b[group][collection][0].actionAuthority = true; assert.equal((await call(f, item, b)).statusCode, 400); }
    noPersistence(f);
  });
  test(item.name + ' query parameters cannot broaden scope or supply policy and method is restricted', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const suffix of ['?scope=right', '?scope=left&scope=right', '?branch=left&scope=right']) assert.equal((await call(f, item, item.input(), { suffix })).statusCode, 403);
    for (const suffix of ['?asOf=2026-01-01', '?tenant=bravo', '?maxAgeMinutes=999']) assert.equal((await call(f, item, item.input(), { suffix })).statusCode, 400);
    assert.equal((await call(f, item, item.input(), { suffix: '?branch=left' })).statusCode, 200);
    assert.equal((await call(f, item, item.input(), { method: 'GET' })).statusCode, 404); noPersistence(f);
  });
  test(item.name + ' post-body revocation and current-principal changes fence calculation', async () => {
    const changes = [f => f.db.exec("DELETE FROM sessions WHERE email='left'"), f => f.db.exec("UPDATE sessions SET expires=0 WHERE email='left'"), f => f.db.exec("DELETE FROM users WHERE email='left'"), f => f.db.exec("UPDATE users SET role='employee' WHERE email='left'"), f => f.db.exec("UPDATE users SET person_id='root' WHERE email='left'"), f => f.db.exec("UPDATE users SET costs=1 WHERE email='left'"), f => f.db.exec("UPDATE users SET tenant='bravo' WHERE email='left'"), f => { const s = state(); s.staff[0].site = 'other'; f.db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(s), 'alpha'); }];
    for (const mutate of changes) { const f = fixture(); try { const r = await call(f, item, item.input(), { mutate }); assert.ok([401, 403].includes(r.statusCode)); assert.equal(r.body.result, undefined); assert.deepEqual(f.events, []); } finally { f.close(); } }
  });
  test(item.name + ' rejects malformed, primitive and oversized JSON without a result', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const raw of ['{', 'null', '[]', '123']) { const r = await call(f, item, null, { raw }); assert.equal(r.statusCode, 400); assert.equal(r.body.result, undefined); }
    assert.equal((await call(f, item, null, { raw: JSON.stringify({ excess: 'x'.repeat(270000) }) })).statusCode, 413); noPersistence(f);
  });
  test(item.name + ' route is reachable over real loopback HTTP', async t => {
    const f = fixture(); t.after(() => f.close());
    const server = http.createServer(async (req, res) => { if (!await f.service.handleRequest(req, res)) { res.statusCode = 404; res.end(); } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const response = await fetch('http://127.0.0.1:' + server.address().port + item.route, { method: 'POST', headers: { cookie: 'wfm_session=left', 'content-type': 'application/json' }, body: JSON.stringify(item.input()) });
    assert.equal(response.status, 200); item.result((await response.json()).result); noPersistence(f);
  });
}
test('output donor period, source distinction, completeness and safe integer guards are enforced through HTTP', async t => {
  const f = fixture(), item = cases[0]; t.after(() => f.close());
  const changes = [b => b.production.complete = false, b => b.plan.window.end = clock(-59), b => b.window.end = clock(1), b => b.production.observedAt = clock(1), b => b.plan.observedAt = clock(-61), b => b.production.evidenceRef = b.plan.evidenceRef, b => { for (const key of ['sourceName', 'revision', 'digest']) b.production[key] = b.plan[key]; }, b => b.plan.targetUnits = '120', b => b.production.acceptedUnits = -1, b => b.production.acceptedUnits = Number.MAX_SAFE_INTEGER + 1, b => b.window.start = clock(-32 * 1440)];
  for (const change of changes) { const b = item.input(); change(b); const r = await call(f, item, b); assert.equal(r.statusCode, 400); assert.equal(r.body.result, undefined); }
  for (const [accepted, gap, over] of [[120,0,0],[125,0,5]]) { const b = item.input(); b.production.acceptedUnits = accepted; const r = await call(f, item, b); assert.equal(r.statusCode, 200); assert.equal(r.body.result.gapUnits,gap); assert.equal(r.body.result.overPlanUnits,over); }
  noPersistence(f);
});
test('material donor BOM, revision, component, units and fixed 15-minute stock freshness guards are enforced through HTTP', async t => {
  const f = fixture(), item = cases[1]; t.after(() => f.close());
  const changes = [b => b.bom.complete = false, b => b.inventory.complete = false, b => b.inventory.bomRevision = 'old', b => b.inventory.bomDigest = 'old', b => b.inventory.observedAt = clock(-16), b => b.inventory.observedAt = clock(1), b => b.inventory.observedAt = clock(-31), b => b.bom.effectiveEnd = clock(-1), b => b.bom.effectiveStart = clock(1), b => b.bom.components[0].tenantId = 'bravo', b => b.inventory.balances[0].orderId = 'foreign', b => b.inventory.balances[0].unit = 'EA', b => b.bom.components[0].requiredMilliunits = '3000', b => b.inventory.balances[0].allocatableMilliunits = -1, b => b.inventory.balances[0].evidenceRef = b.bom.components[0].evidenceRef, b => b.inventory.balances = [], b => b.bom.components.push({...b.bom.components[0]}), b => b.inventory.digest = b.bom.digest];
  for (const change of changes) { const b = item.input(); change(b); const r = await call(f, item, b); assert.equal(r.statusCode, 400); assert.equal(r.body.result, undefined); }
  const b = item.input(); b.inventory.balances[0].allocatableMilliunits = 3000; const r = await call(f, item, b); assert.equal(r.statusCode,200); assert.equal(r.body.result.shortfallCount,0); assert.equal(r.body.result.sourceAuthenticated,false); noPersistence(f);
});
