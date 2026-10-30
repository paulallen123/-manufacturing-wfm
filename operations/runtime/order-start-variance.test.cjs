'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOrderStartVariance } = require('./order-start-variance.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'synthetic-tenant', siteId: 'site-1', lineId: 'line-1', orderId: 'order-1' };
  return { ...scope, asOf: '2026-10-28T11:30:00.000Z', maxAgeMinutes: 120,
    plan: { ...scope, source: 'ERP', recordId: 'plan-1', revision: 'r1', recordSha256: A,
      observedAt: '2026-10-28T09:30:00.000Z', complete: true, state: 'PUBLISHED',
      plannedStart: '2026-10-28T10:00:00.000Z', plannedEnd: '2026-10-28T12:00:00.000Z' },
    actual: { ...scope, source: 'MES', recordId: 'actual-1', revision: 'r1', recordSha256: B,
      observedAt: '2026-10-28T10:45:00.000Z', complete: true, state: 'STARTED',
      plannedRevision: 'r1', plannedRecordSha256: A, actualStart: '2026-10-28T10:30:00.000Z' } };
}
test('reports only declared exact-order start variance and no cause or value claim', () => {
  const x = assessOrderStartVariance(fixture());
  assert.equal(x.status, 'STARTED_LATE'); assert.equal(x.startVarianceMinutes, 30);
  assert.equal(x.sourceAuthenticated, false); assert.equal(x.causeVerified, false);
  assert.equal(x.costVerified, false); assert.equal(x.executionAuthority, false);
  const early = fixture(); early.actual.actualStart = '2026-10-28T09:50:00.000Z';
  assert.equal(assessOrderStartVariance(early).startVarianceMinutes, -10);
  const onTime = fixture(); onTime.actual.actualStart = onTime.plan.plannedStart;
  assert.equal(assessOrderStartVariance(onTime).status, 'ON_TIME');
  const sourceLocalIds = fixture(); sourceLocalIds.actual.recordId = sourceLocalIds.plan.recordId;
  assert.equal(assessOrderStartVariance(sourceLocalIds).status, 'STARTED_LATE');
});
test('rejects foreign, stale, incomplete, and contradictory source evidence', () => {
  for (const mutate of [
    x => { x.actual.tenantId = 'other'; }, x => { x.actual.orderId = 'other'; },
    x => { x.plan.observedAt = '2026-10-28T09:29:59.000Z'; },
    x => { x.actual.observedAt = '2026-10-28T11:31:00.000Z'; },
    x => { x.plan.complete = false; }, x => { x.actual.complete = false; },
    x => { x.actual.plannedRevision = 'r2'; }, x => { x.actual.plannedRecordSha256 = B; },
    x => { x.actual.recordSha256 = A; }, x => { x.actual.actualStart = '2026-10-28T10:45:01.000Z'; },
    x => { x.plan.observedAt = '2026-10-28T10:31:00.000Z'; },
    x => { x.actual.actualStart = '2026-10-28T11:00:00.000Z'; x.actual.observedAt = '2026-10-28T10:45:00.000Z'; }
  ]) { const x = fixture(); mutate(x); assert.throws(() => assessOrderStartVariance(x)); }
});
