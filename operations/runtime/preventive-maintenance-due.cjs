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
function currentEvidence(value, scope, now, age, expectedSource) {
  const observed = instant(value?.observedAt);
  return value && id(value.id) && value.tenant === scope.tenant && value.site === scope.site
    && id(expectedSource) && value.provenance?.source === expectedSource
    && id(value.revision) && value.provenance?.revision === value.revision
    && HASH.test(value.provenance?.recordHash || '')
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
  const sources = input.sourceBinding || {};
  const assetValid = currentEvidence(asset, scope, now, age, sources.assetSource)
    && asset.type === 'MACHINE'
    && ['OPERABLE', 'MAINTENANCE_REQUIRED'].includes(asset.state);
  if (!assetValid) {
    blockers.push('ASSET_EVIDENCE_UNPROVEN');
  }
  const planValid = currentEvidence(plan, scope, now, age, sources.planSource)
    && plan.assetId === asset?.id && plan.status === 'ACTIVE';
  if (!planValid) {
    blockers.push('PREVENTIVE_PLAN_UNPROVEN');
  }
  const due = instant(plan?.nextDueAt);
  const completed = plan?.lastCompletedAt == null ? null : instant(plan.lastCompletedAt);
  const assetFrom = instant(asset?.effectiveFrom);
  const assetUntil = instant(asset?.effectiveUntil);
  const effectiveFrom = instant(plan?.effectiveFrom);
  const effectiveUntil = instant(plan?.effectiveUntil);
  if (due === null || assetFrom === null || assetUntil === null
      || effectiveFrom === null || effectiveUntil === null
      || assetFrom > now || assetUntil < now || assetFrom > assetUntil
      || effectiveFrom > now || effectiveUntil < now || effectiveFrom > effectiveUntil
      || (due !== null && effectiveFrom !== null && due < effectiveFrom)
      || (due !== null && effectiveUntil !== null && due > effectiveUntil)
      || (plan?.lastCompletedAt != null && completed === null)
      || (completed !== null && (completed > due || completed > now || completed > instant(plan?.observedAt)))) {
    blockers.push('PLAN_TIMELINE_UNPROVEN');
  }
  const supported = blockers.length === 0;
  const evidence = supported ? Object.freeze({
    asset: Object.freeze({ id: asset.id, revision: asset.revision, source: asset.provenance.source,
      recordHash: asset.provenance.recordHash, observedAt: asset.observedAt,
      effectiveFrom: asset.effectiveFrom, effectiveUntil: asset.effectiveUntil }),
    plan: Object.freeze({ id: plan.id, revision: plan.revision, source: plan.provenance.source,
      recordHash: plan.provenance.recordHash, observedAt: plan.observedAt,
      effectiveFrom: plan.effectiveFrom, effectiveUntil: plan.effectiveUntil,
      nextDueAt: plan.nextDueAt })
  }) : null;
  return Object.freeze({
    contractVersion: 'VECTOR_PREVENTIVE_MAINTENANCE_DUE_V1',
    scope: Object.freeze({ tenant: scope.tenant, site: scope.site }),
    evaluatedAt: input.now,
    status: supported ? (now >= due ? 'DUE_ADVISORY' : 'NOT_DUE_ADVISORY') : 'BLOCKED',
    blockers: Object.freeze(blockers),
    evidence,
    executionAuthority: false,
    workOrderCreated: false,
    claimBoundary: 'Source-owned plan and asset records require independent authentication; this read model cannot authorise or perform maintenance.'
  });
}

module.exports = { assessPreventiveMaintenanceDue };
