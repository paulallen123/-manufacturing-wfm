import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicaliseMeterIntervals, priceIndustrialElectricity, reconcileEnergyBill } from '../../src/frontier/energy-bill-evidence.mjs';

const tariff = {
  tenantId:'t1', siteId:'s1', meterPointId:'MPAN-1', timeZone:'Europe/London',
  standingChargePencePerDay:100,
  unitRates:[
    {id:'offpeak',startHour:0,endHour:7,pencePerKWh:10},
    {id:'peak',startHour:7,endHour:19,pencePerKWh:30},
    {id:'night',startHour:19,endHour:24,pencePerKWh:15}
  ]
};
const read=(start,kWh,extra={})=>({
  tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',start,kWh,
  source:{provider:'authorised-hh-feed',revision:'r1',revisionSequence:1},...extra
});

test('uses GB local time so BST does not misprice a half-hour',()=>{
  const p=priceIndustrialElectricity({tariff,intervals:[read('2026-09-18T06:30:00Z',10)],billingPeriod:{start:'2026-09-18',end:'2026-09-19'}});
  assert.equal(p.status,'priced'); assert.equal(p.energyGBP,3); assert.equal(p.pricedIntervals[0].rateId,'peak');
});

test('winter UTC and summer BST resolve to different tariff bands correctly',()=>{
  const s=priceIndustrialElectricity({tariff,intervals:[read('2026-09-18T06:30:00Z',10)],billingPeriod:{start:'2026-09-18',end:'2026-09-19'}});
  const w=priceIndustrialElectricity({tariff,intervals:[read('2026-12-18T06:30:00Z',10)],billingPeriod:{start:'2026-12-18',end:'2026-12-19'}});
  assert.equal(s.energyGBP,3); assert.equal(w.energyGBP,1);
});

test('uses the latest ordered meter revision and drops exact replay duplicates',()=>{
  const c=canonicaliseMeterIntervals([
    read('2026-09-18T08:00:00Z',10),
    read('2026-09-18T08:00:00Z',9,{source:{provider:'authorised-hh-feed',revision:'r2',revisionSequence:2}}),
    read('2026-09-18T08:30:00Z',4), read('2026-09-18T08:30:00Z',4)
  ]);
  assert.equal(c.status,'ok'); assert.equal(c.intervals.length,2); assert.equal(c.intervals[0].kWh,9);
  assert.equal(c.revisionsApplied,1); assert.equal(c.duplicatesDropped,1);
});

test('fails closed on conflicting same-revision reads',()=>{
  const p=priceIndustrialElectricity({tariff,intervals:[read('2026-09-18T08:00:00Z',10),read('2026-09-18T08:00:00Z',11)]});
  assert.equal(p.status,'unpriced'); assert.match(p.errors[0],/conflicting_same_revision/);
});

test('fails closed when the meter point does not match the tariff',()=>{
  const p=priceIndustrialElectricity({tariff,intervals:[read('2026-09-18T08:00:00Z',10,{meterPointId:'MPAN-X'})]});
  assert.equal(p.status,'unpriced'); assert.equal(p.errors[0],'meter_point_mismatch:0');
});

test('models explicit CCL-style per-kWh and maximum-demand charges without hardcoding customer rates',()=>{
  const t={...tariff,chargeComponents:[
    {id:'ccl',type:'per_kwh',ratePencePerKWh:0.801},
    {id:'capacity',type:'max_demand_gbp_per_kw',rateGBPPerKw:2}
  ]};
  const p=priceIndustrialElectricity({tariff:t,intervals:[read('2026-09-18T08:00:00Z',10,{kW:50})],billingPeriod:{start:'2026-09-18',end:'2026-09-19'}});
  assert.equal(p.status,'priced'); assert.equal(Number(p.knownCostGBP.toFixed(4)),104.0801);
});

