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
 const r=reconcileWaterOutcome({recommendation:{id:'R1',predictedFreshWaterM3:11},decision:{status:'accepted'},observed:{authoritative:true,actualFreshWaterM3:12.5},operations:{authoritative:true,productionCompleted:true},financial:{authoritative:true,realisedWaterCost:20}});
 assert.equal(r.status,'reconciled');
 assert.equal(r.calibration.waterErrorM3,1.5);
});
