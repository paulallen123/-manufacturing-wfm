'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createCleanCustomerState, createSetupCustomerState } = require(require('node:path').join(process.env.CLEAN_CUSTOMER_RUNTIME_ROOT || __dirname, 'clean-customer-state.cjs'));
const input = () => ({ tenant: 'synthetic-setup-tenant', customerId: 'synthetic-customer-001',
  authority: { tenant: 'synthetic-setup-tenant', customerId: 'synthetic-customer-001',
    purpose: 'construct-setup-customer-state', reference: 'synthetic-trusted-binding-001' } });
// Isolated authority fixture; production must resolve the exact binding externally.
const trusted = { authorize: value => JSON.stringify(value) === JSON.stringify(input()) };
const make = () => createSetupCustomerState(input(), trusted);

test('setup-only construction has the complete reviewed empty shape without an organisation anchor', () => {
  const reference = createCleanCustomerState({ tenant: 'synthetic-setup-tenant',
    owner: { tenant: 'synthetic-setup-tenant', person_id: 'synthetic-owner' },
    organisation: { tenant: 'synthetic-setup-tenant', ownerAnchor: {
      id: 'synthetic-owner', parent: null, name: 'Synthetic Owner', label: 'Synthetic Org' } },
    authority: { tenant: 'synthetic-setup-tenant', person_id: 'synthetic-owner',
      purpose: 'construct-clean-customer-state', reference: 'synthetic-anchor-binding' }
  }, { authorize: () => true });
  reference.org = []; reference.orgAdmin.baseOrg = [];
  const state = make();
  assert.deepEqual(state, reference);
  assert.equal(state.timeReview.thresholds, null);
  assert.equal(state.demandPlanning.minCohort, null);
  assert.equal(state.demandPlanning.shareAggregates, false);
  assert.equal(state.costing.calendar, null);
  for (const key of ['users', 'personnel_links', 'permissions', 'credentials', 'productionApproved']) {
    assert.equal(Object.hasOwn(state, key), false);
  }
});

test('setup construction requires externally verified matching customer and tenant authority', () => {
  for (const authorize of [undefined, () => false, () => 'true', () => 1, async () => true]) {
    assert.throws(() => createSetupCustomerState(input(), { authorize }), /authority/i);
  }
  for (const field of ['tenant', 'customerId', 'purpose']) {
    const bad = input(); bad.authority[field] = 'another-binding';
    let calls = 0;
    assert.throws(() => createSetupCustomerState(bad, { authorize: () => { calls++; return true; } }), /match/i);
    assert.equal(calls, 0);
  }
});

test('setup constructor rejects extra fields, ambiguous strings and accessor/prototype authority', () => {
  const badInputs = [];
  for (const field of ['owner', 'organisation', 'verified', 'role']) badInputs.push({ ...input(), [field]: true });
  for (const value of ['', ' tenant', 'tenant ', 'x\n', 'x'.repeat(101)]) badInputs.push({ ...input(), tenant: value });
  for (const value of ['', ' customer', 'customer ', 'x\u0000', 'x'.repeat(301)]) badInputs.push({ ...input(), customerId: value });
  const accessor = input(); let reads = 0;
  Object.defineProperty(accessor.authority, 'reference', { enumerable: true, get() { reads++; return 'reference'; } });
  badInputs.push(accessor);
  const inherited = input(); Object.setPrototypeOf(inherited.authority, { verified: true }); badInputs.push(inherited);
  const symbol = input(); symbol.authority[Symbol('approval')] = true; badInputs.push(symbol);
  for (const bad of badInputs) {
    let calls = 0;
    assert.throws(() => createSetupCustomerState(bad, { authorize: () => { calls++; return true; } }));
    assert.equal(calls, 0);
  }
  assert.equal(reads, 0);
});

test('authority callback sees frozen exact values and cannot mutate caller data or output', () => {
  const original = input(), before = structuredClone(original);
  const state = createSetupCustomerState(original, { authorize(validated) {
    assert.deepEqual(validated, before);
    assert.equal(Object.isFrozen(validated), true);
    assert.equal(Object.isFrozen(validated.authority), true);
    assert.throws(() => { validated.authority.tenant = 'foreign'; }, TypeError);
    return true;
  } });
  assert.deepEqual(original, before);
  assert.deepEqual(state.org, []);
  const other = make(); state.workRules.jobs.push({ id: 'synthetic-test-mutation' });
  assert.deepEqual(other.workRules.jobs, []);
  assert.deepEqual(other.orgAdmin.baseOrg, []);
});

test('setup state survives canonical SQLite round-trip without importing authority or demo rows', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL)');
  const state = make();
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(input().tenant, state.version, JSON.stringify(state));
  const row = db.prepare('SELECT * FROM tenants WHERE id=?').get(input().tenant);
  assert.deepEqual(JSON.parse(row.state), state);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tenants').get().n, 1);
  assert.deepEqual(JSON.parse(row.state).staff, []);
  assert.deepEqual(JSON.parse(row.state).org, []);
  assert.equal(JSON.stringify(state).includes(input().authority.reference), false);
});
