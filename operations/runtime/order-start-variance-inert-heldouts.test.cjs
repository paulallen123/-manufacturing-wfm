'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOrderStartVariance } = require('./order-start-variance.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
function fixture() {
  const scope = { tenantId: 't', siteId: 's', lineId: 'l', orderId: 'o' };
  return { ...scope, asOf: '2026-10-28T11:30:00.000Z', maxAgeMinutes: 120,
    plan: { ...scope, source: 'ERP', recordId: 'p', revision: 'r1', recordSha256: A,
      observedAt: '2026-10-28T09:30:00.000Z', complete: true, state: 'PUBLISHED',
      plannedStart: '2026-10-28T10:00:00.000Z', plannedEnd: '2026-10-28T12:00:00.000Z' },
    actual: { ...scope, source: 'MES', recordId: 'a', revision: 'r1', recordSha256: B,
      observedAt: '2026-10-28T10:45:00.000Z', complete: true, state: 'STARTED',
      plannedRevision: 'r1', plannedRecordSha256: A, actualStart: '2026-10-28T10:30:00.000Z' } };
}
test('input scope accessor cannot be read even if it would return valid scope', () => {
  const x = fixture(); let reads = 0;
  Object.defineProperty(x, 'tenantId', { enumerable: true, get() { reads++; return 't'; } });
  assert.throws(() => assessOrderStartVariance(x), /INERT_RECORD/);
  assert.equal(reads, 0);
});
test('plan revision cannot change after cross-source linkage', () => {
  const x = fixture(); let reads = 0;
  Object.defineProperty(x.plan, 'revision', { enumerable: true, get() { return ++reads <= 2 ? 'r1' : 'r2'; } });
  assert.throws(() => assessOrderStartVariance(x), /INERT_RECORD/);
  assert.equal(reads, 0);
});
test('actual source hash cannot change after validation and collision check', () => {
  const x = fixture(); let reads = 0;
  Object.defineProperty(x.actual, 'recordSha256', { enumerable: true, get() { return ++reads <= 2 ? B : C; } });
  assert.throws(() => assessOrderStartVariance(x), /INERT_RECORD/);
  assert.equal(reads, 0);
});
test('proxy traps on top-level and nested source records are not invoked', () => {
  for (const locate of [x => x, x => x.actual]) {
    const x = fixture(); let reads = 0;
    const raw = locate(x), proxy = new Proxy(raw, {
      get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); },
      getPrototypeOf(target) { reads++; return Reflect.getPrototypeOf(target); },
      ownKeys(target) { reads++; return Reflect.ownKeys(target); }
    });
    if (raw === x) assert.throws(() => assessOrderStartVariance(proxy), /INERT_RECORD/);
    else { x.actual = proxy; assert.throws(() => assessOrderStartVariance(x), /INERT_RECORD/); }
    assert.equal(reads, 0);
  }
});
test('non-enumerable accessor and symbol fields cannot be hidden on supplied records', () => {
  for (const mutate of [
    x => Object.defineProperty(x.plan, 'hidden', { get() { throw Error('executed'); } }),
    x => Object.defineProperty(x.actual, Symbol('foreign'), { value: 'x', enumerable: true })
  ]) {
    const x = fixture(); mutate(x);
    assert.throws(() => assessOrderStartVariance(x), /INERT_RECORD/);
  }
});
test('plain JSON, frozen and null-prototype data retain equivalent advisory output', () => {
  const original = fixture();
  const expected = assessOrderStartVariance(JSON.parse(JSON.stringify(original)));
  const frozen = fixture(); Object.freeze(frozen.plan); Object.freeze(frozen.actual); Object.freeze(frozen);
  const nullProto = fixture();
  nullProto.plan = Object.assign(Object.create(null), nullProto.plan);
  nullProto.actual = Object.assign(Object.create(null), nullProto.actual);
  const extra = fixture();
  Object.defineProperty(extra.plan, '__proto__', { value: 'literal', enumerable: true, writable: true, configurable: true });
  for (const input of [original, frozen, nullProto, extra]) {
    assert.deepEqual(assessOrderStartVariance(input), expected);
  }
  assert.equal(expected.sourceAuthenticated, false);
  assert.equal(expected.causeVerified, false);
  assert.equal(expected.costVerified, false);
  assert.equal(expected.scheduleAuthority, false);
  assert.equal(expected.executionAuthority, false);
});
test('ordinary malformed source chronology is still denied', () => {
  const x = fixture();
  x.actual.observedAt = '2026-10-28T10:20:00.000Z';
  assert.throws(() => assessOrderStartVariance(x), /INVALID_CHRONOLOGY/);
});
