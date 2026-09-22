'use strict';

const { createHash } = require('node:crypto');

const VIDEO_JOB_VERSION='VECTOR_TRAINING_VIDEO_JOB_V1';
const VIDEO_RECEIPT_VERSION='VECTOR_TRAINING_VIDEO_RECEIPT_V1';
const SOURCE_CLASS='SYNTHETIC';

function sha256(value){return createHash('sha256').update(String(value)).digest('hex');}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function validSha(value){return /^[a-f0-9]{7,64}$/i.test(clean(value,80));}
function validDigest(value){return /^[a-f0-9]{64}$/i.test(clean(value,80));}
function validHttpsOrigin(value){
  try{
    const u=new URL(String(value||''));
    return u.protocol==='https:' && u.origin===u.href.replace(/\/$/,'');
  }catch{return false;}
}
function validateVideoGenerationJob(job={}){
  const errors=[];
  if(job.contractVersion!==VIDEO_JOB_VERSION) errors.push('JOB_CONTRACT_INVALID');
  if(!clean(job.jobId,120)) errors.push('JOB_ID_REQUIRED');
  if(!clean(job.artifactFingerprint,80)||!validDigest(job.artifactFingerprint)) errors.push('ARTIFACT_FINGERPRINT_INVALID');
  if(!validSha(job.productSha)) errors.push('PRODUCT_SHA_REQUIRED');
  if(job.uiVersion!=='VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1') errors.push('UI_VERSION_UNAPPROVED');
  if(job.sourceClass!==SOURCE_CLASS) errors.push('SYNTHETIC_SOURCE_REQUIRED');
  if(job.locale!=='en-GB') errors.push('LOCALISATION_NOT_PROVEN');
  if(!validHttpsOrigin(job.targetOrigin)) errors.push('TARGET_ORIGIN_INVALID');
  if(job.capture?.status!=='READY'||!clean(job.capture?.route,120)) errors.push('CAPTURE_PLAN_NOT_READY');
  if(!Array.isArray(job.capture?.requiredSelectors)||job.capture.requiredSelectors.length<2) errors.push('CAPTURE_SELECTORS_REQUIRED');
  if(!Array.isArray(job.script)||job.script.length<1) errors.push('SCRIPT_REQUIRED');
  if(job.script?.some(step=>!clean(step?.title,200)||!clean(step?.instruction,1000))) errors.push('SCRIPT_STEP_INVALID');
  if(job.containsCredentials===true) errors.push('CREDENTIALS_MUST_NOT_BE_EMBEDDED');
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}
function createVideoGenerationJob(module,input={}){
  if(!module||module.contractVersion!=='VECTOR_TRAINING_WORKFLOW_MANIFEST_V1') throw new Error('Verified training module is required.');
  if(module.mode!=='SHOW_ME') throw new Error('Autonomous video generation is bound to SHOW_ME modules.');
  if(module.artifactPublishable!==true) throw new Error('Exact product identity is required before video generation.');
  if(module.capture?.status!=='READY') throw new Error('This workflow has no verified capture plan.');
  const targetOrigin=String(input.targetOrigin||'').replace(/\/$/,'');
  const seed={
    artifactFingerprint:module.artifactFingerprint,
    productSha:module.productSha,
    uiVersion:module.uiVersion,
    captureRevision:module.capture.revision,
    locale:module.locale,
    explanationMode:module.explanationMode
  };
  const job={
    contractVersion:VIDEO_JOB_VERSION,
    jobId:'training-'+sha256(stable(seed)).slice(0,40),
    artifactFingerprint:module.artifactFingerprint,
    competencyKey:module.competencyKey,
    role:module.role,
    productSha:module.productSha,
    uiVersion:module.uiVersion,
    generatorVersion:module.generatorVersion,
    workflowRevision:module.workflowRevision,
    captureRevision:module.capture.revision,
    locale:module.locale,
    explanationMode:module.explanationMode,
    sourceClass:SOURCE_CLASS,
    targetOrigin,
    containsCredentials:false,
    capture:{
      status:'READY',
      route:module.capture.route,
      requiredSelectors:[...module.capture.requiredSelectors],
      expectedText:module.capture.expectedText||null,
      safeFocusSelectors:[...(module.capture.safeFocusSelectors||[])]
    },
    script:module.steps.map(step=>({id:step.id,index:step.index,title:step.title,instruction:step.instruction})),
    accessibility:{
      captionsRequired:true,
      transcriptRequired:true,
      reducedMotion:true
    },
    narration:{
      requiredForPublication:true,
      provider:'UNBOUND'
    },
    publicationPolicy:'PROOF_ONLY_UNTIL_DURABLE_NARRATED'
  };
  const validation=validateVideoGenerationJob(job);
  if(!validation.ok) throw new Error('Video job rejected: '+validation.errors.join(','));
  return Object.freeze(job);
}
function validateVideoReceipt(job,receipt={}){
  const jobValidation=validateVideoGenerationJob(job);
  const errors=[...jobValidation.errors];
  if(receipt.contractVersion!==VIDEO_RECEIPT_VERSION) errors.push('RECEIPT_CONTRACT_INVALID');
  if(receipt.jobId!==job.jobId) errors.push('JOB_BINDING_MISMATCH');
  if(receipt.artifactFingerprint!==job.artifactFingerprint) errors.push('ARTIFACT_BINDING_MISMATCH');
  if(receipt.productSha!==job.productSha) errors.push('PRODUCT_SHA_MISMATCH');
  if(receipt.uiVersion!==job.uiVersion) errors.push('UI_VERSION_MISMATCH');
  if(receipt.sourceClass!==SOURCE_CLASS) errors.push('SOURCE_CLASS_MISMATCH');
  if(receipt.capture?.route!==job.capture.route) errors.push('CAPTURE_ROUTE_MISMATCH');
  const observed=new Set(Array.isArray(receipt.capture?.observedSelectors)?receipt.capture.observedSelectors:[]);
  for(const selector of job.capture.requiredSelectors) if(!observed.has(selector)) errors.push('REQUIRED_SELECTOR_MISSING');
  if(job.capture.expectedText && receipt.capture?.expectedTextObserved!==true) errors.push('EXPECTED_TEXT_MISSING');
  if(receipt.scan?.pii!=='PASS') errors.push('PII_SCAN_FAILED');
  if(receipt.scan?.secrets!=='PASS') errors.push('SECRET_SCAN_FAILED');
  if(!Array.isArray(receipt.consoleErrors)||receipt.consoleErrors.length) errors.push('CONSOLE_ERRORS_PRESENT');
  if(!validDigest(receipt.media?.videoSha256)) errors.push('VIDEO_DIGEST_INVALID');
  if(!validDigest(receipt.media?.captionsSha256)) errors.push('CAPTION_DIGEST_INVALID');
  if(!validDigest(receipt.media?.transcriptSha256)) errors.push('TRANSCRIPT_DIGEST_INVALID');
  if(!Number.isFinite(Number(receipt.media?.durationMs))||Number(receipt.media.durationMs)<2000) errors.push('VIDEO_DURATION_INVALID');
  const narrationPresent=receipt.narration?.status==='PRESENT'&&validDigest(receipt.narration?.audioSha256);
  const durable=receipt.publication?.durable===true&&/^https:\/\//.test(String(receipt.publication?.url||''));
  const state=errors.length?'FAILED':(narrationPresent&&durable?'READY':'PROOF_ONLY');
  return {ok:errors.length===0,state,errors:[...new Set(errors)]};
}
module.exports=Object.freeze({
  VIDEO_JOB_VERSION,VIDEO_RECEIPT_VERSION,SOURCE_CLASS,
  createVideoGenerationJob,validateVideoGenerationJob,validateVideoReceipt
});
