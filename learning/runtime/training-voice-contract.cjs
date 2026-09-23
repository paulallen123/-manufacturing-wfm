'use strict';

const { createHash } = require('node:crypto');

const VOICE_PROFILE_VERSION='VECTOR_TRAINING_VOICE_PROFILE_V1';
const NARRATION_JOB_VERSION='VECTOR_TRAINING_NARRATION_JOB_V1';
const NARRATION_RECEIPT_VERSION='VECTOR_TRAINING_NARRATION_RECEIPT_V1';
const DEFAULT_PROFILE=Object.freeze({
  contractVersion:VOICE_PROFILE_VERSION,
  id:'vector-guide-v1',
  voiceType:'SYNTHETIC_BRAND',
  persona:'calm-direct-supportive',
  locale:'en-GB',
  pace:0.98,
  pitch:0,
  emphasis:'moderate',
  pronunciation:Object.freeze({
    VECTOR:'Vector',
    WFM:'workforce management',
    Autopilot:'Autopilot'
  }),
  cloneConsentRequired:false
});

function clean(v,max=1000){return String(v??'').trim().slice(0,max);}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function sha256(value){return createHash('sha256').update(String(value)).digest('hex');}
function validDigest(value){return /^[a-f0-9]{64}$/i.test(clean(value,80));}
function validSha(value){return /^[a-f0-9]{7,64}$/i.test(clean(value,80));}

function normaliseProfile(input={}){
  const voiceType=clean(input.voiceType||DEFAULT_PROFILE.voiceType,40);
  if(voiceType!=='SYNTHETIC_BRAND') throw new Error('Only synthetic brand voices are admitted by this contract.');
  const profile={
    contractVersion:VOICE_PROFILE_VERSION,
    id:clean(input.id||DEFAULT_PROFILE.id,120),
    voiceType,
    persona:clean(input.persona||DEFAULT_PROFILE.persona,120),
    locale:clean(input.locale||DEFAULT_PROFILE.locale,40),
    pace:Number.isFinite(Number(input.pace))?Math.max(0.75,Math.min(1.2,Number(input.pace))):DEFAULT_PROFILE.pace,
    pitch:Number.isFinite(Number(input.pitch))?Math.max(-6,Math.min(6,Number(input.pitch))):DEFAULT_PROFILE.pitch,
    emphasis:clean(input.emphasis||DEFAULT_PROFILE.emphasis,40),
    pronunciation:Object.freeze({...DEFAULT_PROFILE.pronunciation,...(input.pronunciation||{})}),
    cloneConsentRequired:false
  };
  if(!profile.id||!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(profile.locale)) throw new Error('Voice profile id and locale are required.');
  return Object.freeze(profile);
}

function createNarrationJob(input={}){
  const artifactFingerprint=clean(input.artifactFingerprint,80);
  const productSha=clean(input.productSha,80);
  const segments=(Array.isArray(input.segments)?input.segments:[]).map((segment,index)=>({
    id:clean(segment.id||('segment-'+(index+1)),120),
    text:clean(segment.text,1800),
    pauseAfterMs:Number.isFinite(Number(segment.pauseAfterMs))?Math.max(0,Math.min(5000,Number(segment.pauseAfterMs))):350
  })).filter(x=>x.id&&x.text);
  if(!validDigest(artifactFingerprint)) throw new Error('Narration requires an exact artifact fingerprint.');
  if(!validSha(productSha)) throw new Error('Narration requires an exact product SHA.');
  if(!segments.length||segments.length>80) throw new Error('Narration requires 1-80 bounded segments.');
  const profile=normaliseProfile(input.voiceProfile||{});
  const textDigest=sha256(stable(segments));
  const job={
    contractVersion:NARRATION_JOB_VERSION,
    jobId:'narration-'+sha256(stable({artifactFingerprint,productSha,profileId:profile.id,textDigest})).slice(0,40),
    artifactFingerprint,
    productSha,
    locale:profile.locale,
    voiceProfile:profile,
    segments,
    textDigest,
    audioTarget:Object.freeze({
      container:'wav',
      codec:'pcm_s16le',
      sampleRateHz:48000,
      channels:1,
      loudnessLufs:-16,
      truePeakDb:-1,
      trimLeadingTrailingSilence:true
    }),
    safety:Object.freeze({
      syntheticVoiceOnly:true,
      piiAllowed:false,
      secretsAllowed:false,
      customerVoiceCloning:false
    })
  };
  return Object.freeze(job);
}

function validateNarrationReceipt(job,receipt={}){
  const errors=[];
  if(job?.contractVersion!==NARRATION_JOB_VERSION) errors.push('JOB_CONTRACT_INVALID');
  if(receipt.contractVersion!==NARRATION_RECEIPT_VERSION) errors.push('RECEIPT_CONTRACT_INVALID');
  if(receipt.jobId!==job.jobId) errors.push('JOB_BINDING_MISMATCH');
  if(receipt.artifactFingerprint!==job.artifactFingerprint) errors.push('ARTIFACT_BINDING_MISMATCH');
  if(receipt.productSha!==job.productSha) errors.push('PRODUCT_SHA_MISMATCH');
  if(receipt.voiceProfileId!==job.voiceProfile.id) errors.push('VOICE_PROFILE_MISMATCH');
  if(receipt.textDigest!==job.textDigest) errors.push('TEXT_DIGEST_MISMATCH');
  if(!validDigest(receipt.audioSha256)) errors.push('AUDIO_DIGEST_INVALID');
  if(!validDigest(receipt.transcriptSha256)) errors.push('TRANSCRIPT_DIGEST_INVALID');
  if(!Number.isFinite(Number(receipt.durationMs))||Number(receipt.durationMs)<500) errors.push('AUDIO_DURATION_INVALID');
  if(Number(receipt.sampleRateHz)<24000) errors.push('SAMPLE_RATE_TOO_LOW');
  if(![1,2].includes(Number(receipt.channels))) errors.push('CHANNEL_COUNT_INVALID');
  if(receipt.scan?.pii!=='PASS') errors.push('PII_SCAN_FAILED');
  if(receipt.scan?.secrets!=='PASS') errors.push('SECRET_SCAN_FAILED');
  if(receipt.contentMatch!==true) errors.push('NARRATION_CONTENT_MISMATCH');
  const audioUrl=clean(receipt.audioUrl,2000);
  const durable=receipt.durable===true&&/^https:\/\//.test(audioUrl);
  return Object.freeze({ok:errors.length===0,state:errors.length?'FAILED':(durable?'READY':'PROOF_ONLY'),errors:[...new Set(errors)]});
}

module.exports=Object.freeze({
  VOICE_PROFILE_VERSION,NARRATION_JOB_VERSION,NARRATION_RECEIPT_VERSION,DEFAULT_PROFILE,
  normaliseProfile,createNarrationJob,validateNarrationReceipt,sha256,stable
});
