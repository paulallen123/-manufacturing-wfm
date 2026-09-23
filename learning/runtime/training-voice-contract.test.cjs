'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createNarrationJob,validateNarrationReceipt,normaliseProfile}=require('./training-voice-contract.cjs');

test('creates an exact-build synthetic brand narration job',()=>{
  const job=createNarrationJob({
    artifactFingerprint:'a'.repeat(64),
    productSha:'1234567890abcdef1234567890abcdef12345678',
    segments:[{id:'intro',text:'Welcome to VECTOR. We will recover a production gap safely.'}]
  });
  assert.equal(job.voiceProfile.voiceType,'SYNTHETIC_BRAND');
  assert.equal(job.audioTarget.sampleRateHz,48000);
  assert.equal(job.safety.customerVoiceCloning,false);
});
test('human voice cloning is refused by the base contract',()=>{
  assert.throws(()=>normaliseProfile({voiceType:'HUMAN_CLONE'}),/synthetic brand/);
});
test('narration receipt fails closed unless audio, transcript and content binding are proven',()=>{
  const job=createNarrationJob({artifactFingerprint:'a'.repeat(64),productSha:'1234567890abcdef1234567890abcdef12345678',segments:[{text:'Test narration.'}]});
  const hex='b'.repeat(64);
  const good={contractVersion:'VECTOR_TRAINING_NARRATION_RECEIPT_V1',jobId:job.jobId,artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,voiceProfileId:job.voiceProfile.id,textDigest:job.textDigest,audioSha256:hex,transcriptSha256:hex,durationMs:4000,sampleRateHz:48000,channels:1,scan:{pii:'PASS',secrets:'PASS'},contentMatch:true,durable:true,audioUrl:'https://media.example/vector.wav'};
  assert.equal(validateNarrationReceipt(job,good).state,'READY');
  assert.equal(validateNarrationReceipt(job,{...good,contentMatch:false}).state,'FAILED');
});
