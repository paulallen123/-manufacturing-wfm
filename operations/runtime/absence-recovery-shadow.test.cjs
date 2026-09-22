'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildAbsenceRecoveryShadow}=require('./absence-recovery-shadow.cjs');

test('builds first factory-autopilot shadow decision from simulated candidates',()=>{
  const result=buildAbsenceRecoveryShadow({
    tenant:'alpha',site:'tamworth',triggerKind:'ABSENCE',triggerId:'absence:42',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',
    requiredSkills:['welding-l2'],affectedLines:['line-4'],
    sourceEvidence:['absence:42','skills:line-4','production:plan-a'],
    objective:{labourCost:0.25,planAttainmentPct:0.55,riskScore:0.2,uncertaintyPenalty:0.1},
    candidates:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:0,planAttainmentPct:80,riskScore:2},evidenceRefs:['sim:a']},
      {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:120,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:b']},
      {id:'agency',feasible:false,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.2,prediction:{labourCost:400,planAttainmentPct:100,riskScore:1},evidenceRefs:['sim:c']}
    ]
  });
  assert.equal(result.shadowOnly,true);
  assert.equal(result.executionPermitted,false);
  assert.equal(result.episode.recommendation.optionId,'redeploy');
});
test('requires skills and source evidence',()=>{
  assert.throws(()=>buildAbsenceRecoveryShadow({triggerKind:'ABSENCE'}),/required skill|Source evidence/);
});
