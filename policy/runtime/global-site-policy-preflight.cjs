'use strict';
const { createHash } = require('node:crypto');
function stable(v){if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=160){return String(v??'').trim().slice(0,max);}
function countryCode(v){return typeof v==='string'?v.trim().toUpperCase():'';}
function list(v,max=100,maxLen=160){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function createGlobalSitePolicyPreflight({graph}={}){
  if(!graph||typeof graph.resolve!=='function') throw new Error('Global site preflight requires jurisdiction policy graph.');
  function assess(input={}){
    const tenant=text(input.tenant,120),site=input.site||{},workers=Array.isArray(input.workers)?input.workers:[];
    if(!tenant||!text(site.id,120)) throw new Error('tenant and site.id are required.');
    const country=countryCode(site.country),baseQuestions=[];
    if(!/^[A-Z]{2}$/.test(country)) baseQuestions.push({code:'SITE_COUNTRY_REQUIRED',scope:'site',siteId:site.id});
    if(!text(site.legalEntityId,160)) baseQuestions.push({code:'LEGAL_ENTITY_REQUIRED',scope:'site',siteId:site.id});
    const results=[];
    for(const worker of workers){
      const workerId=text(worker.id,160); if(!workerId) continue;
      const workCountry=countryCode(worker.workLocationCountry==null||worker.workLocationCountry===''?country:worker.workLocationCountry);
      const context={country:workCountry,subdivision:text(worker.workLocationSubdivision||site.subdivision,80)||null,sector:text(worker.sector||site.sector,120)||null,legalEntityId:text(worker.legalEntityId||site.legalEntityId,160)||null,siteId:text(site.id,120),employmentCategory:text(worker.employmentCategory,120)||null,workerClass:text(worker.workerClass,120)||null,collectiveAgreements:list(worker.collectiveAgreements||site.collectiveAgreements,20,160),workLocationCountry:workCountry,workLocationSubdivision:text(worker.workLocationSubdivision,80)||null};
      if(!context.employmentCategory) baseQuestions.push({code:'EMPLOYMENT_CATEGORY_REQUIRED',scope:'worker',workerId});
      const resolved=/^[A-Z]{2}$/.test(workCountry)?graph.resolve({legalAt:input.legalAt,knownAt:input.knownAt,context}):null;
      results.push({workerId,context,policyContext:resolved,ready:Boolean(resolved?.verifiedCoverage),requiresReview:Boolean(resolved?.review?.length)});
    }
    const questions=[...new Map(baseQuestions.map(q=>[stable(q),q])).values()],noCoverage=results.filter(x=>!x.ready).map(x=>x.workerId),reviewWorkers=results.filter(x=>x.requiresReview).map(x=>x.workerId);
    let status='READY_ADVISORY';
    if(questions.length) status='REQUIRES_CUSTOMER_INPUT';
    else if(noCoverage.length) status='BLOCKED_POLICY_COVERAGE';
    else if(reviewWorkers.length) status='READY_WITH_REVIEW';
    const payload={contractVersion:'VECTOR_GLOBAL_SITE_POLICY_PREFLIGHT_V1',tenant,siteId:text(site.id,120),status,customerQuestions:questions,workers:results.map(x=>({workerId:x.workerId,ready:x.ready,requiresReview:x.requiresReview,contextDigest:x.policyContext?.contextDigest||null})),coverage:{workerCount:results.length,covered:results.filter(x=>x.ready).length,missing:noCoverage,requiresReview:reviewWorkers},automation:{publicLawMonitoringCustomerEffort:'NONE_EXPECTED',configurationMode:'INFER_THEN_EXCEPTION_ONLY',executionAuthority:false,customerMutation:false},nextActions:[]};
    if(status==='REQUIRES_CUSTOMER_INPUT') payload.nextActions.push('Ask only the listed irreducible organisational questions, then rerun preflight.');
    if(status==='BLOCKED_POLICY_COVERAGE') payload.nextActions.push('Acquire/verify authoritative policy coverage before any consequential action.');
    if(status==='READY_WITH_REVIEW') payload.nextActions.push('Route only the ambiguous/exception contexts for qualified review; keep the remaining population automated.');
    if(status==='READY_ADVISORY') payload.nextActions.push('Proceed to shadow scheduling/payroll/absence simulation; no execution authority granted.');
    return Object.freeze({...payload,preflightDigest:digest(payload)});
  }
  return Object.freeze({assess});
}
module.exports=Object.freeze({createGlobalSitePolicyPreflight,digest,stable});

