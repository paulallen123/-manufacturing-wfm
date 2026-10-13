'use strict';

// Advisory read model for a CMMS-owned preventive plan. It does not calculate
// a new due date, create a work order, or change asset/production authority.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/i;
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}
function id(value) { return typeof value === 'string' && ID.test(value); }
function currentEvidence(value, scope, now, age) {
  const observed = instant(value?.observedAt);
  return value && id(value.id) && value.tenant === scope.tenant && value.site === scope.site
    && id(value.provenance?.source) && HASH.test(value.provenance?.recordHash || '')
    && observed !== null && observed <= now && now - observed <= age;
}

function assessPreventiveMaintenanceDue(input) {
  const scope = input?.scope || {};
  const now = instant(input?.now);
  const age = input?.maxEvidenceAgeMs;
  if (!id(scope.tenant) || !id(scope.site) || now === null
      || !Number.isSafeInteger(age) || age < 1 || age > 86400000) {
    throw new Error('Exact scope, UTC evaluation time and bounded evidence age required.');
  }
  const blockers = [];
  const asset = input.asset;
  const plan = input.plan;
  if (!currentEvidence(asset, scope, now, age) || asset.type !== 'MACHINE'
      || !['OPERABLE', 'MAINTENANCE_REQUIRED'].includes(asset.state)) {
    blockers.push('ASSET_EVIDENCE_UNPROVEN');
  }
  if (!currentEvidence(plan, scope, now, age) || plan.assetId !== asset?.id
      || plan.status !== 'ACTIVE' || !id(plan.revision)) {
    blockers.push('PREVENTIVE_PLAN_UNPROVEN');
  }
  const due = instant(plan?.nextDueAt);
  const completed = plan?.lastCompletedAt == null ? null : instant(plan.lastCompletedAt);
  const effectiveUntil = instant(plan?.effectiveUntil);
  if (due === null || effectiveUntil === null || effectiveUntil < now
      || (due !== null && effectiveUntil !== null && due > effectiveUntil)
      || (plan?.lastCompletedAt != null && completed === null)
      || (completed !== null && (completed > due || completed > now || completed > instant(plan?.observedAt)))) {
    blockers.push('PLAN_TIMELINE_UNPROVEN');
  }
  return Object.freeze({
    contractVersion: 'VECTOR_PREVENTIVE_MAINTENANCE_DUE_V1',
    status: blockers.length ? 'BLOCKED' : now >= due ? 'DUE_ADVISORY' : 'NOT_DUE_ADVISORY',
    blockers: Object.freeze(blockers),
    executionAuthority: false,
    workOrderCreated: false,
    claimBoundary: 'Source-owned plan and asset records require independent authentication; this read model cannot authorise or perform maintenance.'
  });
}

module.exports = { assessPreventiveMaintenanceDue };
