'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildArtifactFingerprint,buildTrainingModule,affectedCompetencies}=require('./training-workflow-manifest.cjs');

test('artifact fingerprint binds workflow, role, locale and exact product identity',()=>{
  const base={competencyKey:'schedule.recover',role:'manager',locale:'en-GB',productSha:'abc',configurationClass:'standard'};
  const a=buildArtifactFingerprint(base).fingerprint;
  const b=buildArtifactFingerprint({...base,locale:'fr-FR'}).fingerprint;
  const c=buildArtifactFingerprint({...base,productSha:'def'}).fingerprint;
  assert.notEqual(a,b);assert.notEqual(a,c);
});
test('show and guide never award mastery; test requires independent task evidence',()=>{
  assert.equal(buildTrainingModule({competencyKey:'schedule.recover',role:'manager',mode:'SHOW_ME',productSha:'abc'}).evidencePolicy,'NO_MASTERY_FROM_DELIVERY');
  assert.equal(buildTrainingModule({competencyKey:'schedule.recover',role:'manager',mode:'GUIDE_ME',productSha:'abc'}).exposureOnly,true);
  assert.equal(buildTrainingModule({competencyKey:'schedule.recover',role:'manager',mode:'TEST_ME',productSha:'abc'}).evidencePolicy,'OBSERVED_INDEPENDENT_TASK_REQUIRED');
});
test('dependency impact graph identifies only affected competencies',()=>{
  const affected=affectedCompetencies(['autopilot']);
  assert.ok(affected.includes('schedule.recover'));
  assert.ok(!affected.includes('time.clock'));
});


test('director is an administrator for training delivery',()=>{
 const module=buildTrainingModule({competencyKey:'configuration.policy',role:'director',mode:'GUIDE_ME',productSha:'abc'});
 assert.equal(module.role,'admin');
});

test('every assigned base competency has a usable guide for its role',()=>{
 const {ROLE_CURRICULA}=require('./adaptive-learning-engine.cjs');
 for(const [role,keys] of Object.entries(ROLE_CURRICULA)) for(const competencyKey of keys){
  const module=buildTrainingModule({competencyKey,role,mode:'GUIDE_ME',productSha:'abc'});
  assert.ok(module.steps.length>=3,role+' '+competencyKey);
  assert.equal(module.evidencePolicy,'NO_MASTERY_FROM_DELIVERY');
 }
});
