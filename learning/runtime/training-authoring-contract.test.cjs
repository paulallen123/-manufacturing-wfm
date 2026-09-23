'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAuthoringJob,validateAuthoringReceipt}=require('./training-authoring-contract.cjs');

const source={sourceRef:'vector:verified-workflow:schedule-recover',sha256:'a'.repeat(64),revision:'7',approved:true};
test('authoring is grounded in approved versioned sources and asks for real practice',()=>{
  const job=createAuthoringJob({competencyKey:'schedule.recover',title:'Recover schedule',objective:'Recover a production gap safely.',roles:['manager'],sources:[source]});
  assert.equal(job.requiredOutput.retrievalItemsMin,2);
  assert.equal(job.policy.answerGiving,'HINT_FIRST');
});
test('high-risk authoring remains in review until a human approval receipt exists',()=>{
  const job=createAuthoringJob({competencyKey:'payroll.reconcile',title:'Reconcile payroll',objective:'Release only reconciled payroll.',roles:['payroll'],riskClass:'PAYROLL',sources:[source]});
  const receipt={contractVersion:'VECTOR_TRAINING_AUTHORING_RECEIPT_V1',jobId:job.jobId,sourceDigest:job.sourceDigest,sourceRefs:[source.sourceRef],content:{conciseExplanation:'Explain.',workedExample:'Example.',retrievalItems:[{q:'1'},{q:'2'}],practiceScenario:{id:'s'},misconceptionFeedback:['Why'],independentTask:{id:'task'},accessibilityNotes:{plainLanguage:true}},unsupportedClaimsDetected:false,humanReview:{approved:false}};
  assert.equal(validateAuthoringReceipt(job,receipt).state,'REVIEW_REQUIRED');
  assert.equal(validateAuthoringReceipt(job,{...receipt,humanReview:{approved:true}}).state,'APPROVED');
});
