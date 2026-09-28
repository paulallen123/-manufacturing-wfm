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
    let indexCount=0;
    for(const key of Reflect.ownKeys(value)){
      if(key==='length') continue;
      if(typeof key!=='string') fail(`${path} contains symbol data`);
      if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
      if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=4294967295) fail(`${path}.${key} is not an array index`);
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
      copy[key]=cloneInert(descriptor.value,`${path}[${key}]`,seen);
      indexCount++;
    }
    if(indexCount!==value.length) fail(`${path} contains sparse array data`);
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
  if(typeof value!=='string'||!value) fail(`${name} must be a non-empty string`);
  if(value.trim()!==value) fail(`${name} must not contain surrounding whitespace`);
  return value;
}

function opaque(value,name){
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
  const canonical=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  if(new Date(milliseconds).toISOString()!==canonical) fail(`${name} must be a real UTC instant`);
  return new Date(milliseconds).toISOString();
}

function exactOrigin(value){
  const normalized=text(value,'apiOrigin');
  let parsed;
  try{parsed=new URL(normalized);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==normalized||normalized.includes('*')){
    fail('apiOrigin must be an exact HTTPS origin');
  }
  return parsed.origin.toLowerCase();
}

function exactRoute(value){
  const normalized=text(value,'route');
  if(
    !normalized.startsWith('/')||normalized.includes('*')||normalized.includes('?')||normalized.includes('#')||
    normalized.includes('\\')||normalized.includes('//')||/[\u0000-\u001f\u007f]/.test(normalized)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(normalized)||
    /%(?:25|2e|2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(normalized)
  ){
    fail('route must be an exact path without wildcard, traversal, query or fragment');
  }
  return normalized;
}

function language(value){
  const normalized=text(value,'languageTag');
  if(!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) fail('languageTag must be an explicit BCP 47-style language tag');
  return normalized;
}

function nullableText(value,name){return value===null?null:text(value,name);}
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

export function createExplicitExecutionContextAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const contextFields=['provider','wfmTenantId','connectionId','sourceTenantId','apiVersion','companyId'];
  const fingerprints=['serviceActivationFingerprint','routeAuthorizationFingerprint','metadataFingerprint','queryFingerprint','schemaFingerprint'];
  exactKeys(policy,new Set([
    ...contextFields,'apiOrigin','route','method','identityMode','identityTag','languageTag',...fingerprints,
    'expectedCheckpointPredecessor','expectedObservedAt','maxRecords'
  ]),'policy');
  for(const field of contextFields) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactOrigin(policy.apiOrigin);
  policy.route=exactRoute(policy.route);
  policy.method=text(policy.method,'method');
  if(policy.method!=='GET') fail('only exact GET read routes are allowed');
  policy.identityMode=text(policy.identityMode,'identityMode');
  if(policy.identityMode!=='service-account') fail('identity switching is forbidden; service-account mode is required');
  policy.identityTag=nullableText(policy.identityTag,'identityTag');
  if(policy.identityMode==='service-account'&&policy.identityTag!==null) fail('service-account identity must not switch identity');
  policy.languageTag=language(policy.languageTag);
  for(const field of fingerprints) policy[field]=fingerprint(policy[field],field);
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');
  policy.expectedObservedAt=instant(policy.expectedObservedAt,'expectedObservedAt');
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  deepFreeze(policy);

  const scope={};
  for(const field of contextFields) scope[field]=policy[field];
  Object.assign(scope,{
    apiOrigin:policy.apiOrigin,route:policy.route,method:policy.method,identityMode:policy.identityMode,
    identityTag:policy.identityTag,languageTag:policy.languageTag,...Object.fromEntries(fingerprints.map(field=>[field,policy[field]]))
  });
  const checkpointNamespace=`explicit-execution-context:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      ...contextFields,'apiOrigin','route','method','companyHeader','identityMode','identityTag','identityHeader',
      'languageTag','contentLanguageHeader','usedDefaultCompany','usedIdentitySwitch','usedDefaultLanguage',...fingerprints,
      'checkpointPredecessor','observedAt','successful','complete','records'
    ]),'receipt');
    for(const field of contextFields) same(text(receipt[field],field),policy[field],field);
    same(exactOrigin(receipt.apiOrigin),policy.apiOrigin,'apiOrigin');
    same(exactRoute(receipt.route),policy.route,'route');
    same(text(receipt.method,'method'),policy.method,'method');
    if(receipt.usedDefaultCompany!==false) fail('default company execution is forbidden');
    same(text(receipt.companyHeader,'companyHeader'),policy.companyId,'company header');
    same(text(receipt.identityMode,'identityMode'),policy.identityMode,'identity mode');
    const identityTag=nullableText(receipt.identityTag,'identityTag');
    const identityHeader=nullableText(receipt.identityHeader,'identityHeader');
    same(identityTag,policy.identityTag,'identity tag');
    if(receipt.usedIdentitySwitch!==false||identityHeader!==null) fail('identity switching is forbidden for the service-account route');
    same(language(receipt.languageTag),policy.languageTag,'language');
    if(receipt.usedDefaultLanguage!==false) fail('default language execution is forbidden');
    same(language(receipt.contentLanguageHeader),policy.languageTag,'content language header');
    for(const field of fingerprints) same(fingerprint(receipt[field],field),policy[field],field.replace('Fingerprint',' fingerprint'));
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor'),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    same(instant(receipt.observedAt,'observedAt'),policy.expectedObservedAt,'observation horizon');
    if(receipt.successful!==true) fail('provider request failed and cannot become reconciliation evidence');
    if(receipt.complete!==true) fail('execution-context receipt is incomplete');
    if(!Array.isArray(receipt.records)||receipt.records.length>policy.maxRecords) fail('receipt exceeds the record limit');

    const byIdentity=new Map();
    const records=[];
    let exactReplayCount=0;
    for(let index=0;index<receipt.records.length;index++){
      const rawRecord=receipt.records[index];
      const path=`records[${index}]`;
      exactKeys(rawRecord,new Set(['id','sourceVersion','payloadDigest']),path);
      const id=opaque(rawRecord.id,`${path}.id`);
      const sourceVersion=opaque(rawRecord.sourceVersion,`${path}.sourceVersion`);
      const payloadDigest=fingerprint(rawRecord.payloadDigest,`${path}.payloadDigest`);
      let byVersion=byIdentity.get(id);
      if(!byVersion){byVersion=new Map();byIdentity.set(id,byVersion);}
      const prior=byVersion.get(sourceVersion);
      if(prior){
        if(prior.payloadDigest!==payloadDigest) fail(`${path} is a conflicting duplicate source version`);
        exactReplayCount++;
        continue;
      }
      const normalized={id,sourceVersion,payloadDigest,scopedRecordFingerprint:`sha256:${digest({scope,id})}`};
      byVersion.set(sourceVersion,normalized);
      records.push(normalized);
    }
    records.sort((left,right)=>compareOpaque(left.id,right.id)||compareOpaque(left.sourceVersion,right.sourceVersion));
    const decision={
      contextReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,
      writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,
      ...scope,checkpointNamespace,checkpointPredecessor:policy.expectedCheckpointPredecessor,
      observedAt:policy.expectedObservedAt,reportedRecordCount:receipt.records.length,
      uniqueVersionCount:records.length,exactReplayCount,records
    };
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;
    return deepFreeze(decision);
  }

  return Object.freeze({admit});
}
