import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcileWorkforcePopulation as reconcile } from './workforce-population-reconciliation.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const FIELDS = ['employeeId', 'firstName', 'lastName', 'email', 'status', 'department',
  'location', 'managerId', 'jobTitle', 'startDate', 'endDate', 'payRate', 'payCurrency', 'employmentType'];
const provenance = () => ({ issuer: 'synthetic-owner', evidenceId: 'synthetic-evidence',
  evidenceChecksum: hash('synthetic-evidence'), validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-11-01T00:00:00.000Z' });
function fixture(sourceCount = 2, onboardingCount = sourceCount, operatingCount = sourceCount) {
  const namespace = { tenant: 'tenant-A', provider: 'provider-A', company: 'company-A', connectionId: 'connection-A' };
  const ids = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  const onboarding = { namespace: { ...namespace }, revision: 'onboarding-r1', provenance: provenance(), ids: ids(onboardingCount, 'onboarding') };
  const operating = { namespace: { ...namespace }, revision: 'operating-r1', provenance: provenance(), ids: ids(operatingCount, 'operating') };
  for (const x of [onboarding, operating]) x.checksum = hash(JSON.stringify([...x.ids].sort()));
  const source = ids(sourceCount, 'external').map(employeeId => {
    const canonical = { employeeId };
    return { namespace: { ...namespace }, tenant: namespace.tenant, connection_id: namespace.connectionId,
      batch_id: 'batch-1', employee_key: hash(employeeId), canonical_json: JSON.stringify(canonical),
      record_checksum: hash(JSON.stringify(FIELDS.map(f => [f, canonical[f] ?? null]))) };
  });
  const current = { batchId: 'batch-1', mappingVersion: 1, sourceRevision: 'source-r1',
    batchChecksum: hash([namespace.connectionId, '1', ...source.map(x => x.record_checksum).sort()].join('|')),
    onboardingRevision: onboarding.revision, onboardingChecksum: onboarding.checksum,
    operatingRevision: operating.revision, operatingChecksum: operating.checksum };
  const authority = { namespace: { ...namespace }, current: { ...current }, permission: 'people.read', provenance: provenance() };
  const bindings = source.map((x, i) => ({ id: `edge-${i}`, namespace: { ...namespace }, current: { ...current },
    employeeId: `external-${i}`, recordChecksum: x.record_checksum,
    onboardingId: `onboarding-${i}`, operatingId: `operating-${i}`, provenance: provenance() }));
  return { namespace, asOf: '2026-10-11T12:00:00.000Z', current, authority, source, onboarding, operating, bindings, exclusions: [] };
}
function repin(x) {
  for (const p of ['onboarding', 'operating']) {
    x[p].checksum = hash(JSON.stringify([...x[p].ids].sort())); x.current[`${p}Checksum`] = x[p].checksum;
  }
  x.current.batchChecksum = hash([x.namespace.connectionId, String(x.current.mappingVersion),
    ...x.source.map(r => r.record_checksum).sort()].join('|'));
  x.authority.current = { ...x.current };
  for (const b of [...x.bindings, ...x.exclusions]) b.current = { ...x.current };
}
const noBindings = r => assert.equal(r.bindings.length, 0);
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };

test('complete fixture is structurally consistent, never authoritative or readiness PASS', () => {
  const r = reconcile(fixture());
  assert.equal(r.structuralStatus, 'consistent-unverified');
  assert.equal(r.authoritative, false);
  assert.equal(r.authentication, 'required-by-integrating-owner');
  assert.equal(r.bindings.length, 2);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.unbound, { source: [], onboarding: [], operating: [] });
  assert.equal(Object.hasOwn(r, 'ready'), false);
});
test('2/4/42 with no independently supplied bindings reports exact unbound IDs', () => {
  const x = fixture(2, 4, 42); x.bindings = [];
  const r = reconcile(x);
  assert.deepEqual(Object.values(r.counts).map(c => c.unbound), [2, 4, 42]);
  assert.deepEqual(r.extra.onboarding, [...x.onboarding.ids].sort());
  assert.deepEqual(r.extra.operating, [...x.operating.ids].sort());
  const expectedSource = x.source.map(s => JSON.stringify(['tenant-A', 'provider-A', 'company-A', 'connection-A', s.employee_key])).sort();
  assert.deepEqual(r.missing.onboarding, expectedSource);
  assert.deepEqual(r.missing.operating, expectedSource); noBindings(r);
});
test('equal counts and equal display attributes never create identity edges', () => {
  const x = fixture(); x.bindings = [];
  x.onboarding.names = ['Same Name', 'Same Name']; x.operating.names = x.onboarding.names;
  x.onboarding.emails = ['same@example.invalid']; x.operating.emails = x.onboarding.emails;
  const r = reconcile(x); noBindings(r);
  assert.deepEqual(Object.values(r.counts).map(c => c.unbound), [2, 2, 2]);
});
for (const field of ['tenant', 'provider', 'company', 'connectionId']) {
  test(`reject cross-${field} edge contamination`, () => {
    const x = fixture(); x.bindings.forEach(b => { b.namespace[field] = 'foreign'; });
    const r = reconcile(x); noBindings(r); assert.equal(r.rejected.length, 2);
  });
  test(`quarantine cross-${field} source rows`, () => {
    const x = fixture(); x.source[0].namespace[field] = 'foreign';
    const r = reconcile(x); noBindings(r); assert.equal(r.counts.source.distinct, 1);
  });
}
test('reused external IDs across providers remain distinct namespaces', () => {
  const a = fixture(1), b = fixture(1);
  b.namespace.provider = 'provider-B'; b.authority.namespace.provider = 'provider-B';
  for (const v of [...b.source, b.onboarding, b.operating, ...b.bindings]) v.namespace.provider = 'provider-B';
  const ra = reconcile(a), rb = reconcile(b);
  assert.equal(rb.structuralStatus, 'consistent-unverified');
  assert.notEqual(ra.bindings[0].source, rb.bindings[0].source);
  b.bindings = a.bindings; noBindings(reconcile(b));
});
for (const pin of ['batchId', 'mappingVersion', 'batchChecksum', 'sourceRevision', 'onboardingRevision', 'onboardingChecksum', 'operatingRevision', 'operatingChecksum']) {
  test(`stale binding ${pin} is rejected`, () => {
    const x = fixture(1); x.bindings[0].current[pin] = pin === 'mappingVersion' ? 2 : 'stale';
    noBindings(reconcile(x)); assert.equal(reconcile(x).structuralStatus, 'blocked');
  });
}
test('stale actual source row, record body and edge record checksum fail closed', () => {
  for (const mutate of [x => { x.source[0].batch_id = 'old'; },
    x => { x.source[0].canonical_json = '{"employeeId":"other"}'; },
    x => { x.source[0].record_checksum = hash('old'); },
    x => { x.bindings[0].recordChecksum = hash('old'); }]) {
    const x = fixture(1); mutate(x); noBindings(reconcile(x));
  }
});
test('caller booleans cannot replace effective-dated authority or provenance', () => {
  for (const mutate of [x => { x.authority = { authorized: true }; },
    x => { x.authority.provenance = { authenticated: true }; },
    x => { x.authority.provenance.validUntil = x.asOf; },
    x => { x.authority.provenance.validFrom = '2026-10-12T00:00:00.000Z'; },
    x => { x.authority.permission = 'revoked'; },
    x => { x.authority.current.mappingVersion = 99; },
    x => { delete x.bindings[0].provenance; }]) {
    const x = fixture(1); mutate(x); noBindings(reconcile(x));
  }
});
test('snapshot omissions, foreign scopes, tampering, and stale revisions block binding', () => {
  for (const mutate of [x => { x.onboarding.ids = []; },
    x => { x.operating.namespace.tenant = 'other'; },
    x => { x.onboarding.revision = 'old'; },
    x => { x.operating.checksum = hash('wrong'); },
    x => { delete x.onboarding.provenance; }]) {
    const x = fixture(1); mutate(x); noBindings(reconcile(x));
  }
});
for (const population of ['source', 'onboarding', 'operating']) {
  test(`duplicate ${population} member is unusable`, () => {
    const x = fixture(1);
    if (population === 'source') x.source.push(structuredClone(x.source[0]));
    else x[population].ids.push(x[population].ids[0]);
    repin(x); const r = reconcile(x); noBindings(r);
    assert.equal(r.duplicates[0].population, population); assert.equal(r.duplicates[0].occurrences, 2);
  });
}
test('duplicate edge IDs and repeated triples cannot bind', () => {
  for (const sameId of [true, false]) {
    const x = fixture(1); const b = structuredClone(x.bindings[0]); if (!sameId) b.id = 'edge-copy';
    x.bindings.push(b); const r = reconcile(x); noBindings(r);
    assert.ok(sameId ? r.duplicates.length : r.conflicting.length);
  }
});
test('one-to-many and many-to-one ambiguity rejects all incident edges', () => {
  for (const stage of ['source', 'onboarding', 'operating']) {
    const x = fixture();
    if (stage === 'source') {
      x.bindings[1].employeeId = x.bindings[0].employeeId;
      x.bindings[1].recordChecksum = x.bindings[0].recordChecksum;
    } else x.bindings[1][`${stage}Id`] = x.bindings[0][`${stage}Id`];
    const r = reconcile(x); noBindings(r);
    assert.equal(r.conflicting[0].population, stage);
    assert.deepEqual(r.conflicting[0].bindingIds, ['edge-0', 'edge-1']);
  }
});
function exclude(x, population, memberId, reason = 'former') {
  x.exclusions.push({ id: `exclude-${population}-${memberId}`, namespace: { ...x.namespace }, current: { ...x.current },
    population, memberId, reason, provenance: provenance() });
}
test('explicit effective-dated former/excluded memberships are accounted separately', () => {
  const x = fixture(); x.bindings.pop();
  exclude(x, 'source', x.source[1].employee_key);
  exclude(x, 'onboarding', x.onboarding.ids[1], 'excluded');
  exclude(x, 'operating', x.operating.ids[1]);
  const r = reconcile(x); assert.equal(r.structuralStatus, 'consistent-unverified');
  assert.equal(r.excluded.length, 3); assert.equal(r.bindings.length, 1);
  assert.deepEqual(Object.values(r.counts).map(c => c.excluded), [1, 1, 1]);
  x.exclusions[0].provenance.validUntil = x.asOf;
  assert.equal(reconcile(x).unbound.source.length, 1);
});
test('status labels alone and duplicate exclusion evidence do not suppress members', () => {
  const x = fixture(1); x.bindings = []; x.operating.status = 'former';
  assert.equal(reconcile(x).extra.operating.length, 1);
  exclude(x, 'operating', x.operating.ids[0]); x.exclusions.push(structuredClone(x.exclusions[0]));
  assert.equal(reconcile(x).extra.operating.length, 1);
});
test('unknown target IDs stay unbound; no name or email fallback', () => {
  const x = fixture(1); x.bindings[0].operatingId = 'unknown';
  const r = reconcile(x); noBindings(r); assert.deepEqual(r.extra.operating, ['operating-0']);
});
test('malformed JSON exclusion populations return stable blocked diagnostics without coercion or mutation', () => {
  const populations = [{ toString: null }, {}, { valueOf: null, toString: null },
    [], ['source'], ['operating'], null, true, false, 0, 1, '', 'unknown',
    '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
  let expected;
  for (const population of populations) {
    const x = fixture(1); x.bindings = [];
    exclude(x, 'source', x.source[0].employee_key);
    x.exclusions[0].population = population;
    const before = structuredClone(x);
    const result = reconcile(freeze(x));
    assert.equal(result.structuralStatus, 'blocked');
    assert.equal(result.authoritative, false);
    assert.deepEqual(result.excluded, []);
    assert.deepEqual(Object.values(result.counts).map(c => c.unbound), [1, 1, 1]);
    assert.deepEqual(result.rejected, [{ population: 'exclusion',
      id: x.exclusions[0].id, reason: 'invalid-or-stale-exclusion-authority' }]);
    assert.deepEqual(reconcile(x), result);
    assert.deepEqual(x, before);
    if (expected) assert.deepEqual(result, expected);
    expected = result;
  }
});
test('malformed JSON exclusion entries return blocked diagnostics without mutation', () => {
  for (const entry of [null, [], ['source'], {}, true, false, 0, 1, 'source', '__proto__']) {
    const x = fixture(1); x.exclusions = [entry];
    const before = structuredClone(x);
    const result = reconcile(freeze(x));
    assert.equal(result.structuralStatus, 'blocked');
    assert.deepEqual(result.excluded, []);
    assert.deepEqual(result.rejected, [{ population: 'exclusion', id: null,
      reason: 'invalid-or-stale-exclusion-authority' }]);
    assert.deepEqual(reconcile(x), result);
    assert.deepEqual(x, before);
  }
});
test('all accepted output fields are detached from input objects', () => {
  const x = fixture(2); x.bindings.pop();
  exclude(x, 'source', x.source[1].employee_key);
  exclude(x, 'onboarding', x.onboarding.ids[1], 'excluded');
  exclude(x, 'operating', x.operating.ids[1]);
  const before = structuredClone(x);
  const inputObjects = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    inputObjects.add(value); Object.values(value).forEach(collect);
  };
  collect(x);
  const result = reconcile(freeze(x));
  assert.equal(result.structuralStatus, 'consistent-unverified');
  assert.equal(result.bindings.length, 1); assert.equal(result.excluded.length, 3);
  const checkDetached = value => {
    if (!value || typeof value !== 'object') return;
    assert.equal(inputObjects.has(value), false);
    Object.values(value).forEach(checkDetached);
  };
  checkDetached(result);
  result.excluded[0].population = 'changed';
  result.bindings[0].evidenceId = 'changed';
  result.counts.source.distinct = 99;
  assert.deepEqual(x, before);
  assert.deepEqual(reconcile(x), reconcile(before));
});
test('bounded malformed input returns diagnostic without throwing', () => {
  for (const x of [null, {}, { authorized: true }, { ...fixture(), source: Array(501).fill(null) },
    { ...fixture(), bindings: null }, { ...fixture(), asOf: '2026-02-30T00:00:00.000Z' }]) {
    const r = reconcile(x); assert.equal(r.structuralStatus, 'blocked'); assert.equal(r.authoritative, false);
  }
  const x = fixture(1); x.source[0].canonical_json = '{'; noBindings(reconcile(x));
});
test('deep canonical field serialization errors become stable blocked source diagnostics', () => {
  const values = ['['.repeat(20000) + '0' + ']'.repeat(20000),
    '{"v":'.repeat(8000) + '0' + '}'.repeat(8000)];
  for (const value of values) {
    const x = fixture(1);
    x.source[0].canonical_json = '{"employeeId":"external-0","payRate":' + value + '}';
    assert.ok(x.source[0].canonical_json.length < 65536);
    assert.doesNotThrow(() => JSON.parse(x.source[0].canonical_json));
    const before = structuredClone(x);
    const r = reconcile(freeze(x));
    noBindings(r); assert.equal(r.structuralStatus, 'blocked');
    assert.ok(r.rejected.some(v => v.population === 'source'
      && v.id === x.source[0].employee_key && v.reason === 'invalid-source-batch-key-or-record-checksum'));
    assert.equal(r.unbound.source.length, 1);
    assert.deepEqual(reconcile(x), r); assert.deepEqual(x, before);
  }
});
test('bounded malformed and oversized canonical JSON remain blocked without mutation', () => {
  for (const value of ['{"employeeId":"external-0","payRate":' + '['.repeat(20000),
    '{"employeeId":"external-0","payRate":' + '['.repeat(33000) + '0' + ']'.repeat(33000) + '}']) {
    const x = fixture(1); x.source[0].canonical_json = value;
    const before = structuredClone(x); const r = reconcile(freeze(x));
    noBindings(r); assert.equal(r.structuralStatus, 'blocked');
    assert.deepEqual(reconcile(x), r); assert.deepEqual(x, before);
  }
});
test('serializable canonical values retain the exact accepted-source hashing semantics', () => {
  for (const payRate of [12.5, '12.5', { amount: 12.5 }, [12.5, { currency: 'synthetic' }]]) {
    const x = fixture(1); const canonical = { employeeId: 'external-0', payRate };
    x.source[0].canonical_json = JSON.stringify(canonical);
    x.source[0].record_checksum = hash(JSON.stringify(FIELDS.map(f => [f, canonical[f] ?? null])));
    x.bindings[0].recordChecksum = x.source[0].record_checksum; repin(x);
    assert.equal(reconcile(freeze(x)).structuralStatus, 'consistent-unverified');
  }
});
test('deterministic replay, input permutation, frozen inputs and detached outputs', () => {
  const x = fixture(3); x.bindings = []; const before = structuredClone(x);
  const first = reconcile(freeze(x)); assert.deepEqual(reconcile(x), first); assert.deepEqual(x, before);
  const y = structuredClone(before); y.source.reverse(); y.onboarding.ids.reverse(); y.operating.ids.reverse();
  assert.deepEqual(reconcile(y), first);
  first.namespace.tenant = 'changed'; assert.equal(x.namespace.tenant, 'tenant-A');
  const valid = fixture(3), reversed = structuredClone(valid); reversed.bindings.reverse(); reversed.source.reverse();
  assert.deepEqual(reconcile(freeze(valid)), reconcile(reversed));
});
