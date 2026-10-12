'use strict';

const {createVideoGenerationJob,validateVideoReceipt}=require('./training-video-contract.cjs');
const {buildArtifactFingerprint,CONTRACT_VERSION,UI_VERSION,GENERATOR_VERSION,roleCanUse,workflowFor}=require('./training-workflow-manifest.cjs');

// PR232 quality evaluator, hardened for structural evidence admission only.
// trusted is a separate server/collector-owned contract, NEVER a request field.
// Its module is the current canonical SHOW_ME manifest; sourceDigest identifies
// approved source content; mediaIdentity contains separately collected SHA-256s.
// nowMs/maxAgeMs and riskClass are mandatory policy inputs. The collector must
// authenticate scan/review provenance, hash actual bytes, verify scope, semantics,
// completeness and durable storage, and prevent replay at publication time.
// Matching strings, PASS results and this function cannot authenticate any of
// those facts. No receipt here authorizes publication or awards competence.
// Existing PR232 authoring/media/voice summaries need the bound receipt fields
// below. Authoring metrics must be derived from independently validated native
// authoring content/source references by that collector, not client counts.
// This is not a replacement for native authoring/narration job validation.
// Canonical summary-only registry views are intentionally insufficient.
const BINDING_KEYS=Object.freeze(['artifactFingerprint','productSha','competencyKey','role','locale','uiVersion','generatorVersion','workflowRevision','permissionClass','configurationClass','explanationMode']);
const MEDIA_KEYS=Object.freeze(['videoSha256','captionsSha256','transcriptSha256','audioSha256']);
const HIGH_RISK=new Set(['PAYROLL','SAFETY','COMPLIANCE','LEGAL','ACCESS_CONTROL','PRODUCTION_AUTHORITY']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v:{};
const text=v=>typeof v==='string'&&v.trim().length>0&&v===v.trim();
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const productSha=v=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const number=v=>typeof v==='number'&&Number.isFinite(v);
const rate=v=>number(v)&&v>=0&&v<=1;
function https(value){
  if(!text(value))return false;
  try{const url=new URL(value);return url.protocol==='https:'&&Boolean(url.hostname)&&!url.username&&!url.password;}
  catch{return false;}
}
function exactModule(module){
  try{
    const workflow=workflowFor(module.competencyKey);
    if(!workflow||!Array.isArray(workflow.roles)||module.contractVersion!==CONTRACT_VERSION||module.mode!=='SHOW_ME'||
      module.uiVersion!==UI_VERSION||module.generatorVersion!==GENERATOR_VERSION||
      module.artifactPublishable!==true||!digest(module.artifactFingerprint)||!productSha(module.productSha)||
      !BINDING_KEYS.every(key=>text(module[key]))||!roleCanUse(workflow,module.role))return false;
    const rebuilt=buildArtifactFingerprint(module);
    return rebuilt.fingerprint===module.artifactFingerprint&&
      Object.keys(rebuilt.payload).every(key=>rebuilt.payload[key]===module[key]);
  }catch{return false;}
}
function validNarration(job,receipt,module){
  job=object(job);
  if(job.contractVersion!=='VECTOR_TRAINING_NARRATION_JOB_V1'||!text(job.jobId)||job.artifactFingerprint!==module.artifactFingerprint||job.productSha!==module.productSha||
    job.locale!==module.locale||!digest(job.textDigest)||!text(object(job.voiceProfile).id)||
    receipt.jobId!==job.jobId||receipt.textDigest!==job.textDigest||receipt.voiceProfileId!==job.voiceProfile.id||
    !digest(receipt.audioSha256)||!digest(receipt.transcriptSha256)||receipt.contentMatch!==true||
    !number(receipt.durationMs)||receipt.durationMs<500||!number(receipt.sampleRateHz)||receipt.sampleRateHz<24000||
    ![1,2].includes(receipt.channels)||object(receipt.scan).pii!=='PASS'||object(receipt.scan).secrets!=='PASS')return false;
  const segments=job.segments,timings=receipt.segmentTimings;
  if(!Array.isArray(segments)||segments.length<1||segments.length>80||
    !Array.isArray(timings)||timings.length!==segments.length)return false;
  let previousEnd=0;const ids=new Set();
  for(let index=0;index<timings.length;index++){
    const timing=object(timings[index]),id=object(segments[index]).id;
    if(!text(id)||ids.has(id)||timing.id!==id||!number(timing.startMs)||!number(timing.endMs)||
      timing.startMs<previousEnd||timing.endMs<=timing.startMs||timing.endMs>receipt.durationMs+250)return false;
    previousEnd=timing.endMs;ids.add(id);
  }
  return true;
}

function evaluateTrainingQuality(input={},trusted={}){
  input=object(input);trusted=object(trusted);
  const module=object(input.module),expected=object(trusted.module);
  const authoring=object(input.authoring),media=object(input.media),voice=object(input.voice),tutor=object(input.tutor);
  const scan=object(media.scan),review=object(authoring.humanReview);
  const identity=object(trusted.mediaIdentity),actualMedia=object(media.media);
  const bindingValid=exactModule(module)&&exactModule(expected)&&
    BINDING_KEYS.every(key=>module[key]===expected[key])&&digest(trusted.sourceDigest);
  const bound=receipt=>bindingValid&&receipt.sourceDigest===trusted.sourceDigest&&
    BINDING_KEYS.every(key=>receipt[key]===expected[key]);
  const fresh=receipt=>Number.isSafeInteger(trusted.nowMs)&&trusted.nowMs>0&&
    Number.isSafeInteger(trusted.maxAgeMs)&&trusted.maxAgeMs>0&&
    Number.isSafeInteger(receipt.issuedAtMs)&&receipt.issuedAtMs>0&&
    receipt.issuedAtMs<=trusted.nowMs&&trusted.nowMs-receipt.issuedAtMs<=trusted.maxAgeMs;
  const matchesMedia=value=>MEDIA_KEYS.every(key=>digest(identity[key])&&object(value)[key]===identity[key]);
  const authoringBound=bound(authoring)&&authoring.contractVersion==='VECTOR_TRAINING_AUTHORING_RECEIPT_V1';
  const mediaBound=bound(media)&&media.contractVersion==='VECTOR_TRAINING_VIDEO_RECEIPT_V1';
  const voiceBound=bound(voice)&&voice.contractVersion==='VECTOR_TRAINING_NARRATION_RECEIPT_V1';
  const scanBound=bound(scan)&&scan.contractVersion==='VECTOR_TRAINING_MEDIA_SCAN_V1'&&fresh(scan)&&matchesMedia(scan.mediaIdentity);
  let videoValidation={ok:false,state:'FAILED'};
  try{if(bindingValid)videoValidation=validateVideoReceipt(createVideoGenerationJob(expected,{targetOrigin:trusted.targetOrigin}),media);}
  catch{ /* Invalid native receipts fail closed. */ }
  const narrationValid=voiceBound&&validNarration(trusted.narrationJob,voice,expected);
  const exemption=object(trusted.authoringExemption);
  // NOT_REQUIRED exempts generated authoring only; it never waives source,
  // pedagogy, scans, freshness, media completeness or high-risk human review.
  const sourceGrounded=authoringBound&&authoring.unsupportedClaimsDetected===false&&
    (authoring.state==='APPROVED'||(authoring.state==='NOT_REQUIRED'&&
      exemption.contractVersion===CONTRACT_VERSION&&text(exemption.reason)));
  const riskKnown=trusted.riskClass==='STANDARD'||HIGH_RISK.has(trusted.riskClass);
  const needsReview=HIGH_RISK.has(trusted.riskClass);
  const highRiskReview=riskKnown&&(!needsReview||(review.contractVersion==='VECTOR_TRAINING_HUMAN_REVIEW_V1'&&
    bound(review)&&fresh(review)&&matchesMedia(review.mediaIdentity)&&review.approved===true&&
    text(review.reviewerRef)&&review.riskClass===trusted.riskClass));
  const tutorDisabled=input.tutor===undefined||tutor.enabled===false;
  const tutorBound=tutor.enabled===true&&bound(tutor)&&fresh(tutor)&&tutor.contractVersion==='VECTOR_TRAINING_TUTOR_EVALUATION_V1';
  const completeness=object(media.completeness),publication=object(media.publication);
  const gates={
    exactProductBound:bindingValid,
    noPassiveMastery:module.exposureOnly===true&&module.evidencePolicy==='NO_MASTERY_FROM_DELIVERY',
    receiptBinding:authoringBound&&mediaBound&&voiceBound,
    videoReceipt:videoValidation.ok===true,
    narrationReceipt:narrationValid,
    freshness:[authoring,media,voice,scan].every(fresh)&&(!needsReview||fresh(review))&&
      (tutorDisabled||fresh(tutor)),
    sourceGrounded,
    highRiskReview,
    retrievalPractice:authoringBound&&Number.isSafeInteger(authoring.retrievalItems)&&authoring.retrievalItems>=2,
    independentTask:authoringBound&&authoring.independentTask===true,
    explanatoryFeedback:authoringBound&&authoring.explanatoryFeedback===true,
    mediaIdentity:mediaBound&&voiceBound&&matchesMedia(actualMedia)&&
      voice.audioSha256===identity.audioSha256&&voice.transcriptSha256===identity.transcriptSha256&&
      object(media.narration).audioSha256===identity.audioSha256&&
      number(actualMedia.durationMs)&&actualMedia.durationMs>=2000&&
      number(voice.durationMs)&&voice.durationMs>=500&&voice.durationMs<=actualMedia.durationMs,
    captions:media.captionsAvailable===true&&completeness.captions===true,
    transcript:media.transcriptAvailable===true&&completeness.transcript===true,
    narrated:voice.state==='READY'&&media.narrationState==='READY'&&videoValidation.state==='READY'&&
      narrationValid&&voice.durable===true&&https(voice.audioUrl)&&completeness.narration===true,
    privacySafe:scanBound&&scan.pii==='PASS'&&object(voice.scan).pii==='PASS'&&
      (media.privacySafe===undefined||media.privacySafe===true),
    secretSafe:scanBound&&scan.secrets==='PASS'&&object(voice.scan).secrets==='PASS'&&
      (media.secretSafe===undefined||media.secretSafe===true),
    mediaState:['READY','PROOF_ONLY'].includes(media.state)&&['READY','PROOF_ONLY'].includes(voice.state),
    durablePublication:media.state==='READY'&&publication.durable===true&&
      ['videoUrl','captionsUrl','transcriptUrl'].every(key=>https(publication[key])),
    tutorGrounded:tutorDisabled||(tutorBound&&rate(tutor.groundedRate)&&tutor.groundedRate>=0.98),
    tutorHintFirst:tutorDisabled||(tutorBound&&rate(tutor.directAnswerLeakRate)&&tutor.directAnswerLeakRate<=0.02),
    tutorEscalation:tutorDisabled||(tutorBound&&rate(tutor.escalationAccuracy)&&tutor.escalationAccuracy>=0.95)
  };
  const blockers=Object.entries(gates).filter(([,passed])=>!passed).map(([name])=>name);
  const publishable=blockers.length===0;
  const proofEligible=['exactProductBound','noPassiveMastery','receiptBinding','videoReceipt','narrationReceipt','freshness','mediaIdentity','privacySafe','secretSafe','mediaState'].every(key=>gates[key]);
  const state=publishable?'PUBLISHABLE':(proofEligible?'PROOF_ONLY':'BLOCKED');
  return Object.freeze({contractVersion:'VECTOR_TRAINING_QUALITY_GATE_V2',state,publishable,
    validationScope:'STRUCTURAL_ONLY',requiresTrustedCollector:true,awardsMastery:false,awardsCompetency:false,
    gates:Object.freeze(gates),blockers:Object.freeze(blockers)});
}

module.exports=Object.freeze({evaluateTrainingQuality});
