'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_JURISDICTION_POLICY_GRAPH_V1';
const LAYERS = Object.freeze([
  'GLOBAL','SUPRANATIONAL','COUNTRY','SUBDIVISION','SECTOR','COLLECTIVE_AGREEMENT',
  'LEGAL_ENTITY','SITE','EMPLOYMENT','WORKER_CLASS','WORK_LOCATION','CUSTOMER_POLICY'
]);
const LEGAL_CHARACTERS = new Set([
  'MANDATORY_FLOOR','MANDATORY_CEILING','MANDATORY_REQUIREMENT','ENTITLEMENT',
  'EXCEPTION','CUSTOMER_POLICY','INFORMATIONAL'
]);
const OPERATORS = new Set(['MIN','MAX','REQUIRE','DENY','ALLOW','SET','INFO']);

function stable(v){
  if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function countryCode(v){return typeof v==='string'?v.trim().toUpperCase():'';}
function iso(v,name){const raw=text(v,80),ms=Date.parse(raw);if(!raw||!Number.isFinite(ms)) throw new Error((name||'timestamp')+' must be valid ISO.');return new Date(ms).toISOString();}
function list(v,max=100,maxLen=240){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function exactOrListMatch(expected,actual){
  if(expected==null||expected===''||(Array.isArray(expected)&&expected.length===0)) return true;
  const values=Array.isArray(expected)?expected:[expected];
  if(Array.isArray(actual)) return values.some(v=>actual.map(String).includes(String(v)));
  return values.map(String).includes(String(actual??''));
}

function normaliseRule(rule={},node={}){
  const id=text(rule.id,160),domain=text(rule.domain,80),key=text(rule.key||rule.metric||rule.id,160);
  const legalCharacter=text(rule.legalCharacter,40).toUpperCase();
  const operator=text(rule.operator,20).toUpperCase();
  if(!id||!domain||!key) throw new Error('Policy rule requires id, domain and key.');
  if(!LEGAL_CHARACTERS.has(legalCharacter)) throw new Error('Unsupported legalCharacter: '+legalCharacter);
  if(!OPERATORS.has(operator)) throw new Error('Unsupported operator: '+operator);
  const numeric=['MIN','MAX'].includes(operator);
  if(numeric && !Number.isFinite(Number(rule.value))) throw new Error('Numeric policy operator requires finite value.');
  if(legalCharacter==='EXCEPTION' && (!rule.exceptionTo || rule.verifiedException!==true)) throw new Error('Policy exception requires exceptionTo and verifiedException=true.');
  const core={id,domain,key,legalCharacter,operator,value:numeric?Number(rule.value):clone(rule.value),unit:rule.unit?text(rule.unit,60):null,summary:text(rule.summary,500),sourceRefs:list(rule.sourceRefs?.length?rule.sourceRefs:node.sourceRefs,30,300),exceptionTo:rule.exceptionTo?text(rule.exceptionTo,160):null,verifiedException:rule.verifiedException===true,remediation:list(rule.remediation,20,240)};
  return Object.freeze({...core,ruleDigest:digest(core)});
}

function normaliseNode(node={}){
  const id=text(node.id,160),layer=text(node.layer,40).toUpperCase();
  if(!id||!LAYERS.includes(layer)) throw new Error('Policy node requires id and supported layer.');
  const effectiveFrom=iso(node.effectiveFrom,'effectiveFrom');
  const effectiveTo=node.effectiveTo?iso(node.effectiveTo,'effectiveTo'):null;
  if(effectiveTo&&Date.parse(effectiveTo)<=Date.parse(effectiveFrom)) throw new Error('effectiveTo must follow effectiveFrom.');
  const recordedAt=iso(node.recordedAt||node.verifiedAt,'recordedAt');
  const supersededAt=node.supersededAt?iso(node.supersededAt,'supersededAt'):null;
  if(supersededAt&&Date.parse(supersededAt)<Date.parse(recordedAt)) throw new Error('supersededAt cannot precede recordedAt.');
  const sourceRefs=list(node.sourceRefs,40,300);
  if(node.verified!==true||!sourceRefs.length) throw new Error('Policy node must be verified and provenance-backed.');
  const scope=clone(node.scope||{});
  const rules=(node.rules||[]).map(rule=>normaliseRule(rule,{sourceRefs}));
  if(!rules.length) throw new Error('Policy node requires at least one rule.');
  if(new Set(rules.map(x=>x.id)).size!==rules.length) throw new Error('Policy rule ids must be unique within a node.');
  const core={contractVersion:CONTRACT_VERSION,id,layer,effectiveFrom,effectiveTo,recordedAt,supersededAt,sourceRefs,scope,rules,verified:true,grantsExecutionAuthority:false};
  return Object.freeze({...core,nodeDigest:digest(core)});
}

function nodeMatchesContext(node,context={}){
  const s=node.scope||{};
  for(const f of ['supranationalRegime','country','subdivision','sector','legalEntityId','siteId','employmentCategory','workerClass','workLocationCountry','workLocationSubdivision']) if(!exactOrListMatch(s[f],context[f])) return false;
  if(!exactOrListMatch(s.collectiveAgreements,context.collectiveAgreements||[])) return false;
  return true;
}
function activeAt(node,legalAt,knownAt){
  const legal=Date.parse(legalAt),known=Date.parse(knownAt);
  return Date.parse(node.effectiveFrom)<=legal && (!node.effectiveTo||legal<Date.parse(node.effectiveTo)) &&
    Date.parse(node.recordedAt)<=known && (!node.supersededAt||known<Date.parse(node.supersededAt));
}

function composeRuleSet(rules=[]){
  const byKey=new Map();
  for(const item of rules){if(!byKey.has(item.rule.key)) byKey.set(item.rule.key,[]);byKey.get(item.rule.key).push(item);}
  const constraints=[],review=[],informational=[];
  for(const [key,items] of byKey){
    const denied=items.filter(x=>x.rule.operator==='DENY'&&x.rule.legalCharacter!=='EXCEPTION');
    if(denied.length){constraints.push({key,result:'DENY',sources:denied.map(x=>x.rule.id),reason:'MANDATORY_DENY'});continue;}
    const floors=items.filter(x=>x.rule.legalCharacter==='MANDATORY_FLOOR'&&x.rule.operator==='MIN');
    const ceilings=items.filter(x=>x.rule.legalCharacter==='MANDATORY_CEILING'&&x.rule.operator==='MAX');
    const entitlements=items.filter(x=>x.rule.legalCharacter==='ENTITLEMENT'&&x.rule.operator==='MIN');
    const requirements=items.filter(x=>x.rule.legalCharacter==='MANDATORY_REQUIREMENT'||x.rule.operator==='REQUIRE');
    const customer=items.filter(x=>x.rule.legalCharacter==='CUSTOMER_POLICY');
    const exceptions=items.filter(x=>x.rule.legalCharacter==='EXCEPTION');
    const info=items.filter(x=>x.rule.legalCharacter==='INFORMATIONAL'||x.rule.operator==='INFO');
    if(floors.length||entitlements.length){
      const candidates=[...floors,...entitlements],chosen=Math.max(...candidates.map(x=>Number(x.rule.value)));
      constraints.push({key,result:'MIN',value:chosen,unit:candidates.find(x=>Number(x.rule.value)===chosen)?.rule.unit||null,sources:candidates.filter(x=>Number(x.rule.value)===chosen).map(x=>x.rule.id),reason:'MOST_PROTECTIVE_FLOOR'});
    }
    if(ceilings.length){
      const chosen=Math.min(...ceilings.map(x=>Number(x.rule.value)));
      constraints.push({key,result:'MAX',value:chosen,unit:ceilings.find(x=>Number(x.rule.value)===chosen)?.rule.unit||null,sources:ceilings.filter(x=>Number(x.rule.value)===chosen).map(x=>x.rule.id),reason:'STRICTEST_MANDATORY_CEILING'});
    }
    for(const x of requirements) constraints.push({key,result:'REQUIRE',value:clone(x.rule.value),sources:[x.rule.id],reason:'MANDATORY_REQUIREMENT'});
    for(const x of customer){
      const mandatoryMax=constraints.find(c=>c.key===key&&c.result==='MAX'),mandatoryMin=constraints.find(c=>c.key===key&&c.result==='MIN');
      if(x.rule.operator==='MAX'&&mandatoryMax&&Number(x.rule.value)>mandatoryMax.value){review.push({key,ruleId:x.rule.id,reason:'CUSTOMER_POLICY_CANNOT_WEAKEN_MANDATORY_CEILING'});continue;}
      if(x.rule.operator==='MIN'&&mandatoryMin&&Number(x.rule.value)<mandatoryMin.value){review.push({key,ruleId:x.rule.id,reason:'CUSTOMER_POLICY_CANNOT_WEAKEN_MANDATORY_FLOOR'});continue;}
      constraints.push({key,result:x.rule.operator,value:clone(x.rule.value),unit:x.rule.unit||null,sources:[x.rule.id],reason:'CUSTOMER_POLICY_STRICTER_OR_PERMITTED'});
    }
    for(const x of exceptions) review.push({key,ruleId:x.rule.id,exceptionTo:x.rule.exceptionTo,reason:'VERIFIED_EXCEPTION_REQUIRES_CONTEXTUAL_REVIEW'});
    for(const x of info) informational.push({key,ruleId:x.rule.id,value:clone(x.rule.value)});
  }
  return {constraints,review,informational};
}

function createJurisdictionPolicyGraph(initial=[]){
  const nodes=new Map(); for(const node of initial) register(node);
  function register(input){const node=normaliseNode(input);if(nodes.has(node.id)) throw new Error('Policy node already registered: '+node.id);nodes.set(node.id,node);return node;}
  function all(){return [...nodes.values()].sort((a,b)=>LAYERS.indexOf(a.layer)-LAYERS.indexOf(b.layer)||a.id.localeCompare(b.id));}
  function resolve(input={}){
    const legalAt=iso(input.legalAt||new Date().toISOString(),'legalAt');
    const knownAt=iso(input.knownAt||new Date().toISOString(),'knownAt');
    const context=clone(input.context||{});
    context.country=countryCode(context.country);
    if(!/^[A-Z]{2}$/.test(context.country)) throw new Error('Jurisdiction resolution requires ISO alpha-2 context.country.');
    if(context.workLocationCountry!=null){
      context.workLocationCountry=countryCode(context.workLocationCountry);
      if(!/^[A-Z]{2}$/.test(context.workLocationCountry)) throw new Error('Jurisdiction resolution requires ISO alpha-2 work location country.');
    }
    const applicable=all().filter(node=>activeAt(node,legalAt,knownAt)&&nodeMatchesContext(node,context));
    const rules=applicable.flatMap(node=>node.rules.map(rule=>({node,rule})));
    const composed=composeRuleSet(rules);
    const payload={contractVersion:'VECTOR_JURISDICTION_POLICY_CONTEXT_V1',legalAt,knownAt,context,applicableNodes:applicable.map(n=>({id:n.id,layer:n.layer,nodeDigest:n.nodeDigest,sourceRefs:n.sourceRefs,effectiveFrom:n.effectiveFrom,effectiveTo:n.effectiveTo,recordedAt:n.recordedAt})),constraints:composed.constraints,review:composed.review,informational:composed.informational,verifiedCoverage:applicable.length>0,executionAuthority:false,claimBoundary:'Advisory policy context only. This resolver does not grant payroll, scheduling, legal or machine-control authority.'};
    return Object.freeze({...clone(payload),contextDigest:digest(payload)});
  }
  return Object.freeze({register,resolve,all});
}

module.exports=Object.freeze({CONTRACT_VERSION,LAYERS,LEGAL_CHARACTERS,OPERATORS,normaliseNode,createJurisdictionPolicyGraph,composeRuleSet,digest,stable});

