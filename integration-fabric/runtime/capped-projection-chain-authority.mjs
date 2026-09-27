import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)/i;

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);
  seen.add(value);
  if(Array.isArray(value)){
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const copy=[];
    for(const key of Object.keys(descriptors)){
      if(key==='length') continue;
      const descriptor=descriptors[key];
      if(!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
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

function opaque(value,name,maxBytes){
  if(value===null) return null;
  if(typeof value!=='string'||value.length===0) fail(`${name} must be a non-empty opaque string or null`);
  if(new TextEncoder().encode(value).byteLength>maxBytes) fail(`${name} exceeds the bookmark byte limit`);
  return value;
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createCappedProjectionChainAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const scopeFields=['provider','wfmTenantId','connectionId','sourceTenantId','configurationId','siteId','apiVersion','projectionId'];
  exactKeys(policy,new Set([
    ...scopeFields,'apiOrigin','queryFingerprint','schemaFingerprint','scopeFingerprint',
    'expectedCheckpointPredecessor','expectedObservedAt','effectiveRecordCap','maxPages','maxRecords','maxBookmarkBytes'
  ]),'policy');
  for(const field of scopeFields) policy[field]=text(policy[field],field);
  policy.apiOrigin=origin(policy.apiOrigin);
  policy.queryFingerprint=fingerprint(policy.queryFingerprint,'queryFingerprint');
  policy.schemaFingerprint=fingerprint(policy.schemaFingerprint,'schemaFingerprint');
  policy.scopeFingerprint=fingerprint(policy.scopeFingerprint,'scopeFingerprint');
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');
  policy.expectedObservedAt=instant(policy.expectedObservedAt,'expectedObservedAt');
  policy.effectiveRecordCap=integer(policy.effectiveRecordCap,'effectiveRecordCap',{minimum:1});
  policy.maxPages=integer(policy.maxPages,'maxPages',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  policy.maxBookmarkBytes=integer(policy.maxBookmarkBytes,'maxBookmarkBytes',{minimum:1});
  deepFreeze(policy);

  const scope={};
  for(const field of scopeFields) scope[field]=policy[field];
  Object.assign(scope,{
    apiOrigin:policy.apiOrigin,queryFingerprint:policy.queryFingerprint,schemaFingerprint:policy.schemaFingerprint,
    scopeFingerprint:policy.scopeFingerprint,effectiveRecordCap:policy.effectiveRecordCap
  });
  const checkpointNamespace=`capped-projection:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      ...scopeFields,'apiOrigin','queryFingerprint','schemaFingerprint','scopeFingerprint',
      'checkpointPredecessor','observedAt','complete','pages'
    ]),'receipt');
    for(const field of scopeFields) same(text(receipt[field],field),policy[field],field);
    same(origin(receipt.apiOrigin),policy.apiOrigin,'apiOrigin');
    same(fingerprint(receipt.queryFingerprint,'queryFingerprint'),policy.queryFingerprint,'queryFingerprint');
    same(fingerprint(receipt.schemaFingerprint,'schemaFingerprint'),policy.schemaFingerprint,'schemaFingerprint');
    same(fingerprint(receipt.scopeFingerprint,'scopeFingerprint'),policy.scopeFingerprint,'scopeFingerprint');
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor'),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    same(instant(receipt.observedAt,'observedAt'),policy.expectedObservedAt,'observation horizon');
    if(receipt.complete!==true) fail('projection receipt is incomplete');
    if(!Array.isArray(receipt.pages)||receipt.pages.length===0||receipt.pages.length>policy.maxPages) fail('projection receipt exceeds the page limit');

    let expectedBookmark=null;
    const seenBookmarks=new Set();
    const byVersion=new Map();
    const records=[];
    const pageReceipts=[];
    let reportedRecordCount=0;
    let exactReplayCount=0;

    for(let pageIndex=0;pageIndex<receipt.pages.length;pageIndex++){
      const rawPage=receipt.pages[pageIndex];
      const path=`pages[${pageIndex}]`;
      exactKeys(rawPage,new Set([
        'pageIndex','requestBookmark','nextBookmark','moreRowsExist','messageCode','effectiveRecordCap',
        'queryFingerprint','schemaFingerprint','scopeFingerprint','records'
      ]),path);
      if(integer(rawPage.pageIndex,`${path}.pageIndex`)!==pageIndex) fail('page index sequence is not gapless');
      if(integer(rawPage.messageCode,`${path}.messageCode`)!==0) fail('provider returned a messageCode error');
      same(integer(rawPage.effectiveRecordCap,`${path}.effectiveRecordCap`,{minimum:1}),policy.effectiveRecordCap,'record cap');
      same(fingerprint(rawPage.queryFingerprint,`${path}.queryFingerprint`),policy.queryFingerprint,'queryFingerprint');
      same(fingerprint(rawPage.schemaFingerprint,`${path}.schemaFingerprint`),policy.schemaFingerprint,'schemaFingerprint');
      same(fingerprint(rawPage.scopeFingerprint,`${path}.scopeFingerprint`),policy.scopeFingerprint,'scopeFingerprint');
      if(typeof rawPage.moreRowsExist!=='boolean') fail(`${path}.moreRowsExist must be a boolean`);
      if(!Array.isArray(rawPage.records)) fail(`${path}.records must be an array`);
      if(rawPage.records.length>policy.effectiveRecordCap) fail(`${path} exceeds the effective record cap`);
      reportedRecordCount+=rawPage.records.length;
      if(reportedRecordCount>policy.maxRecords) fail('projection receipt exceeds the record limit');

      const requestBookmark=opaque(rawPage.requestBookmark,`${path}.requestBookmark`,policy.maxBookmarkBytes);
      const nextBookmark=opaque(rawPage.nextBookmark,`${path}.nextBookmark`,policy.maxBookmarkBytes);
      if(requestBookmark!==expectedBookmark) fail('bookmark chain has a gap or cross-query token');
      if(requestBookmark!==null&&seenBookmarks.has(requestBookmark)) fail('bookmark loop detected');
      if(requestBookmark!==null) seenBookmarks.add(requestBookmark);
      if(rawPage.moreRowsExist&&nextBookmark===null) fail('next bookmark is required while more rows exist');
      if(!rawPage.moreRowsExist&&nextBookmark!==null) fail('next bookmark is forbidden on the terminal page');
      if(nextBookmark!==null&&(nextBookmark===requestBookmark||seenBookmarks.has(nextBookmark))) fail('bookmark loop detected');
      if(!rawPage.moreRowsExist&&pageIndex!==receipt.pages.length-1) fail('terminal page must be last');
      expectedBookmark=nextBookmark;

      for(let recordIndex=0;recordIndex<rawPage.records.length;recordIndex++){
        const rawRecord=rawPage.records[recordIndex];
        const recordPath=`${path}.records[${recordIndex}]`;
        exactKeys(rawRecord,new Set(['id','sourceVersion','payloadDigest']),recordPath);
        const id=text(rawRecord.id,`${recordPath}.id`);
        const sourceVersion=text(rawRecord.sourceVersion,`${recordPath}.sourceVersion`);
        const payloadDigest=fingerprint(rawRecord.payloadDigest,`${recordPath}.payloadDigest`);
        const versionKey=`${id}\0${sourceVersion}`;
        const prior=byVersion.get(versionKey);
        if(prior){
          if(prior.payloadDigest!==payloadDigest) fail(`${recordPath} is a conflicting duplicate source version`);
          exactReplayCount++;
          continue;
        }
        const normalized={
          id,sourceVersion,payloadDigest,
          scopedRecordFingerprint:`sha256:${digest({scope,id})}`
        };
        byVersion.set(versionKey,normalized);
        records.push(normalized);
      }

      pageReceipts.push({
        pageIndex,recordCount:rawPage.records.length,moreRowsExist:rawPage.moreRowsExist,
        requestBookmarkFingerprint:requestBookmark===null?null:`sha256:${digest(requestBookmark)}`,
        nextBookmarkFingerprint:nextBookmark===null?null:`sha256:${digest(nextBookmark)}`
      });
    }

    if(expectedBookmark!==null) fail('bookmark chain is incomplete and missing its terminal page');
    records.sort((left,right)=>left.id.localeCompare(right.id)||left.sourceVersion.localeCompare(right.sourceVersion));
    const decision={
      projectionReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,
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
