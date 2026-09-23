'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSchedulingPlan,evaluateOpenShift,evaluateSwap,repairSchedulingPlan,capabilityContract}=require('./manufacturing-scheduling-engine.cjs');

const baseReq={id:'line4-welder',site:'tamworth',line:'line-4',role:'welder',start:'2026-09-24T06:00:00Z',end:'2026-09-24T14:00:00Z',
  headcount:1,requiredSkills:['welding-l3'],requiredCertifications:['weld-cert'],tags:['DAY'],productionPriority:90,customerPriority:85,marginAtRisk:8000,evidenceRefs:['mes:44']};
function worker(id,o={}){
  return {id,type:'EMPLOYEE',status:'ACTIVE',homeSite:'tamworth',eligibleSites:['tamworth'],skills:['welding-l3'],
    certifications:[{name:'weld-cert',expiresAt:'2027-01-01T00:00:00Z'}],
    availability:[{start:'2026-09-24T05:00:00Z',end:'2026-09-24T23:00:00Z'}],
    previousShiftEnd:'2026-09-23T18:00:00Z',hoursWorkedWeek:24,contractedHours:40,hourlyCost:20,
    fairness:{},preferences:{},evidenceRefs:['hr:'+id],...o};
}
function input(o={}){
  return {tenant:'alpha',contextRevision:'twin:1',createdAt:'2026-09-23T12:00:00Z',sourceEvidence:['mes:44','hr:9','policy:uk'],
    policy:{minRestHours:11,maxWeeklyHours:48,maxOvertimeHours:8,ruleVersion:'uk-site-v3'},
    workers:[worker('a'),worker('b',{hourlyCost:24})],requirements:[baseReq],...o};
}
test('lower controllable cost wins without execution authority',()=>{
  const p=createSchedulingPlan(input());
  assert.equal(p.assignments[0].workerId,'a'); assert.equal(p.quality.coveragePct,100); assert.equal(p.executionPermitted,false); assert.equal(p.validation.valid,true);
});
test('hard constraints fail closed and explain shortfall',()=>{
  const bad=worker('bad',{skills:[],certifications:[{name:'weld-cert',expiresAt:'2026-09-24T08:00:00Z'}],
    availability:[{start:'2026-09-24T07:00:00Z',end:'2026-09-24T15:00:00Z'}],previousShiftEnd:'2026-09-24T01:00:00Z'});
  const p=createSchedulingPlan(input({workers:[bad]})),reasons=p.unfilled[0].topReasons.map(x=>x.reason);
  assert.equal(p.quality.coveragePct,0); assert.ok(reasons.includes('MISSING_SKILL:welding-l3')); assert.ok(reasons.includes('CERTIFICATION_INVALID:weld-cert')); assert.ok(reasons.includes('MINIMUM_REST_BREACH'));
});
test('cross-site internal labour competes economically with agency',()=>{
  const internal=worker('internal',{homeSite:'birmingham',eligibleSites:['birmingham','tamworth'],hourlyCost:21,travelCostBySite:{tamworth:15},travelMinutesBySite:{tamworth:45}});
  const agency=worker('agency',{type:'AGENCY',hourlyCost:19,agencyPremiumPerHour:14});
  const p=createSchedulingPlan(input({workers:[internal,agency]}));
  assert.equal(p.assignments[0].workerId,'internal'); assert.equal(p.quality.agencyHours,0);
});
test('open shift evaluation includes rejection reasons',()=>{
  const r=evaluateOpenShift({requirement:baseReq,workers:[worker('ok'),worker('no',{skills:[]})],policy:{}});
  assert.equal(r.ranked[0].workerId,'ok'); assert.ok(r.ranked.find(x=>x.workerId==='no').failures.includes('MISSING_SKILL:welding-l3'));
});
test('swap refuses a qualification breach',()=>{
  const packing={...baseReq,id:'packing',role:'packer',requiredSkills:['packing'],requiredCertifications:[]};
  const r=evaluateSwap({workerA:worker('a'),workerB:worker('b',{skills:['packing']}),requirementA:baseReq,requirementB:packing,policy:{}});
  assert.equal(r.eligible,false); assert.ok(r.reasons.includes('MISSING_SKILL:welding-l3'));
});
test('repair removes unavailable worker and remains shadow only',()=>{
  const reqs=[baseReq,{...baseReq,id:'second',start:'2026-09-24T14:00:00Z',end:'2026-09-24T22:00:00Z'}],workers=[worker('a'),worker('b',{hourlyCost:22})];
  const prior=createSchedulingPlan(input({workers,requirements:reqs})),lost=prior.assignments.find(x=>x.workerId).workerId;
  const r=repairSchedulingPlan({priorPlan:prior,workers,requirements:reqs,contextRevision:'twin:2',event:{type:'NO_SHOW',unavailableWorkerIds:[lost],evidenceRef:'clock:1'},sourceEvidence:['clock:1']});
  assert.equal(r.executionPermitted,false); assert.ok(r.changeCount>=1); assert.equal(r.repairedPlan.assignments.some(x=>x.workerId===lost),false);
});
test('uncertain forecast plans p90 without claiming forecasting model accuracy',()=>{
  const p=createSchedulingPlan(input({workers:[worker('a'),worker('b')],requirements:[{...baseReq,headcount:undefined,forecast:{p50Headcount:1,p90Headcount:2,confidence:0.5}}]}));
  assert.equal(p.assignments.length,2); assert.equal(p.quality.coveragePct,100);
});
test('capability contract is explicit about limits',()=>{
  const c=capabilityContract(); assert.equal(c.tableStakes.shiftSwapValidation,true); assert.equal(c.differentiation.marginAtRisk,true); assert.ok(c.notClaimed.includes('production-autonomous-scheduling'));
});
