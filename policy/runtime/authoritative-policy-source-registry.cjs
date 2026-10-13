'use strict';
const { createHash } = require('node:crypto');
const AUTHORITY_TIERS=new Set(['PRIMARY_GOVERNMENT','OFFICIAL_REGULATOR','OFFICIAL_STATUTORY_INTERFACE','CUSTOMER_PRIVATE_INSTRUMENT','QUALIFIED_REVIEW']);
const CHANNELS=new Set(['API','FEED','MACHINE_DOWNLOAD','OFFICIAL_WEB','SUBSCRIPTION','CUSTOMER_UPLOAD']);
function stable(v){if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v,name){
  const raw=text(v,80),ms=Date.parse(raw),date=/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(raw);
  let calendarValid=true;
  if(date){
    const year=Number(date[1]),month=Number(date[2]),day=Number(date[3]);
    const leap=year%4===0&&(year%100!==0||year%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    calendarValid=month>=1&&month<=12&&day>=1&&day<=days[month-1];
  }
  if(!raw||!Number.isFinite(ms)||!calendarValid) throw new Error((name||'timestamp')+' must be valid ISO.');
  return new Date(ms).toISOString();
}
function list(v,max=50,maxLen=240){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function normaliseSource(input={}){
  const id=text(input.id,160),authorityTier=text(input.authorityTier,60).toUpperCase(),channel=text(input.channel,40).toUpperCase();
  if(!id||!AUTHORITY_TIERS.has(authorityTier)||!CHANNELS.has(channel)) throw new Error('Source requires id, supported authorityTier and channel.');
  const jurisdiction=text(input.jurisdiction,120); if(!jurisdiction) throw new Error('Source jurisdiction is required.');
  const declaredFreshness=input.freshnessHours,requestedFreshness=Number(declaredFreshness||24);
  if(!Number.isFinite(requestedFreshness)||(typeof declaredFreshness==='number'&&!Number.isFinite(declaredFreshness))) throw new Error('Source freshnessHours must be finite.');
  const freshnessHours=Math.max(1,Math.min(24*90,requestedFreshness));
  const core={contractVersion:'VECTOR_POLICY_SOURCE_V1',id,authorityTier,channel,jurisdiction,canonicalReference:text(input.canonicalReference,500),nativeLanguages:Object.freeze(list(input.nativeLanguages,20,32)),freshnessHours,active:input.active!==false,customerSupplied:authorityTier==='CUSTOMER_PRIVATE_INSTRUMENT',grantsExecutionAuthority:false};
  if(!core.canonicalReference) throw new Error('Source canonicalReference is required.');
  return Object.freeze({...core,sourceDigest:digest(core)});
}
function createAuthoritativePolicySourceRegistry(initial=[]){
  const sources=new Map(),snapshots=new Map(); for(const s of initial) registerSource(s);
  function registerSource(input){const s=normaliseSource(input);if(sources.has(s.id)) throw new Error('Source already registered: '+s.id);sources.set(s.id,s);snapshots.set(s.id,[]);return s;}
  function recordSnapshot(input={}){
    const source=sources.get(text(input.sourceId,160)); if(!source) throw new Error('Unknown source.');
    const observedAt=iso(input.observedAt,'observedAt'),contentDigest=text(input.contentDigest,128).toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(contentDigest)) throw new Error('Snapshot requires sha256 contentDigest.');
    const core={contractVersion:'VECTOR_POLICY_SOURCE_SNAPSHOT_V1',sourceId:source.id,sourceDigest:source.sourceDigest,observedAt,revision:text(input.revision,200)||null,contentDigest,retrievalMethod:text(input.retrievalMethod,80)||source.channel,canonicalReference:text(input.canonicalReference,500)||source.canonicalReference,verifiedRetrieval:input.verifiedRetrieval===true,customerMutation:false,executionAuthority:false};
    if(!core.verifiedRetrieval) throw new Error('Snapshot must be verified retrieval evidence.');
    const receipt=Object.freeze({...core,snapshotDigest:digest(core)}); snapshots.get(source.id).push(receipt); return receipt;
  }
  function latest(sourceId){const arr=snapshots.get(text(sourceId,160))||[];return arr.length?arr[arr.length-1]:null;}
  function assess(sourceId,{at=new Date().toISOString()}={}){
    const source=sources.get(text(sourceId,160)); if(!source) throw new Error('Unknown source.');
    const snap=latest(source.id),atIso=iso(at,'at');
    if(!source.active) return Object.freeze({sourceId:source.id,state:'DISABLED',usable:false,requiresAttention:true});
    if(!snap) return Object.freeze({sourceId:source.id,state:'NO_EVIDENCE',usable:false,requiresAttention:true});
    const ageHours=(Date.parse(atIso)-Date.parse(snap.observedAt))/3600000,stale=ageHours>source.freshnessHours,notYetObserved=ageHours<0;
    return Object.freeze({sourceId:source.id,state:notYetObserved?'NOT_YET_OBSERVED':stale?'STALE':'CURRENT',usable:!stale&&!notYetObserved,requiresAttention:stale||notYetObserved,ageHours:Number(ageHours.toFixed(3)),freshnessHours:source.freshnessHours,snapshotDigest:snap.snapshotDigest});
  }
  function all(){return [...sources.values()].sort((a,b)=>a.id.localeCompare(b.id));}
  return Object.freeze({registerSource,recordSnapshot,latest,assess,all});
}
module.exports=Object.freeze({AUTHORITY_TIERS,CHANNELS,normaliseSource,createAuthoritativePolicySourceRegistry,digest,stable});

