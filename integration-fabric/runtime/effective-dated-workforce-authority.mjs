import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const QUERY_MODES=new Set([
  'odata-effective-delta','compound-effective-delta','compound-period-delta','as-of-snapshot'
]);

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
  const normalized=value.normalize('NFC').trim();
  if(normalized.length>512) fail(`${name} exceeds the text length limit`);
  return normalized;
}

function integer(value,name,{minimum=0}={}){
  if(!Number.isSafeInteger(value)||value<minimum) fail(`${name} must be a safe integer of at least ${minimum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a real UTC ISO-8601 instant`);
  const parsed=Date.parse(normalized);
  const canonical=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonical) fail(`${name} must be a real UTC ISO-8601 instant`);
  return parsed;
}

function calendarDate(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) fail(`${name} must be a real calendar date`);
  const parsed=Date.parse(`${normalized}T00:00:00.000Z`);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==normalized) fail(`${name} must be a real calendar date`);
  return parsed;
}

function exactHttpsOrigin(value){
  const normalized=text(value,'apiOrigin');
  let url;
  try{url=new URL(normalized);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(
    url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    url.pathname!=='/'||normalized.includes('*')||url.origin!==normalized
  ) fail('apiOrigin must be an exact HTTPS origin');
  return url.origin.toLowerCase();
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createEffectiveDatedWorkforceAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','sourceInstanceId','companyId','consumerId','apiOrigin',
    'apiVersion','entity','queryMode','schemaFingerprint','queryFingerprint','maxWindowSeconds',
    'overlapSeconds','maxClockSkewSeconds','maxRecords'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','sourceInstanceId','companyId','consumerId','apiVersion',
    'entity','queryMode','schemaFingerprint','queryFingerprint'
  ]) policy[field]=text(policy[field],field);
  if(!QUERY_MODES.has(policy.queryMode)) fail('queryMode is not supported');
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  policy.maxWindowSeconds=integer(policy.maxWindowSeconds,'maxWindowSeconds',{minimum:1});
  policy.overlapSeconds=integer(policy.overlapSeconds,'overlapSeconds');
  policy.maxClockSkewSeconds=integer(policy.maxClockSkewSeconds,'maxClockSkewSeconds');
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    sourceInstanceId:policy.sourceInstanceId,companyId:policy.companyId,consumerId:policy.consumerId,
    apiOrigin:policy.apiOrigin,apiVersion:policy.apiVersion,entity:policy.entity,queryMode:policy.queryMode,
    schemaFingerprint:policy.schemaFingerprint,queryFingerprint:policy.queryFingerprint
  };
  const checkpointNamespace=`effective-workforce:${digest(scope)}`;

  function admitBatch(rawBatch){
    const batch=cloneInert(rawBatch,'batch');
    exactKeys(batch,new Set([
      'provider','wfmTenantId','connectionId','sourceInstanceId','companyId','consumerId','apiOrigin',
      'apiVersion','entity','queryMode','schemaFingerprint','queryFingerprint','windowStart','windowEnd',
      'observedAt','complete','records'
    ]),'batch');
    for(const field of [
      'provider','wfmTenantId','connectionId','sourceInstanceId','companyId','consumerId','apiVersion',
      'entity','queryMode','schemaFingerprint','queryFingerprint'
    ]) same(batch[field],policy[field],field);
    same(exactHttpsOrigin(batch.apiOrigin),policy.apiOrigin,'apiOrigin');

    const windowStartMs=instant(batch.windowStart,'windowStart');
    const windowEndMs=instant(batch.windowEnd,'windowEnd');
    const observedAtMs=instant(batch.observedAt,'observedAt');
    if(windowEndMs<=windowStartMs) fail('window end must be after window start');
    if((windowEndMs-windowStartMs)/1000>policy.maxWindowSeconds) fail('window exceeds the approved window limit');
    if(windowEndMs>observedAtMs+policy.maxClockSkewSeconds*1000) fail('window end exceeds observation clock-skew limit');
    if(batch.complete!==true) fail('effective-dated batch is incomplete');
    if(!Array.isArray(batch.records)) fail('records must be an array');
    if(batch.records.length>policy.maxRecords) fail('batch exceeds the record limit');

    const deltaMode=policy.queryMode!=='as-of-snapshot';
    const lowerDeltaMs=windowStartMs-policy.overlapSeconds*1000;
    const upperDeltaMs=windowEndMs+policy.maxClockSkewSeconds*1000;
    const byVersionedSlice=new Map();
    const identities=new Set();
    const records=[];
    let exactReplayCount=0;

    for(let index=0;index<batch.records.length;index++){
      const item=batch.records[index];
      exactKeys(item,new Set([
        'personId','employmentId','assignmentId','effectiveStartDate','effectiveEndDate',
        'sequenceNumber','lastModifiedAt','sourceVersion','payloadDigest'
      ]),`records[${index}]`);
      const personId=text(item.personId,`records[${index}].personId`);
      const employmentId=text(item.employmentId,`records[${index}].employmentId`);
      const assignmentId=text(item.assignmentId,`records[${index}].assignmentId`);
      const effectiveStartDate=text(item.effectiveStartDate,`records[${index}].effectiveStartDate`);
      const effectiveEndDate=text(item.effectiveEndDate,`records[${index}].effectiveEndDate`);
      const effectiveStartMs=calendarDate(effectiveStartDate,`records[${index}].effectiveStartDate`);
      const effectiveEndMs=calendarDate(effectiveEndDate,`records[${index}].effectiveEndDate`);
      if(effectiveEndMs<effectiveStartMs) fail(`records[${index}] effective end precedes effective start`);
      const sequenceNumber=integer(item.sequenceNumber,`records[${index}].sequenceNumber`);
      const lastModifiedAt=text(item.lastModifiedAt,`records[${index}].lastModifiedAt`);
      const lastModifiedMs=instant(lastModifiedAt,`records[${index}].lastModifiedAt`);
      if(lastModifiedMs>observedAtMs+policy.maxClockSkewSeconds*1000) fail(`records[${index}] was modified after observation beyond allowed clock skew`);
      if(deltaMode&&(lastModifiedMs<lowerDeltaMs||lastModifiedMs>upperDeltaMs)) fail(`records[${index}] is outside the approved delta window`);
      const sourceVersion=text(item.sourceVersion,`records[${index}].sourceVersion`);
      const payloadDigest=text(item.payloadDigest,`records[${index}].payloadDigest`);
      const normalized={
        personId,employmentId,assignmentId,effectiveStartDate,effectiveEndDate,sequenceNumber,
        lastModifiedAt:new Date(lastModifiedMs).toISOString(),sourceVersion,payloadDigest
      };
      const identityKey=canonical([personId,employmentId,assignmentId]);
      identities.add(identityKey);
      const versionedSliceKey=canonical([
        personId,employmentId,assignmentId,effectiveStartDate,sequenceNumber,sourceVersion
      ]);
      const existing=byVersionedSlice.get(versionedSliceKey);
      if(existing){
        if(canonical(existing)!==canonical(normalized)) fail(`records[${index}] is a conflicting duplicate composite identity`);
        exactReplayCount++;
        continue;
      }
      byVersionedSlice.set(versionedSliceKey,normalized);
      records.push(normalized);
    }

    records.sort((left,right)=>canonical([
      left.personId,left.employmentId,left.assignmentId,left.effectiveStartDate,left.sequenceNumber,left.sourceVersion
    ]).localeCompare(canonical([
      right.personId,right.employmentId,right.assignmentId,right.effectiveStartDate,right.sequenceNumber,right.sourceVersion
    ])));

    return deepFreeze({
      effectiveDatedReconciliationCandidate:true,
      deltaCandidate:deltaMode,
      snapshotCandidate:!deltaMode,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      writeBackAuthority:false,
      payrollAuthority:false,
      accessDecisionAuthority:false,
      ...scope,
      checkpointNamespace,
      windowStart:new Date(windowStartMs).toISOString(),
      windowEnd:new Date(windowEndMs).toISOString(),
      observedAt:new Date(observedAtMs).toISOString(),
      reportedRecordCount:batch.records.length,
      uniqueRecordCount:records.length,
      exactReplayCount,
      identityCount:identities.size,
      records,
      reconciliationFingerprint:`sha256:${digest({scope,windowStart:batch.windowStart,windowEnd:batch.windowEnd,records})}`
    });
  }

  return Object.freeze({admitBatch});
}
