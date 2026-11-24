'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPublishedShiftResponse } = require('./published-shift-response-evidence.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'tenant-a', siteId: 'site-a', shiftId: 'shift-a', slotId: 'slot-a', workerRef: 'opaque-1', windowStart: '2026-11-01T08:00:00.000Z', windowEnd: '2026-11-01T16:00:00.000Z' };
  const published = { ...scope, source: 'schedule', recordId: 'plan-1', revision: 'v2', recordSha256: A, eventAt: '2026-10-31T08:00:00.000Z', observedAt: '2026-10-31T08:01:00.000Z', state: 'PUBLISHED' };
  const response = { ...scope, source: 'employee-response', recordId: 'reply-1', revision: 'v1', recordSha256: B, publishedRecordSha256: A, eventAt: '2026-10-31T09:00:00.000Z', observedAt: '2026-10-31T09:01:00.000Z', state: 'ACKNOWLEDGED' };
  return { ...scope, asOf: '2026-10-31T10:00:00.000Z', published, response };
}
test('exact published revision and scoped response yield advisory acknowledgement only', () => {
  const x = fixture(), result = assessPublishedShiftResponse(x);
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(result.responseRecordSha256, B);
  assert.equal(result.workerRef, undefined);
  for (const key of ['sourceAuthenticated', 'scheduleAuthority', 'attendanceAuthority', 'payrollAuthority', 'decisionAuthority']) assert.equal(result[key], false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(assessPublishedShiftResponse({ ...x, response: { ...x.response, state: 'DECLINED' } }).status, 'DECLINED');
});
test('absence of a response remains unknown and grants no action', () => {
  const x = fixture();
  assert.equal(assessPublishedShiftResponse({ ...x, response: null }).status, 'UNKNOWN');
});
test('wrong tenant, site, shift, slot, worker, window, revision link or response rejects', () => {
  const x = fixture();
  for (const key of ['tenantId', 'siteId', 'shiftId', 'slotId', 'workerRef', 'windowStart', 'windowEnd']) {
    assert.throws(() => assessPublishedShiftResponse({ ...x, response: { ...x.response, [key]: 'foreign' } }));
    assert.throws(() => assessPublishedShiftResponse({ ...x, published: { ...x.published, [key]: 'foreign' } }));
  }
  for (const change of [{ publishedRecordSha256: B }, { state: 'ACCEPTED' }, { recordSha256: A }, { source: 'schedule', recordId: 'plan-1' }])
    assert.throws(() => assessPublishedShiftResponse({ ...x, response: { ...x.response, ...change } }));
});
test('late, future, rolled dates and stale chronology reject', () => {
  const x = fixture();
  for (const change of [{ eventAt: x.windowStart }, { observedAt: '2026-11-01T09:00:00.000Z' }, { eventAt: '2026-10-31T07:00:00.000Z' }, { eventAt: '2026-02-30T09:00:00.000Z' }])
    assert.throws(() => assessPublishedShiftResponse({ ...x, response: { ...x.response, ...change } }));
  assert.throws(() => assessPublishedShiftResponse({ ...x, published: { ...x.published, observedAt: '2026-11-01T09:00:00.000Z' } }));
});
