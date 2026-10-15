'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMaintenanceProductionImpact } = require('./maintenance-production-impact.cjs');

const NOW = '2026-10-15T12:00:00Z';
function fixture() {
  return {
    tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1', now: NOW,
    workOrder: {
      id: 'wo-7', tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1', status: 'OPEN',
      sourceRevision: 'cmms-r2', evidenceRef: 'cmms:wo-7',
      observedAt: '2026-10-15T11:55:00Z', validUntil: '2026-10-15T15:00:00Z',
      plannedStart: '2026-10-15T13:00:00Z', plannedEnd: '2026-10-15T14:00:00Z',
    },
    window: { start: '2026-10-15T13:00:00Z', end: '2026-10-15T14:00:00Z' },
    production: {
      tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1',
      complete: true, sourceRevision: 'mes-r4', evidenceRef: 'mes:press-1:r4',
      observedAt: '2026-10-15T11:55:00Z', validUntil: '2026-10-15T15:00:00Z',
      runs: [
        { tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1', orderId: 'order-1', start: '2026-10-15T12:30:00Z', end: '2026-10-15T13:30:00Z' },
        { tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1', orderId: 'order-2', start: '2026-10-15T13:30:00Z', end: '2026-10-15T14:30:00Z' },
      ],
    },
  };
}

test('reports bounded planned production overlap without claiming lost output or savings', () => {
  const result = assessMaintenanceProductionImpact(fixture());
  assert.equal(result.status, 'ADVISORY_ONLY');
  assert.equal(result.overlapMinutes, 60);
  assert.deepEqual(result.affectedOrderIds, ['order-1', 'order-2']);
  assert.deepEqual(result.evidenceRefs, ['cmms:wo-7', 'mes:press-1:r4']);
  assert.equal(result.lostUnits, undefined);
  assert.equal(result.savings, undefined);
});

test('half-open boundaries do not create a production impact', () => {
  const input = fixture();
  input.production.runs = [{ tenantId: 'tenant-a', siteId: 'site-a', assetId: 'press-1', orderId: 'order-1', start: '2026-10-15T12:00:00Z', end: input.window.start }];
  const result = assessMaintenanceProductionImpact(input);
  assert.equal(result.status, 'ADVISORY_ONLY');
  assert.equal(result.overlapMinutes, 0);
  assert.deepEqual(result.affectedOrderIds, []);
});

test('foreign, stale or incomplete evidence cannot support an impact advisory', () => {
  const cases = [
    x => { x.workOrder.tenantId = 'tenant-b'; },
    x => { x.production.siteId = 'site-b'; },
    x => { x.production.complete = false; },
    x => { x.production.observedAt = '2026-10-15T11:30:00Z'; },
    x => { x.production.validUntil = '2026-10-15T13:30:00Z'; },
    x => { x.workOrder.status = 'CLOSED'; },
    x => { x.workOrder.plannedStart = '2026-10-15T16:00:00Z'; },
    x => { x.workOrder.plannedEnd = '2026-10-15T17:00:00Z'; },
    x => { x.workOrder.observedAt = '2026-10-15T11:30:00Z'; },
    x => { x.workOrder.validUntil = '2026-10-15T13:30:00Z'; },
    x => { x.production.runs[0].end = '2026-10-15T13:40:00Z'; },
    x => { x.production.runs[0].start = '2026-02-30T12:00:00Z'; },
    x => { x.production.runs[0].tenantId = 'tenant-b'; },
    x => { delete x.production.runs[0].assetId; },
  ];
  for (const alter of cases) {
    const input = fixture(); alter(input);
    const result = assessMaintenanceProductionImpact(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.overlapMinutes, undefined);
  }
});
