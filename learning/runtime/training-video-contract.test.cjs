'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createVideoGenerationJob,validateVideoReceipt}=require('./training-video-contract.cjs');

function module(){
  return buildTrainingModule({competencyKey:'absence.request',role:'employee',mode:'SHOW_ME',locale:'en-GB',productSha:'1234567890abcdef1234567890abcdef12345678'});
}
test('video job is bound to exact product/UI, synthetic source and verified capture plan',()=>{
  const job=createVideoGenerationJob(module(),{targetOrigin:'https://vector.example'});
  assert.equal(job.sourceClass,'SYNTHETIC');
  assert.equal(job.capture.route,'leave');
  assert.ok(job.capture.requiredSelectors.includes('[data-vector-leave-route="employee"]'));
  assert.equal(job.containsCredentials,false);
});
test('receipt remains proof-only until durable narration is present',()=>{
  const job=createVideoGenerationJob(module(),{targetOrigin:'https://vector.example'});
  const hex='a'.repeat(64);
  const receipt={contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',jobId:job.jobId,artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,uiVersion:job.uiVersion,sourceClass:'SYNTHETIC',capture:{route:'leave',observedSelectors:job.capture.requiredSelectors,expectedTextObserved:true},scan:{pii:'PASS',secrets:'PASS'},consoleErrors:[],media:{videoSha256:hex,captionsSha256:hex,transcriptSha256:hex,durationMs:9000},narration:{status:'NOT_CONFIGURED'},publication:{durable:false,url:null}};
  const result=validateVideoReceipt(job,receipt);
  assert.equal(result.ok,true);assert.equal(result.state,'PROOF_ONLY');
});
test('receipt fails closed on missing selector or privacy evidence',()=>{
  const job=createVideoGenerationJob(module(),{targetOrigin:'https://vector.example'});
  const hex='a'.repeat(64);
  const receipt={contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',jobId:job.jobId,artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,uiVersion:job.uiVersion,sourceClass:'SYNTHETIC',capture:{route:'leave',observedSelectors:[],expectedTextObserved:true},scan:{pii:'FAIL',secrets:'PASS'},consoleErrors:[],media:{videoSha256:hex,captionsSha256:hex,transcriptSha256:hex,durationMs:9000},narration:{status:'NOT_CONFIGURED'},publication:{durable:false,url:null}};
  const result=validateVideoReceipt(job,receipt);
  assert.equal(result.ok,false);assert.equal(result.state,'FAILED');
});
