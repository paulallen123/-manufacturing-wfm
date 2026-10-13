'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assessMaintenanceReliability } = require('./maintenance-reliability-metrics.cjs');

const scope = { tenant: 'synthetic-tenant', site: 'synthetic-site' };
const window = { from: '2026-10-12T00:00:00.000Z', until: '2026-10-13T00:00:00.000Z' };
const source = 'synthetic-cmms';
function fixture() {
  return { scope, assetId: 'asset-1', now: '2026-10-13T00:10:00.000Z',
    window, maxEvidenceAgeMs: 3600000, expectedSource: source,
    snapshot: { id: 'window-1', ...scope, assetId: 'asset-1', window, complete: true,
      observedAt: '2026-10-13T00:05:00.000Z', revision: 'r1',
      provenance: { source, revision: 'r1', recordHash: 'a'.repeat(64) },
      events: [
        { id: 'failure-1', ...scope, assetId: 'asset-1', kind: 'UNPLANNED_FAILURE', source,
          revision: 'e1', recordHash: 'b'.repeat(64), startedAt: '2026-10-12T10:00:00.000Z',
          endedAt: '2026-10-12T10:30:00.000Z', rootCauseCode: 'bearing', rootCauseEvidenceRef: 'inspection-1' },
        { id: 'failure-2', ...scope, assetId: 'asset-1', kind: 'UNPLANNED_FAILURE', source,
          revision: 'e2', recordHash: 'c'.repeat(64), startedAt: '2026-10-12T11:00:00.000Z',
          endedAt: '2026-10-12T11:15:00.000Z' }
      ] } };
}

test('aggregates complete CMMS window with scoped evidence and no inferred rate or cost', () => {
  const result = assessMaintenanceReliability(fixture());
  assert.equal(result.status, 'METRICS_ADVISORY');
  assert.deepEqual(result.scope, { ...scope, assetId: 'asset-1' });
  assert.deepEqual(result.metrics, { unplannedFailureCount: 2, unplannedDowntimeMinutes: 45 });
  assert.equal(result.evidence.events[0].rootCauseEvidenceRef, 'inspection-1');
  assert.equal(result.evidence.events[1].rootCauseCode, null);
  assert.equal(result.executionAuthority, false);
  assert.equal('mtbf' in result.metrics, false);
});

test('complete empty window yields zero, rather than unknown', () => {
  const value = fixture(); value.snapshot.events = [];
  assert.deepEqual(assessMaintenanceReliability(value).metrics,
    { unplannedFailureCount: 0, unplannedDowntimeMinutes: 0 });
});

for (const [name, mutate, blocker] of [
  ['incomplete window', v => { v.snapshot.complete = false; }, 'CMMS_WINDOW_UNPROVEN'],
  ['foreign snapshot site', v => { v.snapshot.site = 'other'; }, 'CMMS_WINDOW_UNPROVEN'],
  ['wrong source', v => { v.snapshot.provenance.source = 'synthetic-erp'; }, 'CMMS_WINDOW_UNPROVEN'],
  ['revision mismatch', v => { v.snapshot.provenance.revision = 'r2'; }, 'CMMS_WINDOW_UNPROVEN'],
  ['stale snapshot', v => { v.snapshot.observedAt = '2026-10-12T23:00:00.000Z'; }, 'CMMS_WINDOW_UNPROVEN'],
  ['missing event list', v => { delete v.snapshot.events; }, 'CMMS_WINDOW_UNPROVEN'],
  ['foreign event site', v => { v.snapshot.events[0].site = 'other'; }, 'FAILURE_EVENT_UNPROVEN'],
  ['planned work mislabeled as failure', v => { v.snapshot.events[0].kind = 'PLANNED_MAINTENANCE'; }, 'FAILURE_EVENT_UNPROVEN'],
  ['event outside window', v => { v.snapshot.events[0].endedAt = '2026-10-13T01:00:00.000Z'; }, 'FAILURE_EVENT_UNPROVEN'],
  ['duplicate event', v => { v.snapshot.events[1].id = 'failure-1'; }, 'FAILURE_EVENT_UNPROVEN'],
  ['overlapping events', v => { v.snapshot.events[1].startedAt = '2026-10-12T10:20:00.000Z'; }, 'OVERLAPPING_FAILURE_EVENTS']
]) {
  test(`blocks ${name}`, () => {
    const value = fixture(); mutate(value);
    const result = assessMaintenanceReliability(value);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes(blocker));
    assert.equal(result.metrics, null);
    assert.equal(result.evidence, null);
  });
}

test('source cause code without evidence reference is not shown as an evidenced cause', () => {
  const value = fixture(); delete value.snapshot.events[0].rootCauseEvidenceRef;
  const result = assessMaintenanceReliability(value);
  assert.equal(result.status, 'METRICS_ADVISORY');
  assert.equal(result.evidence.events[0].rootCauseCode, null);
});
