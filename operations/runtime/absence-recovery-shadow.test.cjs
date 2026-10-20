'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {buildAbsenceRecoveryShadow}=require('./absence-recovery-shadow.cjs');

function input(){
  return {
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
  };
}
test('builds first factory-autopilot shadow decision from simulated candidates',()=>{
  const result=buildAbsenceRecoveryShadow(input());
  assert.equal(result.shadowOnly,true);
  assert.equal(result.executionPermitted,false);
  assert.equal(result.episode.recommendation.optionId,'redeploy');
});
test('requires skills and source evidence',()=>{
  assert.throws(()=>buildAbsenceRecoveryShadow({triggerKind:'ABSENCE'}),/required skill|Source evidence/);
});

test('published shadow constraints and episode cannot change under the same identity',()=>{
  const result=buildAbsenceRecoveryShadow(input());
  const before=JSON.stringify(result),identity=result.episode.episodeId;
  for(const mutate of [
    ()=>{result.requiredSkills[0]='unverified-skill';},
    ()=>{result.affectedLines.push('different-line');},
    ()=>{result.episode.recommendation.optionId='agency';},
    ()=>{result.episode.recommendation.executionPermitted=true;},
    ()=>{result.episode.recommendation.ranking[0].score=100;},
    ()=>{result.episode.options[0].prediction.labourCost=999;},
    ()=>{result.episode.options[0].evidenceRefs.push('unverified-source');},
    ()=>{result.episode.sourceEvidence.splice(0);},
    ()=>{result.episode.objective.weights.labourCost=1;}
  ])assert.throws(mutate,TypeError);
  assert.equal(result.episode.episodeId,identity);
  assert.equal(JSON.stringify(result),before);
  function frozen(value){
    if(!value||typeof value!=='object')return;
    assert.equal(Object.isFrozen(value),true);
    for(const child of Object.values(value))frozen(child);
  }
  frozen(result);
});

test('serialized advice matches the pinned canonical base golden digest',()=>{
  // SHA-256 of JSON.stringify(buildAbsenceRecoveryShadow(input())) generated
  // from BOTH modules at canonical 48dce8f697825c8cd5f99b3e5aeea3953647f8c2.
  // Base absence module blob: 0051f54d3ee78e306fbc8c4657983d7d416eeb9e.
  // This literal must not be regenerated from the implementation under test.
  const serialized=JSON.stringify(buildAbsenceRecoveryShadow(input()));
  assert.equal(createHash('sha256').update(serialized).digest('hex'),
    'c109c04632ebcfbe35d1782bfe3dfe0da5a32d58918ddcc680d59eb5116817fb');
});

test('freezing an absence result keeps caller data mutable and detached',()=>{
  const source=input(),expected=JSON.stringify(buildAbsenceRecoveryShadow(source));
  const result=buildAbsenceRecoveryShadow(source);
  source.requiredSkills.push('later-skill');
  source.affectedLines[0]='later-line';
  source.sourceEvidence.push('later-source');
  source.candidates[0].prediction.labourCost=800;
  source.candidates[0].evidenceRefs.push('later-ref');
  source.objective.labourCost=1;
  assert.equal(Object.isFrozen(source.candidates[0].prediction),false);
  assert.equal(JSON.stringify(result),expected);
  const restored=JSON.parse(JSON.stringify(result));
  assert.equal(restored.episode.recommendation.optionId,'redeploy');
  assert.equal(restored.shadowOnly,true);
  assert.equal(restored.executionPermitted,false);
  assert.equal(restored.episode.recommendation.executionPermitted,false);
});
