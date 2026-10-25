'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { comparePublishedRosters } = require('./published-roster-revision-diff.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'alpha', siteId: 'factory-1', windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-03T00:00:00.000Z' };
  const slots = [
    { slotId: 's1', workerRef: 'opaque-1', start: '2026-11-01T08:00:00.000Z', end: '2026-11-01T16:00:00.000Z' },
    { slotId: 's2', workerRef: 'opaque-2', start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T16:00:00.000Z' }
  ];
  const before = { ...scope, source: 'schedule', recordId: 'roster', revision: '1', recordSha256: A, state: 'PUBLISHED', complete: true, publishedAt: '2026-10-30T08:00:00.000Z', observedAt: '2026-10-30T08:01:00.000Z', slots };
  const after = { ...before, revision: '2', recordSha256: B, previousRecordSha256: A, publishedAt: '2026-10-31T08:00:00.000Z', observedAt: '2026-10-31T08:01:00.000Z', slots: [{ ...slots[0], workerRef: 'opaque-3' }, { ...slots[1], start: '2026-11-02T09:00:00.000Z' }] };
  return { ...scope, asOf: '2026-10-31T10:00:00.000Z', before, after };
}
test('compares future published slots without disclosing worker identity or claiming savings', () => {
  const r = comparePublishedRosters(fixture());
  assert.deepEqual(r.changedSlots, [{ slotId: 's1', kind: 'ASSIGNMENT' }, { slotId: 's2', kind: 'TIME' }]);
  assert.equal(r.changedSlotCount, 2);
  assert.equal(JSON.stringify(r).includes('opaque-'), false);
  for (const key of ['sourceAuthenticated', 'completeSourceVerified', 'scheduleAuthority', 'payrollAuthority', 'executionAuthority']) assert.equal(r[key], false);
  assert.equal(Object.isFrozen(r.changedSlots), true);
});
test('added, removed, combined and unchanged slots are distinguished', () => {
  const x = fixture();
  x.after.slots = [{ ...x.before.slots[0], workerRef: null, start: '2026-11-01T09:00:00.000Z' },
    { slotId: 's3', workerRef: null, start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T18:00:00.000Z' }];
  assert.deepEqual(comparePublishedRosters(x).changedSlots, [
    { slotId: 's1', kind: 'ASSIGNMENT_AND_TIME' }, { slotId: 's2', kind: 'REMOVED' }, { slotId: 's3', kind: 'ADDED' }]);
  x.after.slots = x.before.slots.map(s => ({ ...s }));
  assert.equal(comparePublishedRosters(x).changedSlotCount, 0);
});
test('foreign, incomplete, unlinked, ambiguous and stale revisions reject', () => {
  const x = fixture();
  for (const change of [{ siteId: 'elsewhere' }, { complete: false }, { previousRecordSha256: B },
    { source: 'other' }, { revision: '1' }, { publishedAt: x.before.publishedAt },
    { observedAt: '2026-11-01T01:00:00.000Z' }, { recordSha256: A }])
    assert.throws(() => comparePublishedRosters({ ...x, after: { ...x.after, ...change } }));
  assert.throws(() => comparePublishedRosters({ ...x, before: { ...x.before, slots: [x.before.slots[0], x.before.slots[0]] } }));
});
test('past shifts, malformed instants and incomplete slot shapes reject', () => {
  const x = fixture();
  for (const change of [{ start: x.asOf }, { start: '2026-02-30T08:00:00.000Z' },
    { end: '2026-11-04T00:00:00.000Z' }, { workerRef: undefined }])
    assert.throws(() => comparePublishedRosters({ ...x, after: { ...x.after, slots: [{ ...x.after.slots[0], ...change }, x.after.slots[1]] } }));
});
