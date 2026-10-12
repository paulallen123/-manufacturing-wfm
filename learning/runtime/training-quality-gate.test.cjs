'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {evaluateTrainingQuality}=require('./training-quality-gate.cjs');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createVideoGenerationJob}=require('./training-video-contract.cjs');

// Synthetic structural fixtures only: no scan, review or publication is performed.
const hash=value=>createHash('sha256').update(value).digest('hex');
const nowMs=Date.UTC(2026,9,12);
function fixture(){
  const module=buildTrainingModule({competencyKey:'absence.request',role:'employee',mode:'SHOW_ME',locale:'en-GB',productSha:'4fde7520b4a1d71cff6262ca6425451b7264d22e'});
  const targetOrigin='https://vector.example.invalid';
  const videoJob=createVideoGenerationJob(module,{targetOrigin});
  const narrationJob={contractVersion:'VECTOR_TRAINING_NARRATION_JOB_V1',jobId:'synthetic-narration-job',artifactFingerprint:module.artifactFingerprint,productSha:module.productSha,locale:module.locale,textDigest:hash('synthetic narration text'),voiceProfile:{id:'vector-guide-v1'},segments:[{id:'intro'},{id:'workflow'}]};
  const binding=Object.fromEntries(['artifactFingerprint','productSha','competencyKey','role','locale','uiVersion','generatorVersion','workflowRevision','permissionClass','configurationClass','explanationMode'].map(key=>[key,module[key]]));
  binding.sourceDigest=hash('approved source revision');
  const mediaIdentity={videoSha256:hash('video'),captionsSha256:hash('captions'),transcriptSha256:hash('transcript'),audioSha256:hash('audio')};
  const receipt=(contractVersion,extra={})=>({...binding,contractVersion,issuedAtMs:nowMs-1000,...extra});
  const input={module:{...module},
    authoring:receipt('VECTOR_TRAINING_AUTHORING_RECEIPT_V1',{state:'APPROVED',retrievalItems:2,independentTask:true,explanatoryFeedback:true,unsupportedClaimsDetected:false}),
    media:receipt('VECTOR_TRAINING_VIDEO_RECEIPT_V1',{
      jobId:videoJob.jobId,sourceClass:'SYNTHETIC',capture:{route:module.capture.route,observedSelectors:[...module.capture.requiredSelectors],expectedTextObserved:true},consoleErrors:[],narration:{status:'PRESENT',audioSha256:mediaIdentity.audioSha256},
      state:'READY',captionsAvailable:true,transcriptAvailable:true,narrationState:'READY',privacySafe:true,secretSafe:true,
      media:{...mediaIdentity,durationMs:9000},
      completeness:{captions:true,transcript:true,narration:true},
      scan:receipt('VECTOR_TRAINING_MEDIA_SCAN_V1',{pii:'PASS',secrets:'PASS',mediaIdentity:{...mediaIdentity}}),
      publication:{durable:true,videoUrl:'https://media.example.invalid/video',captionsUrl:'https://media.example.invalid/captions',transcriptUrl:'https://media.example.invalid/transcript'}
    }),
    voice:receipt('VECTOR_TRAINING_NARRATION_RECEIPT_V1',{state:'READY',audioSha256:mediaIdentity.audioSha256,transcriptSha256:mediaIdentity.transcriptSha256,contentMatch:true,durationMs:9000,jobId:narrationJob.jobId,textDigest:narrationJob.textDigest,voiceProfileId:narrationJob.voiceProfile.id,sampleRateHz:48000,channels:1,scan:{pii:'PASS',secrets:'PASS'},segmentTimings:[{id:'intro',startMs:0,endMs:1000},{id:'workflow',startMs:1000,endMs:9000}],durable:true,audioUrl:'https://media.example.invalid/audio'}),
    tutor:{enabled:false}
  };
  const trusted={module:{...module},targetOrigin,narrationJob,sourceDigest:binding.sourceDigest,mediaIdentity:{...mediaIdentity},riskClass:'STANDARD',nowMs,maxAgeMs:60000};
  return {input,trusted,receipt};
}
function evaluate(f){return evaluateTrainingQuality(f.input,f.trusted);}
function blocked(f,gate){const out=evaluate(f);assert.equal(out.publishable,false);if(gate)assert.ok(out.blockers.includes(gate),JSON.stringify(out));return out;}

