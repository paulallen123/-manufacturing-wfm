'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planTrainingRegeneration}=require('./training-regeneration-planner.cjs');

test('change impact regenerates only dependency-linked capture-ready role variants',()=>{
  const plan=planTrainingRegeneration({
    changedDependencies:['absence'],
    roles:['employee','manager'],
    locales:['en-GB'],
    productSha:'1234567890abcdef1234567890abcdef12345678',
    targetOrigin:'https://vector.example'
  });
  assert.ok(plan.competencies.includes('absence.request'));
  assert.ok(plan.jobs.some(job=>job.competencyKey==='absence.request'&&job.role==='employee'));
  assert.ok(plan.jobs.every(job=>job.sourceClass==='SYNTHETIC'));
});
test('unproven locale is identified rather than silently publishing English content under another locale',()=>{
  const plan=planTrainingRegeneration({
    changedDependencies:['absence'],roles:['employee'],locales:['fr-FR'],
    productSha:'1234567890abcdef1234567890abcdef12345678',
    targetOrigin:'https://vector.example'
  });
  assert.equal(plan.jobs.length,0);
  assert.ok(plan.localisationRequired.length>0);
});

test('explicit empty role scope cannot expand to every default training role',()=>{
  const base={changedDependencies:['absence'],productSha:'1234567890abcdef1234567890abcdef12345678',targetOrigin:'https://vector.example'};
  for(const roles of [[],[''],{}]){
    assert.throws(()=>planTrainingRegeneration({...base,roles}),error=>error.statusCode===400&&/roles/i.test(error.message));
  }
  assert.ok(planTrainingRegeneration(base).jobs.length>0,'omitted roles retain the documented default scope');
});
