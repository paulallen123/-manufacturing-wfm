'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createVideoGenerationJob,validateVideoGenerationJob,validateVideoReceipt}=require('./training-video-contract.cjs');

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

function receiptFixture(){
  const job=createVideoGenerationJob(module(),{targetOrigin:'https://vector.example'});
  const hex='c'.repeat(64);
  return {job,receipt:{
    contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',jobId:job.jobId,
    artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,uiVersion:job.uiVersion,
    sourceClass:'SYNTHETIC',capture:{route:job.capture.route,observedSelectors:[...job.capture.requiredSelectors],expectedTextObserved:true},
    scan:{pii:'PASS',secrets:'PASS'},consoleErrors:[],
    media:{videoSha256:hex,captionsSha256:hex,transcriptSha256:hex,durationMs:9000},
    narration:{status:'PRESENT',audioSha256:hex},
    publication:{durable:true,videoUrl:'https://media.example/video',captionsUrl:'https://media.example/captions',transcriptUrl:'https://media.example/transcript'}
  }};
}

const malformedJobs=[
  ['null root',()=>null],['array root',()=>[]],['primitive root',()=>17],
  ['missing capture',j=>{delete j.capture;return j;}],
  ['null capture',j=>({...j,capture:null})],
  ['array capture',j=>({...j,capture:[]})],
  ['string selectors',j=>({...j,capture:{...j.capture,requiredSelectors:'not-an-array'}})],
  ['object selectors',j=>({...j,capture:{...j.capture,requiredSelectors:{}}})],
  ['string script',j=>({...j,script:'not-an-array'})],
  ['object script',j=>({...j,script:{some:null}})],
  ['null script step',j=>({...j,script:[null]})],
  ['object title',j=>({...j,script:[{title:{toString:null},instruction:'synthetic'}]})],
  ['object target origin',j=>({...j,targetOrigin:{toString:null}})],
  ['missing storage identity',j=>{delete j.artifactFingerprint;return j;}]
];
for(const [name,change] of malformedJobs){
  test('malformed job is a structured refusal: '+name,()=>{
    const pair=receiptFixture(),job=change(structuredClone(pair.job));
    let result;
    assert.doesNotThrow(()=>{result=validateVideoGenerationJob(job);});
    assert.equal(result.ok,false);assert.ok(result.errors.length>0);
    assert.deepEqual(Object.keys(result).sort(),['errors','ok']);
    assert.doesNotThrow(()=>{result=validateVideoReceipt(job,pair.receipt);});
    assert.equal(result.ok,false);assert.equal(result.state,'FAILED');
    assert.deepEqual(Object.keys(result).sort(),['errors','ok','state']);
  });
}
const malformedReceipts=[
  ['null root',()=>null],['array root',()=>[]],['primitive root',()=>true],
  ['missing capture',r=>{delete r.capture;return r;}],
  ['array capture',r=>({...r,capture:[]})],
  ['object selectors',r=>({...r,capture:{...r.capture,observedSelectors:{}}})],
  ['missing scan',r=>{delete r.scan;return r;}],
  ['null media',r=>({...r,media:null})],
  ['object digest',r=>({...r,media:{...r.media,videoSha256:{toString:null}}})],
  ['object duration',r=>({...r,media:{...r.media,durationMs:{valueOf:null,toString:null}}})],
  ['string console errors',r=>({...r,consoleErrors:'none'})],
  ['array narration',r=>({...r,narration:[]})],
  ['object URL',r=>({...r,publication:{...r.publication,videoUrl:{toString:null}}})]
];
for(const [name,change] of malformedReceipts){
  test('malformed receipt is a structured refusal: '+name,()=>{
    const {job,receipt}=receiptFixture();let result;
    assert.doesNotThrow(()=>{result=validateVideoReceipt(job,change(receipt));});
    assert.equal(result.ok,false);assert.equal(result.state,'FAILED');assert.ok(result.errors.length>0);
    assert.deepEqual(Object.keys(result).sort(),['errors','ok','state']);
  });
}
test('valid READY and optional narration/publication PROOF_ONLY preserve public results',()=>{
  const {job,receipt}=receiptFixture();
  assert.deepEqual(validateVideoReceipt(job,receipt),{ok:true,state:'READY',errors:[]});
  for(const optional of [{},{narration:null,publication:null},{narration:{status:'NOT_CONFIGURED'},publication:{durable:false}}]){
    const pending=structuredClone(receipt);delete pending.narration;delete pending.publication;
    Object.assign(pending,optional);
    assert.deepEqual(validateVideoReceipt(job,pending),{ok:true,state:'PROOF_ONLY',errors:[]});
  }
});
test('supported scalar coercions and deterministic job identity remain compatible',()=>{
  const {job,receipt}=receiptFixture(),second=receiptFixture();
  assert.equal(job.jobId,second.job.jobId);
  const changed=structuredClone(job);changed.jobId=123;changed.script[0].title=42;
  const observed=structuredClone(receipt);observed.jobId=123;observed.media.durationMs='9000';
  assert.equal(validateVideoGenerationJob(changed).ok,true);
  assert.deepEqual(validateVideoReceipt(changed,observed),{ok:true,state:'READY',errors:[]});
});
test('well-formed semantic failures retain the existing failed validation reasons',()=>{
  const mutations=[
    [r=>{r.scan.pii='FAIL';},'PII_SCAN_FAILED'],
    [r=>{r.scan.secrets='FAIL';},'SECRET_SCAN_FAILED'],
    [r=>{r.capture.observedSelectors=[];},'REQUIRED_SELECTOR_MISSING'],
    [r=>{r.consoleErrors=['synthetic console error'];},'CONSOLE_ERRORS_PRESENT'],
    [r=>{r.media.videoSha256='invalid';},'VIDEO_DIGEST_INVALID'],
    [r=>{r.media.durationMs='bad';},'VIDEO_DURATION_INVALID']
  ];
  for(const [mutate,reason] of mutations){const {job,receipt}=receiptFixture();mutate(receipt);
    const result=validateVideoReceipt(job,receipt);assert.equal(result.ok,false);assert.equal(result.state,'FAILED');assert.ok(result.errors.includes(reason));}
});
