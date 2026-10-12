'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createCleanCustomerState } = require('./clean-customer-state.cjs');

// Missing/wrong archive is a hard failure, never a mocked or seed-based fallback.
const archive = process.env.CLEAN_CUSTOMER_ARCHIVE || path.resolve(__dirname,
  '../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const archiveHash = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), archiveHash);
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-customer-pinned-'));
execFileSync('tar', ['xzf', archive, '-C', runtime]);
test.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
const read = file => fs.readFileSync(path.join(runtime, file), 'utf8');
const mod = name => require(path.join(runtime, 'public', name + '.js'));
const W = mod('core'), E = mod('engine'), C = mod('cost-engine'), P = mod('payroll-control');
const R = mod('work-rules'), D = mod('demand-engine'), O = mod('operations-engine');
const RD = mod('readiness-engine'), SP = mod('schedule-publication');
const OA = mod('org-admin'), ON = mod('onboarding-engine');
const decoratorNames = fs.readdirSync(path.join(runtime, 'public')).filter(f =>
  f.endsWith('.js') && /function decorate\(/.test(read('public/' + f))).map(f => f.slice(0, -3));
const decorators = decoratorNames.filter(n => n !== 'engine').map(n => [n, mod(n)]);
// Tripwires only for forbidden seeds. Every tested reader/decorator remains real.
W.seed = E.decorate = RD.seedFixture = () => { throw new Error('FORBIDDEN_DEMO_SEED'); };
const input = () => ({ tenant: 'synthetic-tenant-a',
  owner: { tenant: 'synthetic-tenant-a', person_id: 'synthetic-owner-a' },
  organisation: { tenant: 'synthetic-tenant-a', ownerAnchor: {
    id: 'synthetic-owner-a', parent: null, name: 'Synthetic Owner', label: 'Synthetic Organisation' } },
  authority: { tenant: 'synthetic-tenant-a', person_id: 'synthetic-owner-a',
    purpose: 'construct-clean-customer-state', reference: 'synthetic-reviewed-anchor-001' }
});
// Test-only caller authority. Production must resolve this from trusted server data.
const caller = { authorize: x => JSON.stringify(x) === JSON.stringify(input()) };
const make = () => createCleanCustomerState(input(), caller);
// Test actor permissions are not written into the factory output.
const actor = { tenant: 'synthetic-tenant-a', personId: 'synthetic-owner-a',
  role: 'manager', costs: true, permissions: ['company.configure', 'payroll.review', 'payroll.export'] };
const server = read('server.cjs');
function sourceBetween(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'Pinned source extraction boundary changed');
  return source.slice(a, b);
}
function serverReaders(db) {
  const context = vm.createContext({ db, E, C, P, R, RD, SP, OA, ON, structuredClone });
  vm.runInContext(sourceBetween(server, 'function load(tenant)', '\nfunction '), context);
  vm.runInContext(sourceBetween(server, 'function sanitise(s,a)', '\nfunction redactCostResult'), context);
  return context;
}
const json = x => JSON.parse(JSON.stringify(x));

test('construction is deterministic, isolated, pure and separate from workforce/authority', () => {
  const original = input(), before = structuredClone(original);
  const a = createCleanCustomerState(original, caller), b = make();
  assert.deepEqual(original, before); assert.deepEqual(a, b); assert.notEqual(a, b);
  for (const [key, value] of Object.entries(a)) if (value && typeof value === 'object') assert.notEqual(value, b[key]);
  a.org[0].name = 'Changed'; a.orgAdmin.baseOrg[0].label = 'Changed'; a.costing.rates.changed = [];
  a.workRules.roster.push({ id: 'local-only' });
  assert.deepEqual(b, make()); assert.deepEqual(original, before);
  assert.notEqual(b.org[0], b.orgAdmin.baseOrg[0]);
  for (const key of ['users','roles','personnel_links','authority','productionApproved','operationalReady','ready','jurisdiction','rulesVerifiedAt']) assert.equal(Object.hasOwn(b, key), false);
  assert.deepEqual(b.staff, []); assert.equal(Object.hasOwn(b.org[0], 'role'), false);
});

test('wrong tenant/owner, missing context, unknown fields and missing authority fail closed', () => {
  for (const change of [x => { delete x.owner; }, x => { delete x.organisation; },
    x => { delete x.authority; }, x => { x.owner.tenant = 'synthetic-tenant-b'; },
    x => { x.organisation.tenant = 'synthetic-tenant-b'; }, x => { x.authority.tenant = 'synthetic-tenant-b'; },
    x => { x.authority.person_id = 'synthetic-other'; }, x => { x.owner.person_id = 'synthetic-other'; },
    x => { x.organisation.ownerAnchor.id = 'synthetic-other'; }, x => { x.organisation.ownerAnchor.parent = 'unknown'; },
    x => { x.organisation.ownerAnchor.name = ''; }, x => { x.authority.reference = ''; },
    x => { x.owner.person_id = x.authority.person_id = x.organisation.ownerAnchor.id = 'unsafe"id'; },
    x => { x.authority.purpose = 'different-purpose'; }, x => { x.staff = []; },
    x => { x.owner.roles = ['admin']; }, x => { x.organisation.ownerAnchor.payrollId = 'invented'; }]) {
    const x = input(); change(x); assert.throws(() => createCleanCustomerState(x, { authorize: () => true }));
  }
  for (const options of [undefined, {}, { authorize: () => false }, { authorize: () => ({ approved: true }) },
    { authorize: () => Promise.resolve(true) }]) assert.throws(() => createCleanCustomerState(input(), options));
  const x = input(); x.authority.reference = 'unrecognised-reference';
  assert.throws(() => createCleanCustomerState(x, caller));
  assert.throws(() => createCleanCustomerState(input(), { authorize: v => { v.owner.person_id = 'changed'; return true; } }));
  let getterCalled = false; const accessor = input();
  Object.defineProperty(accessor, 'tenant', { get() { getterCalled = true; return 'synthetic-tenant-a'; } });
  assert.throws(() => createCleanCustomerState(accessor, caller)); assert.equal(getterCalled, false);
});

test('non-enumerable required and optional input properties fail before authority is consulted', () => {
  for (const location of [[], ['owner'], ['organisation'], ['organisation', 'ownerAnchor'], ['authority']]) {
    const template = input(); template.organisation.ownerAnchor.role = 'Synthetic supplied title';
    const target = location.reduce((value, key) => value[key], template);
    for (const key of Object.keys(target)) {
      const value = structuredClone(template);
      const hidden = location.reduce((value, key) => value[key], value);
      Object.defineProperty(hidden, key, { enumerable: false });
      let consulted = false;
      assert.throws(() => createCleanCustomerState(value, { authorize: () => { consulted = true; return true; } }),
        /Invalid /, 'Hidden ' + [...location, key].join('.'));
      assert.equal(consulted, false, 'Hidden properties must not reach authorize');
    }
  }
});

test('authority snapshot and returned organisation retain exactly the validated enumerable values', () => {
  for (const includeRole of [false, true]) {
    const value = input();
    if (includeRole) value.organisation.ownerAnchor.role = 'Synthetic supplied title';
    const expected = structuredClone(value); let snapshot;
    const state = createCleanCustomerState(value, { authorize: validated => {
      snapshot = validated;
      assert.deepEqual(validated, expected);
      for (const object of [validated, validated.owner, validated.organisation,
        validated.organisation.ownerAnchor, validated.authority]) assert(Object.isFrozen(object));
      // Changes to the caller's original input after validation cannot alter the approved snapshot.
      value.organisation.ownerAnchor.id = 'changed-original';
      value.organisation.ownerAnchor.name = 'Changed original';
      value.organisation.ownerAnchor.parent = 'changed-parent';
      value.authority.reference = 'changed-reference';
      return true;
    } });
    assert.deepEqual(snapshot, expected);
    assert.deepEqual(state.org, [expected.organisation.ownerAnchor]);
    assert.deepEqual(state.orgAdmin.baseOrg, state.org);
    assert.notEqual(state.org[0], snapshot.organisation.ownerAnchor);
    assert.notEqual(state.orgAdmin.baseOrg[0], state.org[0]);
    assert.equal(Object.hasOwn(state.org[0], 'role'), includeRole);
  }
});

test('every pinned public decorator preserves clean state twice and after JSON round-trip', () => {
  assert.deepEqual(decorators.map(([name]) => name).sort(), [
    'attendance-corrections', 'cost-engine', 'demand-engine', 'economic-cost-engine',
    'manufacturing-context', 'manufacturing-scenarios', 'onboarding-engine', 'operations-engine',
    'org-admin', 'overtime-watch', 'payroll-control', 'readiness-engine', 'recommendation-engine',
    'resources-engine', 'schedule-publication', 'time-review', 'value-cockpit', 'work-rules'
  ].sort(), 'Review every new/removed decorator before changing this inventory');
  const expected = make(); let state = make();
  for (let pass = 0; pass < 3; pass++) {
    for (const [name, reader] of decorators) {
      reader.decorate(state); assert.deepEqual(state, expected, name + ' added or changed state');
    }
    E.refreshCostView(state); E.syncToday(state); state = json(state);
  }
  assert.deepEqual(state, expected);
});

test('actual sealed load, SQLite save/read and bootstrap sanitisation preserve emptiness', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT)');
    const expected = make();
    db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(actor.tenant, expected.version, JSON.stringify(expected));
    const readers = serverReaders(db);
    for (let pass = 0; pass < 2; pass++) {
      const state = readers.load(actor.tenant); assert.deepEqual(json(state), expected);
      for (const costs of [false, true]) {
        const view = readers.sanitise(state, { ...actor, costs });
        for (const key of ['staff','requests','assignments','availability','gaps','offers','audit','history']) assert.deepEqual(json(view[key]), []);
        assert.deepEqual(json(view.org), expected.org);
        assert.equal(Boolean(view.costing), costs);
        if (costs) assert.deepEqual(json(view.costing), expected.costing);
      }
      // Identical SQL/JSON persistence format to sealed mutate(), no command or account created.
      db.prepare('UPDATE tenants SET version=?,state=? WHERE id=?').run(state.version, JSON.stringify(state), actor.tenant);
    }
    assert.deepEqual(json(readers.load(actor.tenant)), expected);
    assert.throws(() => readers.load('synthetic-absent-tenant'));
  } finally { db.close(); }
});