test('refuses exact spend when half-hourly coverage is incomplete',()=>{
  const invoice={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',billingPeriod:{start:'2026-09-18',end:'2026-09-19'},totalBeforeTaxGBP:4,unpricedCharges:[]};
  const r=reconcileEnergyBill({tariff,intervals:[read('2026-09-18T08:00:00Z',10)],invoice,meterCoverage:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',complete:false,expectedIntervals:48}});
  assert.equal(r.status,'needs_review'); assert.equal(r.exactSpendClaimAllowed,false);
});

test('allows exact spend only when meter, tariff, invoice and ledger reconcile',()=>{
  const invoice={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',billingPeriod:{start:'2026-09-18',end:'2026-09-19'},totalBeforeTaxGBP:4,unpricedCharges:[]};
  const ledger={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',postedAmountGBP:4};
  const r=reconcileEnergyBill({tariff,intervals:[read('2026-09-18T08:00:00Z',10)],invoice,ledgerEntry:ledger,meterCoverage:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',complete:true,expectedIntervals:1}});
  assert.equal(r.status,'reconciled'); assert.equal(r.exactSpendClaimAllowed,true); assert.equal(r.financeReconciled,true);
});

function reconciliation(overrides={}) {
  return reconcileEnergyBill({
    tariff, intervals:[read('2026-09-18T08:00:00Z',10)],
    invoice:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',billingPeriod:{start:'2026-09-18',end:'2026-09-19'},totalBeforeTaxGBP:4,unpricedCharges:[]},
    ledgerEntry:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',postedAmountGBP:4},
    meterCoverage:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',complete:true,expectedIntervals:1}, ...overrides
  });
}

test('foreign or unbound ledger cannot finance-reconcile an exact meter bill',()=>{
  for (const change of [
    {tenantId:'foreign'}, {siteId:'foreign'}, {meterPointId:'foreign'}, {meterPointId:undefined}
  ]) {
    const result=reconciliation({ledgerEntry:{tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',postedAmountGBP:4,...change}});
    assert.equal(result.status,'unreconciled');
    assert.equal(result.reason,'ledger_identity_mismatch');
    assert.notEqual(result.financeReconciled,true);
  }
});

test('malformed invoice, ledger and tolerance values cannot produce exact spend',()=>{
  const invoice={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',billingPeriod:{start:'2026-09-18',end:'2026-09-19'},totalBeforeTaxGBP:4,unpricedCharges:[]};
  const ledger={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',postedAmountGBP:4};
  for (const amount of [null,'4',NaN,Infinity,-1]) {
    const invalidInvoice=reconciliation({invoice:{...invoice,totalBeforeTaxGBP:amount}});
    assert.equal(invalidInvoice.status,'unreconciled');
    assert.equal(invalidInvoice.reason,'invalid_invoice_total');
    const invalidLedger=reconciliation({ledgerEntry:{...ledger,postedAmountGBP:amount}});
    assert.equal(invalidLedger.status,'unreconciled');
    assert.equal(invalidLedger.reason,'invalid_ledger_amount');
  }
  for (const toleranceGBP of [null,'0.01',NaN,Infinity,-0.01,1]) {
    const result=reconciliation({toleranceGBP});
    assert.equal(result.status,'unreconciled');
    assert.equal(result.reason,'invalid_tolerance');
  }
});

test('missing and rolled invoice billing periods cannot omit standing charges from exact spend',()=>{
  for (const billingPeriod of [undefined,{start:'2026-02-30',end:'2026-03-02'},
    {start:'2026-09-19',end:'2026-09-18'}]) {
    const invoice={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',billingPeriod,totalBeforeTaxGBP:3,unpricedCharges:[]};
    const result=reconciliation({invoice,ledgerEntry:undefined});
    assert.equal(result.status,'unreconciled');
    assert.equal(result.reason,'invalid_billing_period');
    assert.notEqual(result.exactSpendClaimAllowed,true);
  }
});

test('foreign and coerced meter coverage cannot establish an exact bill',()=>{
  const coverage={tenantId:'t1',siteId:'s1',meterPointId:'MPAN-1',complete:true,expectedIntervals:1};
  for (const change of [{tenantId:'foreign'},{siteId:'foreign'},{meterPointId:'foreign'},
    {expectedIntervals:'1'},{expectedIntervals:1.5},{expectedIntervals:null}]) {
    const result=reconciliation({meterCoverage:{...coverage,...change}});
    assert.equal(result.status,'unreconciled');
    assert.equal(result.reason,'meter_coverage_invalid');
    assert.notEqual(result.exactSpendClaimAllowed,true);
  }
});
