import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|private[_-]?key|client[_-]?secret|api[_-]?key)$/i;
const MODES=new Set(['cursor','offset']);

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
  const copy=Object.create(null);
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

function fingerprint(value,name){
  const normalized=text(value,name);
  if(!/^sha256:[a-f0-9]{64}$/.test(normalized)) fail(`${name} must be a canonical sha256 fingerprint`);
  return normalized;
}

function identifier(value,name){
  if(Number.isSafeInteger(value)&&value>=0) return String(value);
  return text(value,name);
}

function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be a safe integer from ${minimum} to ${maximum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a real UTC ISO-8601 instant`);
  const canonical=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  const parsed=Date.parse(normalized);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonical) fail(`${name} must be a real UTC ISO-8601 instant`);
  return {ms:parsed,iso:canonical};
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

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createMutablePollWindowAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','organizationId','siteId','apiOrigin','apiVersion','resource',
    'paginationMode','queryFingerprint','schemaFingerprint','expectedCommittedWatermark','overlapSeconds',
    'maxWindowSeconds','maxPages','maxRecords','maxClockSkewSeconds'
  ]),'policy');
  for(const field of ['provider','wfmTenantId','connectionId','siteId','apiVersion']) policy[field]=text(policy[field],field);
  policy.queryFingerprint=fingerprint(policy.queryFingerprint,'queryFingerprint');
  policy.schemaFingerprint=fingerprint(policy.schemaFingerprint,'schemaFingerprint');
  policy.expectedCommittedWatermark=instant(policy.expectedCommittedWatermark,'expectedCommittedWatermark').iso;
  policy.organizationId=identifier(policy.organizationId,'organizationId');
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  policy.resource=text(policy.resource,'resource');
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(policy.resource)) fail('resource must be one exact read-only collection name');
  policy.paginationMode=text(policy.paginationMode,'paginationMode');
  if(!MODES.has(policy.paginationMode)) fail('paginationMode must be cursor or offset');
  policy.overlapSeconds=integer(policy.overlapSeconds,'overlapSeconds');
  if(policy.paginationMode==='offset'&&policy.overlapSeconds===0) fail('offset pagination requires a positive overlap window');
  policy.maxWindowSeconds=integer(policy.maxWindowSeconds,'maxWindowSeconds',{minimum:1});
  policy.maxPages=integer(policy.maxPages,'maxPages',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  policy.maxClockSkewSeconds=integer(policy.maxClockSkewSeconds,'maxClockSkewSeconds');
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    organizationId:policy.organizationId,siteId:policy.siteId,apiOrigin:policy.apiOrigin,apiVersion:policy.apiVersion,
    resource:policy.resource,paginationMode:policy.paginationMode,queryFingerprint:policy.queryFingerprint,
    schemaFingerprint:policy.schemaFingerprint
  };
  const checkpointNamespace=`mutable-poll:${digest(scope)}`;

  function admitBatch(rawBatch){
    const batch=cloneInert(rawBatch,'batch');
    exactKeys(batch,new Set([
      'provider','wfmTenantId','connectionId','organizationId','siteId','apiOrigin','apiVersion','resource',
      'paginationMode','queryFingerprint','schemaFingerprint','checkpointPredecessor','windowStartInclusive',
      'observedAt','complete','paginationComplete','pages'
    ]),'batch');
    for(const field of ['provider','wfmTenantId','connectionId','siteId','apiVersion','resource','paginationMode']){
      same(text(batch[field],field),policy[field],field);
    }
    same(fingerprint(batch.queryFingerprint,'queryFingerprint'),policy.queryFingerprint,'queryFingerprint');
    same(fingerprint(batch.schemaFingerprint,'schemaFingerprint'),policy.schemaFingerprint,'schemaFingerprint');
    same(identifier(batch.organizationId,'organizationId'),policy.organizationId,'organizationId');
    same(exactHttpsOrigin(batch.apiOrigin),policy.apiOrigin,'apiOrigin');
    if(batch.complete!==true) fail('poll window is incomplete');
    if(batch.paginationComplete!==true) fail('poll window pagination is incomplete');
    if(!Array.isArray(batch.pages)) fail('pages must be an array');
    if(batch.pages.length===0||batch.pages.length>policy.maxPages) fail('poll window exceeds the page limit');

    const windowStart=instant(batch.windowStartInclusive,'windowStartInclusive');
    const observedAt=instant(batch.observedAt,'observedAt');
    const checkpointPredecessor=instant(batch.checkpointPredecessor,'checkpointPredecessor');
    if(checkpointPredecessor.iso!==policy.expectedCommittedWatermark) fail('checkpoint predecessor does not match approved authority');
    const expectedWindowStart=new Date(checkpointPredecessor.ms-policy.overlapSeconds*1000).toISOString();
    if(windowStart.iso!==expectedWindowStart) fail('window lower bound does not match the expected overlap window');
    if(observedAt.ms<windowStart.ms) fail('observation must not precede the window lower bound');
    if((observedAt.ms-windowStart.ms)/1000>policy.maxWindowSeconds) fail('poll window exceeds the approved window limit');

    let expectedCursor=null;
    let expectedOffset=0;
    const seenCursors=new Set();
    const seenOffsets=new Set();
    const byVersion=new Map();
    const records=[];
    let exactReplayCount=0;
    let reportedRecordCount=0;

    for(let pageIndex=0;pageIndex<batch.pages.length;pageIndex++){
      const page=batch.pages[pageIndex];
      const pagePath=`pages[${pageIndex}]`;
      if(policy.paginationMode==='cursor'){
        exactKeys(page,new Set(['pageIndex','requestCursor','nextCursor','lowerBoundApplied','queryFingerprint','records']),pagePath);
      }else{
        exactKeys(page,new Set(['pageIndex','requestOffset','nextOffset','lowerBoundApplied','queryFingerprint','records']),pagePath);
      }
      if(integer(page.pageIndex,`${pagePath}.pageIndex`)!==pageIndex) fail('pageIndex sequence is not gapless');
      const applied=instant(page.lowerBoundApplied,`${pagePath}.lowerBoundApplied`);
      if(applied.iso!==windowStart.iso) fail('window lower bound must be identical on every page');
      same(fingerprint(page.queryFingerprint,`${pagePath}.queryFingerprint`),policy.queryFingerprint,'queryFingerprint');
      if(!Array.isArray(page.records)) fail(`${pagePath}.records must be an array`);
      reportedRecordCount+=page.records.length;
      if(reportedRecordCount>policy.maxRecords) fail('poll window exceeds the record limit');

      if(policy.paginationMode==='cursor'){
        const requestCursor=page.requestCursor===null?null:text(page.requestCursor,`${pagePath}.requestCursor`);
        const nextCursor=page.nextCursor===null?null:text(page.nextCursor,`${pagePath}.nextCursor`);
        if(requestCursor!==expectedCursor) fail('cursor chain has a gap or cross-query token');
        if(requestCursor!==null&&seenCursors.has(requestCursor)) fail('cursor loop detected');
        if(requestCursor!==null) seenCursors.add(requestCursor);
        if(nextCursor!==null&&(nextCursor===requestCursor||seenCursors.has(nextCursor))) fail('cursor loop detected');
        expectedCursor=nextCursor;
      }else{
        const requestOffset=integer(page.requestOffset,`${pagePath}.requestOffset`);
        const nextOffset=page.nextOffset===null?null:integer(page.nextOffset,`${pagePath}.nextOffset`);
        if(requestOffset!==expectedOffset) fail('offset chain has a gap');
        if(seenOffsets.has(requestOffset)) fail('offset loop detected');
        seenOffsets.add(requestOffset);
        if(nextOffset!==null&&(nextOffset<=requestOffset||seenOffsets.has(nextOffset))) fail('offset loop detected');
        expectedOffset=nextOffset;
      }

      for(let recordIndex=0;recordIndex<page.records.length;recordIndex++){
        const item=page.records[recordIndex];
        const recordPath=`${pagePath}.records[${recordIndex}]`;
        exactKeys(item,new Set(['id','organizationId','updatedAt','payloadDigest']),recordPath);
        const id=identifier(item.id,`${recordPath}.id`);
        const organizationId=identifier(item.organizationId,`${recordPath}.organizationId`);
        if(organizationId!==policy.organizationId) fail(`${recordPath} belongs to an unapproved organization`);
        const updatedAt=instant(item.updatedAt,`${recordPath}.updatedAt`);
        if(updatedAt.ms<windowStart.ms) fail(`${recordPath}.updatedAt is before the applied lower bound`);
        if(updatedAt.ms>observedAt.ms+policy.maxClockSkewSeconds*1000) fail(`${recordPath}.updatedAt exceeds the observation clock-skew limit`);
        const payloadDigest=fingerprint(item.payloadDigest,`${recordPath}.payloadDigest`);
        const versionKey=`${organizationId}\0${id}\0${updatedAt.iso}`;
        const existing=byVersion.get(versionKey);
        if(existing){
          if(existing.payloadDigest!==payloadDigest) fail(`${recordPath} is a conflicting duplicate source version`);
          exactReplayCount++;
          continue;
        }
        const normalized={
          id,organizationId,updatedAt:updatedAt.iso,payloadDigest,
          scopedRecordFingerprint:`sha256:${digest({scope,organizationId,id})}`
        };
        byVersion.set(versionKey,normalized);
        records.push(normalized);
      }
    }

    if(policy.paginationMode==='cursor'&&expectedCursor!==null) fail('cursor chain is missing its terminal cursor');
    if(policy.paginationMode==='offset'&&expectedOffset!==null) fail('offset chain is missing its terminal offset');

    records.sort((left,right)=>left.updatedAt.localeCompare(right.updatedAt)||left.id.localeCompare(right.id));
    const maxSourceUpdatedAt=records.length?records.reduce((latest,item)=>item.updatedAt>latest?item.updatedAt:latest,records[0].updatedAt):null;
    const watermarkCandidate=maxSourceUpdatedAt
      ?new Date(Math.max(checkpointPredecessor.ms,Math.min(Date.parse(maxSourceUpdatedAt),observedAt.ms))).toISOString()
      :null;
    const nextPollMs=watermarkCandidate
      ?Math.max(windowStart.ms,Date.parse(watermarkCandidate)-policy.overlapSeconds*1000)
      :windowStart.ms;
    const nextPollFromInclusive=new Date(nextPollMs).toISOString();

    return deepFreeze({
      pollWindowReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,
      writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,
      ...scope,checkpointNamespace,checkpointPredecessor:checkpointPredecessor.iso,
      windowStartInclusive:windowStart.iso,observedAt:observedAt.iso,
      overlapSeconds:policy.overlapSeconds,reportedRecordCount,uniqueVersionCount:records.length,
      exactReplayCount,maxSourceUpdatedAt,watermarkCandidate,nextPollFromInclusive,records,
      reconciliationFingerprint:`sha256:${digest({scope,windowStartInclusive:windowStart.iso,observedAt:observedAt.iso,records})}`
    });
  }

  return Object.freeze({admitBatch});
}
