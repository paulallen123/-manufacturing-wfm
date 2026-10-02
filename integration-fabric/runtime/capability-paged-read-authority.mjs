import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)/i;

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);
  seen.add(value);
  if(Array.isArray(value)){
    const copy=[];
    for(const key of Reflect.ownKeys(value)){
      if(key==='length') continue;
      if(typeof key!=='string') fail(`${path} contains symbol data`);
      if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
      if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=4294967295) fail(`${path}.${key} is not an array index`);
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
      copy[key]=cloneInert(descriptor.value,`${path}[${key}]`,seen);
    }
    seen.delete(value);
    return copy;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const copy=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    copy[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  seen.delete(value);
  return copy;
}

function exactKeys(value,allowed,path){
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
  for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);
}

function text(value,name){
  if(typeof value!=='string'||!value.trim()) fail(`${name} must be a non-empty string`);
  return value.trim().normalize('NFC');
}

function opaqueIdentity(value,name){
  if(typeof value!=='string'||value.length===0) fail(`${name} must be a non-empty opaque string`);
  return value;
}

function fingerprint(value,name){
  const normalized=text(value,name);
  if(!/^sha256:[a-f0-9]{64}$/.test(normalized)) fail(`${name} must be a canonical sha256 fingerprint`);
  return normalized;
}

function integer(value,name,{minimum=0}={}){
  if(!Number.isSafeInteger(value)||value<minimum) fail(`${name} must be an integer of at least ${minimum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a UTC instant`);
  const milliseconds=Date.parse(normalized);
  if(!Number.isFinite(milliseconds)) fail(`${name} must be a real UTC instant`);
  return new Date(milliseconds).toISOString();
}

function origin(value){
  const normalized=text(value,'apiOrigin');
  let parsed;
  try{parsed=new URL(normalized);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==normalized||normalized.includes('*')){
    fail('apiOrigin must be an exact HTTPS origin');
  }
  return parsed.origin.toLowerCase();
}

