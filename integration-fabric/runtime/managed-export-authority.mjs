import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;

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
    const copy=[];
    for(let index=0;index<value.length;index++){
      const descriptor=descriptors[index];
      if(!descriptor||!descriptor.enumerable||!('value' in descriptor)) fail(`${path} contains executable data`);
      copy.push(cloneInert(descriptor.value,`${path}[${index}]`,seen));
    }
    return copy;
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
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
}

function text(value,name){
  if(typeof value!=='string'||!value.normalize('NFC').trim()||value.includes('\0')) fail(`${name} is required`);
  return value.normalize('NFC').trim();
}

function integer(value,name){
  if(!Number.isSafeInteger(value)||value<0) fail(`${name} must be a non-negative safe integer`);
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

export function createManagedExportAuthority(input){
  const policy=cloneInert(input,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','accountId','environmentId','regionalHost',
    'credentialRevision','credentialScope','exports'
  ]),'policy');
  for(const field of ['provider','wfmTenantId','connectionId','accountId','environmentId','credentialRevision']) policy[field]=text(policy[field],field);
  policy.regionalHost=text(policy.regionalHost,'regionalHost').toLowerCase();
  if(policy.regionalHost.includes('*')||policy.regionalHost.includes('/')||policy.regionalHost.includes(':')) fail('regionalHost must be an exact HTTPS host without wildcard, scheme, path or port');
  try{new URL(`https://${policy.regionalHost}`);}catch{fail('regionalHost is invalid');}
  if(!Array.isArray(policy.exports)||policy.exports.length===0) fail('exports must contain at least one approved export');

  if(!policy.credentialScope||typeof policy.credentialScope!=='object') fail('credentialScope is required');
  exactKeys(policy.credentialScope,new Set(['mode','exports','imports','flows','connections','apis','topics']),'credentialScope');
  if(policy.credentialScope.mode!=='custom') fail('credential must use a custom export scope');
  for(const kind of ['exports','imports','flows','connections','apis','topics']){
    if(!Array.isArray(policy.credentialScope[kind])) fail(`credential scope ${kind} must be an array`);
  }
  for(const kind of ['imports','flows','connections','apis','topics']){
    if(policy.credentialScope[kind].length!==0) fail(`credential scope includes forbidden ${kind} authority`);
  }

  const approved=new Map();
  for(const entry of policy.exports){
    exactKeys(entry,new Set(['integrationId','exportId','dataset','sinkId','exportRevision','schemaFingerprint']),'export');
    for(const field of ['integrationId','exportId','dataset','sinkId','exportRevision','schemaFingerprint']) entry[field]=text(entry[field],field);
    if(entry.exportId.includes('*')) fail('exportId wildcard is forbidden');
    if(approved.has(entry.exportId)) fail('duplicate exportId in authority');
    approved.set(entry.exportId,entry);
  }
  const scopedExports=policy.credentialScope.exports.map((id,index)=>text(id,`credentialScope.exports[${index}]`));
  if(scopedExports.some(id=>id.includes('*'))||new Set(scopedExports).size!==scopedExports.length) fail('credential scope contains wildcard or duplicate exports');
  const approvedIds=[...approved.keys()].sort();
  if(canonical([...scopedExports].sort())!==canonical(approvedIds)) fail('credential scope must equal the exact approved export set');
  deepFreeze(policy);
  const issuedPlans=new WeakSet();

  function authorize(rawRequest){
    const request=cloneInert(rawRequest,'request');
    exactKeys(request,new Set([
      'provider','wfmTenantId','connectionId','accountId','environmentId','regionalHost',
      'resourceKind','action','integrationId','exportId','dataset','sinkId','exportRevision','schemaFingerprint'
    ]),'request');
    if(request.resourceKind!=='export'||request.action!=='invoke-read-ingress') fail('only read-ingress export invocation is authorised');
    for(const field of ['provider','wfmTenantId','connectionId','accountId','environmentId','regionalHost']) same(request[field],policy[field],field);
    const entry=approved.get(request.exportId);
    if(!entry) fail('exportId does not match approved authority');
    for(const field of ['integrationId','exportId','dataset','sinkId','exportRevision','schemaFingerprint']) same(request[field],entry[field],field);
    const identity={
      provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
      accountId:policy.accountId,environmentId:policy.environmentId,regionalHost:policy.regionalHost,
      credentialRevision:policy.credentialRevision,integrationId:entry.integrationId,exportId:entry.exportId,
      dataset:entry.dataset,sinkId:entry.sinkId,exportRevision:entry.exportRevision,
      schemaFingerprint:entry.schemaFingerprint
    };
    const plan={
      authority:'read-ingress-only',
      ...identity,
      checkpointNamespace:`managed-export:${digest(identity)}`,
      planFingerprint:`sha256:${digest({authority:'read-ingress-only',...identity})}`
    };
    deepFreeze(plan);
    issuedPlans.add(plan);
    return plan;
  }

  function admitReceipt(plan,rawReceipt){
    if(!issuedPlans.has(plan)) fail('plan was not issued by this authority');
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      'planFingerprint','providerRunId','status','startedAt','completedAt','sourceWindow',
      'exportRevision','schemaFingerprint','errorCount','pages','pageCount','recordCount','byteCount'
    ]),'receipt');
    same(receipt.planFingerprint,plan.planFingerprint,'planFingerprint');
    same(receipt.exportRevision,plan.exportRevision,'exportRevision');
    same(receipt.schemaFingerprint,plan.schemaFingerprint,'schemaFingerprint');
    if(receipt.status!=='completed') fail('receipt status is not completed');
    if(integer(receipt.errorCount,'errorCount')!==0) fail('receipt contains export errors');
    const started=instant(receipt.startedAt,'startedAt');
    const completed=instant(receipt.completedAt,'completedAt');
    if(completed<started) fail('completedAt is before startedAt');
    if(!receipt.sourceWindow||typeof receipt.sourceWindow!=='object') fail('sourceWindow is required');
    exactKeys(receipt.sourceWindow,new Set(['from','to']),'sourceWindow');
    const windowFrom=instant(receipt.sourceWindow.from,'sourceWindow.from');
    const windowTo=instant(receipt.sourceWindow.to,'sourceWindow.to');
    if(windowTo<windowFrom) fail('sourceWindow.to is before sourceWindow.from');
    text(receipt.providerRunId,'providerRunId');
    if(!Array.isArray(receipt.pages)) fail('pages must be an array');
    const expectedPageCount=integer(receipt.pageCount,'pageCount');
    if(receipt.pages.length!==expectedPageCount) fail('pageCount does not match pages');
    let records=0,bytes=0;
    const digests=new Set();
    for(let index=0;index<receipt.pages.length;index++){
      const page=receipt.pages[index];
      exactKeys(page,new Set(['sequence','recordCount','byteCount','digest']),`pages[${index}]`);
      if(page.sequence!==index+1) fail(`pages[${index}].sequence is duplicate, missing or out of order`);
      records+=integer(page.recordCount,`pages[${index}].recordCount`);
      bytes+=integer(page.byteCount,`pages[${index}].byteCount`);
      const pageDigest=text(page.digest,`pages[${index}].digest`);
      if(digests.has(pageDigest)) fail('page digest is duplicated');
      digests.add(pageDigest);
    }
    if(records!==integer(receipt.recordCount,'recordCount')) fail('recordCount does not match pages');
    if(bytes!==integer(receipt.byteCount,'byteCount')) fail('byteCount does not match pages');
    return deepFreeze({
      reconciliationCandidate:true,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      provider:plan.provider,
      providerRunId:receipt.providerRunId,
      checkpointNamespace:plan.checkpointNamespace,
      planFingerprint:plan.planFingerprint,
      dataset:plan.dataset,
      exportId:plan.exportId,
      exportRevision:plan.exportRevision,
      schemaFingerprint:plan.schemaFingerprint,
      startedAt:receipt.startedAt,
      completedAt:receipt.completedAt,
      sourceWindow:receipt.sourceWindow,
      pageCount:expectedPageCount,
      recordCount:records,
      byteCount:bytes
    });
  }

  return Object.freeze({authorize,admitReceipt});
}
