'use strict';

const { createHash } = require('node:crypto');
const CONTRACT_VERSION='VECTOR_COUNTRY_POLICY_PACK_V1';
const STATUSES=new Set(['DRAFT','VERIFIED','RETIRED']);
const EFFECTS=new Set(['ALLOW','DENY','LIMIT','REQUIRE_APPROVAL','REQUIRE_EVIDENCE','INFORMATIONAL']);
const DOMAINS=new Set(['working-time','overtime','rest','absence','holiday','payroll','ai-governance','privacy','worker-category','evidence-retention','certification','safety']);
function stable(value){if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function countryCode(v){return typeof v==='string'?v.trim().toUpperCase():'';}
function iso(v,name){const raw=text(v,80),ms=Date.parse(raw);if(!raw||!Number.isFinite(ms)) throw new Error(name+' must be a valid ISO timestamp.');return new Date(ms).toISOString();}
function list(v,max=40,maxLen=300){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function normaliseRule(rule={}){
  const id=text(rule.id,120),domain=text(rule.domain,80),effect=text(rule.effect,40).toUpperCase();
  if(!id) throw new Error('Policy rule id is required.');
  if(!DOMAINS.has(domain)) throw new Error('Unsupported policy domain: '+domain);
  if(!EFFECTS.has(effect)) throw new Error('Unsupported policy effect: '+effect);
  return Object.freeze({id,domain,effect,summary:text(rule.summary,400),parameters:clone(rule.parameters||{}),sourceRefs:list(rule.sourceRefs,20,300),authorityRequired:effect==='REQUIRE_APPROVAL'?'HUMAN_APPROVAL_REQUIRED':'EXTERNAL_RULE_AUTHORITY'});
}
function normalisePack(pack={}){
  const id=text(pack.id,120),country=countryCode(pack.country),version=text(pack.version,60),status=text(pack.status,20).toUpperCase();
  if(!id||!/^[A-Z]{2}$/.test(country)||!version) throw new Error('Policy pack requires id, ISO alpha-2 country and version.');
  if(!STATUSES.has(status)) throw new Error('Unsupported policy pack status.');
  const effectiveFrom=iso(pack.effectiveFrom,'effectiveFrom'),effectiveTo=pack.effectiveTo?iso(pack.effectiveTo,'effectiveTo'):null;
  if(effectiveTo&&Date.parse(effectiveTo)<=Date.parse(effectiveFrom)) throw new Error('effectiveTo must be after effectiveFrom.');
  const sourceRefs=list(pack.sourceRefs,40,300),verifiedAt=pack.verifiedAt?iso(pack.verifiedAt,'verifiedAt'):null;
  if(status==='VERIFIED'&&(!verifiedAt||!sourceRefs.length||!text(pack.verifiedBy,180))) throw new Error('Verified policy pack requires verifiedAt, verifiedBy and sourceRefs.');
  const rules=(Array.isArray(pack.rules)?pack.rules:[]).map(normaliseRule);
  if(new Set(rules.map(r=>r.id)).size!==rules.length) throw new Error('Policy rule ids must be unique within a pack.');
  const core={contractVersion:CONTRACT_VERSION,id,country,version,status,effectiveFrom,effectiveTo,verifiedAt,verifiedBy:pack.verifiedBy?text(pack.verifiedBy,180):null,sourceRefs,rules,legalEntityTypes:list(pack.legalEntityTypes,20,80),regions:list(pack.regions,40,120),notes:pack.notes?text(pack.notes,600):null,grantsExecutionAuthority:false,claimBoundary:'Country packs provide versioned policy requirements and evidence. They never override authoritative law, payroll, safety or customer policy systems and never grant execution authority.'};
  return Object.freeze({...core,packDigest:digest(core)});
}
function createCountryPolicyPackRegistry(initial=[]){
  const packs=new Map(); for(const pack of initial) register(pack);
  function key(pack){return pack.country+'|'+pack.id+'|'+pack.version;}
  function register(input){const pack=normalisePack(input),k=key(pack);if(packs.has(k)) throw new Error('Policy pack version already registered.');packs.set(k,pack);return pack;}
  function all(){return [...packs.values()].sort((a,b)=>a.country.localeCompare(b.country)||a.id.localeCompare(b.id)||a.version.localeCompare(b.version));}
  function resolve(input={}){
    const country=countryCode(input.country); if(!/^[A-Z]{2}$/.test(country)) throw new Error('resolve requires ISO alpha-2 country.');
    const at=iso(input.at||new Date().toISOString(),'at'),ms=Date.parse(at);
    const matches=all().filter(pack=>pack.country===country&&pack.status==='VERIFIED'&&Date.parse(pack.effectiveFrom)<=ms&&(!pack.effectiveTo||ms<Date.parse(pack.effectiveTo)));
    const rules=matches.flatMap(pack=>pack.rules.map(rule=>({...rule,packId:pack.id,packVersion:pack.version,packDigest:pack.packDigest})));
    return Object.freeze({contractVersion:'VECTOR_COUNTRY_POLICY_CONTEXT_V1',country,at,packs:matches.map(pack=>({id:pack.id,version:pack.version,packDigest:pack.packDigest,verifiedAt:pack.verifiedAt,verifiedBy:pack.verifiedBy,sourceRefs:pack.sourceRefs})),rules,verifiedCoverage:matches.length>0,executionAuthority:false,limitations:matches.length?[]:['No verified effective policy pack is registered for this country/date. Fail closed to authoritative customer/legal review for policy-dependent execution.']});
  }
  return Object.freeze({register,resolve,all});
}
module.exports=Object.freeze({CONTRACT_VERSION,STATUSES,EFFECTS,DOMAINS,normalisePack,createCountryPolicyPackRegistry,digest,stable});

