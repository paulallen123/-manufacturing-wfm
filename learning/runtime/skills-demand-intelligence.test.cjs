'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSkillsDemand}=require('./skills-demand-intelligence.cjs');

function profile(status,score,dueAt,mode='PRACTISE'){
  return {contractVersion:'VECTOR_TRAINING_TWIN_V1',competencies:[{competencyKey:'line4',status,score,dueAt,recommendedMode:mode,recentHelp:0}]};
}

test('identifies verified production skill gap without granting authority',()=>{
  const result=evaluateSkillsDemand({tenant:'alpha',site:'tamworth',requirement:{competencyKey:'line4',requiredCount:2,at:'2026-09-25T06:00:00Z',verified:true,sourceRef:'mes:demand:4'},people:[
    {personRef:'p1',tenant:'alpha',site:'tamworth',available:true,trainingProfile:profile('MASTERED',92,'2026-12-01T00:00:00Z','NONE')},
    {personRef:'p2',tenant:'alpha',site:'tamworth',available:true,trainingProfile:profile('IN_PROGRESS',72,'2026-10-01T00:00:00Z','PRACTISE')}
  ]});
  assert.equal(result.gapCount,1);
  assert.deepEqual(result.qualifiedNow,['p1']);
  assert.equal(result.trainingCandidates[0].personRef,'p2');
  assert.equal(result.executionPermitted,false);
  assert.equal(result.authority,'RECOMMENDATION_ONLY');
});

test('rejects unverified demand evidence',()=>{
  assert.throws(()=>evaluateSkillsDemand({tenant:'alpha',site:'tamworth',requirement:{competencyKey:'line4',requiredCount:1,at:'2026-09-25T06:00:00Z',verified:false,sourceRef:'guess'},people:[]}),/verified authoritative/);
});

test('rejects cross-tenant person evidence',()=>{
  assert.throws(()=>evaluateSkillsDemand({tenant:'alpha',site:'tamworth',requirement:{competencyKey:'line4',requiredCount:1,at:'2026-09-25T06:00:00Z',verified:true,sourceRef:'mes:demand'},people:[{personRef:'p1',tenant:'beta',available:true,trainingProfile:profile('MASTERED',90,'2026-12-01T00:00:00Z')}]}),/Cross-tenant/);
});
