import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWaterResiliencePlan,compareWaterResiliencePlans,reconcileWaterOutcome} from './water-resilience-orchestration.mjs';

const now='2026-09-20T22:30:00Z';
const policy={
 authoritative:true,siteId:'S1',version:'water-4',ref:'utility:water:4',observedAt:'2026-09-20T22:00:00Z',maxAgeMinutes:120,
 slots:[
  {slot:1,authoritative:true,waterSource:'fresh',freshWaterAvailableM3:20,minimumReserveM3:5,effluentCapacityM3:18,scarcityWeight:3,waterTariffPerM3:2.5,restrictionActive:true},
  {slot:2,authoritative:true,waterSource:'fresh',freshWaterAvailableM3:40,minimumReserveM3:5,effluentCapacityM3:30,scarcityWeight:1,waterTariffPerM3:1.2,restrictionActive:false},
  {slot:3,authoritative:true,waterSource:'fresh',freshWaterAvailableM3:35,minimumReserveM3:5,effluentCapacityM3:25,scarcityWeight:1.2,waterTariffPerM3:1.5,restrictionActive:false}
 ]
};
const workers=[
 {id:'W1',siteId:'S1',skills:['wash','pack']},
 {id:'W2',siteId:'S1',skills:['wash','pack']}
];
const tasks=[
 {id:'T1',siteId:'S1',skill:'wash',freshWaterM3:10,effluentM3:8,earliestSlot:1,latestSlot:3,preferredSlot:1,latePenalty:1,allowedWaterSources:['fresh'],allowedDuringRestriction:true},
 {id:'T2',siteId:'S1',skill:'pack',freshWaterM3:1,effluentM3:0.2,earliestSlot:1,latestSlot:2,preferredSlot:1,latePenalty:1,allowedWaterSources:['fresh'],allowedDuringRestriction:true}
];

test('prefers same work moved away from the stressed water slot',()=>{
 const plans=[
  {id:'baseline',assignments:[{taskId:'T1',workerId:'W1',slot:1},{taskId:'T2',workerId:'W2',slot:1}]},
  {id:'water-aware',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:1}]}
 ];
 const r=compareWaterResiliencePlans({policy,workers,tasks,plans,now});
 assert.equal(r.status,'ranked');
 assert.equal(r.preferred.planId,'water-aware');
 assert.ok(r.safe[0].metrics.scarcityWeightedWater<r.safe[1].metrics.scarcityWeightedWater);
});

test('minimum reserve is a hard constraint',()=>{
 const plan={id:'breach',assignments:[{taskId:'T1',workerId:'W1',slot:1},{taskId:'T2',workerId:'W2',slot:1}]};
 const tighter=structuredClone(policy);tighter.slots[0].freshWaterAvailableM3=12;tighter.slots[0].minimumReserveM3=5;
 const r=evaluateWaterResiliencePlan({policy:tighter,workers,tasks,plan,now});
 assert.equal(r.reason,'minimum_water_reserve_breached');
});

test('effluent capacity is a hard constraint',()=>{
 const plan={id:'breach',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:2}]};
 const tighter=structuredClone(policy);tighter.slots[1].effluentCapacityM3=5;
 const r=evaluateWaterResiliencePlan({policy:tighter,workers,tasks,plan,now});
 assert.equal(r.reason,'effluent_capacity_breached');
});

test('unapproved work during a restriction is rejected',()=>{
 const t=structuredClone(tasks);t[0].allowedDuringRestriction=false;
 const plan={id:'bad',assignments:[{taskId:'T1',workerId:'W1',slot:1},{taskId:'T2',workerId:'W2',slot:2}]};
 assert.equal(evaluateWaterResiliencePlan({policy,workers,tasks:t,plan,now}).reason,'task_not_allowed_during_restriction');
});

