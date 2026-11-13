'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {forecastDemand,toHeadcountForecast}=require('./manufacturing-demand-forecast.cjs');
function obs(values){return values.map((value,i)=>({at:new Date(Date.UTC(2026,8,1+i)).toISOString(),value,evidenceRef:'mes:'+i}));}
test('forecast ensemble returns p50 p90 confidence and model evidence',()=>{const f=forecastDemand({observations:obs([10,11,10,12,11,13,12,14,13,15,14,16]),horizonPeriods:3,seasonLength:4});assert.equal(f.steps.length,3);assert.ok(f.steps.every(x=>x.p90>=x.p50));assert.ok(f.confidence>0&&f.confidence<=0.95);assert.ok(f.models.length>=3);assert.equal(f.claimBoundary,'FORECAST_BASELINE_NOT_CUSTOMER_ACCURACY_PROOF');});
test('planned evidence-backed adjustment changes demand',()=>{const a=forecastDemand({observations:obs([10,10,10,10,10,10]),horizonPeriods:1});const b=forecastDemand({observations:obs([10,10,10,10,10,10]),horizonPeriods:1,adjustments:[{type:'PERCENT',value:20,evidenceRef:'erp:order-spike'}]});assert.ok(b.steps[0].p50>a.steps[0].p50);assert.ok(b.adjustmentEvidence.includes('erp:order-spike'));});
test('translates production units into headcount with p90 preserved',()=>{const f=forecastDemand({observations:obs([800,820,780,850,830,860]),horizonPeriods:1});const h=toHeadcountForecast({forecast:f,unitsPerLabourHour:20,shiftHours:8});assert.ok(h.steps[0].p90Headcount>=h.steps[0].p50Headcount);assert.equal(h.claimBoundary,'CAPACITY_TRANSLATION_REQUIRES_CUSTOMER_VALIDATED_RATE');});
test('insufficient history fails explicitly',()=>{assert.throws(()=>forecastDemand({observations:obs([1,2,3])}),/At least four/);});

// V093 ordinary demand-record refusal. References and values remain caller declarations.
{
const {createHash}=require('node:crypto');
function v093Rows(){return [0,10.5,20.25,0,15,20.5,8,12].map((value,i)=>({at:new Date(Date.UTC(2026,8,1+i)).toISOString(),value,evidenceRef:'declared-fixture:'+i}));}
const v093BadValues=[['string','10'],['zero-string','0'],['true',true],['false',false],['null',null],['missing',undefined],['object',{}],['array',[]],['boxed-number',new Number(1)],['NaN',NaN],['positive-infinity',Infinity],['negative-infinity',-Infinity],['negative-integer',-1],['negative-fraction',-0.1]];
for(const[label,value]of v093BadValues)test('V093 refuses '+label+' demand value instead of coercing clamping or dropping its row',()=>{const observations=v093Rows();observations.splice(3,0,{at:'2026-09-03T12:00:00Z',value,evidenceRef:'declared-invalid'});const before=JSON.stringify(observations);assert.throws(()=>forecastDemand({observations,horizonPeriods:2}),/Invalid demand observation/);assert.equal(JSON.stringify(observations),before);});
for(const[label,row]of[['number',12],['boolean',true],['string','not-a-record'],['object',{}],['array',[]],['null',null],['missing',undefined]])test('V093 refuses malformed '+label+' record even beside enough valid history',()=>{const observations=v093Rows();observations.splice(3,0,row);assert.throws(()=>forecastDemand({observations}));});
test('V093 refuses a sparse demand record instead of counting a missing position as history',()=>{const observations=v093Rows();delete observations[3];assert.throws(()=>forecastDemand({observations}),/Invalid demand observation/);});
for(const field of['value','headcount','units'])test('V093 preserves numeric zero and fractional '+field+' aliases without editing input',()=>{const observations=v093Rows().map(({value,...rest})=>({...rest,[field]:value})),before=JSON.stringify(observations);const forecast=forecastDemand({observations,horizonPeriods:2,seasonLength:4});assert.deepEqual(forecast,forecastDemand({observations:v093Rows(),horizonPeriods:2,seasonLength:4}));assert.equal(forecast.historyCount,8);assert.equal(JSON.stringify(observations),before);});
test('V093 valid forecast and labour golden remains byte-exact',()=>{const forecast=forecastDemand({observations:v093Rows(),horizonPeriods:2,seasonLength:4}),labour=toHeadcountForecast({forecast,unitsPerLabourHour:2,shiftHours:8});assert.equal(createHash('sha256').update(JSON.stringify({forecast,labour})).digest('hex'),'676ae6b9eca7cba238d6f3851b5b611394b62ab81dd4c1b1f836a2fb24d89cc9');assert.equal(forecast.claimBoundary,'FORECAST_BASELINE_NOT_CUSTOMER_ACCURACY_PROOF');assert.equal(labour.claimBoundary,'CAPACITY_TRANSLATION_REQUIRES_CUSTOMER_VALIDATED_RATE');});
test('V093 retains existing nullish alias precedence without inventing a contradictory-field policy',()=>{const observations=v093Rows();observations[0]={...observations[0],value:null,headcount:0,units:999};assert.deepEqual(forecastDemand({observations,horizonPeriods:2,seasonLength:4}),forecastDemand({observations:v093Rows(),horizonPeriods:2,seasonLength:4}));});
}


