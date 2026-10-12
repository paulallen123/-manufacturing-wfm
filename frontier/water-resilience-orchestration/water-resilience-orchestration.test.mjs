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

test('outcome learning preserves predicted vs realised water',()=>{
 const r=reconcileWaterOutcome({recommendation:{id:'R1',tenantId:'A',siteId:'S1',predictedFreshWaterM3:11},decision:{status:'accepted',recommendationId:'R1',tenantId:'A',siteId:'S1'},observed:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',actualFreshWaterM3:12.5},operations:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',productionCompleted:true},financial:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',realisedWaterCost:20}});
 assert.equal(r.status,'reconciled');
 assert.equal(r.calibration.waterErrorM3,1.5);
});
test('whitespace-padded accepted status cannot bypass tenant and recommendation evidence checks',()=>{
 const input={recommendation:{id:'R1',tenantId:'A',siteId:'S1',predictedFreshWaterM3:10},decision:{status:' accepted ',recommendationId:'R1',tenantId:'A',siteId:'S1'},observed:{authoritative:true,recommendationId:'R2',tenantId:'B',siteId:'S2',actualFreshWaterM3:99},operations:{authoritative:true,recommendationId:'R2',tenantId:'B',siteId:'S2',productionCompleted:true}};
 assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'outcome_attribution_invalid'});
 input.observed.recommendationId='R1';input.observed.tenantId='A';input.observed.siteId='S1';
 input.operations.recommendationId='R1';input.operations.tenantId='A';input.operations.siteId='S1';
 assert.equal(reconcileWaterOutcome(input).status,'reconciled');
 input.decision.status=' rejected ';
 assert.deepEqual(reconcileWaterOutcome(input),{status:'recorded',outcomeClass:'rejected_by_human',recommendationId:'R1'});
});

test('foreign or unbound outcome evidence cannot calibrate a recommendation',()=>{
 const base={recommendation:{id:'R1',tenantId:'A',siteId:'S1',predictedFreshWaterM3:11},decision:{status:'accepted',recommendationId:'R1',tenantId:'A',siteId:'S1'},observed:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',actualFreshWaterM3:12.5},operations:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',productionCompleted:true},financial:{authoritative:true,recommendationId:'R1',tenantId:'A',siteId:'S1',realisedWaterCost:20}};
 for(const field of ['decision','observed','operations','financial']){
  for(const [key,value] of [['recommendationId','R2'],['tenantId','B'],['siteId','S2'],['recommendationId',undefined],['tenantId',undefined],['siteId',undefined]]){
   const input=structuredClone(base);input[field][key]=value;
   const result=reconcileWaterOutcome(input);
   assert.equal(result.status,'incomplete',`${field}.${key}=${value}`);
   assert.equal(result.reason,'outcome_attribution_invalid');
  }
 }
 assert.deepEqual(reconcileWaterOutcome({...base,recommendation:{...base.recommendation,siteId:undefined}}),{status:'incomplete',reason:'outcome_attribution_invalid'});
 assert.deepEqual(reconcileWaterOutcome({...base,recommendation:{...base.recommendation,tenantId:undefined}}),{status:'incomplete',reason:'outcome_attribution_invalid'});
 const rejected=structuredClone(base);rejected.decision.status='rejected';
 assert.equal(reconcileWaterOutcome(rejected).outcomeClass,'rejected_by_human');
 rejected.decision.recommendationId='R2';
 assert.deepEqual(reconcileWaterOutcome(rejected),{status:'incomplete',reason:'outcome_attribution_invalid'});
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

test('raw opaque recommendation, tenant and site IDs never join padded receipt aliases',()=>{
 const example=()=>({recommendation:{id:'R',tenantId:'T',siteId:'S',predictedFreshWaterM3:10},decision:{status:'accepted',recommendationId:'R',tenantId:'T',siteId:'S'},observed:{authoritative:true,recommendationId:'R',tenantId:'T',siteId:'S',actualFreshWaterM3:11},operations:{authoritative:true,recommendationId:'R',tenantId:'T',siteId:'S',productionCompleted:true}});
 for(const source of ['decision','observed','operations'])for(const field of ['recommendationId','tenantId','siteId']){
  const input=example();input[source][field]=' '+input[source][field]+' ';
  assert.deepEqual(reconcileWaterOutcome(input),{status:'incomplete',reason:'outcome_attribution_invalid'});
 }
});

test('untrusted optional financial row cannot block valid operational outcome',()=>{
 const r=reconcileWaterOutcome({recommendation:{id:'R',tenantId:'T',siteId:'S',predictedFreshWaterM3:10},decision:{status:'accepted',recommendationId:'R',tenantId:'T',siteId:'S'},observed:{authoritative:true,recommendationId:'R',tenantId:'T',siteId:'S',actualFreshWaterM3:11},operations:{authoritative:true,recommendationId:'R',tenantId:'T',siteId:'S',productionCompleted:true},financial:{authoritative:false,realisedWaterCost:99}});
 assert.equal(r.status,'reconciled');assert.equal(r.realised.realisedWaterCost,null);assert.equal(r.calibration.waterErrorM3,1);
});