test('water source compatibility cannot be traded for cost',()=>{
 const reclaimed=structuredClone(policy);reclaimed.slots[1].waterSource='reclaimed';
 const plan={id:'badsource',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:1}]};
 assert.equal(evaluateWaterResiliencePlan({policy:reclaimed,workers,tasks,plan,now}).reason,'water_source_not_approved');
});

test('skills and site boundaries fail closed',()=>{
 const badWorkers=structuredClone(workers);badWorkers[0].siteId='S2';
 const plan={id:'x',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:1}]};
 assert.equal(evaluateWaterResiliencePlan({policy,workers:badWorkers,tasks,plan,now}).reason,'worker_site_mismatch');
 const skillWorkers=structuredClone(workers);skillWorkers[0].skills=['pack'];
 assert.equal(evaluateWaterResiliencePlan({policy,workers:skillWorkers,tasks,plan,now}).reason,'skill_missing');
});

test('stale policy blocks scoring',()=>{
 const stale=structuredClone(policy);stale.observedAt='2026-09-19T00:00:00Z';
 const plan={id:'x',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:1}]};
 assert.equal(evaluateWaterResiliencePlan({policy:stale,workers,tasks,plan,now}).reason,'policy_stale');
});

const outcomeFixture=()=>({
 now:'2026-09-20T22:30:00Z',
 recommendation:{id:'R1',tenantId:'northstar-demo',siteId:'S1',sourceRef:'recommendation:R1',decisionSourceRef:'decision-approval:R1',observedSourceRef:'meter:R1',operationsSourceRef:'mes:R1',financialSourceRef:'erp:R1',generatedAt:'2026-09-20T22:00:00Z',maxAgeMinutes:120,predictedFreshWaterM3:11},
 decision:{status:'accepted',recommendationId:'R1',tenantId:'northstar-demo',siteId:'S1',sourceRef:'decision-approval:R1',observedAt:'2026-09-20T22:05:00Z'},
 observed:{authoritative:true,recommendationId:'R1',tenantId:'northstar-demo',siteId:'S1',sourceRef:'meter:R1',observedAt:'2026-09-20T22:20:00Z',actualFreshWaterM3:12.5},
 operations:{authoritative:true,recommendationId:'R1',tenantId:'northstar-demo',siteId:'S1',sourceRef:'mes:R1',observedAt:'2026-09-20T22:20:00Z',productionCompleted:true},
 financial:{authoritative:true,recommendationId:'R1',tenantId:'northstar-demo',siteId:'S1',sourceRef:'erp:R1',observedAt:'2026-09-20T22:20:00Z',realisedWaterCost:20}
});

test('outcome learning preserves predicted vs realised water with bound provenance',()=>{
 const r=reconcileWaterOutcome(outcomeFixture());
 assert.equal(r.status,'reconciled');
 assert.equal(r.calibration.waterErrorM3,1.5);
 assert.deepEqual(r.evidenceRefs,{recommendation:'recommendation:R1',decision:'decision-approval:R1',observed:'meter:R1',operations:'mes:R1',financial:'erp:R1'});
});

const candidate={id:'candidate',assignments:[{taskId:'T1',workerId:'W1',slot:2},{taskId:'T2',workerId:'W2',slot:1}]};
const fixture=()=>structuredClone({policy,workers,tasks,plan:candidate,now});
const evaluate=input=>evaluateWaterResiliencePlan(input);
function assertUnsafe(input,expected){
 assert.deepEqual(evaluate(input),expected);
 const ranked=compareWaterResiliencePlans({...input,plans:[input.plan]});
 assert.equal(ranked.status,'no_safe_candidate');
 assert.equal(ranked.preferred,null);
 assert.deepEqual(ranked.safe,[]);
 assert.deepEqual(ranked.rejected,[expected]);
}