function opaqueCursor(value,name,maxBytes){
  if(value===null) return null;
  if(typeof value!=='string'||value.length===0) fail(`${name} must be a non-empty opaque string or null`);
  if(new TextEncoder().encode(value).byteLength>maxBytes) fail(`${name} exceeds the cursor byte limit`);
  return value;
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function compareOpaque(left,right){return left<right?-1:left>right?1:0;}
function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createCapabilityPagedReadAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const scopeFields=[
    'provider','wfmTenantId','connectionId','sourceTenantId','companyId','divisionId','facilityId',
    'apiVersion','program','transaction','operationClass'
  ];
  exactKeys(policy,new Set([
    ...scopeFields,'apiOrigin','paginationSupported','metadataFingerprint','queryFingerprint','schemaFingerprint',
    'expectedCheckpointPredecessor','expectedObservedAt','recordCap','maxPages','maxRecords','maxCursorBytes'
  ]),'policy');
  for(const field of scopeFields) policy[field]=text(policy[field],field);
  if(policy.operationClass!=='read-list') fail('only proven read-list operations are allowed; mutation semantics are denied');
  if(policy.paginationSupported!==true) fail('pagination support must be proven for the exact operation');
  policy.apiOrigin=origin(policy.apiOrigin);
  policy.metadataFingerprint=fingerprint(policy.metadataFingerprint,'metadataFingerprint');
  policy.queryFingerprint=fingerprint(policy.queryFingerprint,'queryFingerprint');
  policy.schemaFingerprint=fingerprint(policy.schemaFingerprint,'schemaFingerprint');
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');
  policy.expectedObservedAt=instant(policy.expectedObservedAt,'expectedObservedAt');
  policy.recordCap=integer(policy.recordCap,'recordCap',{minimum:1});
  policy.maxPages=integer(policy.maxPages,'maxPages',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  policy.maxCursorBytes=integer(policy.maxCursorBytes,'maxCursorBytes',{minimum:1});
  deepFreeze(policy);

  const scope={};
  for(const field of scopeFields) scope[field]=policy[field];
  Object.assign(scope,{
    apiOrigin:policy.apiOrigin,metadataFingerprint:policy.metadataFingerprint,queryFingerprint:policy.queryFingerprint,
    schemaFingerprint:policy.schemaFingerprint,recordCap:policy.recordCap
  });
  const checkpointNamespace=`capability-paged-read:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      ...scopeFields,'apiOrigin','metadataFingerprint','queryFingerprint','schemaFingerprint',
      'checkpointPredecessor','observedAt','complete','pages'
    ]),'receipt');
    for(const field of scopeFields) same(text(receipt[field],field),policy[field],field);
    same(origin(receipt.apiOrigin),policy.apiOrigin,'apiOrigin');
    same(fingerprint(receipt.metadataFingerprint,'metadataFingerprint'),policy.metadataFingerprint,'metadataFingerprint');
    same(fingerprint(receipt.queryFingerprint,'queryFingerprint'),policy.queryFingerprint,'queryFingerprint');
    same(fingerprint(receipt.schemaFingerprint,'schemaFingerprint'),policy.schemaFingerprint,'schemaFingerprint');
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor'),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    same(instant(receipt.observedAt,'observedAt'),policy.expectedObservedAt,'observation horizon');
    if(receipt.complete!==true) fail('paged read receipt is incomplete');
    if(!Array.isArray(receipt.pages)||receipt.pages.length===0||receipt.pages.length>policy.maxPages) fail('paged read receipt exceeds the page limit');

    let expectedCursor=null;
    const seenCursors=new Set();
    const byIdentity=new Map();
    const records=[];
    const pageReceipts=[];
    let reportedRecordCount=0;
    let exactReplayCount=0;

    for(let pageIndex=0;pageIndex<receipt.pages.length;pageIndex++){
      const rawPage=receipt.pages[pageIndex];
      const path=`pages[${pageIndex}]`;
      exactKeys(rawPage,new Set([
        'pageIndex','requestCursor','nextCursor','hasMore','successful','recordCap',
        'metadataFingerprint','queryFingerprint','schemaFingerprint','records'
      ]),path);
      if(integer(rawPage.pageIndex,`${path}.pageIndex`)!==pageIndex) fail('page index sequence is not gapless');
      if(rawPage.successful!==true) fail('provider page failed and cannot become reconciliation evidence');
      same(integer(rawPage.recordCap,`${path}.recordCap`,{minimum:1}),policy.recordCap,'record cap');
      same(fingerprint(rawPage.metadataFingerprint,`${path}.metadataFingerprint`),policy.metadataFingerprint,'metadataFingerprint');
      same(fingerprint(rawPage.queryFingerprint,`${path}.queryFingerprint`),policy.queryFingerprint,'queryFingerprint');
      same(fingerprint(rawPage.schemaFingerprint,`${path}.schemaFingerprint`),policy.schemaFingerprint,'schemaFingerprint');
      if(typeof rawPage.hasMore!=='boolean') fail(`${path}.hasMore must be a boolean`);
      if(!Array.isArray(rawPage.records)) fail(`${path}.records must be an array`);
      if(rawPage.records.length>policy.recordCap) fail(`${path} exceeds the approved record cap`);
      reportedRecordCount+=rawPage.records.length;
      if(reportedRecordCount>policy.maxRecords) fail('paged read receipt exceeds the record limit');

      const requestCursor=opaqueCursor(rawPage.requestCursor,`${path}.requestCursor`,policy.maxCursorBytes);
      const nextCursor=opaqueCursor(rawPage.nextCursor,`${path}.nextCursor`,policy.maxCursorBytes);
      if(requestCursor!==expectedCursor) fail('cursor chain has a gap or cross-query token');
      if(requestCursor!==null&&seenCursors.has(requestCursor)) fail('cursor loop detected');
      if(requestCursor!==null) seenCursors.add(requestCursor);
      if(rawPage.hasMore&&nextCursor===null) fail('next cursor is required while more rows exist');
      if(!rawPage.hasMore&&nextCursor!==null) fail('next cursor is forbidden on the terminal page');
      if(nextCursor!==null&&(nextCursor===requestCursor||seenCursors.has(nextCursor))) fail('cursor loop detected');
      if(!rawPage.hasMore&&pageIndex!==receipt.pages.length-1) fail('terminal page must be last');
      expectedCursor=nextCursor;

      for(let recordIndex=0;recordIndex<rawPage.records.length;recordIndex++){
        const rawRecord=rawPage.records[recordIndex];
        const recordPath=`${path}.records[${recordIndex}]`;
        exactKeys(rawRecord,new Set(['id','sourceVersion','payloadDigest']),recordPath);
        const id=opaqueIdentity(rawRecord.id,`${recordPath}.id`);
        const sourceVersion=opaqueIdentity(rawRecord.sourceVersion,`${recordPath}.sourceVersion`);
        const payloadDigest=fingerprint(rawRecord.payloadDigest,`${recordPath}.payloadDigest`);
        let byVersion=byIdentity.get(id);
        if(!byVersion){byVersion=new Map();byIdentity.set(id,byVersion);}
        const prior=byVersion.get(sourceVersion);
        if(prior){
          if(prior.payloadDigest!==payloadDigest) fail(`${recordPath} is a conflicting duplicate source version`);
          exactReplayCount++;
          continue;
        }
        const normalized={id,sourceVersion,payloadDigest,scopedRecordFingerprint:`sha256:${digest({scope,id})}`};
        byVersion.set(sourceVersion,normalized);
        records.push(normalized);
      }

      pageReceipts.push({
        pageIndex,recordCount:rawPage.records.length,hasMore:rawPage.hasMore,
        requestCursorFingerprint:requestCursor===null?null:`sha256:${digest(requestCursor)}`,
        nextCursorFingerprint:nextCursor===null?null:`sha256:${digest(nextCursor)}`
      });
    }

    if(expectedCursor!==null) fail('cursor chain is incomplete and missing its terminal page');
    records.sort((left,right)=>compareOpaque(left.id,right.id)||compareOpaque(left.sourceVersion,right.sourceVersion));
    const decision={
      pagedReadReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,
      writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,
      ...scope,checkpointNamespace,checkpointPredecessor:policy.expectedCheckpointPredecessor,
      observedAt:policy.expectedObservedAt,reportedRecordCount,uniqueVersionCount:records.length,
      exactReplayCount,pageReceipts,records
    };
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;
    return deepFreeze(decision);
  }

  return Object.freeze({admit});
}
