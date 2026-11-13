'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessTrainingShiftCollision } = require('./training-shift-collision.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'tenant-a', siteId: 'site-a', workerRef: 'opaque-1' };
  const publishedShift = { ...scope, shiftId: 'shift-a', slotId: 'slot-a', source: 'schedule', recordId: 'plan-a', revision: '2', recordSha256: A,
    state: 'PUBLISHED', start: '2026-11-01T08:00:00.000Z', end: '2026-11-01T16:00:00.000Z',
    eventAt: '2026-10-31T08:00:00.000Z', observedAt: '2026-10-31T08:01:00.000Z' };
  const trainingSession = { ...scope, sessionId: 'training-a', source: 'lms', recordId: 'session-a', revision: '1', recordSha256: B,
    state: 'CONFIRMED', attendanceRequired: true, start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T12:00:00.000Z',
    eventAt: '2026-10-31T09:00:00.000Z', observedAt: '2026-10-31T09:01:00.000Z' };
  return { ...scope, asOf: '2026-10-31T10:00:00.000Z', publishedShift, trainingSession };
}
test('bounded training and published shift overlap is advisory and hides worker reference', () => {
  const r = assessTrainingShiftCollision(fixture());
  assert.equal(r.status, 'DECLARED_CONFLICT');
  assert.equal(r.declaredOverlapMinutes, 120);
  assert.equal(r.workerRef, undefined);
  for (const key of ['sourceAuthenticated', 'rosterCompleteVerified', 'scheduleAuthority', 'trainingAuthority', 'payrollAuthority', 'executionAuthority']) assert.equal(r[key], false);
  assert.equal(Object.isFrozen(r), true);
});
test('touching boundaries have no declared overlap, without claiming full availability', () => {
  const x = fixture();
  const r = assessTrainingShiftCollision({ ...x, trainingSession: { ...x.trainingSession, start: x.publishedShift.end, end: '2026-11-01T18:00:00.000Z' } });
  assert.equal(r.status, 'NO_DECLARED_OVERLAP');
  assert.equal(r.declaredOverlapMinutes, 0);
  assert.equal(r.rosterCompleteVerified, false);
});
test('foreign identity, incomplete state and reused source evidence reject', () => {
  const x = fixture();
  for (const key of ['tenantId', 'siteId', 'workerRef']) {
    assert.throws(() => assessTrainingShiftCollision({ ...x, trainingSession: { ...x.trainingSession, [key]: 'other' } }));
    assert.throws(() => assessTrainingShiftCollision({ ...x, publishedShift: { ...x.publishedShift, [key]: 'other' } }));
  }
  for (const change of [{ attendanceRequired: false }, { state: 'PLANNED' }, { source: 'schedule' }, { recordSha256: A }])
    assert.throws(() => assessTrainingShiftCollision({ ...x, trainingSession: { ...x.trainingSession, ...change } }));
  assert.throws(() => assessTrainingShiftCollision({ ...x, publishedShift: { ...x.publishedShift, state: 'DRAFT' } }));
});
test('past, future, rolled and inverted evidence times reject', () => {
  const x = fixture();
  for (const change of [{ start: x.asOf }, { observedAt: '2026-11-02T00:00:00.000Z' },
    { eventAt: '2026-11-01T11:00:00.000Z' }, { start: '2026-02-30T10:00:00.000Z' },
    { end: x.trainingSession.start }])
    assert.throws(() => assessTrainingShiftCollision({ ...x, trainingSession: { ...x.trainingSession, ...change } }));
});

test('active root scope and receipt selectors reject without invoking getters', () => {
  for (const key of ['tenantId', 'siteId', 'workerRef', 'asOf', 'publishedShift', 'trainingSession']) {
    const x = fixture(); let reads = 0; const value = x[key];
    Object.defineProperty(x, key, { enumerable: true, get() { reads++; return value; } });
    assert.throws(() => assessTrainingShiftCollision(x));
    assert.equal(reads, 0, key);
  }
});
test('active receipt fields reject before a value can change after validation', () => {
  for (const kind of ['publishedShift', 'trainingSession']) {
    for (const key of Object.keys(fixture()[kind])) {
      const x = fixture(); let reads = 0; const value = x[kind][key];
      Object.defineProperty(x[kind], key, { enumerable: true, get() { reads++; return reads === 1 ? value : 'unvalidated'; } });
      assert.throws(() => assessTrainingShiftCollision(x));
      assert.equal(reads, 0, kind + '.' + key);
    }
  }
});
test('frozen accessor receipts remain active and must reject without invocation', () => {
  const x = fixture(); let reads = 0;
  Object.defineProperty(x.publishedShift, 'recordSha256', { enumerable: true, get() { return ++reads <= 2 ? A : 'not-a-hash'; } });
  Object.freeze(x.publishedShift); Object.freeze(x);
  assert.throws(() => assessTrainingShiftCollision(x));
  assert.equal(reads, 0);
});
test('proxy roots and receipt records reject without running traps', () => {
  for (const key of [null, 'publishedShift', 'trainingSession']) {
    const x = fixture(); let traps = 0;
    const wrapped = new Proxy(key ? x[key] : x, {
      get(target, prop, receiver) { traps++; return Reflect.get(target, prop, receiver); },
      ownKeys(target) { traps++; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, prop) { traps++; return Reflect.getOwnPropertyDescriptor(target, prop); },
      getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); }
    });
    if (key) x[key] = wrapped;
    assert.throws(() => assessTrainingShiftCollision(key ? x : wrapped));
    assert.equal(traps, 0);
  }
});
test('inherited scope and active extra fields cannot enter validated records', () => {
  const inherited = fixture();
  inherited.trainingSession = Object.create(inherited.trainingSession);
  assert.throws(() => assessTrainingShiftCollision(inherited));
  const x = fixture(); let reads = 0;
  Object.defineProperty(x.trainingSession, 'displayNote', { enumerable: true, get() { reads++; return 'note'; } });
  assert.throws(() => assessTrainingShiftCollision(x));
  assert.equal(reads, 0);
});
test('plain JSON, null-prototype data and ignored extra data retain ordinary behavior', () => {
  const x = fixture(); const expected = assessTrainingShiftCollision(x);
  assert.deepEqual(assessTrainingShiftCollision(JSON.parse(JSON.stringify(x))), expected);
  x.displayNote = 'ignored'; x.publishedShift.displayNote = { nested: ['plain', 1, null] };
  assert.deepEqual(assessTrainingShiftCollision(x), expected);
  const asNull = value => Object.assign(Object.create(null), value);
  assert.deepEqual(assessTrainingShiftCollision(asNull({ ...x, publishedShift: asNull(x.publishedShift), trainingSession: asNull(x.trainingSession) })), expected);
});