for(const domain of ['tasks','workers','slots']){
 for(const conflicting of [false,true]){
  test(`${domain}: ${conflicting?'conflicting':'identical'} duplicate IDs fail closed in both orders`,()=>{
   const input=fixture(),rows=domain==='slots'?input.policy.slots:input[domain];
   const copy=structuredClone(rows[0]);
   if(conflicting){
    if(domain==='tasks')Object.assign(copy,{freshWaterM3:100,effluentM3:100,skill:'missing'});
    if(domain==='workers')copy.skills=[];
    if(domain==='slots')Object.assign(copy,{freshWaterAvailableM3:0,effluentCapacityM3:0,waterSource:'unapproved',authoritative:false});
   }
   rows.unshift(copy);
   const expected=domain==='slots'?{status:'blocked',reason:'water_slot_id_duplicate'}:{status:'rejected',reason:`${domain==='tasks'?'task':'worker'}_id_duplicate`};
   assertUnsafe(input,expected);
   rows.reverse();
   assertUnsafe(input,expected);
  });
 }
}

test('duplicate unused workers and water slots are ambiguous too',()=>{
 for(const domain of ['workers','slots']){
  const input=fixture(),rows=domain==='slots'?input.policy.slots:input.workers;
  const unused=domain==='slots'?{...rows[0],slot:99}:{...rows[0],id:'unused'};
  rows.push(unused,{...unused});
  assertUnsafe(input,domain==='slots'?{status:'blocked',reason:'water_slot_id_duplicate'}:{status:'rejected',reason:'worker_id_duplicate'});
 }
});

test('non-array input collections cannot produce a candidate',()=>{
 for(const value of [null,{},'invalid',1,true]){
  for(const domain of ['workers','tasks','slots']){
   const input=fixture();
   if(domain==='slots')input.policy.slots=value;else input[domain]=value;
   assertUnsafe(input,domain==='slots'?{status:'blocked',reason:'water_slots_invalid'}:{status:'rejected',reason:`${domain}_invalid`});
  }
  const input=fixture();input.plan.assignments=value;
  assertUnsafe(input,{status:'rejected',reason:'plan_invalid'});
  const ranked=compareWaterResiliencePlans({...fixture(),plans:value});
  assert.deepEqual(ranked,{status:'no_safe_candidate',preferred:null,safe:[],rejected:[]});
 }
});

test('malformed rows and IDs fail closed even when unreferenced',()=>{
 for(const domain of ['workers','tasks','slots']){
  for(const row of [null,undefined,[],{},false,0,'invalid',{id:''},{id:'   '},{id:{}},{id:[]},{id:false},{id:NaN},{id:Infinity},{slot:null},{slot:false},{slot:''},{slot:' '},{slot:[]},{slot:{}},{slot:1.5},{slot:NaN},{slot:Infinity}]){
   const input=fixture(),rows=domain==='slots'?input.policy.slots:input[domain];
   rows.push(row);
   assertUnsafe(input,domain==='slots'?{status:'blocked',reason:'water_slots_invalid'}:{status:'rejected',reason:`${domain}_invalid`});
  }
  const input=fixture(),rows=domain==='slots'?input.policy.slots:input[domain];
  rows.length++;
  assertUnsafe(input,domain==='slots'?{status:'blocked',reason:'water_slots_invalid'}:{status:'rejected',reason:`${domain}_invalid`});
 }
});

test('assignment links must resolve without object or empty-slot coercion',()=>{
 for(const field of ['taskId','workerId','slot']){
  for(const value of [undefined,null,'',{},[],false,'unknown',99]){
   const input=fixture();input.plan.assignments[0][field]=value;
   assertUnsafe(input,{status:'rejected',reason:'unknown_assignment_reference'});
  }
 }
 const input=fixture();input.plan.assignments.pop();
 assertUnsafe(input,{status:'rejected',reason:'task_coverage_mismatch',required:2,actual:1});
});

