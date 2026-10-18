'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {forecastDemand,toHeadcountForecast}=require('./manufacturing-demand-forecast.cjs');
function obs(values){return values.map((value,i)=>({at:new Date(Date.UTC(2026,8,1+i)).toISOString(),value,evidenceRef:'mes:'+i}));}
test('forecast ensemble returns p50 p90 confidence and model evidence',()=>{const f=forecastDemand({observations:obs([10,11,10,12,11,13,12,14,13,15,14,16]),horizonPeriods:3,seasonLength:4});assert.equal(f.steps.length,3);assert.ok(f.steps.every(x=>x.p90>=x.p50));assert.ok(f.confidence>0&&f.confidence<=0.95);assert.ok(f.models.length>=3);assert.equal(f.claimBoundary,'FORECAST_BASELINE_NOT_CUSTOMER_ACCURACY_PROOF');});
test('planned evidence-backed adjustment changes demand',()=>{const a=forecastDemand({observations:obs([10,10,10,10,10,10]),horizonPeriods:1});const b=forecastDemand({observations:obs([10,10,10,10,10,10]),horizonPeriods:1,adjustments:[{type:'PERCENT',value:20,evidenceRef:'erp:order-spike'}]});assert.ok(b.steps[0].p50>a.steps[0].p50);assert.ok(b.adjustmentEvidence.includes('erp:order-spike'));});
test('translates production units into headcount with p90 preserved',()=>{const f=forecastDemand({observations:obs([800,820,780,850,830,860]),horizonPeriods:1});const h=toHeadcountForecast({forecast:f,unitsPerLabourHour:20,shiftHours:8});assert.ok(h.steps[0].p90Headcount>=h.steps[0].p50Headcount);assert.equal(h.claimBoundary,'CAPACITY_TRANSLATION_REQUIRES_CUSTOMER_VALIDATED_RATE');});
test('a malformed demand observation rejects the complete forecast batch',()=>{
  for(const value of ['9',true,-1,NaN,Infinity]){
    assert.throws(()=>forecastDemand({observations:obs([10,11,12,13,value])}),/Invalid demand observation/);
  }
});
test('genuine zero demand remains valid and counted',()=>{
  const f=forecastDemand({observations:obs([0,1,0,1,0])});
  assert.equal(f.historyCount,5);
  assert.equal(f.sourceEvidence.length,5);
});
test('insufficient history fails explicitly',()=>{assert.throws(()=>forecastDemand({observations:obs([1,2,3])}),/At least four/);});