test('polished media alone cannot pass the learning quality gate',()=>{
  const f=fixture();Object.assign(f.input.authoring,{retrievalItems:0,independentTask:false,explanatoryFeedback:false});
  assert.ok(blocked(f).blockers.includes('retrievalPractice'));
});
test('fully grounded, accessible, narrated training can become publishable',()=>{
  const out=evaluate(fixture());assert.equal(out.state,'PUBLISHABLE');assert.equal(out.publishable,true);
});
test('regression: absent authoring is not NOT_REQUIRED even with top-level pedagogy flags',()=>{
  const f=fixture();delete f.input.authoring;Object.assign(f.input,{retrievalItems:2,independentTask:true,explanatoryFeedback:true});
  blocked(f,'sourceGrounded');
});
test('regression: absent privacy and secret evidence cannot pass',()=>{
  const f=fixture();delete f.input.media.privacySafe;delete f.input.media.secretSafe;delete f.input.media.scan;
  const out=blocked(f);assert.ok(out.blockers.includes('privacySafe'));assert.ok(out.blockers.includes('secretSafe'));assert.equal(out.state,'BLOCKED');
});
test('regression: positive prototype fingerprint x is not an artifact identity',()=>{
  const f=fixture();f.input.module.artifactFingerprint='x';blocked(f,'exactProductBound');
});
test('regression: independently valid receipts for a different source cannot be mixed',()=>{
  const f=fixture();f.input.authoring.sourceDigest=hash('another source');blocked(f,'receiptBinding');
});
test('legacy prototype positive fixture is insufficient without a trusted contract',()=>{
  const out=evaluateTrainingQuality({module:{artifactFingerprint:'x',artifactPublishable:true,exposureOnly:true,evidencePolicy:'NO_MASTERY_FROM_DELIVERY'},media:{captionsAvailable:true,transcriptAvailable:true,narrationState:'READY',privacySafe:true,secretSafe:true},voice:{state:'READY'},authoring:{state:'APPROVED',retrievalItems:2,independentTask:true,explanatoryFeedback:true}});
  assert.equal(out.state,'BLOCKED');
});
test('trusted current contract is mandatory and cannot be supplied inside input',()=>{
  const f=fixture();f.input.trusted=f.trusted;assert.equal(evaluateTrainingQuality(f.input).state,'BLOCKED');
});
test('only an explicit justified exemption in the trusted contract can omit generated authoring',()=>{
  const f=fixture();f.input.authoring.state='NOT_REQUIRED';blocked(f,'sourceGrounded');
  f.input.authoring.exemption={reason:'self-approved'};blocked(f,'sourceGrounded');
  f.trusted.authoringExemption={contractVersion:'VECTOR_TRAINING_WORKFLOW_MANIFEST_V1',reason:'Reviewed canonical workflow; no generated authoring.'};
  assert.equal(evaluate(f).state,'PUBLISHABLE');
  f.trusted.authoringExemption.reason=' ';blocked(f,'sourceGrounded');
});
test('authoring exemption still needs bound pedagogy and may not waive high-risk review',()=>{
  const f=fixture();f.input.authoring.state='NOT_REQUIRED';f.trusted.authoringExemption={contractVersion:'VECTOR_TRAINING_WORKFLOW_MANIFEST_V1',reason:'Reviewed canonical workflow'};
  f.trusted.riskClass='SAFETY';blocked(f,'highRiskReview');
  delete f.input.authoring;blocked(f,'sourceGrounded');
});
for(const component of ['authoring','media','voice']){
  for(const field of ['artifactFingerprint','sourceDigest','productSha','competencyKey','role','locale','uiVersion','generatorVersion','workflowRevision','permissionClass','configurationClass','explanationMode']){
    test(`${component} receipt rejects mismatched ${field}`,()=>{
      const f=fixture();f.input[component][field]=['sourceDigest','artifactFingerprint'].includes(field)?hash('other'):String(f.input[component][field])+'-other';blocked(f,'receiptBinding');
    });
  }
  test(`${component} rejects a missing or wrong receipt version`,()=>{
    for(const value of [undefined,'UNKNOWN']){const f=fixture();f.input[component].contractVersion=value;blocked(f,'receiptBinding');}
  });
}
test('module identity rejects malformed digests, short product SHA and altered canonical scope',()=>{
  for(const [field,value] of [['artifactFingerprint','a'.repeat(63)],['productSha','abcdef0'],['role','super-employee'],['locale','en-GB '],['uiVersion','unreviewed'],['workflowRevision','old'],['mode','TEST_ME']]){
    const f=fixture();f.input.module[field]=value;blocked(f,'exactProductBound');
  }
});
test('trusted fingerprint must also match the canonical manifest and exact source',()=>{
  const f=fixture();f.trusted.module.artifactFingerprint=hash('not the manifest');blocked(f,'exactProductBound');
});
test('media and scan digests must all match the separately collected artifact identity',()=>{
  for(const key of ['videoSha256','captionsSha256','transcriptSha256','audioSha256']){
    const f=fixture();f.input.media.media[key]=hash('replacement');blocked(f,'mediaIdentity');
    const g=fixture();g.input.media.scan.mediaIdentity[key]=hash('other scan');blocked(g,'privacySafe');
    const h=fixture();h.trusted.mediaIdentity[key]='x';blocked(h,'mediaIdentity');
  }
});
test('voice audio and transcript must belong to the same media',()=>{
  for(const key of ['audioSha256','transcriptSha256']){const f=fixture();f.input.voice[key]=hash('other narration');blocked(f,'mediaIdentity');}
});
test('scan results must be explicit PASS for the bound source, version and current media',()=>{
  for(const field of ['pii','secrets'])for(const value of [undefined,null,false,true,'pass','FAIL','UNKNOWN']){
    const f=fixture();f.input.media.scan[field]=value;blocked(f,field==='pii'?'privacySafe':'secretSafe');
  }
  for(const field of ['artifactFingerprint','sourceDigest','role','productSha','locale','contractVersion']){
    const f=fixture();f.input.media.scan[field]='other';blocked(f,'privacySafe');
  }
});
test('contradictory privacy, secret and unsupported claim flags fail closed',()=>{
  for(const flag of ['privacySafe','secretSafe']){const f=fixture();f.input.media[flag]=false;blocked(f,flag);}
  const f=fixture();f.input.authoring.unsupportedClaimsDetected=true;blocked(f,'sourceGrounded');
  delete f.input.authoring.unsupportedClaimsDetected;blocked(f,'sourceGrounded');
});
test('captions, transcript and narration require explicit completeness evidence',()=>{
  for(const [flag,gate] of [['captions','captions'],['transcript','transcript'],['narration','narrated']]){
    const f=fixture();delete f.input.media.completeness[flag];assert.equal(blocked(f,gate).state,'PROOF_ONLY');
  }
  const f=fixture();f.input.voice.contentMatch=false;blocked(f,'narrated');
});
test('proof-only or non-durable media never become publishable from ready flags',()=>{
  for(const component of ['media','voice']){const f=fixture();f.input[component].state='PROOF_ONLY';assert.equal(blocked(f).state,'PROOF_ONLY');}
  for(const field of ['durable','videoUrl','captionsUrl','transcriptUrl']){const f=fixture();delete f.input.media.publication[field];assert.equal(blocked(f,'durablePublication').state,'PROOF_ONLY');}
  for(const url of ['http://example.invalid/video','https://','https://user:password@example.invalid/video']){const f=fixture();f.input.media.publication.videoUrl=url;blocked(f,'durablePublication');}
});
test('failed media receipts remain BLOCKED, not PROOF_ONLY',()=>{
  const f=fixture();f.input.media.state='FAILED';assert.equal(blocked(f).state,'BLOCKED');
});
test('every required receipt rejects stale, future, missing or coerced timestamps',()=>{
  for(const component of ['authoring','media','voice','scan'])for(const value of [undefined,null,'1791763199000',nowMs+1,nowMs-60001]){
    const f=fixture();(component==='scan'?f.input.media.scan:f.input[component]).issuedAtMs=value;
    assert.equal(blocked(f,'freshness').state,'BLOCKED');
  }
  const f=fixture();for(const r of [f.input.authoring,f.input.media,f.input.voice,f.input.media.scan])r.issuedAtMs=nowMs-60000;
  assert.equal(evaluate(f).publishable,true);
});
test('invalid trusted clock or freshness policy cannot bless evidence',()=>{
  for(const [key,value] of [['nowMs',NaN],['nowMs',undefined],['maxAgeMs',0],['maxAgeMs',Infinity],['maxAgeMs','60000']]){
    const f=fixture();f.trusted[key]=value;blocked(f,'freshness');
  }
});
for(const riskClass of ['PAYROLL','SAFETY','COMPLIANCE','LEGAL','ACCESS_CONTROL','PRODUCTION_AUTHORITY']){
  test(`${riskClass} needs fresh human review bound to source and media`,()=>{
    const f=fixture();f.trusted.riskClass=riskClass;blocked(f,'highRiskReview');
    f.input.authoring.humanReview=f.receipt('VECTOR_TRAINING_HUMAN_REVIEW_V1',{approved:true,reviewerRef:'synthetic-reviewer',riskClass,mediaIdentity:{...f.trusted.mediaIdentity}});
    assert.equal(evaluate(f).publishable,true);
    f.input.authoring.humanReview.sourceDigest=hash('old');blocked(f,'highRiskReview');
    f.input.authoring.humanReview.sourceDigest=f.trusted.sourceDigest;f.input.authoring.humanReview.issuedAtMs=nowMs-60001;blocked(f,'highRiskReview');
  });
}
test('risk classification cannot be omitted or supplied only by untrusted input',()=>{
  const f=fixture();delete f.trusted.riskClass;f.input.riskClass='STANDARD';blocked(f,'highRiskReview');
});
test('pedagogy never uses top-level fallbacks, coercion or missing metrics',()=>{
  for(const [key,value,gate] of [['retrievalItems','2','retrievalPractice'],['retrievalItems',1.5,'retrievalPractice'],['retrievalItems',0,'retrievalPractice'],['independentTask',false,'independentTask'],['explanatoryFeedback',undefined,'explanatoryFeedback']]){
    const f=fixture();f.input.authoring[key]=value;f.input[key]=key==='retrievalItems'?3:true;blocked(f,gate);
  }
});
test('enabled tutor requires bound, fresh and finite evaluation metrics',()=>{
  const f=fixture();f.input.tutor=f.receipt('VECTOR_TRAINING_TUTOR_EVALUATION_V1',{enabled:true,groundedRate:.995,directAnswerLeakRate:.01,escalationAccuracy:.98});
  assert.equal(evaluate(f).publishable,true);
  for(const [field,value] of [['groundedRate',.97],['directAnswerLeakRate',undefined],['directAnswerLeakRate',-.1],['escalationAccuracy',1.1],['groundedRate','.999'],['issuedAtMs',nowMs-60001],['sourceDigest',hash('other')]]){
    const g=structuredClone({input:f.input,trusted:f.trusted});g.input.tutor[field]=value;blocked(g);
  }
});
test('malformed enabled tutor flag is not an opt out',()=>{
  const f=fixture();f.input.tutor.enabled='true';blocked(f,'tutorGrounded');
});
test('publication and passive delivery never award mastery or competency',()=>{
  const out=evaluate(fixture());assert.equal(out.awardsMastery,false);assert.equal(out.awardsCompetency,false);
  for(const changes of [{exposureOnly:false},{evidencePolicy:'WATCHING_COUNTS'},{exposureOnly:undefined,evidencePolicy:undefined}]){
    const f=fixture();Object.assign(f.input.module,changes);blocked(f,'noPassiveMastery');
  }
});
test('malformed inputs fail closed without throwing, input mutation or mutable output',()=>{
  for(const input of [null,[],42,{module:null},{authoring:[]},{media:'READY'}])assert.equal(evaluateTrainingQuality(input).state,'BLOCKED');
  const f=fixture(),before=JSON.stringify(f),out=evaluate(f);assert.equal(JSON.stringify(f),before);
  assert.equal(Object.isFrozen(out),true);assert.equal(Object.isFrozen(out.gates),true);assert.equal(Object.isFrozen(out.blockers),true);
  assert.equal(out.validationScope,'STRUCTURAL_ONLY');assert.equal(out.requiresTrustedCollector,true);
});

