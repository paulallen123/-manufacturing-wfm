import test from 'node:test';
import assert from 'node:assert/strict';
const {reconcileEnergyBill}=await import(process.env.REVIEW_ENERGY_MODULE||'./pr520/src/frontier/energy-bill-evidence.mjs');
function fixture(){const scope={tenantId:'synthetic-t',siteId:'synthetic-s',meterPointId:'synthetic-m'};return {tariff:{...scope,timeZone:'UTC',standingChargePencePerDay:100,unitRates:[{id:'flat',pencePerKWh:30}]},intervals:[{...scope,start:'2026-09-18T08:00:00Z',kWh:10,source:{provider:'synthetic-meter',revision:'r1',revisionSequence:1}}],invoice:{...scope,billingPeriod:{start:'2026-09-18',end:'2026-09-19'},totalBeforeTaxGBP:4,unpricedCharges:[]},ledgerEntry:{...scope,postedAmountGBP:4},meterCoverage:{...scope,complete:true,expectedIntervals:1}};}
test('independent current exact declared fixture remains stable',()=>{assert.equal(reconcileEnergyBill(fixture()).financeReconciled,true);});
test('meter read outside invoice billing period cannot support exact finance claim',()=>{const x=fixture();x.intervals[0].start='2026-08-18T08:00:00Z';assert.notEqual(reconcileEnergyBill(x).financeReconciled,true);});
test('missing consumption cannot be coerced into exact zero consumption claim',()=>{const x=fixture();x.intervals[0].kWh=null;x.invoice.totalBeforeTaxGBP=1;x.ledgerEntry.postedAmountGBP=1;assert.notEqual(reconcileEnergyBill(x).financeReconciled,true);});