test('raw Unicode and delimiter IDs stay distinct across separate namespaces',()=>{
 const ids=['same','é','e\u0301','W@1','W','a:b','a|b',' a ','a','1','01','__proto__'];
 const input=fixture();input.policy.slots=[{...policy.slots[1],freshWaterAvailableM3:500,effluentCapacityM3:500}];
 input.workers=ids.map(id=>({...workers[0],id}));
 input.tasks=ids.map(id=>({...tasks[0],id}));
 input.plan.assignments=ids.map(id=>({taskId:id,workerId:id,slot:2}));
 const result=evaluate(input);
 assert.equal(result.status,'safe_candidate');
 assert.equal(result.metrics.freshWaterM3,ids.length*10);
 assert.equal(result.metrics.effluentM3,ids.length*8);
 assert.deepEqual(evaluate(input),result);
});

test('existing finite numeric worker IDs and numeric string slots remain supported',()=>{
 const input=fixture();input.workers[0].id=7;input.plan.assignments[0].workerId=7;
 input.policy.slots[1].slot='2';input.plan.assignments[0].slot='2';
 assert.equal(evaluate(input).status,'safe_candidate');
 input.workers.push({...input.workers[0],id:'7'});
 assertUnsafe(input,{status:'rejected',reason:'worker_id_duplicate'});
 input.workers.reverse();
 assertUnsafe(input,{status:'rejected',reason:'worker_id_duplicate'});
});

test('finite numeric assignment references retain existing string-key compatibility',()=>{
 const input=fixture();input.tasks[0].id='1';input.plan.assignments[0].taskId=1;
 input.workers[0].id='7';input.plan.assignments[0].workerId=7;
 const result=evaluate(input);
 assert.equal(result.status,'safe_candidate');
 input.plan.assignments[0].taskId='1';input.plan.assignments[0].workerId='7';
 assert.deepEqual(evaluate(input),result);
});

test('numeric slot aliases are duplicate keys regardless of order',()=>{
 for(const alias of ['1','01',' 1 ','1e0']){
  const input=fixture();input.policy.slots.push({...input.policy.slots[0],slot:alias});
  assertUnsafe(input,{status:'blocked',reason:'water_slot_id_duplicate'});
  input.policy.slots.reverse();
  assertUnsafe(input,{status:'blocked',reason:'water_slot_id_duplicate'});
 }
});

test('zero and negative integer slots remain valid, coercible non-slots do not',()=>{
 for(const slot of [0,-1]){
  const input=fixture();input.policy.slots=[{...policy.slots[1],slot}];
  input.tasks.forEach(task=>Object.assign(task,{earliestSlot:slot,latestSlot:slot,preferredSlot:slot}));
  input.plan.assignments.forEach(a=>a.slot=slot);
  assert.equal(evaluate(input).status,'safe_candidate');
  if(slot===0){
   for(const invalid of [null,'',' ',false,[]]){
    input.plan.assignments[0].slot=invalid;
    assertUnsafe(input,{status:'rejected',reason:'unknown_assignment_reference'});
   }
  }
 }
});

function deepFreeze(value){
 if(value&&typeof value==='object'){
  Object.values(value).forEach(deepFreeze);
  Object.freeze(value);
 }
 return value;
}

test('valid and ambiguous frozen inputs stay unchanged with deterministic outcomes',()=>{
 for(const duplicate of [false,true]){
  const input=fixture();if(duplicate)input.tasks.push({...input.tasks[0]});
  input.plans=[input.plan,{...input.plan,id:'another'}];
  const before=structuredClone(input);deepFreeze(input);
  const result=evaluate(input),ranked=compareWaterResiliencePlans(input);
  for(let i=0;i<3;i++){
   assert.deepEqual(evaluate(input),result);
   assert.deepEqual(compareWaterResiliencePlans(input),ranked);
  }
  assert.deepEqual(input,before);
 }
});

