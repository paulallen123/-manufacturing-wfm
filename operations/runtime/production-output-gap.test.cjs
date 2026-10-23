'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessProductionOutputGap } = require('./production-output-gap.cjs');

const scope = { tenantId: 'synthetic-tenant', siteId: 'site-1', lineId: 'line-1', productId: 'product-1', orderId: 'order-1' };
const window = { start: '2026-10-20T08:00:00Z', end: '2026-10-20T10:00:00Z' };
function input() {
  return { ...scope, asOf: '2026-10-20T11:00:00Z', window: { ...window },
    plan: { ...scope, window: { ...window }, sourceName: 'ERP_PLAN', revision: 'r2', digest: 'sha256:plan',
      observedAt: '2026-10-20T10:30:00Z', complete: true, evidenceRef: 'plan:order-1:r2', targetUnits: 120 },
    production: { ...scope, window: { ...window }, sourceName: 'MES_OUTPUT', revision: 'r5', digest: 'sha256:mes',
      observedAt: '2026-10-20T10:45:00Z', complete: true, evidenceRef: 'mes:order-1:r5', acceptedUnits: 90 } };
}

test('records a scoped planned-output gap without inventing cause or savings', () => {
  const result = assessProductionOutputGap(input());
  assert.equal(result.status, 'PLANNED_OUTPUT_GAP');
  assert.equal(result.gapUnits, 30);
  assert.deepEqual(result.evidenceRefs, ['plan:order-1:r2', 'mes:order-1:r5']);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.cause, null);
});

test('meeting or exceeding the plan does not report missed output', () => {
  const atTarget = input(); atTarget.production.acceptedUnits = 120;
  assert.equal(assessProductionOutputGap(atTarget).status, 'TARGET_MET');
  const above = input(); above.production.acceptedUnits = 125;
  const result = assessProductionOutputGap(above);
  assert.equal(result.gapUnits, 0);
  assert.equal(result.overPlanUnits, 5);
});

test('rejects scope, period, source and numeric evidence drift', () => {
  const mutations = [
    x => { x.plan.tenantId = 'other'; },
    x => { x.production.siteId = 'other'; },
    x => { x.production.orderId = 'other'; },
    x => { x.plan.window.end = '2026-10-20T09:00:00Z'; },
    x => { x.production.window.start = '2026-10-20T08:30:00Z'; },
    x => { x.plan.complete = false; },
    x => { x.production.observedAt = '2026-10-20T11:30:00Z'; },
    x => { x.plan.observedAt = '2026-10-20T09:30:00Z'; },
    x => { x.production.evidenceRef = x.plan.evidenceRef; },
    x => { x.plan.targetUnits = '120'; },
    x => { x.plan = Object.assign(Object.create({ targetUnits: 120 }), x.plan); delete x.plan.targetUnits; },
    x => { x.production.acceptedUnits = -1; },
    x => { x.production = Object.assign(Object.create({ acceptedUnits: 90 }), x.production); delete x.production.acceptedUnits; },
    x => { x.production.acceptedUnits = Number.MAX_SAFE_INTEGER + 1; },
    x => { x.window.end = '2026-02-30T10:00:00Z'; }
  ];
  for (const change of mutations) { const value = input(); change(value); assert.throws(() => assessProductionOutputGap(value)); }
});

test('rejects root and source accessors before validation or publication', () => {
  const activeAsOf = input();
  let asOfReads = 0;
  Object.defineProperty(activeAsOf, 'asOf', { enumerable: true, get() {
    return asOfReads++ === 0 ? '2026-10-20T11:00:00Z' : '2000-01-01T00:00:00Z';
  }});
  assert.throws(() => assessProductionOutputGap(activeAsOf));

  const activeObservedAt = input();
  let observationReads = 0;
  Object.defineProperty(activeObservedAt.plan, 'observedAt', { enumerable: true, get() {
    return observationReads++ === 0 ? '2026-10-20T10:30:00Z' : '2099-01-01T00:00:00Z';
  }});
  assert.throws(() => assessProductionOutputGap(activeObservedAt));
});

test('rejects source substitution after provenance validation', () => {
  const value = input();
  const validated = value.plan;
  const substituted = { ...validated, targetUnits: 9000 };
  let reads = 0;
  Object.defineProperty(value, 'plan', { enumerable: true, get() {
    return reads++ === 0 ? validated : substituted;
  }});
  assert.throws(() => assessProductionOutputGap(value));
});

test('rejects inherited requested scope and proxy envelopes', () => {
  const value = input();
  const inherited = Object.assign(Object.create({ tenantId: value.tenantId }), value);
  delete inherited.tenantId;
  assert.throws(() => assessProductionOutputGap(inherited));
  assert.throws(() => assessProductionOutputGap(new Proxy(input(), {})));
  const proxiedSource = input();
  proxiedSource.plan = new Proxy(proxiedSource.plan, {});
  assert.throws(() => assessProductionOutputGap(proxiedSource));
});

test('requires genuinely distinct plan and production source evidence', () => {
  const value = input();
  value.production.sourceName = value.plan.sourceName;
  value.production.revision = value.plan.revision;
  value.production.digest = value.plan.digest;
  assert.throws(() => assessProductionOutputGap(value));
});
