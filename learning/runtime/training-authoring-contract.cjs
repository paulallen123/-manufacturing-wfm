'use strict';

const { createHash } = require('node:crypto');

const AUTHORING_JOB_VERSION='VECTOR_TRAINING_AUTHORING_JOB_V1';
const AUTHORING_RECEIPT_VERSION='VECTOR_TRAINING_AUTHORING_RECEIPT_V1';
const HIGH_RISK=new Set(['PAYROLL','SAFETY','COMPLIANCE','LEGAL','ACCESS_CONTROL','PRODUCTION_AUTHORITY']);

function clean(v,max=1200){return String(v??'').trim().slice(0,max);}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function sha256(value){return createHash('sha256').update(String(value)).digest('hex');}
function validDigest(v){return /^[a-f0-9]{64}$/i.test(clean(v,80));}

function createAuthoringJob(input={}){
  const sources=(Array.isArray(input.sources)?input.sources:[]).map(source=>({
    sourceRef:clean(source.sourceRef,300),
    sha256:clean(source.sha256,80),
    revision:clean(source.revision,120),
    approved:source.approved===true,
    authority:clean(source.authority||'CUSTOMER_APPROVED',80)
  }));
  if(!sources.length||sources.some(x=>!x.sourceRef||!validDigest(x.sha256)||!x.revision||!x.approved)) throw new Error('Authoring requires approved, versioned, digest-bound sources.');
  const riskClass=clean(input.riskClass||'STANDARD',60).toUpperCase();
  const target={
    competencyKey:clean(input.competencyKey,180),
    title:clean(input.title,240),
    objective:clean(input.objective,1200),
    roles:[...new Set((Array.isArray(input.roles)?input.roles:[]).map(x=>clean(x,80)).filter(Boolean))],
    locale:clean(input.locale||'en-GB',40),
    riskClass
  };
  if(!target.competencyKey||!target.title||!target.objective||!target.roles.length) throw new Error('Authoring target is incomplete.');
  const sourceDigest=sha256(stable(sources));
  return Object.freeze({
    contractVersion:AUTHORING_JOB_VERSION,
    jobId:'author-'+sha256(stable({target,sourceDigest})).slice(0,40),
    target,
    sources:Object.freeze(sources),
    sourceDigest,
    requiredOutput:Object.freeze({
      conciseExplanation:true,
      workedExample:true,
      retrievalItemsMin:2,
      practiceScenario:true,
      misconceptionFeedback:true,
      independentTask:true,
      managerApplication:true,
      accessibilityNotes:true,
      sourceRefsPerSection:true
    }),
    policy:Object.freeze({
      answerGiving:'HINT_FIRST',
      unsupportedClaims:'FORBIDDEN',
      sourceGrounding:'REQUIRED',
      humanReviewRequired:HIGH_RISK.has(riskClass),
      autoPublishAllowed:!HIGH_RISK.has(riskClass)
    })
  });
}

function validateAuthoringReceipt(job,receipt={}){
  const errors=[];
  if(job?.contractVersion!==AUTHORING_JOB_VERSION) errors.push('JOB_CONTRACT_INVALID');
  if(receipt.contractVersion!==AUTHORING_RECEIPT_VERSION) errors.push('RECEIPT_CONTRACT_INVALID');
  if(receipt.jobId!==job.jobId) errors.push('JOB_BINDING_MISMATCH');
  if(receipt.sourceDigest!==job.sourceDigest) errors.push('SOURCE_DIGEST_MISMATCH');
  const usedRefs=new Set(Array.isArray(receipt.sourceRefs)?receipt.sourceRefs.map(String):[]);
  const allowedRefs=new Set(job.sources.map(x=>x.sourceRef));
  for(const ref of usedRefs) if(!allowedRefs.has(ref)) errors.push('UNAPPROVED_SOURCE_USED');
  if(!usedRefs.size) errors.push('SOURCE_REFS_REQUIRED');
  const content=receipt.content||{};
  if(!clean(content.conciseExplanation,4000)) errors.push('EXPLANATION_REQUIRED');
  if(!clean(content.workedExample,4000)) errors.push('WORKED_EXAMPLE_REQUIRED');
  if(!Array.isArray(content.retrievalItems)||content.retrievalItems.length<2) errors.push('RETRIEVAL_ITEMS_REQUIRED');
  if(!content.practiceScenario) errors.push('PRACTICE_SCENARIO_REQUIRED');
  if(!Array.isArray(content.misconceptionFeedback)||!content.misconceptionFeedback.length) errors.push('MISCONCEPTION_FEEDBACK_REQUIRED');
  if(!content.independentTask) errors.push('INDEPENDENT_TASK_REQUIRED');
  if(!content.accessibilityNotes) errors.push('ACCESSIBILITY_NOTES_REQUIRED');
  if(receipt.unsupportedClaimsDetected===true) errors.push('UNSUPPORTED_CLAIMS_DETECTED');
  const needsHuman=job.policy.humanReviewRequired===true;
  const approved=receipt.humanReview?.approved===true;
  const state=errors.length?'FAILED':(needsHuman&&!approved?'REVIEW_REQUIRED':'APPROVED');
  return Object.freeze({ok:errors.length===0,state,errors:[...new Set(errors)],humanReviewRequired:needsHuman});
}

module.exports=Object.freeze({AUTHORING_JOB_VERSION,AUTHORING_RECEIPT_VERSION,HIGH_RISK,createAuthoringJob,validateAuthoringReceipt,sha256,stable});