test('ranking remains exposure, scarcity, tariff, lateness, then plan ID',()=>{
 const input=fixture();input.tasks=[{...tasks[0],latestSlot:6,latePenalty:1}];
 input.policy.slots=Array.from({length:6},(_,i)=>({...policy.slots[1],slot:i+1,scarcityWeight:1,waterTariffPerM3:1}));
 input.policy.slots[0].restrictionActive=true;
 input.policy.slots[1].scarcityWeight=2;
 input.policy.slots[2].waterTariffPerM3=2;
 input.plans=[6,5,4,3,2,1].map(slot=>({id:`slot-${slot}`,assignments:[{taskId:'T1',workerId:'W1',slot}]}));
 input.plans.push({...input.plans.find(p=>p.id==='slot-4'),id:'aaa'});
 const result=compareWaterResiliencePlans(input);
 assert.deepEqual(result.safe.map(p=>p.planId),['aaa','slot-4','slot-5','slot-6','slot-3','slot-2','slot-1']);
 input.plans.reverse();
 assert.deepEqual(compareWaterResiliencePlans(input),result);
});

test('negative ranking inputs cannot make a water plan look beneficial',()=>{
 for(const [field,value,expected] of [
  ['scarcityWeight',-1,{status:'blocked',reason:'water_slot_economics_invalid',slot:2}],
  ['waterTariffPerM3',-1,{status:'blocked',reason:'water_slot_economics_invalid',slot:2}],
 ]){
  const input=fixture();input.policy.slots[1][field]=value;
  assertUnsafe(input,expected);
 }
 const input=fixture();input.tasks[0].latePenalty=-1;
 assertUnsafe(input,{status:'rejected',reason:'task_invalid',taskId:'T1'});
 const unset=fixture();unset.policy.slots[1].scarcityWeight=null;
 const result=evaluate(unset);
 assert.equal(result.status,'safe_candidate');
 assert.equal(result.metrics.scarcityWeightedWater,13);
 for(const value of ['',false,[]]){
  for(const field of ['scarcityWeight','waterTariffPerM3']){
   const malformed=fixture();malformed.policy.slots[1][field]=value;
   assertUnsafe(malformed,{status:'blocked',reason:'water_slot_economics_invalid',slot:2});
  }
  const malformed=fixture();malformed.tasks[0].latePenalty=value;
  assertUnsafe(malformed,{status:'rejected',reason:'task_invalid',taskId:'T1'});
 }
 for(const value of [null,'',false,[]]){
  for(const field of ['freshWaterM3','effluentM3']){
   const malformed=fixture();malformed.tasks[0][field]=value;
   assertUnsafe(malformed,{status:'rejected',reason:'task_invalid',taskId:'T1'});
  }
  for(const [field,reason] of [['freshWaterAvailableM3','water_capacity_invalid'],['effluentCapacityM3','effluent_capacity_invalid']]){
   const malformed=fixture();malformed.policy.slots[1][field]=value;
   assertUnsafe(malformed,{status:'blocked',reason,slot:2});
  }
 }
 const overflow=fixture();
 overflow.tasks[0].freshWaterM3=1e308;
 overflow.policy.slots[1].freshWaterAvailableM3=1e308;
 overflow.policy.slots[1].minimumReserveM3=0;
 overflow.policy.slots[1].scarcityWeight=1e308;
 assertUnsafe(overflow,{status:'blocked',reason:'water_metrics_invalid'});
});

test('accessor-backed rows fail closed before any validated value can drift',()=>{
 const input=fixture();
 let reads=0;
 Object.defineProperty(input.policy.slots[1],'scarcityWeight',{enumerable:true,get(){reads++;return reads===1?1:-50;}});
 assert.deepEqual(evaluate(input),{status:'blocked',reason:'water_slots_invalid'});
 assert.equal(reads,0);
 const ranked=compareWaterResiliencePlans({...input,plans:[input.plan]});
 assert.equal(ranked.status,'no_safe_candidate');
 assert.equal(reads,0);
});

test('throwing accessors are contained and cannot escape the public entry points',()=>{
 const input=fixture();
 Object.defineProperty(input.policy,'authoritative',{enumerable:true,get(){throw new Error('caller getter executed');}});
 assert.doesNotThrow(()=>evaluate(input));
 assert.deepEqual(evaluate(input),{status:'blocked',reason:'policy_invalid'});
 assert.doesNotThrow(()=>compareWaterResiliencePlans({...input,plans:[input.plan]}));
});

