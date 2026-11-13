import test from 'node:test';
import assert from 'node:assert/strict';
import {priceIntervals,reconcileActualSpend,measureEnergyOutcome,recommendEnergyDataRoutes} from '../../src/frontier/energy-data-reconciliation.mjs';

const tariff={tenantId:'t1',siteId:'s1',currency:'GBP',tariffType:'time_of_use',source:{provider:'supplier-contract',evidenceType:'signed_contract'},standingChargePerDay:100,unitRates:[
{id:'offpeak',startHour:0,endHour:7,pencePerKWh:10},
{id:'peak',startHour:7,endHour:19,pencePerKWh:30},
{id:'night',startHour:19,endHour:24,pencePerKWh:15}
]};
const meter=(start,kWh)=>({tenantId:'t1',siteId:'s1',start,kWh,source:{provider:'hh-meter',revision:'r1'}});

test('prices half-hourly usage against the actual tariff structure',()=>{
  const out=priceIntervals({tariff,intervals:[meter('2026-09-18T06:00:00Z',10),meter('2026-09-18T08:00:00Z',10),meter('2026-09-18T20:00:00Z',10)]});
  assert.equal(out.status,'priced');
  assert.equal(out.totalKWh,30);
  assert.equal(out.variableGBP,5.5);
  assert.equal(out.standingGBP,1);
  assert.equal(out.knownCostGBP,6.5);
});

test('reconciles calculated meter/tariff cost to invoice and ERP posting',()=>{
  const intervals=[meter('2026-09-18T08:00:00Z',10)];
  const out=reconcileActualSpend({tariff,meterIntervals:intervals,invoice:{tenantId:'t1',siteId:'s1',totalBeforeTaxGBP:4,knownExtras:[],unpricedCharges:[]},ledgerEntry:{tenantId:'t1',siteId:'s1',postedAmountGBP:4},toleranceGBP:0.001});
  assert.equal(out.status,'reconciled');
  assert.equal(out.exactSpendClaimAllowed,true);
});

test('blocks exact-spend claim when invoice contains charges we cannot price',()=>{
  const intervals=[meter('2026-09-18T08:00:00Z',10)];
  const out=reconcileActualSpend({tariff,meterIntervals:intervals,invoice:{tenantId:'t1',siteId:'s1',totalBeforeTaxGBP:5,knownExtras:[],unpricedCharges:['capacity_charge']},ledgerEntry:{tenantId:'t1',siteId:'s1',postedAmountGBP:5}});
  assert.equal(out.status,'needs_review');
  assert.equal(out.exactSpendClaimAllowed,false);
});

test('separates usage reduction, avoided tariff cost and flexibility revenue',()=>{
  const baseline=[meter('2026-09-18T08:00:00Z',20)];
  const actual=[meter('2026-09-18T06:00:00Z',15)];
  const recon={status:'reconciled',exactSpendClaimAllowed:true,invoiceBeforeTaxGBP:2.5};
  const out=measureEnergyOutcome({tariff,baselineIntervals:baseline,actualIntervals:actual,actualSpendReconciliation:recon,flexibilityRevenueGBP:2,baselineMethod:{method:'production_normalised_counterfactual',evidenceId:'baseline-1'}});
  assert.equal(out.status,'invoice_reconciled');
  assert.equal(out.usageReductionKWh,5);
  assert.equal(out.avoidedEnergyCostGBP,4.5);
  assert.equal(out.flexibilityRevenueGBP,2);
  assert.equal(out.totalOperationalEnergyValueGBP,6.5);
  assert.equal(out.actualInvoiceSpendGBP,2.5);
});

test('does not claim savings without a documented counterfactual baseline',()=>{
  const intervals=[meter('2026-09-18T08:00:00Z',10)];
  const out=measureEnergyOutcome({tariff,baselineIntervals:intervals,actualIntervals:intervals});
  assert.equal(out.status,'unverified');
});

test('data route hierarchy prioritises authoritative supplier, meter and finance feeds',()=>{
  const out=recommendEnergyDataRoutes({country:'GB'});
  assert.equal(out.routes[0].data,'tariff_and_contract');
  assert.equal(out.routes[1].data,'half_hourly_usage');
  assert.equal(out.routes[2].data,'actual_spend');
  assert.ok(out.routes[1].future.includes('consented_smart_data_repository'));
});

test('refuses unsupported tariff currencies before producing GBP prices',()=>{
  const intervals=[meter('2026-09-18T08:00:00Z',10)];
  for(const currency of ['EUR','USD','gbp',' GBP ']){
    const out=priceIntervals({tariff:{...tariff,currency},intervals});
    assert.deepEqual(out,{status:'unpriced',errors:['unsupported_currency']},currency);
  }
});

test('does not reconcile a non-GBP tariff with a numerically matching GBP invoice',()=>{
  const intervals=[meter('2026-09-18T08:00:00Z',10)];
  for(const currency of ['EUR','USD']){
    const out=reconcileActualSpend({tariff:{...tariff,currency},meterIntervals:intervals,
      invoice:{tenantId:'t1',siteId:'s1',totalBeforeTaxGBP:4},
      ledgerEntry:{tenantId:'t1',siteId:'s1',postedAmountGBP:4}});
    assert.equal(out.status,'unreconciled',currency);
    assert.equal(out.reason,'meter_or_tariff_unpriced');
    assert.deepEqual(out.details,{status:'unpriced',errors:['unsupported_currency']});
    assert.notEqual(out.exactSpendClaimAllowed,true);
  }
});

test('does not measure GBP energy value from a non-GBP tariff',()=>{
  for(const currency of ['EUR','USD']){
    const out=measureEnergyOutcome({tariff:{...tariff,currency},
      baselineIntervals:[meter('2026-09-18T08:00:00Z',20)],
      actualIntervals:[meter('2026-09-18T06:00:00Z',15)],
      actualSpendReconciliation:{status:'reconciled',exactSpendClaimAllowed:true,invoiceBeforeTaxGBP:2.5},
      flexibilityRevenueGBP:2,
      baselineMethod:{method:'production_normalised_counterfactual',evidenceId:'baseline-1'}});
    assert.deepEqual(out,{status:'unverified',reason:'baseline_or_actual_unpriced'},currency);
  }
});
