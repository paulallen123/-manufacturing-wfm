'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const assess = require('./corrective-maintenance-triage.cjs');

function fixture() {
  const scope = { tenantId: 't1', siteId: 's1', sourceRevision: 'r1' };
  const row = (id, due, severity = 'HIGH', status = 'OPEN') => ({ ...scope, id, assetId: 'asset1', kind: 'CORRECTIVE', status, severity,
    reportedAt: '2026-10-19T08:00:00.000Z', responseDueAt: due, observedAt: '2026-10-19T09:00:00.000Z', evidenceRef: `cmms:${id}:r1` });
  return seal({ tenantId: 't1', siteId: 's1', asOf: '2026-10-19T10:00:00.000Z',
    snapshot: { ...scope, complete: true, observedAt: '2026-10-19T09:00:00.000Z', validUntil: '2026-10-19T11:00:00.000Z', evidenceRef: 'cmms:window:r1' },
    workOrders: [row('late', '2026-10-19T09:30:00.000Z'), row('soon', '2026-10-19T10:30:00.000Z', 'CRITICAL'),
      row('later', '2026-10-19T14:00:00.000Z'), row('closed', '2026-10-19T09:00:00.000Z', 'HIGH', 'CLOSED')]
  });
}
function seal(x) {
  x.snapshot.contentDigest = createHash('sha256').update(JSON.stringify(x.workOrders.map(row =>
    Object.keys(row).sort().map(key => [key, row[key]])).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
  return x;
}

test('returns only overdue and approaching open corrective work for review', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'ASSESSED');
  assert.deepEqual(result.reviewQueue.map(x => [x.workOrderId, x.urgency]), [['late','OVERDUE'],['soon','DUE_SOON']]);
  assert.equal(result.openCount, 3);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.executionAuthority, false);
});

test('foreign, stale, duplicate, post-snapshot and malformed evidence blocks', () => {
  const invalid = [
    x => { x.snapshot.complete = false; }, x => { x.snapshot.siteId = 's2'; },
    x => { x.snapshot.validUntil = x.asOf; }, x => { x.workOrders[0].tenantId = 't2'; },
    x => { x.workOrders[0].sourceRevision = 'r2'; },
    x => { x.workOrders[0].observedAt = '2026-10-19T09:01:00.000Z'; },
    x => { x.workOrders[1].id = 'late'; }, x => { x.workOrders[0].responseDueAt = '2026-02-30T10:00:00.000Z'; },
    x => { x.workOrders[0].severity = 'constructor'; },
    x => { x.workOrders[0].severity = '__proto__'; },
    x => { x.workOrders[0].workerName = 'private'; }
  ];
  for (const change of invalid) { const x = fixture(); change(x); seal(x); assert.equal(assess(x).status, 'BLOCKED'); }
  const tampered = fixture(); tampered.workOrders[0].responseDueAt = '2026-10-19T12:00:00.000Z';
  assert.equal(assess(tampered).reason, 'SNAPSHOT_CONTENT_MISMATCH');
  const nullRow = fixture(); nullRow.workOrders = [null];
  assert.equal(assess(nullRow).status, 'BLOCKED');
});
