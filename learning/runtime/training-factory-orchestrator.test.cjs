'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planTrainingFactoryRun}=require('./training-factory-orchestrator.cjs');

test('factory fails closed before source approval',()=>{
  const plan=planTrainingFactoryRun({evidence:{}});
  assert.ok(plan.blockers.includes('SOURCE_APPROVAL'));
  assert.equal(plan.publishable,false);
});
test('high-risk training cannot bypass human review',()=>{
  const plan=planTrainingFactoryRun({highRisk:true,evidence:{sources:'APPROVED',authoring:'APPROVED',manifest:'READY'}});
  assert.ok(plan.blockers.includes('REVIEW'));
});
test('complete quality evidence yields a publishable factory plan',()=>{
  const plan=planTrainingFactoryRun({evidence:{
    sources:'APPROVED',authoring:'APPROVED',humanReview:'APPROVED',manifest:'READY',
    mediaPlan:'READY',narration:'READY',capture:'READY',composition:'READY',
    quality:'PUBLISHABLE',publication:'READY',measurement:'ACTIVE'
  }});
  assert.equal(plan.blockers.length,0);
  assert.equal(plan.publishable,true);
});