test('caller-owned traversal cannot hide assignments or forge a ranked candidate',()=>{
 const hidden=fixture();
 const inherited=Object.create(Array.prototype);
 inherited[1]=hidden.plan.assignments[1];
 hidden.plan.assignments.length=2;
 delete hidden.plan.assignments[1];
 Object.setPrototypeOf(hidden.plan.assignments,inherited);
 assert.deepEqual(evaluate(hidden),{status:'rejected',reason:'plan_invalid'});

 const rankedInput=fixture();
 const forged={status:'safe_candidate',planId:'forged',metrics:{restrictionExposureM3:-1,scarcityWeightedWater:-1,waterCost:-1,latenessPenalty:-1}};
 const plans=[rankedInput.plan];
 plans.map=()=>[forged];
 assert.deepEqual(compareWaterResiliencePlans({...rankedInput,plans}),{status:'no_safe_candidate',preferred:null,safe:[],rejected:[]});
});

test('inherited sources and string skills cannot satisfy safety constraints',()=>{
 const inheritedSource=fixture();
 const allowed=[];allowed.length=1;
 const sourcePrototype=Object.create(Array.prototype);sourcePrototype[0]='fresh';
 Object.setPrototypeOf(allowed,sourcePrototype);
 inheritedSource.tasks[0].allowedWaterSources=allowed;
 assert.deepEqual(evaluate(inheritedSource),{status:'rejected',reason:'tasks_invalid'});

 const stringSkills=fixture();
 stringSkills.workers[0].skills='wash';
 stringSkills.tasks[0].skill='w';
 assert.deepEqual(evaluate(stringSkills),{status:'rejected',reason:'workers_invalid'});
});

test('policy freshness accepts only primitive duration and real UTC instants',()=>{
 const coercible=fixture();coercible.policy.maxAgeMinutes='120';
 assert.deepEqual(evaluate(coercible),{status:'blocked',reason:'policy_time_invalid'});

 const rolled=fixture();
 rolled.policy.observedAt='2026-04-31T00:00:00Z';
 rolled.now='2026-05-01T00:00:00Z';
 assert.deepEqual(evaluate(rolled),{status:'blocked',reason:'policy_time_invalid'});
});

test('outcome learning rejects coercible measurements instead of recording zero',()=>{
 for(const value of [null,false,[], '']){
  const input=outcomeFixture();input.observed.actualFreshWaterM3=value;
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'water_values_invalid'});
  const predicted=outcomeFixture();predicted.recommendation.predictedFreshWaterM3=value;
  assert.deepEqual(reconcileWaterOutcome(predicted),{status:'incomplete',reason:'water_values_invalid'});
  const financial=outcomeFixture();financial.financial.realisedWaterCost=value;
  assert.deepEqual(reconcileWaterOutcome(financial),{status:'incomplete',reason:'water_values_invalid'});
 }
});

test('outcome evidence is bound to recommendation tenant site identity and freshness',()=>{
 for(const [domain,field,value] of [
  ['decision','recommendationId','other'],
  ['observed','tenantId','other-tenant'],
  ['operations','siteId','other-site'],
  ['financial','sourceRef',''],
 ]){
  const input=outcomeFixture();input[domain][field]=value;
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'evidence_identity_invalid'});
 }
 const stale=outcomeFixture();stale.observed.observedAt='2026-09-19T00:00:00Z';
 assert.deepEqual(reconcileWaterOutcome(stale),{status:'incomplete',reason:'evidence_time_invalid'});
});

test('malformed authoritative slot controls fail closed even on an unused slot',()=>{
 for(const [field,value] of [
  ['waterSource',false],['waterSource',null],['waterSource',[]],
  ['restrictionActive','true'],['restrictionActive',null],
  ['minimumReserveM3',null],['minimumReserveM3',false],
 ]){
  const input=fixture();input.policy.slots[2][field]=value;
  assert.deepEqual(evaluate(input),{status:'blocked',reason:'water_slots_invalid'});
 }
});