function productionForecast(){return forecastDemand({observations:obs([800,820,780,850,830,860]),horizonPeriods:2});}
test('capacity product overflow and underflow cannot produce staffing advice',()=>{
 const forecast=productionForecast();
 for(const [unitsPerLabourHour,shiftHours] of [[1e308,1e308],[1e-308,1e-308],[Number.MIN_VALUE,0.5]])
  assert.throws(()=>toHeadcountForecast({forecast,unitsPerLabourHour,shiftHours}),/capacity/i);
});
test('labour capacity inputs must be finite positive primitive numbers',()=>{
 const forecast=productionForecast();
 for(const field of ['unitsPerLabourHour','shiftHours'])for(const value of ['8',true,[],[8],{},new Number(8),null,0,-1,NaN,Infinity,-Infinity])
  assert.throws(()=>toHeadcountForecast({forecast,unitsPerLabourHour:20,shiftHours:8,[field]:value}),/unitsPerLabourHour|shiftHours/);
});
test('headcounts beyond safe integer precision are refused',()=>{
 assert.throws(()=>toHeadcountForecast({forecast:productionForecast(),unitsPerLabourHour:1e-308,shiftHours:1}),/headcount/i);
});
test('invalid or contradictory forecast quantities cannot enter labour translation',()=>{
 const original=productionForecast();
 for(const changes of [{p50:NaN},{p50:Infinity},{p50:-1},{p50:'800'},{p90:null},{p90:Infinity},{p90:-1},{p50:900,p90:800}]){
  const forecast={...original,steps:[{...original.steps[0],...changes}]};
  assert.throws(()=>toHeadcountForecast({forecast,unitsPerLabourHour:20,shiftHours:8}),/forecast/i);
 }
});
test('tiny positive demand cannot underflow to zero required workers',()=>{
 const forecast={...productionForecast(),steps:[{period:1,p50:Number.MIN_VALUE,p90:Number.MIN_VALUE}]};
 assert.throws(()=>toHeadcountForecast({forecast,unitsPerLabourHour:1e308,shiftHours:1}),/headcount/i);
});
test('valid fractional capacity and zero demand preserve finite ordered headcounts',()=>{
 const forecast={...productionForecast(),steps:[{period:1,p50:0,p90:0},{period:2,p50:2.5,p90:5}]};
 const before=JSON.stringify(forecast);Object.freeze(forecast.steps);Object.freeze(forecast);
 const result=toHeadcountForecast({forecast,unitsPerLabourHour:0.5,shiftHours:2.5});
 assert.deepEqual(result.steps.map(s=>[s.p50Headcount,s.p90Headcount]),[[0,0],[2,4]]);
 assert.equal(JSON.stringify(forecast),before);assert.equal(result.forecastId,forecast.forecastId);
 assert.equal(toHeadcountForecast({forecast,unitsPerLabourHour:0.5}).shiftHours,8);
});
