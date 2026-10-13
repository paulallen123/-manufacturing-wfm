'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assessPreventiveMaintenanceDue } = require('./preventive-maintenance-due.cjs');

const now = '2026-10-13T14:00:00.000Z';
const scope = { tenant: 'synthetic-tenant', site: 'synthetic-site' };
const provenance = { source: 'synthetic-cmms', recordHash: 'a'.repeat(64) };
function fixture() {
  return { scope, now, maxEvidenceAgeMs: 3600000,
    asset: { id: 'asset-1', ...scope, type: 'MACHINE', state: 'OPERABLE', observedAt: now, provenance },
    plan: { id: 'plan-1', assetId: 'asset-1', ...scope, status: 'ACTIVE', revision: 'r1',
      observedAt: now, provenance, nextDueAt: '2026-10-13T13:00:00.000Z',
      lastCompletedAt: '2026-10-01T12:00:00.000Z', effectiveUntil: '2026-10-14T00:00:00.000Z' } };
}

test('due source-owned plan yields advisory without a work order', () => {
  const result = assessPreventiveMaintenanceDue(fixture());
  assert.equal(result.status, 'DUE_ADVISORY');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.workOrderCreated, false);
});

test('future due date yields not-due advisory', () => {
  const value = fixture();
  value.plan.nextDueAt = '2026-10-13T15:00:00.000Z';
  assert.equal(assessPreventiveMaintenanceDue(value).status, 'NOT_DUE_ADVISORY');
});

for (const [name, mutate, blocker] of [
  ['foreign plan site', v => { v.plan.site = 'other'; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['stale plan', v => { v.plan.observedAt = '2026-10-13T12:00:00.000Z'; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['future observation', v => { v.asset.observedAt = '2026-10-13T15:00:00.000Z'; }, 'ASSET_EVIDENCE_UNPROVEN'],
  ['asset mismatch', v => { v.plan.assetId = 'asset-2'; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['completed after due', v => { v.plan.lastCompletedAt = '2026-10-13T13:30:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['completion newer than plan observation', v => { v.plan.observedAt = '2026-10-13T13:00:00.000Z'; v.plan.lastCompletedAt = '2026-10-13T13:30:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['expired plan', v => { v.plan.effectiveUntil = '2026-10-13T13:00:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['due beyond plan window', v => { v.plan.nextDueAt = '2026-10-15T00:00:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['unknown asset type', v => { v.asset.type = 'CASH'; }, 'ASSET_EVIDENCE_UNPROVEN'],
  ['inactive plan', v => { v.plan.status = 'RETIRED'; }, 'PREVENTIVE_PLAN_UNPROVEN']
]) {
  test(`blocks ${name}`, () => {
    const value = fixture(); mutate(value);
    const result = assessPreventiveMaintenanceDue(value);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes(blocker));
  });
}
