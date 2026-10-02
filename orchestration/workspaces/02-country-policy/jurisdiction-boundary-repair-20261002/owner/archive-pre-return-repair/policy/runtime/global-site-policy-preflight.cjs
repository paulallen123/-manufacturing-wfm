'use strict';

const { inertJsonCopy } = require('../../implementation/runtime/inert-finite-json.cjs');
const { types } = require('node:util');
function inputCopy(value){return inertJsonCopy(value,'policy input');}
function freezeTree(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}return value;}
function immutable(value){return freezeTree(JSON.parse(JSON.stringify(inputCopy(value))));}
// Factory collaborators are trusted configuration, never policy/worker data.
function collaborator(options,key,fallback){
  if(!options||typeof options!=='object'||types.isProxy(options)||Object.getPrototypeOf(options)!==Object.prototype)throw Error('Invalid trusted factory configuration');
  const descriptors=Object.getOwnPropertyDescriptors(options);
  for(const descriptor of Object.values(descriptors))if(!Object.hasOwn(descriptor,'value'))throw Error('Factory configuration cannot contain accessors');
  return descriptors[key]?descriptors[key].value:fallback;
}

const { createHash } = require('node:crypto');
function stableValue(v){if(Array.isArray(v)) return '['+v.map(stableValue).join(',')+']';if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableValue(v[k])).join(',')+'}';return JSON.stringify(v);}
function stable(value){return stableValue(inputCopy(value));}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=160){return String(v??'').trim().slice(0,max);}
function list(v,max=100,maxLen=160){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function createGlobalSitePolicyPreflight(options={}){
  const graph=collaborator(options,'graph',null);
  if(!graph||typeof graph!=='object'||types.isProxy(graph)||Object.getPrototypeOf(graph)!==Object.prototype)throw Error('Global site preflight requires a trusted plain jurisdiction policy graph.');
  const resolveDescriptor=Object.getOwnPropertyDescriptor(graph,'resolve');
  if(!resolveDescriptor||!Object.hasOwn(resolveDescriptor,'value')||typeof resolveDescriptor.value!=='function')throw Error('Global site preflight requires an inert graph resolve method descriptor.');
  const resolve=resolveDescriptor.value.bind(graph);
  function assess(input={}){
    input=inputCopy(input);
    const tenant=text(input.tenant,120),site=input.site||{},workers=Array.isArray(input.workers)?input.workers:[];
    if(!tenant||!text(site.id,120)) throw new Error('tenant and site.id are required.');
    const country=text(site.country,2).toUpperCase(),baseQuestions=[];
    if(!/^[A-Z]{2}$/.test(country)) baseQuestions.push({code:'SITE_COUNTRY_REQUIRED',scope:'site',siteId:site.id});
    if(!text(site.legalEntityId,160)) baseQuestions.push({code:'LEGAL_ENTITY_REQUIRED',scope:'site',siteId:site.id});
    if(input.workers!==undefined&&!Array.isArray(input.workers))throw Error('Supplied workers must be an array');
    const ids=new Set();
    for(const worker of workers){const id=text(worker?.id,160);if(!id||ids.has(id))throw Error('Supplied worker identity must be present and unique');ids.add(id);}
    const results=[];
    for(const worker of workers){
      const workerId=text(worker.id,160);
      const workCountry=text(worker.workLocationCountry||country,2).toUpperCase();
      const context={country:workCountry,subdivision:text(worker.workLocationSubdivision||site.subdivision,80)||null,sector:text(worker.sector||site.sector,120)||null,legalEntityId:text(worker.legalEntityId||site.legalEntityId,160)||null,siteId:text(site.id,120),employmentCategory:text(worker.employmentCategory,120)||null,workerClass:text(worker.workerClass,120)||null,collectiveAgreements:list(worker.collectiveAgreements||site.collectiveAgreements,20,160),workLocationCountry:workCountry,workLocationSubdivision:text(worker.workLocationSubdivision,80)||null};
      if(!context.employmentCategory) baseQuestions.push({code:'EMPLOYMENT_CATEGORY_REQUIRED',scope:'worker',workerId});
      const resolved=/^[A-Z]{2}$/.test(workCountry)?resolve({...(input.legalAt===undefined?{}:{legalAt:input.legalAt}),...(input.knownAt===undefined?{}:{knownAt:input.knownAt}),context}):null;
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
    return immutable({...payload,preflightDigest:digest(payload)});
  }
  return Object.freeze({assess});
}
module.exports=Object.freeze({createGlobalSitePolicyPreflight,digest,stable});
