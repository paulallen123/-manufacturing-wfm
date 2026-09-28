import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePowerProfile,deriveProfileOpportunity,compareCoordinationModels} from '../../src/frontier/energy-profile-benchmark.mjs';

const NOW='2026-09-18T08:00:00.000Z';
const meta={qualityScore:0.95,sourceId:'synthetic-meter-tariff',observedAt:'2026-09-18T07:55:00.000Z',freshUntil:'2026-09-18T09:00:00.000Z'};
const seg=(kind,durationMinutes,powerKw,unitPricePerKwh,extra={})=>({kind,durationMinutes,powerKw,unitPricePerKwh,...meta,...extra});

test('power profile prices ramp, warm-up, run and cooldown instead of run-only energy',()=>{
  const p=[seg('ramp_up',5,60,0.20),seg('warmup',10,100,0.20),seg('run',60,200,0.20),seg('cooldown',10,80,0.20)];
  const r=evaluatePowerProfile(p,{now:NOW});
  assert.equal(r.valid,true);
  assert.ok(Math.abs(r.energyKwh-235)<1e-9);
  assert.ok(Math.abs(r.cost-47)<1e-9);
  assert.ok(r.phaseEnergyKwh.warmup>0&&r.phaseEnergyKwh.cooldown>0&&r.phaseEnergyKwh.ramp_up>0);
});

test('stale, low-quality or provenance-free profile data fails closed',()=>{
  const cases=[
    [[seg('run',60,100,0.15,{qualityScore:0.5})],'quality_below_threshold'],
    [[seg('run',60,100,0.15,{freshUntil:'2026-09-18T07:59:59.000Z'})],'stale'],
    [[seg('run',60,100,0.15,{sourceId:''})],'missing_source'],
    [[seg('run',60,100,0.15,{observedAt:'2026-09-18T08:00:01.000Z'})],'invalid_observed_at']
  ];
  for(const [profile,reason] of cases){const r=evaluatePowerProfile(profile,{now:NOW});assert.equal(r.valid,false);assert.ok(r.failures.some(x=>x.includes(reason)));}
});

test('transition energy can erase a headline cheap-tariff saving',()=>{
  const baseline=[seg('run',60,100,0.20)];
  const candidate=[seg('warmup',75,100,0.10),seg('run',60,100,0.10)];
  const r=deriveProfileOpportunity({baseline,candidate},{now:NOW});
  assert.equal(r.valid,true);
  assert.ok(r.transitionEnergyKwh>100);
  assert.ok(r.avoidedEnergyCost<0);
  assert.equal(r.lowerCostCandidate,false);
});

test('manual coordination gets the same best safe option when the window is long enough',()=>{
  const options=[
    {id:'a',executable:true,hardConstraintFailures:[],conservativeNetValue:120},
    {id:'b',executable:true,hardConstraintFailures:[],conservativeNetValue:90},
    {id:'unsafe',executable:false,hardConstraintFailures:['qualification_invalid'],conservativeNetValue:999}
  ];
  const r=compareCoordinationModels({options,now:NOW,acceptanceDeadline:'2026-09-18T08:30:00.000Z',manualCoordinationMinutes:15});
  assert.equal(r.separateEmsManual.conservativeValue,r.joinedDecisionTwin.conservativeValue);
  assert.equal(r.joinedDecisionTwin.selectedOptionId,'a');
  assert.notEqual(r.joinedDecisionTwin.selectedOptionId,'unsafe');
});

test('joined model only beats the strong manual baseline when coordination latency is binding',()=>{
  const options=[{id:'safe',executable:true,hardConstraintFailures:[],conservativeNetValue:80}];
  const r=compareCoordinationModels({options,now:NOW,acceptanceDeadline:'2026-09-18T08:10:00.000Z',manualCoordinationMinutes:15});
  assert.equal(r.energyIgnored.conservativeValue,0);
  assert.equal(r.separateEmsManual.conservativeValue,0);
  assert.equal(r.joinedDecisionTwin.conservativeValue,80);
  assert.equal(r.authorityBoundary,'benchmark_only_no_actuation');
});

function lcg(seed){let s=seed>>>0;return()=>((s=Math.imul(1664525,s)+1013904223>>>0)/2**32);}
test('1,000-case coordination benchmark isolates latency lift without weakening hard constraints',()=>{
  const rnd=lcg(0x5eedbeef);let ignored=0,manual=0,joined=0,unsafeSelected=0,manualEqualWhenEligible=0,eligible=0;
  for(let i=0;i<1000;i++){
    const slack=5+Math.floor(rnd()*56),safe=rnd()>0.18,valuable=rnd()>0.32,value=valuable?20+Math.floor(rnd()*481):-Math.floor(rnd()*80);
    const options=[{id:`option-${i}`,executable:safe,hardConstraintFailures:safe?[]:['synthetic_hard_constraint'],conservativeNetValue:value}];
    const deadline=new Date(Date.parse(NOW)+slack*60000).toISOString();
    const r=compareCoordinationModels({options,now:NOW,acceptanceDeadline:deadline,manualCoordinationMinutes:15});
    ignored+=r.energyIgnored.conservativeValue;manual+=r.separateEmsManual.conservativeValue;joined+=r.joinedDecisionTwin.conservativeValue;
    if(!safe&&(r.separateEmsManual.selectedOptionId||r.joinedDecisionTwin.selectedOptionId)) unsafeSelected++;
    if(slack>=15&&safe&&valuable){eligible++;if(r.separateEmsManual.conservativeValue===r.joinedDecisionTwin.conservativeValue) manualEqualWhenEligible++;}
  }
  const summary={cases:1000,energyIgnoredValue:ignored,manualValue:manual,joinedValue:joined,joinedLiftVsManual:manual?joined/manual-1:null,unsafeSelected,manualParityWhenWindowAllows:eligible?manualEqualWhenEligible/eligible:null};
  console.log('ENERGY_COORDINATION_BENCHMARK='+JSON.stringify(summary));
  assert.equal(unsafeSelected,0);
  assert.equal(manualEqualWhenEligible,eligible);
  assert.ok(joined>manual);
  assert.ok(joined/manual-1>0.05);
});
