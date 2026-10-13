'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assessPreventiveMaintenanceDue } = require('./preventive-maintenance-due.cjs');

const now = '2026-10-13T14:00:00.000Z';
const scope = { tenant: 'synthetic-tenant', site: 'synthetic-site' };
const provenance = { source: 'synthetic-cmms', revision: 'r1', recordHash: 'a'.repeat(64) };
function fixture() {
  return { scope, now, maxEvidenceAgeMs: 3600000,
    sourceBinding: { assetSource: 'synthetic-cmms', planSource: 'synthetic-cmms' },
    asset: { id: 'asset-1', ...scope, type: 'MACHINE', state: 'OPERABLE', revision: 'r1',
      observedAt: now, provenance, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: '2026-12-31T23:59:59.000Z' },
    plan: { id: 'plan-1', assetId: 'asset-1', ...scope, status: 'ACTIVE', revision: 'r1',
      observedAt: now, provenance, nextDueAt: '2026-10-13T13:00:00.000Z',
      lastCompletedAt: '2026-10-01T12:00:00.000Z', effectiveFrom: '2026-10-01T00:00:00.000Z',
      effectiveUntil: '2026-10-14T00:00:00.000Z' } };
}

test('due source-owned plan yields advisory without a work order', () => {
  const result = assessPreventiveMaintenanceDue(fixture());
  assert.equal(result.status, 'DUE_ADVISORY');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.workOrderCreated, false);
  assert.equal(result.evidence.plan.id, 'plan-1');
  assert.equal(result.evidence.plan.revision, 'r1');
  assert.equal(result.evidence.plan.nextDueAt, '2026-10-13T13:00:00.000Z');
  assert.deepEqual(result.scope, scope);
  assert.equal(result.evaluatedAt, now);
  assert.equal(result.evidence.asset.effectiveFrom, '2026-01-01T00:00:00.000Z');
  assert.ok(Object.isFrozen(result.scope));
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
  ['inactive plan', v => { v.plan.status = 'RETIRED'; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['future-effective plan', v => { v.plan.effectiveFrom = '2026-10-14T00:00:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['future-effective asset', v => { v.asset.effectiveFrom = '2026-10-14T00:00:00.000Z'; }, 'PLAN_TIMELINE_UNPROVEN'],
  ['wrong configured plan source', v => { v.plan.provenance = { ...provenance, source: 'synthetic-erp' }; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['missing source binding', v => { delete v.sourceBinding; }, 'PREVENTIVE_PLAN_UNPROVEN'],
  ['mismatched source revision', v => { v.plan.provenance = { ...provenance, revision: 'r0' }; }, 'PREVENTIVE_PLAN_UNPROVEN']
]) {
  test(`blocks ${name}`, () => {
    const value = fixture(); mutate(value);
    const result = assessPreventiveMaintenanceDue(value);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes(blocker));
    assert.equal(result.evidence, null);
  });
}