test('present optional task ranking values require their exact primitive type',()=>{
 for(const [field,value] of [
  ['latePenalty',null],['preferredSlot',null],['preferredSlot','2'],['preferredSlot',false]
 ]){
  const input=fixture();input.tasks[0][field]=value;
  assert.deepEqual(evaluate(input),{status:'rejected',reason:'task_invalid',taskId:'T1'});
 }
});

test('outcome sources are role-bound and cannot be swapped or invented',()=>{
 for(const [domain,value] of [['decision','meter:R1'],['observed','mes:R1'],['operations','unknown:R1'],['financial','meter:R1']]){
  const input=outcomeFixture();input[domain].sourceRef=value;
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'evidence_identity_invalid'});
 }
});

test('outcome timestamps preserve causal recommendation decision and evidence order',()=>{
 const earlyDecision=outcomeFixture();earlyDecision.decision.observedAt='2026-09-20T21:59:00Z';
 assert.deepEqual(reconcileWaterOutcome(earlyDecision),{status:'incomplete',reason:'evidence_time_invalid'});
 for(const domain of ['observed','operations','financial']){
  const input=outcomeFixture();input[domain].observedAt='2026-09-20T22:04:00Z';
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'evidence_time_invalid'});
 }
});

test('outcome status and production completion use exact admitted primitives',()=>{
 const padded=outcomeFixture();padded.decision.status=' rejected ';
 assert.deepEqual(reconcileWaterOutcome(padded),{status:'incomplete',reason:'decision_missing'});
 for(const value of [null,[],{},'true',1]){
  const input=outcomeFixture();input.operations.productionCompleted=value;
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'operational_evidence_invalid'});
 }
 for(const value of [null,[],{},'true',1]){
  const input=outcomeFixture();input.financial.authoritative=value;
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'financial_evidence_invalid'});
 }
});


test('every water policy slot requires an explicit source before plans are admitted',()=>{
 for(const index of [0,1,2]){
  const input=fixture();
  delete input.policy.slots[index].waterSource;
  assertUnsafe(input,{status:'blocked',reason:'water_source_missing',slot:input.policy.slots[index].slot});
 }
});

test('a missing source cannot enter the safe ranking through another plan',()=>{
 const input=fixture();
 delete input.policy.slots[2].waterSource;
 const first=input.plan,second={id:'alternate',assignments:[{taskId:'T1',workerId:'W1',slot:3},{taskId:'T2',workerId:'W2',slot:1}]};
 const expected={status:'blocked',reason:'water_source_missing',slot:3};
 for(const plans of [[first,second],[second,first]]){
  const ranked=compareWaterResiliencePlans({...input,plans});
  assert.deepEqual(ranked,{status:'no_safe_candidate',preferred:null,safe:[],rejected:[expected,expected]});
 }
});

test('explicit sources retain fresh and approved reclaimed candidates without mutating inputs',()=>{
 const input=fixture();
 input.policy.slots[1].waterSource='reclaimed';
 input.tasks[0].allowedWaterSources=['fresh','reclaimed'];
 const before=structuredClone(input);
 deepFreeze(input);
 const result=evaluate(input);
 assert.equal(result.status,'safe_candidate');
 assert.equal(result.metrics.freshWaterM3,11);
 assert.deepEqual(input,before);
 const fresh=fixture();
 assert.equal(evaluate(fresh).status,'safe_candidate');
});

test('present malformed sources retain the stricter snapshot rejection',()=>{
 for(const value of [undefined,null,'',' ',false,0,[],{}]){
  const input=fixture();
  input.policy.slots[1].waterSource=value;
  assertUnsafe(input,{status:'blocked',reason:'water_slots_invalid'});
 }
});
