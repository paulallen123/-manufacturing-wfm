'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateMaintenancePartsCost } = require('./maintenance-parts-cost.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
function fixture() {
  const scope = { tenantId: 'tenant-1', siteId: 'site-1' };
  const workOrder = { ...scope, workOrderId: 'wo-1', state: 'OPEN', source: 'cmms', recordId: 'wo-1', revision: '2', recordSha256: A,
    eventAt: '2026-10-25T08:00:00.000Z', observedAt: '2026-10-25T08:01:00.000Z',
    requiredParts: [{ partId: 'bearing', quantity: 2 }, { partId: 'seal', quantity: 3 }] };
  const price = (partId, unitCostPence, hash) => ({ ...scope, partId, currency: 'GBP', unitCostPence,
    source: 'price-list', recordId: 'rate-' + partId, revision: '4', recordSha256: hash,
    effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2026-11-01T00:00:00.000Z', observedAt: '2026-10-25T08:02:00.000Z' });
  return { ...scope, workOrderId: 'wo-1', currency: 'GBP', asOf: '2026-10-25T10:00:00.000Z', workOrder,
    prices: [price('bearing', 2500, B), price('seal', 125, C)] };
}
test('declared exact-pence estimate has no stock, invoice, payroll or savings authority', () => {
  const r = estimateMaintenancePartsCost(fixture());
  assert.equal(r.declaredPlannedPartsCostPence, 5375);
  assert.equal(r.partLineCount, 2);
  assert.deepEqual(r.priceRecordSha256, [B, C]);
  for (const key of ['sourceAuthenticated', 'inventoryReserved', 'invoiceAuthority', 'payrollAuthority', 'executionAuthority']) assert.equal(r[key], false);
  assert.equal(Object.isFrozen(r.priceRecordSha256), true);
});
test('foreign, missing, duplicate and mismatched price evidence rejects', () => {
  const x = fixture();
  for (const change of [{ tenantId: 'other' }, { siteId: 'other' }, { currency: 'USD' },
    { partId: 'unrequired' }, { unitCostPence: -1 }, { unitCostPence: 1.5 },
    { effectiveTo: x.asOf }, { observedAt: '2026-10-26T00:00:00.000Z' }])
    assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [{ ...x.prices[0], ...change }, x.prices[1]] }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [x.prices[0]] }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [x.prices[0], x.prices[0]] }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [x.prices[0], { ...x.prices[1], recordSha256: B }] }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [{ ...x.prices[0], recordSha256: A }, x.prices[1]] }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, workOrder: { ...x.workOrder, requiredParts: [x.workOrder.requiredParts[0], x.workOrder.requiredParts[0]] } }));
});
test('order finality, chronology, quantity and overflow fail closed', () => {
  const x = fixture();
  for (const change of [{ state: 'CLOSED' }, { siteId: 'other' },
    { observedAt: '2026-10-26T00:00:00.000Z' }, { eventAt: '2026-02-30T00:00:00.000Z' }])
    assert.throws(() => estimateMaintenancePartsCost({ ...x, workOrder: { ...x.workOrder, ...change } }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, workOrder: { ...x.workOrder, requiredParts: [{ partId: 'bearing', quantity: 0 }, x.workOrder.requiredParts[1]] } }));
  assert.throws(() => estimateMaintenancePartsCost({ ...x, prices: [{ ...x.prices[0], unitCostPence: Number.MAX_SAFE_INTEGER }, x.prices[1]] }));
});
test('price cannot reuse the work-order source revision with contradictory bytes', () => {
  const x = fixture();
  const orderIdentity = Object.fromEntries(['source','recordId','revision'].map(k => [k,x.workOrder[k]]));
  for (const position of [0,1]) {
    const prices=x.prices.map((p,i)=>i===position?{...p,...orderIdentity}:p);
    assert.throws(()=>estimateMaintenancePartsCost({...x,prices}),/INVALID_PRICE/);
  }
});
test('structured source keys do not collapse distinct identities containing separators', () => {
  const x = fixture();
  x.prices[0]={...x.prices[0],source:'a\u0000b',recordId:'c',revision:'d'};
  x.prices[1]={...x.prices[1],source:'a',recordId:'b\u0000c',revision:'d'};
  assert.equal(estimateMaintenancePartsCost(x).declaredPlannedPartsCostPence,5375);
  x.workOrder={...x.workOrder,source:'a',recordId:'b',revision:'c\u0000d'};
  assert.equal(estimateMaintenancePartsCost(x).declaredPlannedPartsCostPence,5375);
  x.prices[1]={...x.prices[1],source:x.workOrder.source,recordId:x.workOrder.recordId,revision:x.workOrder.revision};
  assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);
});
test('source identity includes revision and preserves zero-valued price evidence', () => {
  const x = fixture();
  x.prices[0]={...x.prices[0],source:x.workOrder.source,recordId:x.workOrder.recordId,revision:'3',unitCostPence:0};
  const r=estimateMaintenancePartsCost(x);assert.equal(r.declaredPlannedPartsCostPence,375);
  assert.equal(r.sourceAuthenticated,false);assert.equal(r.executionAuthority,false);
  delete x.prices[0].unitCostPence;assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);
});