test('actual scoped readers expose empty operational collections without state mutation', () => {
  const s = make(), expected = make();
  assert.deepEqual(E.allowedPeople(s, actor), []); assert.deepEqual(W.scopedStaff(s, actor.personId), []);
  assert.deepEqual(OA.report(s, actor).org, s.org); assert.deepEqual(ON.report(s, actor).people, []);
  assert.deepEqual(ON.report(s, actor).batches, []);
  assert.deepEqual(C.dashboard(s, actor).employees, []);
  assert.deepEqual(R.report(s, actor).staff, []);
  assert.deepEqual(D.settings(s, actor).products, []);
  assert.deepEqual(SP.dashboard(s, actor).published, []);
  assert.deepEqual(SP.dashboard(s, actor).drafts, []);
  assert.deepEqual(RD.runs(s, actor), []); RD.board(s, actor);
  for (const [view, collection] of [['leave','rows'],['breaks','records'],['swaps','swaps'],['shifts','shifts']]) {
    assert.deepEqual(O.view(s, actor, view)[collection], []);
  }
  assert.equal(E.analytics(s, actor).teamSize, 0);
  assert.deepEqual(s, expected);
});

test('pinned onboarding renderers render empty people and batches', () => {
  const source = read('public/onboarding-ui.js');
  const ctx = vm.createContext({ report: ON.report(make(), actor) });
  vm.runInContext(sourceBetween(source, 'function people(r)', '\nfunction page()'), ctx);
  const html = vm.runInContext('people(report)+batches(report)', ctx);
  assert.match(html, /No staged employees yet/); assert.match(html, /No batches yet/);
  assert.doesNotMatch(html, /Create invitation|synthetic-owner|e40|e41/);
});

