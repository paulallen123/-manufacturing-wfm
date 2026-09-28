import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const OPAQUE_CONTROL_KEYS=new Set(['requestedPageToken','nextPageToken']);

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
    if(SECRET_KEY.test(key)&&!OPAQUE_CONTROL_KEYS.has(key)) fail(`${path}.${key} contains secret or credential material`);
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
function fingerprint(value){return value===null?null:`sha256:${createHash('sha256').update(value).digest('hex')}`;}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createOpaquePageChainAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','providerAccountId','region','apiOrigin','apiVersion','resource',
    'queryFingerprint','schemaFingerprint','credentialRevision','maxPages','maxRecords','maxTokenLength'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','providerAccountId','region','apiVersion','resource',
    'queryFingerprint','schemaFingerprint','credentialRevision'
  ]) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  policy.maxPages=integer(policy.maxPages,'maxPages',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  policy.maxTokenLength=integer(policy.maxTokenLength,'maxTokenLength',{minimum:1});
  deepFreeze(policy);

  const sourceScope={
    provider:policy.provider,
    wfmTenantId:policy.wfmTenantId,
    connectionId:policy.connectionId,
    providerAccountId:policy.providerAccountId,
    region:policy.region,
    apiOrigin:policy.apiOrigin,
    apiVersion:policy.apiVersion,
    resource:policy.resource,
    queryFingerprint:policy.queryFingerprint,
    schemaFingerprint:policy.schemaFingerprint,
    credentialRevision:policy.credentialRevision
  };
  const checkpointNamespace=`opaque-page-chain:${digest(sourceScope)}`;

  function token(value,name){
    if(value===null) return null;
    if(typeof value!=='string'||value.length===0||/[\u0000-\u001f\u007f]/.test(value)) fail(`${name} must be an opaque non-control string`);
    if(value.trim()!==value) fail(`${name} contains surrounding whitespace`);
    if(value.length>policy.maxTokenLength) fail(`${name} exceeds the token length limit`);
    return value;
  }

  function admitChain(rawRun){
    const run=cloneInert(rawRun,'run');
    exactKeys(run,new Set([
      'provider','wfmTenantId','connectionId','providerAccountId','region','apiOrigin','apiVersion','resource',
      'queryFingerprint','schemaFingerprint','credentialRevision','startedAt','completedAt','complete','pages'
    ]),'run');
    for(const field of [
      'provider','wfmTenantId','connectionId','providerAccountId','region','apiVersion','resource',
      'queryFingerprint','schemaFingerprint','credentialRevision'
    ]) same(run[field],policy[field],field);
    same(exactHttpsOrigin(run.apiOrigin),policy.apiOrigin,'apiOrigin');
    const startedMs=instant(run.startedAt,'startedAt');
    const completedMs=instant(run.completedAt,'completedAt');
    if(completedMs<startedMs) fail('completedAt is before startedAt');
    if(run.complete!==true) fail('page chain is incomplete');
    if(!Array.isArray(run.pages)||run.pages.length===0) fail('pages must contain at least one page');
    if(run.pages.length>policy.maxPages) fail('page chain exceeds the page limit');

    const pageDigests=new Set();
    const seenTokens=new Set();
    const recordVersions=[];
    const versions=new Map();
    const pageReceipts=[];
    let expectedRequestToken=null;
    let reportedRecordCount=0;
    let exactReplayCount=0;

    for(let pageOffset=0;pageOffset<run.pages.length;pageOffset++){
      const page=run.pages[pageOffset];
      exactKeys(page,new Set(['index','requestedPageToken','nextPageToken','pageDigest','records']),`pages[${pageOffset}]`);
      const expectedIndex=pageOffset+1;
      if(integer(page.index,`pages[${pageOffset}].index`,{minimum:1})!==expectedIndex) fail('page index is not contiguous');
      const requested=token(page.requestedPageToken,`pages[${pageOffset}].requestedPageToken`);
      const next=token(page.nextPageToken,`pages[${pageOffset}].nextPageToken`);
      if(requested!==expectedRequestToken) fail('page token chain is broken');
      if(pageOffset>0&&requested===null) fail('page token chain is missing a continuation token');
      if(next!==null){
        if(seenTokens.has(next)) fail('page token loop or reused continuation token detected');
        seenTokens.add(next);
      }
      const pageDigest=text(page.pageDigest,`pages[${pageOffset}].pageDigest`);
      if(pageDigests.has(pageDigest)) fail('duplicate page digest detected');
      pageDigests.add(pageDigest);
      if(!Array.isArray(page.records)) fail(`pages[${pageOffset}].records must be an array`);
      reportedRecordCount+=page.records.length;
      if(reportedRecordCount>policy.maxRecords) fail('page chain exceeds the record limit');
      for(let recordOffset=0;recordOffset<page.records.length;recordOffset++){
        const item=page.records[recordOffset];
        exactKeys(item,new Set(['sourceId','sourceVersion','payloadDigest']),`pages[${pageOffset}].records[${recordOffset}]`);
        const sourceId=text(item.sourceId,`pages[${pageOffset}].records[${recordOffset}].sourceId`);
        const sourceVersion=text(item.sourceVersion,`pages[${pageOffset}].records[${recordOffset}].sourceVersion`);
        const payloadDigest=text(item.payloadDigest,`pages[${pageOffset}].records[${recordOffset}].payloadDigest`);
        const identity=canonical([sourceId,sourceVersion]);
        const prior=versions.get(identity);
        if(prior!==undefined){
          if(prior!==payloadDigest) fail('conflicting duplicate record version is quarantined');
          exactReplayCount++;
          continue;
        }
        versions.set(identity,payloadDigest);
        recordVersions.push(canonical([sourceId,sourceVersion,payloadDigest]));
      }
      pageReceipts.push({
        index:expectedIndex,
        requestedTokenFingerprint:fingerprint(requested),
        nextTokenFingerprint:fingerprint(next),
        pageDigest,
        recordCount:page.records.length
      });
      expectedRequestToken=next;
      if(next===null&&pageOffset!==run.pages.length-1) fail('page found after terminal response');
    }
    if(expectedRequestToken!==null) fail('complete page chain still has a continuation token and is not terminal');

    return deepFreeze({
      reconciliationCandidate:true,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      ...sourceScope,
      checkpointNamespace,
      startedAt:new Date(startedMs).toISOString(),
      completedAt:new Date(completedMs).toISOString(),
      pageCount:run.pages.length,
      reportedRecordCount,
      uniqueRecordCount:recordVersions.length,
      exactReplayCount,
      pageReceipts,
      recordVersions,
      chainFingerprint:`sha256:${digest({sourceScope,startedAt:run.startedAt,completedAt:run.completedAt,pageReceipts,recordVersions})}`
    });
  }

  return Object.freeze({admitChain});
}