// Independent review regressions: preserve the native V1 media guards.
test('inherited workflow names and malformed scopes fail closed without throwing',()=>{
  for(const name of ['__proto__','constructor','toString']){const f=fixture();f.input.module.competencyKey=name;assert.equal(blocked(f,'exactProductBound').state,'BLOCKED');}
});
test('native video receipt guards remain mandatory',()=>{
  for(const mutation of [r=>{r.sourceClass='CUSTOMER_LIVE';},r=>{r.capture.route='wrong';},r=>{r.capture.observedSelectors=[];},r=>{r.consoleErrors=['capture failure'];},r=>{r.jobId='other';},r=>{r.scan.pii='FAIL';},r=>{r.narration.audioSha256=hash('other audio');}]){
    const f=fixture();mutation(f.input.media);blocked(f);
  }
  const f=fixture();f.input.media.narration.status='ABSENT';assert.equal(blocked(f,'narrated').state,'PROOF_ONLY');
});
test('native narration evidence cannot contradict the normalized ready state',()=>{
  for(const [field,value] of [['jobId','other'],['textDigest',hash('other text')],['voiceProfileId','other'],['sampleRateHz',undefined],['channels',0],['segmentTimings',[]],['scan',{pii:'FAIL',secrets:'FAIL'}]]){
    const f=fixture();f.input.voice[field]=value;blocked(f,'narrationReceipt');
  }
  for(const field of ['durable','audioUrl']){const f=fixture();delete f.input.voice[field];assert.equal(blocked(f,'narrated').state,'PROOF_ONLY');}
  const f=fixture();f.input.voice.scan={pii:'FAIL',secrets:'PASS'};assert.equal(blocked(f).state,'BLOCKED');
});
test('narration timing rejects wrong, overlapping, malformed and out-of-range segments',()=>{
  for(const changes of [{id:'wrong'},{startMs:0},{startMs:'1000'},{endMs:9500},{endMs:1000}]){
    const f=fixture();Object.assign(f.input.voice.segmentTimings[1],changes);blocked(f,'narrationReceipt');
  }
});
test('typed summary flags reject malformed values even when scan receipts say PASS',()=>{
  for(const flag of ['privacySafe','secretSafe'])for(const value of ['false',0,null]){const f=fixture();f.input.media[flag]=value;blocked(f,flag);}
});
test('sparse narration timings cannot claim complete narration',()=>{
  const f=fixture();f.input.voice.segmentTimings=new Array(2);blocked(f,'narrationReceipt');
  const g=fixture();delete g.input.voice.segmentTimings[1];blocked(g,'narrationReceipt');
});
test('native narration timing tolerance of 250ms remains supported',()=>{
  for(const endMs of [9000,9100,9250]){const f=fixture();f.input.voice.segmentTimings[1].endMs=endMs;assert.equal(evaluate(f).publishable,true);}
  const f=fixture();f.input.voice.segmentTimings[1].endMs=9251;blocked(f,'narrationReceipt');
});
test('trusted narration job must use the supported native contract',()=>{
  for(const value of [undefined,'OTHER']){const f=fixture();f.trusted.narrationJob.contractVersion=value;blocked(f,'narrationReceipt');}
});