test('pinned organisation renderer uses supplied anchor without inventing a role', () => {
  const source = read('public/org-admin-ui.js');
  const ctx = vm.createContext({ STATE: { report: OA.report(make(), actor) } });
  vm.runInContext(read('public/app.js').split('\n').find(line => line.startsWith('const esc=')), ctx);
  vm.runInContext(sourceBetween(source, 'function label(id)', '\nfunction accounts()'), ctx);
  const html = vm.runInContext('tree()+history()', ctx);
  assert.match(html, /Synthetic Organisation/); assert.match(html, /No reporting-line changes/);
  assert.doesNotMatch(html, /Operations director|Factory manager|Team leader|undefined/);
  const app = read('public/app.js').split('\n');
  const treeContext = vm.createContext({ data: make(), WFM: W, ui: { root: actor.personId, expanded: true } });
  for (const prefix of ['const esc=', 'const initial=', 'function avatar(', 'function orgNode(']) {
    const line = app.find(line => line.startsWith(prefix)); assert(line); vm.runInContext(line, treeContext);
  }
  const anchored = vm.runInContext('orgNode(ui.root)', treeContext);
  assert.match(anchored, /Synthetic Owner/); assert.match(anchored, /0<br>staff/);
  treeContext.data.org = [];
  assert.throws(() => vm.runInContext('orgNode(ui.root)', treeContext), /name/);
});

