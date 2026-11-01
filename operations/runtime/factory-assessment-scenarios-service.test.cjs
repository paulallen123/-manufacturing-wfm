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
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-consumer-')), dbPath = path.join(directory, 'db.sqlite'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT,person_id TEXT,costs INTEGER,permissions TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);CREATE TABLE audit_events(id INTEGER PRIMARY KEY,tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT);');
  for (const tenant of ['alpha', 'bravo']) db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant, 1, JSON.stringify(state()));
  for (const [email, tenant, role, person, costs] of [['left', 'alpha', 'manager', 'left', 0], ['root', 'alpha', 'director', 'root', 1], ['supervisor', 'alpha', 'supervisor', 'left', 0], ['employee', 'alpha', 'employee', 'left', 0], ['admin', 'alpha', 'admin', 'root', 1], ['hr', 'alpha', 'hr', 'root', 1], ['payroll', 'alpha', 'payroll_admin', 'root', 1], ['unknown', 'alpha', 'unknown', 'root', 1], ['bravo', 'bravo', 'manager', 'left', 0]]) {
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(email, tenant, role, person, costs, '[]');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(email), email, Date.now() + 120000);
  }
  const events = [];
  const service = createSchedulingIntelligenceService({ dbPath, internalToken: 'synthetic-worker-token', nativeHelpers: options.nativeHelpers || nativeHelpers(), publishEvent: event => events.push(event) });
  return { directory, dbPath, db, service, events, close() { service.close(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
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
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n, 0);
  if (f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_factory_assessment_receipts'").get()) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vector_factory_assessment_receipts').get().n, 0);
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

const receiptsRoute = '/api/operations/scheduling/factory-assessments/';
function saveRoute(item) { return { ...item, route: item.route.replace(/\/scenario$/, '/assessments') }; }
async function getReceipt(f, id, options = {}) { return call(f, { route: receiptsRoute + id, input: () => undefined }, undefined, { ...options, method: 'GET' }); }
function receiptCount(f) { return f.db.prepare('SELECT COUNT(*) n FROM vector_factory_assessment_receipts').get().n; }
function receiptAudit(f) { return f.db.prepare("SELECT tenant,actor,action,detail FROM audit_events WHERE action='factory-assessment-declaration-recorded'").all(); }
function assertCustody(receipt, item, input) {
  assert.equal(receipt.contractVersion, 'DECLARED_FACTORY_ASSESSMENT_RECEIPT_V1');
  assert.match(receipt.receiptId, /^[a-f0-9]{64}$/); assert.match(receipt.requestDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.tenantId, 'alpha'); assert.equal(receipt.department, 'left'); assert.equal(receipt.siteId, 'a');
  assert.equal(receipt.kind, item.name); assert.equal(receipt.sourceBasis, item.source);
  assert.equal(receipt.custodyBasis, 'SERVER_RECORDED_CALLER_DECLARATION'); assert.equal(receipt.authority, 'DECLARATION_CUSTODY_ONLY');
  assert.equal(receipt.scenarioOnly, true); assert.equal(receipt.persisted, true);
  for (const key of ['sourceAuthenticated', 'lineOrderAuthority', 'causeVerified', 'costVerified', 'scheduleAuthority', 'executionAuthority']) assert.equal(receipt[key], false, key);
  assert.deepEqual(receipt.input, input); item.result(receipt.assessment.result);
  assert.equal(receipt.assessment.asOf, receipt.assessment.result.asOf);
  assert.equal(receipt.assessment.result.sourceAuthenticated, false); assert.equal(receipt.assessment.result.actionAuthority, false);
  assert.equal(receipt.assessment.result.claimedSavingsPence, null);
}
function freshProcessGet(f, receiptId, who, advanceMs = 0) {
  const modulePath = process.env.V095_FACTORY_SERVICE_MODULE || path.join(__dirname, 'scheduling-intelligence-service.cjs');
  const archive = path.resolve(__dirname, '../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
  const code = `
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),{Readable}=require('node:stream');
    const args=JSON.parse(fs.readFileSync(0,'utf8'));
    if(args.advanceMs){const RealDate=Date,now=RealDate.now()+args.advanceMs;global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};}
    let directory;
    let service;
    (async()=>{try{
      let publicRoot='/app/public';
      if(!fs.existsSync(path.join(publicRoot,'engine.js'))){directory=fs.mkdtempSync(path.join(os.tmpdir(),'factory-readback-native-'));execFileSync('tar',['--no-same-owner','-xzf',args.archive,'-C',directory],{stdio:'pipe'});publicRoot=path.join(directory,'public');}
      const engine=require(path.join(publicRoot,'engine.js')),operations=require(path.join(publicRoot,'operations-engine.js'));
      service=require(args.modulePath).createSchedulingIntelligenceService({dbPath:args.dbPath,nativeHelpers:{allowedPeople:engine.allowedPeople,descendants:engine.descendants,approvedSite:operations.approvedSite}});
      const req=Readable.from([]);req.method='GET';req.url=args.route;req.headers={cookie:'wfm_session='+args.who};
      const res={statusCode:200,headersSent:false,writableEnded:false,setHeader(){},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};
      await service.handleRequest(req,res);process.stdout.write(JSON.stringify({statusCode:res.statusCode,body:res.body}));
    }finally{service?.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});}})().catch(error=>{process.stderr.write(error.stack);process.exitCode=1;});`;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { input: JSON.stringify({ modulePath, archive, dbPath: f.dbPath, route: receiptsRoute + receiptId, who, advanceMs }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
}
for (const item of cases) {
  test(item.name + ' declaration custody writes an immutable receipt and exactly one audit with stable idempotent readback', async t => {
    const f = fixture(); t.after(() => f.close()); const input = item.input(), original = JSON.stringify(input);
    const saved = await call(f, saveRoute(item), input); assert.equal(saved.statusCode, 201); assert.equal(saved.body.idempotent, false);
    const receipt = saved.body.receipt; assertCustody(receipt, item, input); assert.equal(JSON.stringify(input), original);
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const retry = await call(f, saveRoute(item), reordered); assert.equal(retry.statusCode, 200); assert.equal(retry.body.idempotent, true); assert.deepEqual(retry.body.receipt, receipt);
    assert.deepEqual((await getReceipt(f, receipt.receiptId)).body.receipt, receipt);
    assert.equal(receiptCount(f), 1); const audit = receiptAudit(f); assert.equal(audit.length, 1); assert.equal(audit[0].tenant, 'alpha'); assert.equal(audit[0].actor, 'left');
    const detail = JSON.parse(audit[0].detail); assert.equal(detail.receiptId, receipt.receiptId); assert.equal(detail.requestDigest, receipt.requestDigest);
    assert.equal(detail.sourceAuthenticated, false); assert.equal(detail.executionAuthority, false); assert.equal(Object.hasOwn(detail, 'input'), false);
    assert.throws(() => f.db.exec('UPDATE vector_factory_assessment_receipts SET receipt_json=receipt_json'), /append.only/i);
    assert.throws(() => f.db.exec('DELETE FROM vector_factory_assessment_receipts'), /append.only/i);
    for (const table of ['vector_schedule_plans', 'vector_schedule_repairs', 'vector_schedule_reconciliations']) assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0);
    assert.deepEqual(f.events, []); assert.equal(f.db.prepare("SELECT state FROM tenants WHERE id='alpha'").get().state, JSON.stringify(state()));
  });
  test(item.name + ' declaration custody survives a fresh process and fresh session without upgrading historical source authority', async t => {
    const f = fixture(); t.after(() => f.close()); const input = item.input();
    const saved = await call(f, saveRoute(item), input); assert.equal(saved.statusCode, 201); const receipt = saved.body.receipt;
    f.db.exec("DELETE FROM sessions WHERE email='left'");
    f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('fresh-left'), 'left', Date.now() + 3600000);
    f.service.close();
    const read = freshProcessGet(f, receipt.receiptId, 'fresh-left', 20 * 60000); assert.equal(read.statusCode, 200); assert.deepEqual(read.body.receipt, receipt); assertCustody(read.body.receipt, item, input);
    assert.equal(freshProcessGet(f, receipt.receiptId, 'bravo').statusCode, 404);
    assert.equal(freshProcessGet(f, receipt.receiptId, 'root').statusCode, 404);
    assert.equal(freshProcessGet(f, receipt.receiptId, 'left').statusCode, 401);
    assert.equal(receiptCount(f), 1); assert.equal(receiptAudit(f).length, 1);
  });
  test(item.name + ' declaration custody reauthorizes creator identity and native department/site on every read', async t => {
    const f = fixture(); t.after(() => f.close());
    const saved = await call(f, saveRoute(item)); assert.equal(saved.statusCode, 201); const id = saved.body.receipt.receiptId;
    for (const who of ['bravo', 'root', 'supervisor']) { const r = await getReceipt(f, id, { who }); assert.equal(r.statusCode, 404); assert.equal(r.body.receipt, undefined); }
    f.db.exec("UPDATE users SET person_id='root' WHERE email='left'"); assert.equal((await getReceipt(f, id)).statusCode, 404);
    f.db.exec("UPDATE users SET person_id='left' WHERE email='left'");
    const changed = state(); changed.staff[0].site = 'other'; f.db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(changed), 'alpha');
    const denied = await getReceipt(f, id); assert.equal(denied.statusCode, 403); assert.equal(denied.body.receipt, undefined);
    f.db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state()), 'alpha');
    f.db.exec("UPDATE users SET role='employee' WHERE email='left'"); assert.equal((await getReceipt(f, id)).statusCode, 403);
    f.db.exec("UPDATE users SET role='manager' WHERE email='left'; UPDATE sessions SET expires=0 WHERE email='left'"); assert.equal((await getReceipt(f, id)).statusCode, 401);
    assert.equal(receiptCount(f), 1); assert.equal(receiptAudit(f).length, 1);
  });
  test(item.name + ' declaration custody rolls back on audit failure and a later retry creates one complete receipt', async t => {
    const f = fixture(); t.after(() => f.close()); const input = item.input();
    f.db.exec("CREATE TRIGGER fail_factory_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
    const failed = await call(f, saveRoute(item), input); assert.equal(failed.statusCode, 503); assert.equal(failed.body.receipt, undefined); assert.equal(receiptCount(f), 0); assert.equal(receiptAudit(f).length, 0);
    f.db.exec('DROP TRIGGER fail_factory_audit');
    const retry = await call(f, saveRoute(item), input); assert.equal(retry.statusCode, 201); assert.equal(receiptCount(f), 1); assert.equal(receiptAudit(f).length, 1);
  });
  test(item.name + ' declaration custody preserves strict validation and refuses body-time revocation without durable effects', async t => {
    const f = fixture(); t.after(() => f.close());
    for (const extra of [{ tenantId: 'bravo' }, { sourceAuthenticated: true }, { persisted: true }, { asOf: clock(0) }, { receiptId: 'a'.repeat(64) }]) assert.equal((await call(f, saveRoute(item), { ...item.input(), ...extra })).statusCode, 400);
    assert.equal((await call(f, saveRoute(item), item.input({ siteId: 'b' }))).statusCode, 403);
    const revoked = await call(f, saveRoute(item), item.input(), { mutate: f => f.db.exec("DELETE FROM sessions WHERE email='left'") }); assert.equal(revoked.statusCode, 401);
    assert.equal(receiptCount(f), 0); assert.equal(receiptAudit(f).length, 0); assert.deepEqual(f.events, []);
  });
}
test('declaration custody rejects missing native audit storage while preserving the stateless scenario', async t => {
  const f = fixture(); t.after(() => f.close()); f.db.exec('DROP TABLE audit_events');
  const failed = await call(f, saveRoute(cases[0])); assert.equal(failed.statusCode, 503); assert.equal(receiptCount(f), 0);
  const scenario = await call(f, cases[0]); assert.equal(scenario.statusCode, 200); assert.equal(scenario.body.persisted, false);
});
test('declaration custody exact-ID reads reject malformed IDs and query overrides without exposing a record', async t => {
  const f = fixture(); t.after(() => f.close());
  const saved = await call(f, saveRoute(cases[0])); assert.equal(saved.statusCode, 201); const id = saved.body.receipt.receiptId;
  for (const value of ['absent', '../plans', id.toUpperCase(), id + '/extra']) { const r = await getReceipt(f, value); assert.equal(r.statusCode, 404); assert.equal(r.body.receipt, undefined); }
  for (const suffix of ['?tenant=bravo', '?asOf=2026-01-01', '?limit=20']) { const r = await getReceipt(f, id, { suffix }); assert.equal(r.statusCode, 400); assert.equal(r.body.receipt, undefined); }
  assert.equal((await getReceipt(f, id, { suffix: '?scope=right' })).statusCode, 403); assert.equal(receiptCount(f), 1); assert.equal(receiptAudit(f).length, 1);
});
test('declaration custody rechecks revocation after the outer native read before insert and idempotent return', async t => {
  const native = nativeHelpers(); let f, reads = 0, revokeAt = Infinity;
  f = fixture({ nativeHelpers: { ...native, allowedPeople(...args) {
    const people = native.allowedPeople(...args);
    if (++reads === revokeAt) f.db.exec("DELETE FROM sessions WHERE email='left'");
    return people;
  } } }); t.after(() => f.close());
  const input = cases[0].input(); revokeAt = 3;
  const deniedInsert = await call(f, saveRoute(cases[0]), input); assert.equal(deniedInsert.statusCode, 401); assert.equal(receiptCount(f), 0); assert.equal(receiptAudit(f).length, 0);
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('left'), 'left', Date.now() + 120000); revokeAt = Infinity;
  const saved = await call(f, saveRoute(cases[0]), input); assert.equal(saved.statusCode, 201);
  reads = 0; revokeAt = 3;
  const deniedRetry = await call(f, saveRoute(cases[0]), input); assert.equal(deniedRetry.statusCode, 401); assert.equal(deniedRetry.body.receipt, undefined);
  assert.equal(receiptCount(f), 1); assert.equal(receiptAudit(f).length, 1);
});
test('declaration custody save and creator readback execute over real loopback HTTP', async t => {
  const f = fixture(); t.after(() => f.close());
  const server = http.createServer(async (req, res) => { if (!await f.service.handleRequest(req, res)) { res.statusCode = 404; res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const item of cases) {
    const input = item.input(), response = await fetch(origin + saveRoute(item).route, { method: 'POST', headers: { cookie: 'wfm_session=left', 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 201); const receipt = (await response.json()).receipt; assertCustody(receipt, item, input);
    const read = await fetch(origin + receiptsRoute + receipt.receiptId, { headers: { cookie: 'wfm_session=left' } });
    assert.equal(read.status, 200); assert.deepEqual((await read.json()).receipt, receipt); assert.equal(read.headers.get('cache-control'), 'no-store');
  }
  assert.equal(receiptCount(f), 2); assert.equal(receiptAudit(f).length, 2);
});
