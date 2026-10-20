'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./quality-loss-cost-evidence.cjs');

const scope = { tenantId: 't1', siteId: 's1', workCentreId: 'wc1', productId: 'p1', orderId: 'o1' };
function fixture() {
  return { ...scope, windowStart: '2026-10-20T08:00:00.000Z', windowEnd: '2026-10-20T09:00:00.000Z',
    asOf: '2026-10-20T10:00:00.000Z', sourceKind: 'QMS', sourceId: 'qms1', sourceRevision: 'r1',
    complete: true, evidenceRef: 'qms:window:r1',
    events: [
      { ...scope, eventId: 'e1', kind: 'REWORK', sourceRevision: 'r1',
        occurredAt: '2026-10-20T08:15:00.000Z', observedAt: '2026-10-20T08:16:00.000Z',
        evidenceRef: 'qms:e1', recordSha256: 'a'.repeat(64), declaredCostPence: 1200 },
      { ...scope, eventId: 'e2', kind: 'SCRAP', sourceRevision: 'r1',
        occurredAt: '2026-10-20T08:30:00.000Z', observedAt: '2026-10-20T08:31:00.000Z',
        evidenceRef: 'qms:e2', recordSha256: 'b'.repeat(64), declaredCostPence: 300 }
    ] };
}

test('totals independently declared scoped QMS loss without asserting savings or source authentication', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'REVIEW_DECLARED_COST');
  assert.deepEqual(result.declaredCostPence, { rework: 1200, scrap: 300, total: 1500 });
  assert.equal(result.eventCount, 2);
  assert.deepEqual(result.eventEvidence.map(row => row.eventId), ['e1', 'e2']);
  assert.equal(result.eventEvidence[0].recordSha256, 'a'.repeat(64));
  assert.equal(result.sourceId, 'qms1');
  assert.equal(result.asOf, '2026-10-20T10:00:00.000Z');
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.executionAuthority, false);
});

test('complete empty window carries zero declared cost but no quality or savings claim', () => {
  const input = fixture(); input.events = [];
  const result = assess(input);
  assert.deepEqual(result.declaredCostPence, { rework: 0, scrap: 0, total: 0 });
  assert.equal(result.claimBoundary, 'SUPPLIED_QMS_AGGREGATE_ONLY');
});

test('foreign, incomplete, duplicate, private, malformed and future QMS records block', () => {
  const changes = [
    x => { x.complete = false; }, x => { x.events[0].tenantId = 'other'; },
    x => { x.events[0].orderId = 'other'; }, x => { x.events[0].sourceRevision = 'r2'; },
    x => { x.events[1].eventId = 'e1'; }, x => { x.events[1].evidenceRef = 'qms:e1'; },
    x => { x.events[1].recordSha256 = x.events[0].recordSha256; },
    x => { x.events[0].kind = 'DEFECT'; }, x => { x.events[0].employeeId = 'person'; },
    x => { x.events[0].declaredCostPence = -1; }, x => { x.events[0].declaredCostPence = 1.5; },
    x => { x.events[0].recordSha256 = 'bad'; },
    x => { x.events[0].occurredAt = x.windowEnd; },
    x => { x.events[0].observedAt = '2026-10-20T08:14:00.000Z'; },
    x => { x.events[0].observedAt = '2026-10-20T10:01:00.000Z'; },
    x => { x.windowEnd = '2026-10-20T08:00:00.000Z'; },
    x => { x.events[0].declaredCostPence = Number.MAX_SAFE_INTEGER; }
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.equal(assess(input).status, 'BLOCKED'); }
});
