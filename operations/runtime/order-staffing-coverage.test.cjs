'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSchedulingPlan, digest } = require('./manufacturing-scheduling-engine.cjs');
const { assessOrderStaffingCoverage } = require('./order-staffing-coverage.cjs');

const start = '2026-10-24T12:00:00Z', end = '2026-10-24T20:00:00Z';
function fixture(headcount = 2) {
  const plan = { ...createSchedulingPlan({
    tenant: 'synthetic-tenant', contextRevision: 'synthetic-r1', createdAt: '2026-10-24T10:30:00Z',
    sourceEvidence: ['synthetic-order-r1'], policy: { minRestHours: 11, ruleVersion: 'synthetic-policy-r1' },
    workers: [{ id: 'worker-a', homeSite: 'site-a', eligibleSites: ['site-a'], skills: ['weld'],
      availability: [{ start: '2026-10-24T11:00:00Z', end: '2026-10-24T21:00:00Z' }] }],
    requirements: [{ id: 'order-requirement-a', site: 'site-a', line: 'line-1', role: 'welder',
      start, end, headcount, requiredSkills: ['weld'] }]
  }) };
  return {
    tenantId: 'synthetic-tenant', siteId: 'site-a', lineId: 'line-1', orderId: 'order-1',
    asOf: '2026-10-24T11:00:00Z',
    orderSource: { tenantId: 'synthetic-tenant', siteId: 'site-a', lineId: 'line-1', orderId: 'order-1',
      name: 'MES_ORDERS', revision: 'synthetic-r1', digest: 'sha256:synthetic-order', complete: true,
      observedAt: '2026-10-24T10:00:00Z', window: { start, end }, requirementIds: ['order-requirement-a'] },
    plan
  };
}
function reseal(plan) {
  const { planId: _id, createdAt: _createdAt, ...identity } = plan;
  plan.planId = digest(identity);
}

test('binds an actual scheduler shadow plan gap to one order and line', () => {
  const result = assessOrderStaffingCoverage(fixture());
  assert.equal(result.status, 'SHADOW_PLAN_REPORTED_GAP');
  assert.equal(result.requiredSlots, 2);
  assert.equal(result.filledSlots, 1);
  assert.equal(result.gapSlots, 1);
  assert.deepEqual(result.gapRequirementIds, ['order-requirement-a']);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
  assert.equal(result.executionPermitted, false);
});

test('a fully filled plan remains reported coverage, without action authority', () => {
  const result = assessOrderStaffingCoverage(fixture(1));
  assert.equal(result.status, 'SHADOW_PLAN_REPORTED_COVERED');
  assert.equal(result.filledSlots, 1);
  assert.equal(result.gapSlots, 0);
});

test('rejects foreign, stale, incomplete and missing order evidence', () => {
  const mutations = [
    x => { x.orderSource.complete = false; },
    x => { x.orderSource.tenantId = 'other'; },
    x => { x.orderSource.siteId = 'other'; },
    x => { x.orderSource.lineId = 'other'; },
    x => { x.orderSource.orderId = 'other'; },
    x => { x.orderSource.observedAt = '2026-10-24T11:30:00Z'; },
    x => { x.asOf = '2026-10-24T09:00:00Z'; },
    x => { x.orderSource.requirementIds = ['missing']; },
    x => { x.orderSource.requirementIds.push('order-requirement-a'); },
    x => { x.orderSource.window.end = '2026-02-30T20:00:00Z'; },
    x => { x.plan.planId = '0'.repeat(64); },
    x => { x.plan.validation.valid = false; reseal(x.plan); },
    x => { x.plan.assignments.pop(); reseal(x.plan); },
    x => { x.plan.assignments[0].site = 'other'; reseal(x.plan); },
    x => { x.plan.assignments[0].slotId = 'order-requirement-a#01'; reseal(x.plan); },
    x => { x.plan.assignments[0].workerId = 0; reseal(x.plan); },
    x => { x.plan.requirements[0].line = 'other'; reseal(x.plan); }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => assessOrderStaffingCoverage(input));
  }
});

test('rejects accessor-backed and sparse requirement IDs', () => {
  const accessor = fixture();
  Object.defineProperty(accessor.orderSource, 'complete', { get() { throw Error('accessor ran'); } });
  assert.throws(() => assessOrderStaffingCoverage(accessor), /own data field/);
  const sparse = fixture(); sparse.orderSource.requirementIds.length = 2;
  assert.throws(() => assessOrderStaffingCoverage(sparse), /explicit data entries/);
});
