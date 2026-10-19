'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessIdleLabourExposure } = require('./idle-labour-exposure.cjs');

const base = () => ({
  tenantId: 'tenant-a', siteId: 'site-1', asOf: '2026-10-19T12:00:00Z',
  window: { start: '2026-10-19T08:00:00Z', end: '2026-10-19T10:00:00Z' },
  source: { name: 'WFM_STAFFING', revision: 'r1', digest: 'sha256:fixture', observedAt: '2026-10-19T11:00:00Z', complete: true },
  intervals: [
    { tenantId: 'tenant-a', siteId: 'site-1', start: '2026-10-19T08:00:00Z', end: '2026-10-19T09:00:00Z', assignedCount: 5, requiredCount: 3, evidenceRef: 'staffing:1' },
    { tenantId: 'tenant-a', siteId: 'site-1', start: '2026-10-19T09:00:00Z', end: '2026-10-19T10:00:00Z', assignedCount: 2, requiredCount: 4, evidenceRef: 'staffing:2' }
  ]
});

test('calculates only aggregate potential surplus and preserves shortfall separately', () => {
  const result = assessIdleLabourExposure(base());
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.potentialSurplusWorkerMinutes, 120);
  assert.equal(result.shortfallWorkerMinutes, 120);
  assert.deepEqual(result.evidenceRefs, ['staffing:1', 'staffing:2']);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
  assert.equal(result.actualIdleMinutes, undefined);
  assert.equal(result.estimatedSavings, undefined);
});

test('requires a complete contiguous scoped snapshot without duplicate evidence', () => {
  for (const change of [
    x => { x.source.complete = false; },
    x => { x.source = Object.create({ complete: true, name: 'WFM_STAFFING', revision: 'r1', digest: 'sha256:fixture', observedAt: '2026-10-19T11:00:00Z' }); },
    x => { x.intervals[1].tenantId = 'tenant-b'; },
    x => { x.intervals[1].start = '2026-10-19T09:30:00Z'; },
    x => { x.intervals[1].start = '2026-10-19T08:30:00Z'; },
    x => { x.intervals[1].evidenceRef = 'staffing:1'; },
    x => { x.intervals[0].assignedCount = '5'; },
    x => { x.intervals[0] = Object.assign(Object.create({ assignedCount: 5 }), { ...x.intervals[0], assignedCount: undefined }); delete x.intervals[0].assignedCount; },
    x => { x.intervals[0].requiredCount = -1; },
    x => { x.source.observedAt = '2026-10-19T13:00:00Z'; },
    x => { x.intervals[0].start = '2026-10-19T08:00:00'; },
    x => { x.intervals[0].start = '2026-10-19T08:00:00Z'; x.intervals[0].end = '2026-10-19T09:00:00Z'; x.intervals[1].end = '2026-10-19T10:01:00Z'; }
  ]) {
    const input = base(); change(input);
    assert.throws(() => assessIdleLabourExposure(input));
  }
});

test('zero surplus gives a clear result without worker identities', () => {
  const input = base(); input.intervals[0].assignedCount = 3;
  const result = assessIdleLabourExposure(input);
  assert.equal(result.status, 'NO_SURPLUS');
  assert.equal(result.potentialSurplusWorkerMinutes, 0);
  assert.equal(JSON.stringify(result).includes('workerId'), false);
});
