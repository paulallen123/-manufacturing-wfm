'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateDeliveryDisruption}=require('./delivery-disruption-shadow.cjs');

const at='2026-10-12T08:00:00.000Z';
const scope={tenant:'factory-one',site:'north',line:'L1',order:'O1',material:'M1',shipment:'S1'};
function event(kind,id,revision,payload,observedAt='2026-10-12T07:55:00.000Z'){
  return {kind,id,revision,scope:{...scope},source:'synthetic-'+kind,sourceRevision:String(revision),recordHash:'a'.repeat(64),observedAt,confidence:0.95,payload};
}
function input(){return {scope:{...scope},asOf:at,policy:{version:'p1',currency:'GBP',maxAgeMinutes:30,minConfidence:0.6},
  evidence:[
    event('inventory','inv',1,{quantityOnHand:100,safetyStock:20}),
    event('consumption','cons',1,{quantityPerHour:40,startsAt:at}),
    event('requirement','req',1,{remainingQuantity:200,requiredAt:'2026-10-12T09:00:00.000Z'}),
    event('eta','eta',1,{arrivesAt:'2026-10-12T13:00:00.000Z'}),
    event('economics','econ',1,{lostContributionPerHour:10000,idleLabourPerHour:1000,recoveryOvertimePerHour:500,customerPenalty:2000,componentsNonOverlapping:true})
  ],
  options:[
    {id:'transfer',kind:'INTER_SITE_TRANSFER',recoveredHours:2,costUpper:3000,avoidedCostLower:15000,feasibility:{safety:true,quality:true,qualifiedStaff:true,capacity:true,approvalRoute:true},sourceRef:'transfer:1'},
    {id:'resequence',kind:'RESEQUENCE',recoveredHours:1,costUpper:500,avoidedCostLower:8000,feasibility:{safety:true,quality:true,qualifiedStaff:true,capacity:true,approvalRoute:true},sourceRef:'plan:1'}
  ]};}
