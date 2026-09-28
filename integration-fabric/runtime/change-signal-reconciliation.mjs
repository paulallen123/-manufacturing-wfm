import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const NON_SECRET_VERSION_KEYS=new Set(['syncToken']);
const DAY_MS=24*60*60*1000;

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if(!value||typeof value!=='object') fail(`${path} contains unsupported data`);
  if(seen.has(value)) fail(`${path} contains a cycle`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Object.keys(value).length!==value.length) fail(`${path} contains holes or hidden values`);
    return value.map((_,index)=>{
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path} contains executable data`);
      return cloneInert(descriptor.value,`${path}[${index}]`,seen);
    });
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const copy={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)&&!NON_SECRET_VERSION_KEYS.has(key)) fail(`${path}.${key} contains secret or credential material`);
    const descriptor=descriptors[key];
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    copy[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  return copy;
}

function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value,allowed,path){
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
}

function text(value,name){
  if(typeof value!=='string'||!value.normalize('NFC').trim()||value.includes('\0')) fail(`${name} is required`);
  return value.normalize('NFC').trim();
}

function integer(value,name,{minimum=0}={}){
  if(!Number.isSafeInteger(value)||value<minimum) fail(`${name} must be a safe integer of at least ${minimum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a UTC ISO-8601 instant`);
  const parsed=Date.parse(normalized);
  const canonicalInstant=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonicalInstant) fail(`${name} must be a real UTC ISO-8601 instant`);
  return parsed;
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createChangeSignalReconciliation(input){
  const policy=cloneInert(input,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','realmId','apiHost','apiMinorVersion',
    'schemaFingerprint','signatureKeyRevision','entityKinds','maxLookbackDays','maximumObjects','overlapSeconds'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','realmId','apiHost','apiMinorVersion',
    'schemaFingerprint','signatureKeyRevision'
  ]) policy[field]=text(policy[field],field);
  policy.apiHost=policy.apiHost.toLowerCase();
  if(policy.apiHost.includes('*')||policy.apiHost.includes('/')||policy.apiHost.includes(':')) fail('apiHost must be an exact HTTPS host');
  try{new URL(`https://${policy.apiHost}`);}catch{fail('apiHost is invalid');}
  if(!Array.isArray(policy.entityKinds)||policy.entityKinds.length===0) fail('entityKinds must contain at least one entity');
  policy.entityKinds=policy.entityKinds.map((kind,index)=>text(kind,`entityKinds[${index}]`)).sort();
  if(new Set(policy.entityKinds).size!==policy.entityKinds.length) fail('entityKinds must be unique');
  policy.maxLookbackDays=integer(policy.maxLookbackDays,'maxLookbackDays',{minimum:1});
  policy.maximumObjects=integer(policy.maximumObjects,'maximumObjects',{minimum:1});
  policy.overlapSeconds=integer(policy.overlapSeconds,'overlapSeconds');
  deepFreeze(policy);
  const issuedPlans=new WeakSet();
  const allowedKinds=new Set(policy.entityKinds);

  function planRecovery(rawInput){
    const request=cloneInert(rawInput,'recovery');
    exactKeys(request,new Set(['webhook','committedThrough','observedThrough']),'recovery');
    const committedMs=instant(request.committedThrough,'committedThrough');
    const observedMs=instant(request.observedThrough,'observedThrough');
    if(committedMs>observedMs) fail('committedThrough is after observedThrough');
    const hook=request.webhook;
    if(!hook||typeof hook!=='object'||Array.isArray(hook)) fail('webhook is required');
    exactKeys(hook,new Set([
      'provider','wfmTenantId','connectionId','realmId','signatureVerified','signatureKeyRevision',
      'deliveryId','observedAt','changes'
    ]),'webhook');
    for(const field of ['provider','wfmTenantId','connectionId','realmId','signatureKeyRevision']) same(hook[field],policy[field],field);
    if(hook.signatureVerified!==true) fail('webhook signature must be verified before planning recovery');
    text(hook.deliveryId,'deliveryId');
    const hookObservedMs=instant(hook.observedAt,'webhook.observedAt');
    if(hookObservedMs>observedMs) fail('webhook was observed after the recovery boundary');
    if(!Array.isArray(hook.changes)) fail('webhook changes must be an array');
    const uniqueHints=new Map();
    for(let index=0;index<hook.changes.length;index++){
      const change=hook.changes[index];
      exactKeys(change,new Set(['entityKind','entityId','operation','lastUpdated']),`changes[${index}]`);
      const entityKind=text(change.entityKind,`changes[${index}].entityKind`);
      if(!allowedKinds.has(entityKind)) fail(`changes[${index}].entityKind is not approved`);
      const hint={
        entityKind,
        entityId:text(change.entityId,`changes[${index}].entityId`),
        operation:text(change.operation,`changes[${index}].operation`),
        lastUpdated:text(change.lastUpdated,`changes[${index}].lastUpdated`)
      };
      instant(hint.lastUpdated,`changes[${index}].lastUpdated`);
      uniqueHints.set(canonical(hint),hint);
    }
    const hints=[...uniqueHints.values()].sort((left,right)=>canonical(left).localeCompare(canonical(right)));
    const overlapStart=committedMs-policy.overlapSeconds*1000;
    const horizonStart=observedMs-policy.maxLookbackDays*DAY_MS;
    const fullSnapshotRequired=overlapStart<horizonStart;
    const changedSinceMs=Math.max(overlapStart,horizonStart);
    const sourceScope={
      provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
      realmId:policy.realmId,apiHost:policy.apiHost,apiMinorVersion:policy.apiMinorVersion,
      schemaFingerprint:policy.schemaFingerprint
    };
    const plan=deepFreeze({
      authority:'change-recovery-read-only',
      ...sourceScope,
      changedSince:new Date(changedSinceMs).toISOString(),
      observedThrough:new Date(observedMs).toISOString(),
      fullSnapshotRequired,
      webhookRecordAuthority:false,
      deletionAuthority:false,
      hints,
      checkpointNamespace:`change-recovery:${digest(sourceScope)}`,
      planFingerprint:`sha256:${digest({authority:'change-recovery-read-only',...sourceScope,changedSince:new Date(changedSinceMs).toISOString(),observedThrough:new Date(observedMs).toISOString(),fullSnapshotRequired,hints})}`
    });
    issuedPlans.add(plan);
    return plan;
  }

  function admitCdc(plan,rawResult){
    if(!issuedPlans.has(plan)) fail('plan was not issued by this authority');
    const result=cloneInert(rawResult,'cdc');
    exactKeys(result,new Set([
      'planFingerprint','realmId','apiMinorVersion','schemaFingerprint','changedSince',
      'observedThrough','complete','queriedEntityKinds','records'
    ]),'cdc');
    same(result.planFingerprint,plan.planFingerprint,'planFingerprint');
    same(result.realmId,plan.realmId,'realmId');
    same(result.apiMinorVersion,plan.apiMinorVersion,'apiMinorVersion');
    same(result.schemaFingerprint,plan.schemaFingerprint,'schemaFingerprint');
    same(result.changedSince,plan.changedSince,'changedSince');
    same(result.observedThrough,plan.observedThrough,'observedThrough');
    if(result.complete!==true) fail('CDC result is incomplete');
    if(!Array.isArray(result.queriedEntityKinds)) fail('queriedEntityKinds must be an array');
    const queried=result.queriedEntityKinds.map((kind,index)=>text(kind,`queriedEntityKinds[${index}]`)).sort();
    if(canonical(queried)!==canonical(policy.entityKinds)) fail('CDC entity coverage does not match approved authority');
    if(!Array.isArray(result.records)) fail('records must be an array');
    if(result.records.length>policy.maximumObjects) fail('CDC result exceeds the provider maximum object count');
    const changedSinceMs=instant(result.changedSince,'changedSince');
    const observedThroughMs=instant(result.observedThrough,'observedThrough');
    const uniqueRecords=[];
    const versions=new Map();
    let exactReplayCount=0;
    for(let index=0;index<result.records.length;index++){
      const record=result.records[index];
      exactKeys(record,new Set(['entityKind','entityId','syncToken','lastUpdated','active','payloadDigest']),`records[${index}]`);
      const entityKind=text(record.entityKind,`records[${index}].entityKind`);
      if(!allowedKinds.has(entityKind)) fail(`records[${index}].entityKind is not approved`);
      const entityId=text(record.entityId,`records[${index}].entityId`);
      const syncToken=text(record.syncToken,`records[${index}].syncToken`);
      const lastUpdated=text(record.lastUpdated,`records[${index}].lastUpdated`);
      const updatedMs=instant(lastUpdated,`records[${index}].lastUpdated`);
      if(updatedMs<changedSinceMs||updatedMs>observedThroughMs) fail(`records[${index}].lastUpdated is outside the CDC window`);
      if(typeof record.active!=='boolean') fail(`records[${index}].active must be boolean`);
      const payloadDigest=text(record.payloadDigest,`records[${index}].payloadDigest`);
      const identity=canonical([entityKind,entityId,syncToken]);
      const evidence=canonical([lastUpdated,record.active,payloadDigest]);
      const prior=versions.get(identity);
      if(prior!==undefined){
        if(prior!==evidence) fail('conflicting duplicate entity version is quarantined');
        exactReplayCount++;
        continue;
      }
      versions.set(identity,evidence);
      uniqueRecords.push(canonical([entityKind,entityId,syncToken,lastUpdated,record.active,payloadDigest]));
    }
    return deepFreeze({
      reconciliationCandidate:!plan.fullSnapshotRequired,
      fullSnapshotRequired:plan.fullSnapshotRequired,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      provider:plan.provider,
      wfmTenantId:plan.wfmTenantId,
      realmId:plan.realmId,
      checkpointNamespace:plan.checkpointNamespace,
      planFingerprint:plan.planFingerprint,
      changedSince:plan.changedSince,
      observedThrough:plan.observedThrough,
      reportedRecordCount:result.records.length,
      uniqueRecordCount:uniqueRecords.length,
      exactReplayCount,
      recordVersions:uniqueRecords
    });
  }

  return Object.freeze({planRecovery,admitCdc});
}
