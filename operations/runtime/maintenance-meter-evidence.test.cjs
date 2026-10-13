'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMaintenanceMeterEvidence } = require('./maintenance-meter-evidence.cjs');
const hash = 'a'.repeat(64);
const copy = value => structuredClone(value);
function fixture() {
  const scope = { tenant: 'synthetic-tenant', site: 'synthetic-site', asset: 'press-1', meter: 'cycles-1' };
  const reading = (revision, value, observedAt) => ({ ...scope, revision, value, unit: 'cycles', observedAt,
    provenance: { source: 'synthetic-cmms', recordHash: hash } });
  return { scope, now: '2026-10-13T12:00:00.000Z', maxEvidenceAgeMs: 86400000,
    expected: { source: 'synthetic-cmms', unit: 'cycles', earlierRevision: 'r1', laterRevision: 'r2' },
    earlier: reading('r1', 100, '2026-10-12T12:00:00.000Z'),
    later: reading('r2', 112, '2026-10-13T11:59:00.000Z') };
}
function blocked(input, code) {
  const r = assessMaintenanceMeterEvidence(input);
  assert.equal(r.status, 'BLOCKED', JSON.stringify(r));
  assert.equal(r.executionAuthority, false);
  assert.ok(r.blockers.includes(code), JSON.stringify(r));
}
test('source-scoped monotonic readings expose only an advisory delta', () => {
  const input = fixture(), before = copy(input);
  const r = assessMaintenanceMeterEvidence(input);
  assert.equal(r.status, 'CONSISTENT_DELTA');
  assert.equal(r.delta, 12);
  assert.equal(r.executionAuthority, false);
  assert.equal(r.dueAuthority, false);
  assert.deepEqual(input, before);
});
test('same reading has a zero delta without inventing utilisation or due state', () => {
  const f = fixture(); f.later.value = f.earlier.value;
  const r = assessMaintenanceMeterEvidence(f);
  assert.equal(r.status, 'CONSISTENT_DELTA'); assert.equal(r.delta, 0); assert.equal(r.dueAuthority, false);
});
test('scope mismatch in either reading blocks cross-tenant, site, asset and meter mixing', () => {
  for (const field of ['tenant', 'site', 'asset', 'meter']) for (const row of ['earlier', 'later']) {
    const f = fixture(); f[row][field] = 'other'; blocked(f, 'SCOPE_MISMATCH');
  }
});
test('source, unit and revision drift block mixed evidence', () => {
  for (const field of ['unit', 'revision']) {
    const f = fixture(); f.later[field] = 'other'; blocked(f, 'SOURCE_MISMATCH');
  }
  const source = fixture(); source.earlier.provenance.source = 'other'; blocked(source, 'SOURCE_MISMATCH');
  const duplicate = fixture(); duplicate.expected.laterRevision = 'r1'; blocked(duplicate, 'INVALID_EXPECTATION');
});
test('decreasing, negative, nonfinite and overflowing values block', () => {
  for (const [value, code] of [[99, 'ROLLOVER_UNPROVEN'], [-1, 'INVALID_READING'],
    [Infinity, 'INVALID_JSON'], [NaN, 'INVALID_JSON'], [Number.MAX_SAFE_INTEGER + 1, 'INVALID_READING']]) {
    const f = fixture(); f.later.value = value; blocked(f, code);
  }
});
test('freshness, ordering and future timestamps block', () => {
  const future = fixture(); future.later.observedAt = '2026-10-13T12:01:00.000Z'; blocked(future, 'TIME_UNPROVEN');
  const reverse = fixture(); reverse.later.observedAt = reverse.earlier.observedAt; blocked(reverse, 'TIME_UNPROVEN');
  const stale = fixture(); stale.earlier.observedAt = '2026-10-12T11:59:59.000Z'; blocked(stale, 'STALE_EVIDENCE');
});
test('missing provenance or malformed expected source blocks', () => {
  const f = fixture(); f.later.provenance.recordHash = ''; blocked(f, 'INVALID_READING');
  const expected = fixture(); expected.expected.unit = ''; blocked(expected, 'INVALID_EXPECTATION');
});
test('active, cyclic and sparse evidence cannot be admitted as inert JSON', () => {
  const getter = fixture(); let reads = 0;
  Object.defineProperty(getter.later, 'value', { enumerable: true, get() { reads++; return 112; } });
  blocked(getter, 'INVALID_JSON'); assert.equal(reads, 0);
  const proxy = fixture(); proxy.later = new Proxy(proxy.later, {}); blocked(proxy, 'INVALID_JSON');
  const cyclic = fixture(); cyclic.later.self = cyclic.later; blocked(cyclic, 'INVALID_JSON');
});