test('unknown policy/calendar/source facts remain unknown; no approval/readiness flip', () => {
  const s = make();
  assert.equal(s.costing.calendar, null); assert.equal(s.costing.historySource, null);
  assert.deepEqual(s.workRules.contracts, {}); assert.deepEqual(s.workRules.leaveBalances, {});
  assert.deepEqual(s.operations.breakRules, []); assert.deepEqual(s.readiness.runs, []);
  assert.equal(s.demandPlanning.source, null); assert.equal(s.demandPlanning.shareAggregates, false);
  assert.equal(s.timeReview.thresholds, null); assert.equal(s.overtimeWatch.settings.enabled, null);
  for (const [name, reader] of decorators) reader.decorate(s);
  assert.deepEqual(s, make());
  const forbidden = /"(?:e\d+|d1|m[12]|s[1-4])"|Tamworth|Leeds|fictional|synthetic-fixture|payrollId|"(?:approved|verified|complete|ready)":true/;
  assert.doesNotMatch(JSON.stringify(s), forbidden);
});

test('unsupported empty readers fail without fabricating periods, settings or a first worker', () => {
  const s = make();
  assert.throws(() => P.reviewDashboard(s, actor, 'synthetic-no-period'), /Weekly period not found/);
  assert.throws(() => mod('time-review').report(s, actor), /id/);
  assert.throws(() => mod('overtime-watch').report(s, actor, '2026-10-05'), /Enabled must be true or false/);
  const result = ON.validateRows(s, actor, [{ source_id: 'synthetic-source-1', payroll_id: 'synthetic-pay-1',
    name: 'Synthetic Worker', email: 'synthetic-worker@example.test', manager_id: actor.personId,
    site: 'Synthetic Site', job: 'Synthetic Job', start_date: '2026-10-11', contract_type: 'full_time', weekly_hours: '35' }]);
  assert.equal(result.canStage, false); assert.match(result.errors[0].message, /Site is not configured/);
  assert.deepEqual(s, make());
});
