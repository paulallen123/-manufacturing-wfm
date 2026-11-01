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

// V047 current-base owned-output boundaries. No source/actor/cost authority is inferred.
{
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),path=require('node:path');
const {buildAbsenceRecoveryShadow:build}=require('./absence-recovery-shadow.cjs');
function input(){return {
 tenant:'alpha',site:'tamworth',triggerKind:'ABSENCE',triggerId:'absence:42',
 triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',
 requiredSkills:['welding-l2'],affectedLines:['line-4'],
 sourceEvidence:['absence:42','skills:line-4','production:plan-a'],
 objective:{labourCost:0.25,planAttainmentPct:0.55,riskScore:0.2,uncertaintyPenalty:0.1},
 candidates:[
  {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:0,planAttainmentPct:80,riskScore:2},evidenceRefs:['sim:a']},
  {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:120,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:b']},
  {id:'agency',feasible:false,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.2,prediction:{labourCost:400,planAttainmentPct:100,riskScore:1},evidenceRefs:['sim:c']}
 ]};}
function allFrozen(v){if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);Object.values(v).forEach(allFrozen);}}
test('required skills reject in-place insertion and replacement',()=>{
 for(const mutate of [r=>r.requiredSkills.push('unreviewed'),r=>{r.requiredSkills[0]='unreviewed';},r=>r.requiredSkills.splice(0)]){const r=build(input()),before=JSON.stringify(r);assert.throws(()=>mutate(r),TypeError);assert.equal(JSON.stringify(r),before);}
});
test('affected lines reject additions, deletions and reordering of owned arrays',()=>{
 for(const mutate of [r=>r.affectedLines.push('other'),r=>r.affectedLines.pop(),r=>{r.affectedLines[0]='other';}]){const r=build(input()),before=JSON.stringify(r);assert.throws(()=>mutate(r),TypeError);assert.equal(JSON.stringify(r),before);}
});
test('entire published normalized result graph is frozen, including wrapper-only metadata',()=>allFrozen(build(input())));
test('current shared episode already rejects nested recommendation, prediction and evidence mutation',()=>{
 const r=build(input()),before=JSON.stringify(r);
 for(const mutate of [()=>{r.episode.recommendation.optionId='agency';},()=>{r.episode.recommendation.executionPermitted=true;},()=>{r.episode.options[0].prediction.labourCost=999;},()=>r.episode.options[0].evidenceRefs.push('unapproved')])assert.throws(mutate,TypeError);
 assert.equal(JSON.stringify(r),before);
});
test('caller owned inputs remain mutable and detached from issued advice',()=>{
 const x=input(),r=build(x),before=JSON.stringify(r);
 x.requiredSkills.push('later');x.affectedLines[0]='later';x.sourceEvidence.push('later');x.candidates[0].prediction.labourCost=900;x.candidates[0].evidenceRefs.push('later');x.objective.labourCost=1;
 assert.equal(Object.isFrozen(x),false);assert.equal(Object.isFrozen(x.requiredSkills),false);assert.equal(Object.isFrozen(x.candidates[0].prediction),false);assert.equal(JSON.stringify(r),before);
});
test('serialized fixture retains the literal prechange canonical and donor golden',()=>{
 const bytes=JSON.stringify(build(input()));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'c109c04632ebcfbe35d1782bfe3dfe0da5a32d58918ddcc680d59eb5116817fb');
});
test('owned list normalization still deduplicates without editing caller lists',()=>{
 const x=input();x.requiredSkills=[' welding-l2 ','welding-l2'];x.affectedLines=[' line-4 ','line-4'];const before=JSON.stringify(x),r=build(x);
 assert.deepEqual(r.requiredSkills,['welding-l2']);assert.deepEqual(r.affectedLines,['line-4']);assert.equal(JSON.stringify(x),before);
});
test('missing weighted cost remains unknown and yields no ranked recommendation',()=>{
 const x=input();x.objective={labourCost:1};for(const c of x.candidates)c.prediction={labourCost:null};
 const r=build(x);assert.equal(r.episode.recommendation.optionId,null);assert.equal(r.episode.recommendation.reason,'MISSING_WEIGHTED_METRICS');assert.deepEqual(r.episode.recommendation.ranking,[]);
 for(const c of r.episode.options)assert.equal(c.prediction.labourCost,null);
});
test('explicit declared zero cost remains different from a missing cost',()=>{
 const x=input();x.objective={labourCost:1};x.candidates=x.candidates.slice(0,2);x.candidates[0].uncertainty=0;x.candidates[1].uncertainty=0;
 const r=build(x);assert.equal(r.episode.recommendation.optionId,'do-nothing');assert.equal(r.episode.options.find(c=>c.id==='do-nothing').prediction.labourCost,0);
 assert.equal(r.executionPermitted,false);
});
test('declared hard eligibility gates exclude a cheaper or better-looking response',()=>{
 const x=input();x.objective={labourCost:1};x.candidates[0].prediction.labourCost=20;x.candidates[1].prediction.labourCost=10;
 for(const field of ['feasible','policyAllowed','hardConstraintsPassed']){const y=structuredClone(x);y.candidates[1][field]=false;assert.equal(build(y).episode.recommendation.optionId,'do-nothing');}
});
test('required trigger, skills, source references and scenario choices are not invented',()=>{
 for(const change of [x=>{x.triggerKind='UNKNOWN';},x=>{x.requiredSkills=[];},x=>{x.sourceEvidence=[];},x=>{x.candidates=[x.candidates[0]];},x=>{x.candidates=x.candidates.filter(c=>c.id!=='do-nothing');}]){
  const x=input();change(x);assert.throws(()=>build(x));
 }
});
test('caller approval fields cannot grant execution or source authority',()=>{
 const x=input();x.mode='POLICY_BOUNDED';x.executionPermitted=true;x.sourceAuthenticated=true;x.coverReceipt={approved:true};x.candidates[1].executionPermitted=true;
 const r=build(x);assert.equal(r.shadowOnly,true);assert.equal(r.executionPermitted,false);assert.equal(r.episode.mode,'SHADOW');assert.equal(r.episode.recommendation.executionPermitted,false);assert.equal(r.episode.recommendation.authorityRequired,'NO_EXECUTION');assert.equal(Object.hasOwn(r,'sourceAuthenticated'),false);
});
test('qualified-labour-shortage advice keeps the same non-executable contract',()=>{
 const x=input();x.triggerKind='QUALIFIED_LABOUR_SHORTAGE';const r=build(x);assert.equal(r.triggerKind,x.triggerKind);assert.equal(r.shadowOnly,true);assert.equal(r.executionPermitted,false);assert.equal(r.episode.mode,'SHADOW');
});
test('JSON transport is detached plain data and does not claim client-side freezing',()=>{
 const r=build(input()),serialized=JSON.stringify(r),readback=JSON.parse(serialized);
 assert.deepEqual(readback,r);assert.equal(Object.isFrozen(readback.requiredSkills),false);readback.requiredSkills.push('client-local');
 assert.equal(JSON.stringify(r),serialized);assert.equal(readback.executionPermitted,false);
});


}
