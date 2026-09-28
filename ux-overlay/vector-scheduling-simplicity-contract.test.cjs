'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {UX_BUDGET,buildSchedulingTaskExperience,simplicityContract}=require('./vector-scheduling-simplicity-contract.cjs');

function plan(o={}){
  return {planId:'p1',contextRevision:'t1',quality:{coveragePct:100,unfilledSlots:0,overtimeHours:0,labourCost:640,fatigueRiskAssignments:0},unfilled:[],...o};
}
test('ready schedule adds no button just to prove the feature exists',()=>{
  const v=buildSchedulingTaskExperience({plan:plan()});
  assert.equal(v.status,'READY');
  assert.equal(v.primaryAction,null);
  assert.equal(v.secondaryAction,null);
  assert.equal(v.userTaskCount,0);
  assert.equal(v.metrics.length<=3,true);
});
test('coverage gap presents one outcome action and hides optimiser complexity',()=>{
  const v=buildSchedulingTaskExperience({plan:plan({
    quality:{coveragePct:88,unfilledSlots:2,overtimeHours:4,labourCost:720,fatigueRiskAssignments:0},
    unfilled:[{topReasons:[{reason:'MISSING_SKILL:welding-l3'},{reason:'MINIMUM_REST_BREACH'},{reason:'NOT_AVAILABLE'}]}]
  })});
  assert.equal(v.status,'COVERAGE_GAP');
  assert.equal(v.primaryAction.label,'Review cover');
  assert.equal(v.secondaryAction.label,'View details');
  assert.equal(v.userTaskCount,1);
  assert.equal(v.details.defaultOpen,false);
  assert.equal(v.details.reasons.length,2);
  assert.doesNotMatch(v.primaryAction.label,/AI|optim|solver|recalculate/i);
});
test('repair is reduced to one manager decision',()=>{
  const v=buildSchedulingTaskExperience({plan:plan(),repair:{changeCount:3}});
  assert.equal(v.status,'REPAIR_READY');
  assert.equal(v.primaryAction.label,'Review change');
  assert.equal(v.userTaskCount,1);
});
test('fatigue risk does not create multiple competing controls',()=>{
  const v=buildSchedulingTaskExperience({plan:plan({quality:{coveragePct:100,unfilledSlots:0,overtimeHours:7,labourCost:850,fatigueRiskAssignments:2}})});
  assert.equal(v.primaryAction.label,'Review risk');
  assert.equal(v.metrics.length<=UX_BUDGET.maxVisibleMetrics,true);
});
test('complexity budget forbids new scheduling navigation and permanent panels',()=>{
  const c=simplicityContract();
  assert.equal(c.budget.topLevelNavigationAdditions,0);
  assert.equal(c.budget.planTabAdditions,0);
  assert.equal(c.budget.permanentPanelsAdded,0);
  assert.equal(c.budget.maxPrimaryActionsPerTask,1);
});
test('canonical VECTOR navigation remains five sections with no scheduling-specific top level',()=>{
  const shell=fs.readFileSync(path.join(__dirname,'vector-shell.js'),'utf8');
  for(const label of ['Today','People','Plan','Factory','Improve']) assert.match(shell,new RegExp("label:'"+label+"'"));
  assert.doesNotMatch(shell,/label:'Scheduling'/);
  assert.doesNotMatch(shell,/label:'Optimisation'/);
});
