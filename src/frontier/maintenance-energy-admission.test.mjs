import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMaintenanceEnergySwap } from './maintenance-energy-admission.mjs';

const t = '2026-10-20T06:00:00.000Z';
function input() {
  return {
    now: t, tenantId: 'synthetic-tenant', siteId: 'synthetic-site',
    workOrder: { tenantId: 'synthetic-tenant', siteId: 'synthetic-site', assetId: 'asset-1', id: 'wo-1', revision: 3,
      status: 'OPEN', sourceName: 'CMMS', sourceDigest: 'sha256:fixture', observedAt: '2026-10-20T05:50:00.000Z',
      allowedStart: '2026-10-20T06:00:00.000Z', allowedEnd: '2026-10-20T10:00:00.000Z' },
    energySignal: { tenantId: 'synthetic-tenant', siteId: 'synthetic-site', status: 'active', revision: 2,
      type: 'turn_down', publishedAt: '2026-10-20T05:55:00.000Z', freshUntil: '2026-10-20T08:00:00.000Z',
      windowStart: '2026-10-20T06:00:00.000Z', windowEnd: '2026-10-20T08:00:00.000Z', confidence: 0.98 },
    process: { tenantId: 'synthetic-tenant', siteId: 'synthetic-site', flexibilityClass: 'shiftable',
      batchContinuityRequired: false, stateFresh: true, confidence: 0.95 },
    option: { id: 'swap-1', kind: 'maintenance_swap', tenantId: 'synthetic-tenant', siteId: 'synthetic-site',
      workOrderId: 'wo-1', workOrderRevision: 3, assetId: 'asset-1',
      proposedStart: '2026-10-20T06:30:00.000Z', proposedEnd: '2026-10-20T07:30:00.000Z',
      approvalRequired: true, shiftMinutes: 60,
      workforce: { staffingCount: 2, minimumStaffing: 1, restCompliant: true, qualificationsValid: true, confidence: 0.95 },
      energy: { grossSaving: 100, uncertaintyPct: 0.1 }, labour: { premiumCost: 10, upperBoundCost: 10 },
      production: { penaltyCost: 5, upperBoundPenalty: 5, hardServiceBreach: false, qualityRisk: 'acceptable' },
      scheduleChurnCost: 5, upperBoundScheduleChurnCost: 5 }
  };
}

test('binds a maintenance swap to one work order and reuses the energy engine', () => {
  const result = assessMaintenanceEnergySwap(input());
  assert.equal(result.status, 'ADVISORY');
  assert.equal(result.workOrderId, 'wo-1');
  assert.equal(result.optionId, 'swap-1');
  assert.equal(result.actionAuthority, false);
  assert.equal(result.sourceAuthenticated, false);
});

test('rejects foreign, stale, closed, revision-drifted and out-of-window evidence', () => {
  const mutations = [
    x => { x.workOrder.siteId = 'other'; },
    x => { x.workOrder.status = 'CLOSED'; },
    x => { x.option.workOrderRevision = 2; },
    x => { x.option.workOrderId = 'other'; },
    x => { x.option.assetId = 'other'; },
    x => { x.option.proposedEnd = '2026-10-20T08:30:00.000Z'; },
    x => { x.workOrder.allowedStart = '2026-10-20T07:00:00.000Z'; },
    x => { x.workOrder.observedAt = '2026-10-20T06:30:00.000Z'; },
    x => { x.workOrder.observedAt = '2026-10-20T05:00:00.000Z'; },
    x => { x.energySignal.windowStart = '2026-10-20T07:00:00.000Z'; },
    x => { x.energySignal.freshUntil = '2026-10-20T07:00:00.000Z'; },
    x => { x.option.proposedStart = '2026-10-20T05:30:00.000Z'; },
    x => { x.option.kind = 'shift_later'; },
    x => { x.option.approvalRequired = false; },
    x => { delete x.option.workforce; },
    x => { x.option.workforce.qualificationsValid = undefined; }
  ];
  for (const mutate of mutations) { const value = input(); mutate(value); assert.equal(assessMaintenanceEnergySwap(value).status, 'BLOCKED'); }
});

test('engine safety constraints remain controlling', () => {
  const value = input(); value.process.flexibilityClass = 'continuous';
  const result = assessMaintenanceEnergySwap(value);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('process_not_shiftable'));
});
