import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateControlledEnvironmentPlan,compareControlledEnvironmentPlans} from './controlled-environment-flow.mjs';

const now='2026-09-20T21:30:00Z';
const policy={
  authoritative:true,siteId:'S1',version:'ccs-12',ref:'qms:ccs:12',
  observedAt:'2026-09-20T21:00:00Z',maxAgeMinutes:120,defaultOutsideZone:'OUT',
  zones:{D:{maxPersonnel:4},C:{maxPersonnel:3},B:{maxPersonnel:2}},
  transitions:[
    {from:'OUT',to:'D',allowed:true,gowningCycle:true,controlMinutes:5,controlCost:8},
    {from:'OUT',to:'C',allowed:true,gowningCycle:true,controlMinutes:8,controlCost:12},
    {from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:12,controlCost:18},
    {from:'D',to:'C',allowed:true,gowningCycle:true,controlMinutes:6,controlCost:9},
    {from:'C',to:'D',allowed:true,gowningCycle:false,controlMinutes:3,controlCost:2},
    {from:'C',to:'B',allowed:true,gowningCycle:true,controlMinutes:7,controlCost:11},
    {from:'B',to:'C',allowed:true,gowningCycle:false,controlMinutes:4,controlCost:3},
    {from:'D',to:'B',allowed:false},
    {from:'B',to:'D',allowed:false}
  ]
};
const workers=[
 {id:'W1',siteId:'S1',skills:['fill','inspect'],qualifiedZones:['D','C','B'],currentZone:'OUT'},
 {id:'W2',siteId:'S1',skills:['fill','inspect'],qualifiedZones:['D','C','B'],currentZone:'OUT'}
];
const tasks=[
 {id:'T1',siteId:'S1',slot:1,zone:'B',skill:'fill',requiredHeadcount:1},
 {id:'T2',siteId:'S1',slot:2,zone:'B',skill:'inspect',requiredHeadcount:1},
 {id:'T3',siteId:'S1',slot:3,zone:'C',skill:'inspect',requiredHeadcount:1}
];

test('ranks the equally valid plan with fewer controlled-environment transitions first',()=>{
 const plans=[
  {id:'split',assignments:[{taskId:'T1',workerId:'W1'},{taskId:'T2',workerId:'W2'},{taskId:'T3',workerId:'W1'}]},
  {id:'continuous',assignments:[{taskId:'T1',workerId:'W1'},{taskId:'T2',workerId:'W1'},{taskId:'T3',workerId:'W1'}]}
 ];
 const r=compareControlledEnvironmentPlans({policy,workers,tasks,plans,now});
 assert.equal(r.status,'ranked');
 assert.equal(r.preferred.planId,'continuous');
 assert.ok(r.safe[0].metrics.gowningCycles<r.safe[1].metrics.gowningCycles);
});

test('stale or non-authoritative contamination-control policy blocks scoring',()=>{
 const stale=structuredClone(policy);stale.observedAt='2026-09-19T00:00:00Z';
 assert.equal(evaluateControlledEnvironmentPlan({policy:stale,workers,tasks,plan:{id:'p',assignments:[]},now}).reason,'policy_stale');
 const non=structuredClone(policy);non.authoritative=false;
 assert.equal(evaluateControlledEnvironmentPlan({policy:non,workers,tasks,plan:{id:'p',assignments:[]},now}).reason,'policy_not_authoritative');
});

test('missing cleanroom qualification is rejected before optimization',()=>{
 const ws=structuredClone(workers);ws[0].qualifiedZones=['C','D'];
 const plan={id:'bad',assignments:[{taskId:'T1',workerId:'W1'},{taskId:'T2',workerId:'W2'},{taskId:'T3',workerId:'W1'}]};
 assert.equal(evaluateControlledEnvironmentPlan({policy,workers:ws,tasks,plan,now}).reason,'zone_qualification_missing');
});

test('unapproved zone transition is never traded for efficiency',()=>{
 const jumpTasks=[
  {id:'A',siteId:'S1',slot:1,zone:'D',skill:'fill',requiredHeadcount:1},
  {id:'B',siteId:'S1',slot:2,zone:'B',skill:'fill',requiredHeadcount:1}
 ];
 const r=evaluateControlledEnvironmentPlan({policy,workers,tasks:jumpTasks,plan:{id:'badjump',assignments:[{taskId:'A',workerId:'W1'},{taskId:'B',workerId:'W1'}]},now});
 assert.equal(r.reason,'transition_not_approved');
});

test('zone occupancy limits remain hard constraints',()=>{
 const small=structuredClone(policy);small.zones.B.maxPersonnel=1;
 const parallel=[
  {id:'P1',siteId:'S1',slot:1,zone:'B',skill:'fill',requiredHeadcount:1},
  {id:'P2',siteId:'S1',slot:1,zone:'B',skill:'inspect',requiredHeadcount:1}
 ];
 const plan={id:'crowded',assignments:[{taskId:'P1',workerId:'W1'},{taskId:'P2',workerId:'W2'}]};
 assert.equal(evaluateControlledEnvironmentPlan({policy:small,workers,tasks:parallel,plan,now}).reason,'zone_occupancy_exceeded');
});

test('cross-site workers or tasks fail closed',()=>{
 const ws=structuredClone(workers);ws[0].siteId='S2';
 assert.equal(evaluateControlledEnvironmentPlan({policy,workers:ws,tasks,plan:{id:'x',assignments:[]},now}).reason,'worker_site_mismatch');
});

test('one-person site returns an honest no-improvement case rather than inventing capacity',()=>{
 const one=[workers[0]];
 const oneTasks=[tasks[0],tasks[1]];
 const only={id:'only',assignments:[{taskId:'T1',workerId:'W1'},{taskId:'T2',workerId:'W1'}]};
 const r=compareControlledEnvironmentPlans({policy,workers:one,tasks:oneTasks,plans:[only],now});
 assert.equal(r.status,'ranked');
 assert.equal(r.safe.length,1);
 assert.equal(r.preferred.planId,'only');
});
