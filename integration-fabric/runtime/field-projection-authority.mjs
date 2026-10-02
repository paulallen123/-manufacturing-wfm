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
  if(seen.has(value)) fail(`${path} contains a cycle or shared executable shape`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const length=descriptors.length.value;
    if(Reflect.ownKeys(descriptors).length!==length+1) fail(`${path} contains holes or hidden values`);
    const copy=[];
    for(let index=0;index<length;index++){
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${index}] contains executable or hidden data`);
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
  const canonical=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  const parsed=Date.parse(normalized);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonical) fail(`${name} must be a real UTC ISO-8601 instant`);
  return new Date(parsed).toISOString();
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

function routePath(value){
  const normalized=text(value,'routePath');
  if(!normalized.startsWith('/')||normalized.startsWith('//')||normalized.includes('\\')||/[\u0000-\u0020\u007f]/.test(normalized)||normalized.includes('?')||normalized.includes('#')||normalized.includes('*')||normalized.includes('..')){
    fail('routePath must be one exact path');
  }
  return normalized;
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

function normalizedFields(raw,name,{allowEmpty=false}={}){
  if(!Array.isArray(raw)||(!allowEmpty&&raw.length===0)) fail(`${name} must be a non-empty array`);
  const fields=raw.map((field,index)=>text(field,`${name}[${index}]`)).sort();
  for(let index=1;index<fields.length;index++) if(fields[index]===fields[index-1]) fail(`${name} contains a duplicate field`);
  return fields;
}

export function createFieldProjectionAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','sourceAccountId','apiOrigin','apiVersion','resource',
    'routePath','method','readOperation','schemaFingerprint','projectionFingerprint','identityField',
    'allowedFields','requiredFields','deniedSensitiveFields','maxFields','maxRecords'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','sourceAccountId','apiVersion','resource','readOperation',
    'schemaFingerprint','projectionFingerprint','identityField'
  ]) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  policy.routePath=routePath(policy.routePath);
  policy.method=text(policy.method,'method').toUpperCase();
  if(!['GET','POST'].includes(policy.method)) fail('method must be GET or POST read intent');
  policy.maxFields=integer(policy.maxFields,'maxFields',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  policy.allowedFields=normalizedFields(policy.allowedFields,'allowedFields');
  policy.requiredFields=normalizedFields(policy.requiredFields,'requiredFields');
  policy.deniedSensitiveFields=normalizedFields(policy.deniedSensitiveFields,'deniedSensitiveFields',{allowEmpty:true});
  if(policy.allowedFields.length>policy.maxFields) fail('allowedFields exceeds the field limit');
  const allowed=new Set(policy.allowedFields);
  const denied=new Set(policy.deniedSensitiveFields.map(field=>field.toLocaleLowerCase('en-US')));
  for(const field of policy.allowedFields){
    if(denied.has(field.toLocaleLowerCase('en-US'))) fail(`${field} is a denied sensitive field`);
  }
  for(const field of policy.requiredFields) if(!allowed.has(field)) fail(`${field} is not allowlisted`);
  if(!allowed.has(policy.identityField)||!policy.requiredFields.includes(policy.identityField)) fail('identityField must be a required allowlisted field');
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    sourceAccountId:policy.sourceAccountId,apiOrigin:policy.apiOrigin,apiVersion:policy.apiVersion,
    resource:policy.resource,routePath:policy.routePath,method:policy.method,readOperation:policy.readOperation,
    schemaFingerprint:policy.schemaFingerprint,projectionFingerprint:policy.projectionFingerprint
  };
  const checkpointNamespace=`field-projection:${digest(scope)}`;

  function validateRequest(rawRequest,path='request'){
    const request=cloneInert(rawRequest,path);
    exactKeys(request,new Set([
      'provider','wfmTenantId','connectionId','sourceAccountId','apiOrigin','apiVersion','resource',
      'routePath','method','readOperation','schemaFingerprint','projectionFingerprint','fields'
    ]),path);
    for(const field of [
      'provider','wfmTenantId','connectionId','sourceAccountId','apiVersion','resource',
      'readOperation','schemaFingerprint','projectionFingerprint'
    ]) same(text(request[field],`${path}.${field}`),policy[field],field);
    same(exactHttpsOrigin(request.apiOrigin),policy.apiOrigin,'apiOrigin');
    same(routePath(request.routePath),policy.routePath,'routePath');
    same(text(request.method,`${path}.method`).toUpperCase(),policy.method,'method');
    const fields=normalizedFields(request.fields,`${path}.fields`);
    if(fields.length>policy.maxFields) fail('request exceeds the field limit');
    for(const field of fields) if(!allowed.has(field)) fail(`${field} is not allowlisted`);
    for(const required of policy.requiredFields) if(!fields.includes(required)) fail(`${required} is a required field`);
    return {request,fields};
  }

  function authorizeRead(rawRequest){
    const {fields}=validateRequest(rawRequest);
    return deepFreeze({
      ...scope,fields,identityField:policy.identityField,readIntent:true,mutationAuthority:false,
      writeBackAuthority:false,payrollAuthority:false,accessDecisionAuthority:false,
      checkpointNamespace,requestFingerprint:`sha256:${digest({scope,fields})}`
    });
  }

  function admitBatch(rawBatch){
    const batch=cloneInert(rawBatch,'batch');
    exactKeys(batch,new Set([
      'provider','wfmTenantId','connectionId','sourceAccountId','apiOrigin','apiVersion','resource',
      'routePath','method','readOperation','schemaFingerprint','projectionFingerprint','fields',
      'requestedFields','returnedFields','observedAt','complete','paginationComplete','rows'
    ]),'batch');
    const request={};
    for(const key of [
      'provider','wfmTenantId','connectionId','sourceAccountId','apiOrigin','apiVersion','resource',
      'routePath','method','readOperation','schemaFingerprint','projectionFingerprint','fields'
    ]) request[key]=batch[key];
    const {fields}=validateRequest(request,'batch');
    const requestedFields=normalizedFields(batch.requestedFields,'batch.requestedFields');
    const returnedFields=normalizedFields(batch.returnedFields,'batch.returnedFields');
    if(canonical(requestedFields)!==canonical(fields)) fail('requested field set does not match the approved request');
    if(canonical(returnedFields)!==canonical(fields)) fail('returned field set does not match the approved request');
    const observedAt=instant(batch.observedAt,'batch.observedAt');
    if(batch.complete!==true) fail('field projection batch is incomplete');
    if(batch.paginationComplete!==true) fail('field projection pagination is incomplete');
    if(!Array.isArray(batch.rows)) fail('rows must be an array');
    if(batch.rows.length>policy.maxRecords) fail('batch exceeds the record limit');

    const byVersion=new Map();
    const restricted=new Set();
    const records=[];
    let exactReplayCount=0;
    for(let index=0;index<batch.rows.length;index++){
      const item=batch.rows[index];
      exactKeys(item,new Set(['sourceId','sourceVersion','payloadDigest','restrictedFields','values']),`rows[${index}]`);
      const sourceId=text(item.sourceId,`rows[${index}].sourceId`);
      const sourceVersion=text(item.sourceVersion,`rows[${index}].sourceVersion`);
      const payloadDigest=text(item.payloadDigest,`rows[${index}].payloadDigest`);
      const restrictedFields=normalizedFields(item.restrictedFields,`rows[${index}].restrictedFields`,{allowEmpty:true});
      for(const field of restrictedFields){
        if(!fields.includes(field)) fail(`rows[${index}] restricted field is outside the requested projection`);
        restricted.add(field);
      }
      if(restrictedFields.includes(policy.identityField)) fail(`rows[${index}] identity field is restricted`);
      if(!item.values||typeof item.values!=='object'||Array.isArray(item.values)) fail(`rows[${index}].values must be an object`);
      const normalizedValues={};
      for(const originalField of Object.keys(item.values)){
        const field=text(originalField,`rows[${index}].values field`);
        if(Object.hasOwn(normalizedValues,field)) fail(`rows[${index}].values contains a Unicode normalisation collision`);
        normalizedValues[field]=item.values[originalField];
      }
      const valueKeys=Object.keys(normalizedValues).sort();
      if(canonical(valueKeys)!==canonical(fields)){
        if(!valueKeys.includes(policy.identityField)) fail(`rows[${index}] identity field is missing`);
        fail(`rows[${index}] value field set does not match the returned field set`);
      }
      for(const field of restrictedFields) if(normalizedValues[field]!==null) fail(`rows[${index}] restricted field must be null`);
      same(text(normalizedValues[policy.identityField],`rows[${index}] identity value`),sourceId,'identity value and sourceId');
      const values={};
      for(const field of fields) values[field]=normalizedValues[field];
      const normalized={sourceId,sourceVersion,payloadDigest,restrictedFields,values};
      const versionKey=canonical([sourceId,sourceVersion]);
      const existing=byVersion.get(versionKey);
      if(existing){
        if(canonical(existing)!==canonical(normalized)) fail(`rows[${index}] is a conflicting duplicate source version`);
        exactReplayCount++;
        continue;
      }
      byVersion.set(versionKey,normalized);
      records.push(normalized);
    }
    records.sort((left,right)=>canonical([left.sourceId,left.sourceVersion]).localeCompare(canonical([right.sourceId,right.sourceVersion])));
    const restrictedFields=[...restricted].sort();
    return deepFreeze({
      fieldProjectionReconciliationCandidate:true,fieldComplete:restrictedFields.length===0,
      absenceAuthority:false,deletionAuthority:false,checkpointAdvanceAllowed:false,
      writeBackAuthority:false,payrollAuthority:false,accessDecisionAuthority:false,
      ...scope,identityField:policy.identityField,fields,checkpointNamespace,
      requestFingerprint:`sha256:${digest({scope,fields})}`,observedAt,
      reportedRecordCount:batch.rows.length,uniqueRecordCount:records.length,exactReplayCount,
      restrictedFields,records,
      reconciliationFingerprint:`sha256:${digest({scope,fields,observedAt,records})}`
    });
  }

  function classifyFailure(rawFailure){
    const failure=cloneInert(rawFailure,'failure');
    exactKeys(failure,new Set(['status','retryAfterSeconds']),'failure');
    const status=integer(failure.status,'failure.status',{minimum:0});
    let kind='request-failed';
    let retry=false;
    let retryAfterSeconds=null;
    if(status===429){
      kind='rate-limit';
      retry=true;
      retryAfterSeconds=integer(failure.retryAfterSeconds,'failure.retryAfterSeconds',{minimum:0});
    }else if(status===503){
      kind='provider-unavailable';
      retry=true;
    }else if(status===401||status===403){
      kind='permission-or-key-block';
    }
    return deepFreeze({kind,retry,retryAfterSeconds,refreshAuthentication:false,broadenRoute:false});
  }

  return Object.freeze({authorizeRead,admitBatch,classifyFailure});
}
