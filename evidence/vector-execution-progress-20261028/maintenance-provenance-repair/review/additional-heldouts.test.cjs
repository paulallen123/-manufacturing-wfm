'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateMaintenancePartsCost } = require('../operations/runtime/maintenance-parts-cost.cjs');
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

test('independent exact order identity rejected at either price position, for ASCII Unicode and control characters',()=>{
 for(const identity of [['cmms','wo-1','2'],['a\u0000b','c','d'],['日本語','pièce-ä','r\\1'],['[a]','"b"','c,d']]) for(const position of [0,1]){
  const x=fixture();for(const [i,key] of ['source','recordId','revision'].entries()){x.workOrder[key]=identity[i];x.prices[position][key]=identity[i];}
  assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);
 }
});
test('independent tuple boundaries and revisions remain distinct from work-order and each other',()=>{
 const families=[[['a\u0000b','c','d'],['a','b\u0000c','d'],['a','b','c\u0000d']],[['[a]','b,c','d'],['[a],b','c','d'],['[a]','b','c,d']]];
 for(const family of families){const x=fixture();[x.workOrder,...x.prices].forEach((r,i)=>['source','recordId','revision'].forEach((k,j)=>r[k]=family[i][j]));assert.equal(estimateMaintenancePartsCost(x).declaredPlannedPartsCostPence,5375);}
 for(const differingField of ['source','recordId','revision']){const x=fixture();for(const k of ['source','recordId','revision'])x.prices[0][k]=x.workOrder[k];x.prices[0][differingField]+='-distinct';assert.equal(estimateMaintenancePartsCost(x).declaredPlannedPartsCostPence,5375);}
});
test('independent original work-order hash and price-hash collision defenses survive tuple repair',()=>{
 for(const pos of [0,1]){const x=fixture();x.prices[pos].recordSha256=x.workOrder.recordSha256;assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);}
 const x=fixture();x.prices[1].recordSha256=x.prices[0].recordSha256;assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);
});
test('independent valid zero, declared authority and input/output boundaries remain intact',()=>{
 const x=fixture();x.prices[0].unitCostPence=0;const before=JSON.stringify(x),r=estimateMaintenancePartsCost(x);assert.equal(r.declaredPlannedPartsCostPence,375);assert.equal(JSON.stringify(x),before);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.priceRecordSha256));
 for(const flag of ['sourceAuthenticated','inventoryReserved','invoiceAuthority','payrollAuthority','executionAuthority'])assert.equal(r[flag],false);
 delete x.prices[0].unitCostPence;assert.throws(()=>estimateMaintenancePartsCost(x),/INVALID_PRICE/);
});
