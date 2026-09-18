import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCoordinationModels} from '../../src/frontier/energy-profile-benchmark.mjs';

const NOW='2026-09-18T08:00:00.000Z';

function lcg(seed){let s=seed>>>0;return()=>((s=Math.imul(1664525,s)+1013904223>>>0)/2**32);}

function runSensitivity({manualCoordinationMinutes,slackMin,slackMax,cases=1000}){
  const rnd=lcg(0x5eedbeef);
  let manualValue=0,joinedValue=0,unsafeSelected=0,safeValuable=0,bindingSafeValuable=0;
  for(let i=0;i<cases;i++){
    const slack=slackMin+Math.floor(rnd()*(slackMax-slackMin+1));
    const safe=rnd()>0.18;
    const valuable=rnd()>0.32;
    const value=valuable?20+Math.floor(rnd()*481):-Math.floor(rnd()*80);
    const options=[{id:`option-${i}`,executable:safe,hardConstraintFailures:safe?[]:['synthetic_hard_constraint'],conservativeNetValue:value}];
    const deadline=new Date(Date.parse(NOW)+slack*60000).toISOString();
    const result=compareCoordinationModels({options,now:NOW,acceptanceDeadline:deadline,manualCoordinationMinutes});
    manualValue+=result.separateEmsManual.conservativeValue;
    joinedValue+=result.joinedDecisionTwin.conservativeValue;
    if(!safe&&(result.separateEmsManual.selectedOptionId||result.joinedDecisionTwin.selectedOptionId)) unsafeSelected++;
    if(safe&&valuable){
      safeValuable++;
      if(slack<manualCoordinationMinutes) bindingSafeValuable++;
    }
  }
  return {
    manualCoordinationMinutes,
    slackMin,
    slackMax,
    cases,
    manualValue,
    joinedValue,
    joinedLiftVsManual:manualValue?joinedValue/manualValue-1:null,
    unsafeSelected,
    safeValuable,
    bindingSafeValuable,
    bindingShare:safeValuable?bindingSafeValuable/safeValuable:0
  };
}

test('joined energy value advantage collapses when competent manual coordination fits every acceptance window',()=>{
  const rows=[
    {manualCoordinationMinutes:5,slackMin:5,slackMax:60},
    {manualCoordinationMinutes:15,slackMin:15,slackMax:60},
    {manualCoordinationMinutes:30,slackMin:30,slackMax:120},
    {manualCoordinationMinutes:60,slackMin:60,slackMax:240}
  ].map(runSensitivity);
  console.log('ENERGY_COORDINATION_ZERO_LIFT_MATRIX='+JSON.stringify(rows));
  for(const row of rows){
    assert.equal(row.unsafeSelected,0);
    assert.equal(row.bindingSafeValuable,0);
    assert.equal(row.manualValue,row.joinedValue);
    assert.equal(row.joinedLiftVsManual,0);
  }
});

test('synthetic financial lift is a latency-sensitive hypothesis, not a general Decision Twin saving',()=>{
  const rows=[5,10,15,20,30].map(manualCoordinationMinutes=>runSensitivity({manualCoordinationMinutes,slackMin:5,slackMax:60}));
  console.log('ENERGY_COORDINATION_LATENCY_SENSITIVITY='+JSON.stringify(rows));
  for(const row of rows) assert.equal(row.unsafeSelected,0);
  assert.equal(rows[0].joinedLiftVsManual,0);
  assert.ok(Math.abs(rows[2].joinedLiftVsManual-0.21752338020817463)<1e-12);
  for(let i=1;i<rows.length;i++) assert.ok(rows[i].joinedLiftVsManual>=rows[i-1].joinedLiftVsManual);
  assert.ok(rows[1].joinedLiftVsManual<0.10);
  assert.ok(rows[3].joinedLiftVsManual>0.30);
  assert.ok(rows[4].joinedLiftVsManual>0.75);
});
