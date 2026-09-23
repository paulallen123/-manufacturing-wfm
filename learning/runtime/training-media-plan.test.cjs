'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createTrainingMediaPlan}=require('./training-media-plan.cjs');

test('media plan creates 1080p narrated scenes but never claims mastery',()=>{
  const module=buildTrainingModule({competencyKey:'schedule.recover',role:'manager',mode:'SHOW_ME',locale:'en-GB',productSha:'1234567890abcdef1234567890abcdef12345678'});
  const plan=createTrainingMediaPlan(module,{productSha:'1234567890abcdef1234567890abcdef12345678'});
  assert.equal(plan.resolution.width,1920);
  assert.equal(plan.narrationJob.voiceProfile.id,'vector-guide-v1');
  assert.ok(plan.scenes.length>module.steps.length);
  assert.match(plan.learningBoundary,/never awards mastery/i);
});
