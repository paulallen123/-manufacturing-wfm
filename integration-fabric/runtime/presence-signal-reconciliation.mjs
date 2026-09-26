import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const CALLBACK_STATUSES=new Set(['ACTIVE','SUSPENDED','EXPIRED']);
const CHANNELS=new Set(['callback','history']);

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if(!value||typeof value!=='object') fail(`${path} contains unsupported data`);
  if(seen.has(value)) fail(`${path} contains a cycle or shared executable shape`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Object.keys(value).length!==value.length) fail(`${path} contains holes or hidden values`);
    return value.map((_,index)=>{
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path} contains executable or hidden data`);
      return cloneInert(descriptor.value,`${path}[${index}]`,seen);
    });
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const copy={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
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
  if(!value||typeof value!=='object'||Array.isArray(value)) fail(`${path} must be an object`);
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
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a real UTC ISO-8601 instant`);
  const parsed=Date.parse(normalized);
  const canonicalInstant=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonicalInstant) fail(`${name} must be a real UTC ISO-8601 instant`);
  return parsed;
}

function exactHttpsOrigin(value){
  const normalized=text(value,'apiOrigin');
  let url;
  try{url=new URL(normalized);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||normalized.includes('*')||url.origin!==normalized){
    fail('apiOrigin must be an exact HTTPS origin');
  }
  return url.origin.toLowerCase();
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value){return createHash('sha256').update(value).digest('hex');}
function digest(value){return sha256(canonical(value));}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createPresenceSignalAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','organizationId','apiOrigin','applicationRevision',
    'filterId','callbackRegistrationId','eventSource','schemaFingerprint','approvedEventTypes',
    'approvedLocations','maxClockSkewSeconds','maxEvents'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','organizationId','applicationRevision','filterId',
    'callbackRegistrationId','eventSource','schemaFingerprint'
  ]) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  if(!Array.isArray(policy.approvedEventTypes)||policy.approvedEventTypes.length===0) fail('approvedEventTypes must not be empty');
  policy.approvedEventTypes=policy.approvedEventTypes.map((value,index)=>text(value,`approvedEventTypes[${index}]`)).sort();
  if(new Set(policy.approvedEventTypes).size!==policy.approvedEventTypes.length) fail('approvedEventTypes must be unique');
  if(!Array.isArray(policy.approvedLocations)||policy.approvedLocations.length===0) fail('approvedLocations must not be empty');
  const locationMap=new Map();
  policy.approvedLocations=policy.approvedLocations.map((location,index)=>{
    exactKeys(location,new Set(['siteId','zoneIds']),`approvedLocations[${index}]`);
    const siteId=text(location.siteId,`approvedLocations[${index}].siteId`);
    if(locationMap.has(siteId)) fail('approved site IDs must be unique');
    if(!Array.isArray(location.zoneIds)||location.zoneIds.length===0) fail(`approvedLocations[${index}].zoneIds must not be empty`);
    const zoneIds=location.zoneIds.map((zone,zoneIndex)=>text(zone,`approvedLocations[${index}].zoneIds[${zoneIndex}]`)).sort();
    if(new Set(zoneIds).size!==zoneIds.length) fail(`approvedLocations[${index}].zoneIds must be unique`);
    locationMap.set(siteId,new Set(zoneIds));
    return {siteId,zoneIds};
  }).sort((left,right)=>left.siteId.localeCompare(right.siteId));
  policy.maxClockSkewSeconds=integer(policy.maxClockSkewSeconds,'maxClockSkewSeconds');
  policy.maxEvents=integer(policy.maxEvents,'maxEvents',{minimum:1});
  deepFreeze(policy);
  const allowedTypes=new Set(policy.approvedEventTypes);
  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    organizationId:policy.organizationId,apiOrigin:policy.apiOrigin,applicationRevision:policy.applicationRevision,
    filterId:policy.filterId,callbackRegistrationId:policy.callbackRegistrationId,eventSource:policy.eventSource,
    schemaFingerprint:policy.schemaFingerprint
  };
  const checkpointNamespace=`presence-signal:${digest(scope)}`;

  function admitReconciliation(rawRun){
    const run=cloneInert(rawRun,'run');
    exactKeys(run,new Set([
      'provider','wfmTenantId','connectionId','organizationId','apiOrigin','applicationRevision',
      'filterId','callbackRegistrationId','schemaFingerprint','callbackStatus','callbackValidUntil',
      'callbackAuthVerified','historyWindowStart','historyWindowEnd','observedAt','historyComplete','events'
    ]),'run');
    for(const field of [
      'provider','wfmTenantId','connectionId','organizationId','applicationRevision','filterId',
      'callbackRegistrationId','schemaFingerprint'
    ]) same(run[field],policy[field],field);
    same(exactHttpsOrigin(run.apiOrigin),policy.apiOrigin,'apiOrigin');
    const callbackStatus=text(run.callbackStatus,'callbackStatus');
    if(!CALLBACK_STATUSES.has(callbackStatus)) fail('callbackStatus is not supported');
    const callbackValidUntilMs=instant(run.callbackValidUntil,'callbackValidUntil');
    if(typeof run.callbackAuthVerified!=='boolean') fail('callbackAuthVerified must be boolean');
    const windowStartMs=instant(run.historyWindowStart,'historyWindowStart');
    const windowEndMs=instant(run.historyWindowEnd,'historyWindowEnd');
    const observedMs=instant(run.observedAt,'observedAt');
    if(windowEndMs<=windowStartMs) fail('history window end must be after its start');
    if(windowEndMs>observedMs) fail('history window ends after observation time');
    if(run.historyComplete!==true) fail('event history is incomplete');
    if(!Array.isArray(run.events)) fail('events must be an array');
    if(run.events.length>policy.maxEvents) fail('event result exceeds the event limit');

    const aggregates=new Map();
    let callbackEventCount=0;
    let exactReplayCount=0;
    const skewMs=policy.maxClockSkewSeconds*1000;
    for(let index=0;index<run.events.length;index++){
      const item=run.events[index];
      exactKeys(item,new Set([
        'id','source','type','subject','time','receivedAt','siteId','zoneId','readerId','payloadDigest','channel'
      ]),`events[${index}]`);
      const id=text(item.id,`events[${index}].id`);
      const source=text(item.source,`events[${index}].source`);
      same(source,policy.eventSource,`events[${index}].source`);
      const type=text(item.type,`events[${index}].type`);
      if(!allowedTypes.has(type)) fail(`events[${index}] event type is not approved`);
      const subject=text(item.subject,`events[${index}].subject`);
      const eventTime=text(item.time,`events[${index}].time`);
      const eventMs=instant(eventTime,`events[${index}].time`);
      if(eventMs<windowStartMs-skewMs||eventMs>windowEndMs+skewMs) fail(`events[${index}] is outside the approved history window`);
      const receivedAt=text(item.receivedAt,`events[${index}].receivedAt`);
      const receivedMs=instant(receivedAt,`events[${index}].receivedAt`);
      if(receivedMs<eventMs-skewMs) fail(`events[${index}] exceeds allowed clock skew`);
      if(receivedMs>observedMs) fail(`events[${index}] was received after observedAt`);
      const siteId=text(item.siteId,`events[${index}].siteId`);
      const zones=locationMap.get(siteId);
      if(!zones) fail(`events[${index}] site is not approved`);
      const zoneId=text(item.zoneId,`events[${index}].zoneId`);
      if(!zones.has(zoneId)) fail(`events[${index}] zone is not approved for its site`);
      const readerId=item.readerId===null?null:text(item.readerId,`events[${index}].readerId`);
      const payloadDigest=text(item.payloadDigest,`events[${index}].payloadDigest`);
      const channel=text(item.channel,`events[${index}].channel`);
      if(!CHANNELS.has(channel)) fail(`events[${index}].channel is not supported`);
      if(channel==='callback') callbackEventCount++;
      const evidence={id,source,type,subject,time:eventTime,siteId,zoneId,readerId,payloadDigest};
      const evidenceDigest=digest(evidence);
      const prior=aggregates.get(id);
      if(prior){
        if(prior.evidenceDigest!==evidenceDigest) fail('conflicting duplicate event is quarantined');
        exactReplayCount++;
        prior.channels.add(channel);
        if(receivedMs<prior.firstReceivedMs) prior.firstReceivedMs=receivedMs;
        if(receivedMs>prior.lastReceivedMs) prior.lastReceivedMs=receivedMs;
        continue;
      }
      aggregates.set(id,{...evidence,evidenceDigest,channels:new Set([channel]),eventMs,firstReceivedMs:receivedMs,lastReceivedMs:receivedMs});
    }
    if(callbackEventCount>0&&run.callbackAuthVerified!==true) fail('callback authentication was not verified');
    for(const aggregate of aggregates.values()){
      if(aggregate.channels.has('callback')&&!aggregate.channels.has('history')) fail('callback event is absent from complete history');
    }
    const signals=[...aggregates.values()].map(aggregate=>({
      eventId:aggregate.id,
      eventType:aggregate.type,
      subjectFingerprint:`sha256:${sha256(canonical([
        policy.provider,policy.wfmTenantId,policy.connectionId,policy.organizationId,aggregate.subject
      ]))}`,
      occurredAt:new Date(aggregate.eventMs).toISOString(),
      firstReceivedAt:new Date(aggregate.firstReceivedMs).toISOString(),
      lastReceivedAt:new Date(aggregate.lastReceivedMs).toISOString(),
      siteId:aggregate.siteId,
      zoneId:aggregate.zoneId,
      readerId:aggregate.readerId,
      payloadDigest:aggregate.payloadDigest,
      channels:[...aggregate.channels].sort()
    })).sort((left,right)=>left.occurredAt.localeCompare(right.occurredAt)||left.eventId.localeCompare(right.eventId));
    const missedCallbackCount=signals.filter(signal=>!signal.channels.includes('callback')).length;
    const callbackRepairRequired=callbackStatus!=='ACTIVE'||callbackValidUntilMs<=observedMs;
    return deepFreeze({
      presenceSignalCandidate:true,
      attendanceAuthority:false,
      payrollAuthority:false,
      accessDecisionAuthority:false,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      ...scope,
      checkpointNamespace,
      historyWindowStart:new Date(windowStartMs).toISOString(),
      historyWindowEnd:new Date(windowEndMs).toISOString(),
      observedAt:new Date(observedMs).toISOString(),
      callbackStatus,
      callbackRepairRequired,
      reportedEventCount:run.events.length,
      uniqueEventCount:signals.length,
      exactReplayCount,
      missedCallbackCount,
      signals,
      reconciliationFingerprint:`sha256:${digest({scope,historyWindowStart:run.historyWindowStart,historyWindowEnd:run.historyWindowEnd,signals})}`
    });
  }

  return Object.freeze({admitReconciliation});
}
