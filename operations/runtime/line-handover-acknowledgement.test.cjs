'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessLineHandoverAcknowledgement } = require('./line-handover-acknowledgement.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'synthetic', siteId: 'site-1', lineId: 'line-1', handoverId: 'handover-1' };
  return { ...scope, asOf: '2026-10-28T10:20:00.000Z', handoverAt: '2026-10-28T10:00:00.000Z', maxAgeMinutes: 60,
    outgoing: { ...scope, source: 'MES', recordId: 'out-1', revision: 'r1', recordSha256: A, complete: true,
      state: 'PUBLISHED', shiftId: 'shift-A', eventAt: '2026-10-28T09:55:00.000Z', observedAt: '2026-10-28T09:56:00.000Z', openIssueIds: ['opaque-b', 'opaque-a'] },
    incoming: { ...scope, source: 'MES', recordId: 'in-1', revision: 'r1', recordSha256: B, complete: true,
      state: 'ACKNOWLEDGED', shiftId: 'shift-B', eventAt: '2026-10-28T10:05:00.000Z', observedAt: '2026-10-28T10:06:00.000Z',
      outgoingRecordSha256: A, outgoingRevision: 'r1', acknowledgedIssueIds: ['opaque-b'] } };
}
test('reports unacknowledged source issue IDs without resolution or action claims', () => {
  const x = assessLineHandoverAcknowledgement(fixture());
  assert.equal(x.status, 'ACKNOWLEDGEMENT_GAP');
  assert.deepEqual(x.unacknowledgedIssueIds, ['opaque-a']);
  assert.equal(x.issueResolved, false); assert.equal(x.sourceAuthenticated, false);
  assert.equal(x.executionAuthority, false);
  const complete = fixture(); complete.incoming.acknowledgedIssueIds.push('opaque-a');
  assert.equal(assessLineHandoverAcknowledgement(complete).status, 'DECLARED_ACKNOWLEDGED');
  const noOpen = fixture(); noOpen.outgoing.openIssueIds = []; noOpen.incoming.acknowledgedIssueIds = [];
  assert.equal(assessLineHandoverAcknowledgement(noOpen).openIssueCount, 0);
});
test('rejects foreign, stale, incomplete, replayed, and contradictory handover evidence', () => {
  const mutations = [
    x => { x.incoming.siteId = 'foreign'; }, x => { x.outgoing.source = 'WFM'; },
    x => { x.outgoing.complete = false; }, x => { x.incoming.outgoingRevision = 'r2'; },
    x => { x.outgoing.state = 'DRAFT'; }, x => { x.incoming.state = 'CANCELLED'; },
    x => { x.incoming.outgoingRecordSha256 = B; }, x => { x.incoming.recordSha256 = A; },
    x => { x.incoming.shiftId = 'shift-A'; }, x => { x.incoming.acknowledgedIssueIds = ['unknown']; },
    x => { x.incoming.recordId = x.outgoing.recordId; x.incoming.revision = x.outgoing.revision; },
    x => { x.outgoing.openIssueIds.push('opaque-a'); },
    x => { x.incoming.observedAt = '2026-10-28T10:21:00.000Z'; },
    x => { x.outgoing.observedAt = '2026-10-28T09:00:00.000Z'; },
    x => { x.incoming.eventAt = '2026-10-28T09:59:00.000Z'; },
    x => { x.outgoing.eventAt = '2026-10-28T10:01:00.000Z'; },
    x => { x.outgoing.observedAt = '2026-10-28T10:07:00.000Z'; }
  ];
  for (const mutate of mutations) { const x = fixture(); mutate(x); assert.throws(() => assessLineHandoverAcknowledgement(x)); }
});
