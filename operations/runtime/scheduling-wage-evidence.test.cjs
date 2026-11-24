'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normaliseWorker}=require('./manufacturing-scheduling-engine.cjs');
const {assertSchedulingWageEvidence}=require('./scheduling-wage-evidence.cjs');

const worker={id:'w1',type:'EMPLOYEE',hourlyCost:24,hoursWorkedWeek:32,contractedHours:40,overtimeMultiplier:1.5};

test('rejects a wage value that the current scheduler would silently turn into zero',()=>{
  assert.equal(normaliseWorker({...worker,hourlyCost:'unknown'}).hourlyCost,0);
  assert.throws(()=>assertSchedulingWageEvidence([{...worker,hourlyCost:'unknown'}]),/hourlyCost/);
});

test('requires explicit finite wage and overtime inputs before economic ranking',()=>{
  for(const field of ['hourlyCost','hoursWorkedWeek','contractedHours','overtimeMultiplier']){
    for(const value of [undefined,null,'24',true,NaN,Infinity,-1]){
      assert.throws(()=>assertSchedulingWageEvidence([{...worker,[field]:value}]),new RegExp(field));
    }
  }
});

test('rejects finite numbers large enough to overflow or misstate scheduled cost',()=>{
  for(const [field,value] of [['hourlyCost',1e308],['hoursWorkedWeek',1e308],['contractedHours',1e308],['overtimeMultiplier',1e308]])
    assert.throws(()=>assertSchedulingWageEvidence([{...worker,[field]:value}]),new RegExp(field));
});

test('requires source-owned contingent premiums and does not mutate valid worker records',()=>{
  for(const type of ['AGENCY','CONTINGENT']){
    const field=type==='AGENCY'?'agencyPremiumPerHour':'contingentPremiumPerHour';
    assert.throws(()=>assertSchedulingWageEvidence([{...worker,type}]),new RegExp(field));
    const input=Object.freeze({...worker,type,[field]:4});
    assert.doesNotThrow(()=>assertSchedulingWageEvidence([input]));
    assert.equal(input[field],4);
    assert.doesNotThrow(()=>assertSchedulingWageEvidence([{...input,type:type.toLowerCase()}]));
  }
});

test('rejects duplicate or missing worker identities before accepting wage evidence',()=>{
  assert.throws(()=>assertSchedulingWageEvidence([{...worker}, {...worker}]),/id/);
  assert.throws(()=>assertSchedulingWageEvidence([{...worker,id:' '}]),/id/);
  assert.throws(()=>assertSchedulingWageEvidence([]),/workers/);
});
