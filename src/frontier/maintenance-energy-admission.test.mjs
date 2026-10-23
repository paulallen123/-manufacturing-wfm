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
    process: { tenantId: 'synthetic-tenant', siteId: 'synthetic-site', assetId: 'asset-1',
      workOrderId: 'wo-1', workOrderRevision: 3, revision: 4,
      sourceName: 'MES', sourceDigest: 'sha256:process-fixture', observedAt: '2026-10-20T05:52:00.000Z',
      flexibilityClass: 'shiftable', batchContinuityRequired: false, stateFresh: true, confidence: 0.95 },
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
    [x => { x.workOrder.siteId = 'other'; }, 'source_scope_mismatch'],
    [x => { x.workOrder.status = 'CLOSED'; }, 'work_order_not_current'],
    [x => { x.option.workOrderRevision = 2; }, 'work_order_binding_mismatch'],
    [x => { x.option.workOrderId = 'other'; }, 'work_order_binding_mismatch'],
    [x => { x.option.assetId = 'other'; }, 'work_order_binding_mismatch'],
    [x => { x.option.proposedEnd = '2026-10-20T08:30:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.workOrder.allowedStart = '2026-10-20T07:00:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.workOrder.observedAt = '2026-10-20T06:30:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.workOrder.observedAt = '2026-10-20T05:00:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.energySignal.windowStart = '2026-10-20T07:00:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.energySignal.freshUntil = '2026-10-20T07:00:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.option.proposedStart = '2026-10-20T05:30:00.000Z'; }, 'invalid_or_out_of_window_evidence'],
    [x => { x.option.kind = 'shift_later'; }, 'work_order_binding_mismatch'],
    [x => { x.option.approvalRequired = false; }, 'work_order_binding_mismatch'],
    [x => { delete x.option.workforce; }, 'workforce_evidence_incomplete'],
    [x => { x.option.workforce.qualificationsValid = undefined; }, 'workforce_evidence_incomplete']
  ];
  for (const [mutate, reason] of mutations) {
    const value = input(); mutate(value);
    const result = assessMaintenanceEnergySwap(value);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, [reason]);
  }
});

test('rejects malformed, non-finite and out-of-range confidence evidence before engine evaluation', () => {
  const invalid = [NaN, Infinity, -0.01, 1.01, '0.95'];
  const setConfidence = [
    (value, confidence) => { value.energySignal.confidence = confidence; },
    (value, confidence) => { value.process.confidence = confidence; },
    (value, confidence) => { value.option.workforce.confidence = confidence; }
  ];
  for (const assign of setConfidence) for (const confidence of invalid) {
    const value = input(); assign(value, confidence);
    const result = assessMaintenanceEnergySwap(value);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['confidence_evidence_invalid']);
  }
});

test('rejects accessor and proxy evidence that can drift after validation', () => {
  const mutations = [
    value => {
      let reads = 0;
      Object.defineProperty(value.process, 'confidence', { enumerable: true,
        get() { reads += 1; return reads === 1 ? 0.95 : 'not-a-number'; } });
    },
    value => {
      let reads = 0;
      Object.defineProperty(value.process, 'assetId', { enumerable: true,
        get() { reads += 1; return reads === 1 ? 'asset-1' : 'asset-2'; } });
    },
    value => {
      let reads = 0;
      value.option.workforce = new Proxy(value.option.workforce, {
        get(target, property, receiver) {
          if (property === 'confidence') { reads += 1; return reads === 1 ? 0.95 : 'not-a-number'; }
          return Reflect.get(target, property, receiver);
        }
      });
    }
  ];
  for (const mutate of mutations) {
    const value = input(); mutate(value);
    const result = assessMaintenanceEnergySwap(value);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['invalid_evidence_shape']);
  }
});

test('translates malformed object leaves into a fail-closed result', () => {
  const mutations = [
    value => { value.option.energy.grossSaving = {}; },
    value => { value.option.shiftMinutes = {}; }
  ];
  for (const mutate of mutations) {
    const value = input(); mutate(value);
    assert.doesNotThrow(() => assessMaintenanceEnergySwap(value));
    const result = assessMaintenanceEnergySwap(value);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['invalid_evidence_shape']);
  }
});

test('requires current process evidence bound to the maintained asset and work order', () => {
  const mutations = [
    [x => { x.process.assetId = 'asset-2'; }, 'process_binding_mismatch'],
    [x => { x.process.workOrderId = 'wo-2'; }, 'process_binding_mismatch'],
    [x => { x.process.workOrderRevision = 2; }, 'process_binding_mismatch'],
    [x => { x.process.revision = 0; }, 'process_evidence_not_current'],
    [x => { x.process.sourceName = ''; }, 'process_evidence_not_current'],
    [x => { x.process.sourceDigest = ''; }, 'process_evidence_not_current'],
    [x => { delete x.process.observedAt; }, 'process_evidence_not_current'],
    [x => { x.process.observedAt = '2026-10-20T06:01:00.000Z'; }, 'process_evidence_not_current'],
    [x => { x.process.observedAt = '2026-10-20T05:40:00.000Z'; }, 'process_evidence_not_current']
  ];
  for (const [mutate, reason] of mutations) {
    const value = input(); mutate(value);
    const result = assessMaintenanceEnergySwap(value);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, [reason]);
  }
});

test('engine safety constraints remain controlling', () => {
  const value = input(); value.process.flexibilityClass = 'continuous';
  const result = assessMaintenanceEnergySwap(value);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('process_not_shiftable'));
});
