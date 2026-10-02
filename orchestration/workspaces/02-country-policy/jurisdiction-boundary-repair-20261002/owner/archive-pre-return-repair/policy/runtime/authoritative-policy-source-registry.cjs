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
const AUTHORITY_TIERS=new Set(['PRIMARY_GOVERNMENT','OFFICIAL_REGULATOR','OFFICIAL_STATUTORY_INTERFACE','CUSTOMER_PRIVATE_INSTRUMENT','QUALIFIED_REVIEW']);
const CHANNELS=new Set(['API','FEED','MACHINE_DOWNLOAD','OFFICIAL_WEB','SUBSCRIPTION','CUSTOMER_UPLOAD']);
function stableValue(v){if(Array.isArray(v)) return '['+v.map(stableValue).join(',')+']';if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableValue(v[k])).join(',')+'}';return JSON.stringify(v);}
function stable(value){return stableValue(inputCopy(value));}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v,name){const raw=text(v,80),ms=Date.parse(raw);if(!raw||!Number.isFinite(ms)) throw new Error((name||'timestamp')+' must be valid ISO.');return new Date(ms).toISOString();}
function list(v,max=50,maxLen=240){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function normaliseSource(input={}){
  input=inputCopy(input);
  const id=text(input.id,160),authorityTier=text(input.authorityTier,60).toUpperCase(),channel=text(input.channel,40).toUpperCase();
  if(!id||!AUTHORITY_TIERS.has(authorityTier)||!CHANNELS.has(channel)) throw new Error('Source requires id, supported authorityTier and channel.');
  const jurisdiction=text(input.jurisdiction,120); if(!jurisdiction) throw new Error('Source jurisdiction is required.');
  const freshnessHours=Math.max(1,Math.min(24*90,Number(input.freshnessHours||24)));
  if(!Number.isFinite(freshnessHours))throw Error('Source freshnessHours must be finite.');
  const core={contractVersion:'VECTOR_POLICY_SOURCE_V1',id,authorityTier,channel,jurisdiction,canonicalReference:text(input.canonicalReference,500),nativeLanguages:list(input.nativeLanguages,20,32),freshnessHours,active:input.active!==false,customerSupplied:authorityTier==='CUSTOMER_PRIVATE_INSTRUMENT',grantsExecutionAuthority:false};
  if(!core.canonicalReference) throw new Error('Source canonicalReference is required.');
  return immutable({...core,sourceDigest:digest(core)});
}
function createAuthoritativePolicySourceRegistry(initial=[],options={}){
  initial=inputCopy(initial);if(!Array.isArray(initial))throw Error('Initial sources must be an array');
  const clock=collaborator(options,'clock',Date.now);if(typeof clock!=='function')throw Error('Trusted clock must be a function');
  const sources=new Map(),snapshots=new Map(); for(const s of initial) registerSource(s);
  function registerSource(input){const s=normaliseSource(input);if(sources.has(s.id)) throw new Error('Source already registered: '+s.id);sources.set(s.id,s);snapshots.set(s.id,[]);return s;}
  function recordSnapshot(input={}){
    input=inputCopy(input);
    const source=sources.get(text(input.sourceId,160)); if(!source) throw new Error('Unknown source.');
    const observedAt=iso(input.observedAt,'observedAt'),contentDigest=text(input.contentDigest,128).toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(contentDigest)) throw new Error('Snapshot requires sha256 contentDigest.');
    const admissionTime=clock();if(typeof admissionTime!=='number'||!Number.isFinite(admissionTime)||!Number.isFinite(new Date(admissionTime).getTime()))throw Error('Trusted clock must return finite epoch milliseconds');
    const ingestedAt=new Date(admissionTime).toISOString();
    const core={contractVersion:'VECTOR_POLICY_SOURCE_SNAPSHOT_V1',sourceId:source.id,sourceDigest:source.sourceDigest,observedAt,ingestedAt,revision:text(input.revision,200)||null,contentDigest,retrievalMethod:text(input.retrievalMethod,80)||source.channel,canonicalReference:text(input.canonicalReference,500)||source.canonicalReference,verifiedRetrieval:input.verifiedRetrieval===true,customerMutation:false,executionAuthority:false};
    if(!core.verifiedRetrieval) throw new Error('Snapshot must be verified retrieval evidence.');
    const receipt=immutable({...core,snapshotDigest:digest(core)}); snapshots.get(source.id).push(receipt); return receipt;
  }
  function latest(sourceId){sourceId=inputCopy(sourceId);const arr=snapshots.get(text(sourceId,160))||[];return arr.length?arr[arr.length-1]:null;}
  function assess(sourceId,options={}){
    sourceId=inputCopy(sourceId);options=inputCopy(options);const at=options.at===undefined?new Date().toISOString():options.at;
    const source=sources.get(text(sourceId,160)); if(!source) throw new Error('Unknown source.');
    const snap=latest(source.id),atIso=iso(at,'at');
    if(!source.active) return Object.freeze({sourceId:source.id,state:'DISABLED',usable:false,requiresAttention:true});
    if(!snap) return Object.freeze({sourceId:source.id,state:'NO_EVIDENCE',usable:false,requiresAttention:true});
    if(Date.parse(snap.observedAt)>Date.parse(atIso)||Date.parse(snap.ingestedAt)>Date.parse(atIso))return immutable({sourceId:source.id,state:'FUTURE',usable:false,requiresAttention:true,snapshotDigest:snap.snapshotDigest});
    const ageHours=(Date.parse(atIso)-Date.parse(snap.observedAt))/3600000,stale=ageHours>source.freshnessHours;
    return Object.freeze({sourceId:source.id,state:stale?'STALE':'CURRENT',usable:!stale,requiresAttention:stale,ageHours:Number(ageHours.toFixed(3)),freshnessHours:source.freshnessHours,snapshotDigest:snap.snapshotDigest});
  }
  function all(){return immutable([...sources.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  return Object.freeze({registerSource,recordSnapshot,latest,assess,all});
}
module.exports=Object.freeze({AUTHORITY_TIERS,CHANNELS,normaliseSource,createAuthoritativePolicySourceRegistry,digest,stable});