test('late delivery yields a bounded cost estimate and a shadow Decision Episode',()=>{
  const r=evaluateDeliveryDisruption(input());
  assert.equal(r.status,'RECOVERY_OPTIONS');
  assert.equal(r.shortageHours,3);
  assert.equal(r.costAtRiskMinor,36500);
  assert.equal(r.rankedOptions[0].id,'transfer');
  assert.equal(r.rankedOptions[0].conservativeNetBenefitMinor,12000);
  assert.equal(r.episode.mode,'SHADOW');
  assert.equal(r.episode.recommendation.optionId,'transfer');
  assert.equal(r.episode.recommendation.executionPermitted,false);
  assert.equal(r.episode.options.find(o=>o.id==='do-nothing').prediction.disruptionCost,36500);
});
test('on-time or fully covered order creates no disruption or handoff',()=>{
  const a=input();a.evidence.find(e=>e.kind==='eta').payload.arrivesAt='2026-10-12T09:00:00.000Z';
  assert.equal(evaluateDeliveryDisruption(a).status,'NO_DISRUPTION');
  const b=input();b.evidence.find(e=>e.kind==='requirement').payload.remainingQuantity=60;
  assert.equal(evaluateDeliveryDisruption(b).status,'NO_DISRUPTION');
  const c=input();c.evidence.find(e=>e.kind==='eta').payload.arrivesAt='2026-10-12T08:30:00.000Z';
  assert.equal(evaluateDeliveryDisruption(c).status,'NO_DISRUPTION');
});
test('shortage cost stops when remaining order demand is exhausted',()=>{
  const a=input();a.evidence.find(e=>e.kind==='eta').payload.arrivesAt='2026-10-13T08:00:00.000Z';
  const r=evaluateDeliveryDisruption(a);
  assert.equal(r.shortageHours,3);
  assert.equal(r.costAtRiskMinor,36500);
});
test('an empty recovery list still reports the disruption without inventing an action',()=>{
  const a=input();a.options=[];const r=evaluateDeliveryDisruption(a);
  assert.equal(r.status,'NO_SAFE_RECOVERY');assert.equal(r.episode,null);assert.equal(r.rankedOptions.length,0);
});
test('cross-tenant evidence and same revision conflicts fail closed',()=>{
  const a=input();a.evidence[0].scope.tenant='other';assert.equal(evaluateDeliveryDisruption(a).status,'INSUFFICIENT_EVIDENCE');
  const b=input();b.evidence.push({...structuredClone(b.evidence[0]),payload:{quantityOnHand:999,safetyStock:0}});
  assert.equal(evaluateDeliveryDisruption(b).status,'INSUFFICIENT_EVIDENCE');
});
test('newest cancelled or stale source does not fall back to an older active revision',()=>{
  const a=input();a.evidence.push({...structuredClone(a.evidence[3]),revision:2,sourceRevision:'2',status:'cancelled'});
  assert.equal(evaluateDeliveryDisruption(a).status,'INSUFFICIENT_EVIDENCE');
  const b=input();b.evidence[3].observedAt='2026-10-12T07:00:00.000Z';
  assert.equal(evaluateDeliveryDisruption(b).status,'INSUFFICIENT_EVIDENCE');
});
test('future observation and negative economics cannot create a recovery recommendation',()=>{
  const a=input();a.evidence[0].observedAt='2026-10-12T08:01:00.000Z';assert.equal(evaluateDeliveryDisruption(a).status,'INSUFFICIENT_EVIDENCE');
  const b=input();b.evidence[4].payload.customerPenalty=-5000;assert.equal(evaluateDeliveryDisruption(b).status,'INSUFFICIENT_EVIDENCE');
});
test('unsafe, unauthorised and direct-actuation options never rank',()=>{
  const a=input();a.options[0].feasibility.qualifiedStaff=false;a.options[1].directScheduleWrite=true;
  const r=evaluateDeliveryDisruption(a);assert.equal(r.status,'NO_SAFE_RECOVERY');assert.equal(r.rankedOptions.length,0);assert.equal(r.episode.recommendation.optionId,'do-nothing');
});
test('identical replay is deterministic and a material source change changes the result identity',()=>{
  const a=input();const first=evaluateDeliveryDisruption(a);
  a.evidence.push(structuredClone(a.evidence[0]));
  assert.equal(evaluateDeliveryDisruption(a).digest,first.digest);
  a.evidence[3].payload.arrivesAt='2026-10-12T14:00:00.000Z';
  assert.notEqual(evaluateDeliveryDisruption(a).digest,first.digest);
});
test('missing currency or non-overlap attestation holds the economics estimate',()=>{
  const a=input();delete a.policy.currency;assert.equal(evaluateDeliveryDisruption(a).status,'INSUFFICIENT_EVIDENCE');
  const b=input();b.evidence[4].payload.componentsNonOverlapping=false;assert.equal(evaluateDeliveryDisruption(b).status,'INSUFFICIENT_EVIDENCE');
});
test('a stream that changes source record identity cannot silently supersede its earlier revision',()=>{
  const a=input();const replacement=structuredClone(a.evidence[3]);
  replacement.id='another-shipment-eta';replacement.revision=2;replacement.sourceRevision='2';
  a.evidence.push(replacement);
  const r=evaluateDeliveryDisruption(a);
  assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
  assert.ok(r.reasons.includes('CONFLICTING_ETA'));
});
test('a returned result cannot be mutated after its digest is committed',()=>{
  const r=evaluateDeliveryDisruption(input());
  assert.throws(()=>{r.scope.tenant='other';},TypeError);
  assert.throws(()=>{r.rankedOptions[0].failures.push('unsafe');},TypeError);
  assert.throws(()=>{r.episode.options[0].prediction.disruptionCost=0;},TypeError);
});
