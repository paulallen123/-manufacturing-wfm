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

export function createManagedTaskIngressAuthority(input){
  const policy=cloneInert(input,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','environmentId','controlPlaneHost','taskPath',
    'taskRevision','pipelineRevision','schemaFingerprint','credentialRevision','method',
    'parameterNames','sourceAuthority','sinkAuthority','mutationAuthority'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','environmentId','controlPlaneHost','taskPath',
    'taskRevision','pipelineRevision','schemaFingerprint','credentialRevision','method'
  ]) policy[field]=text(policy[field],field);
  policy.controlPlaneHost=policy.controlPlaneHost.toLowerCase();
  if(policy.controlPlaneHost.includes('*')||policy.controlPlaneHost.includes('/')||policy.controlPlaneHost.includes(':')) fail('controlPlaneHost must be an exact HTTPS host');
  try{new URL(`https://${policy.controlPlaneHost}`);}catch{fail('controlPlaneHost is invalid');}
  if(!policy.taskPath.startsWith('/api/1/rest/slsched/')||policy.taskPath.includes('?')||policy.taskPath.includes('#')) fail('taskPath must be an exact triggered-task path');
  if(!['GET','POST'].includes(policy.method)) fail('method must be GET or POST for the approved read task');
  if(policy.sourceAuthority!=='read-only-projection') fail('source authority must be a read-only projection');
  if(policy.sinkAuthority!=='wfm-ingress-only') fail('sink authority must be WFM ingress only');
  if(policy.mutationAuthority!==false) fail('mutation authority must be false');
  if(!Array.isArray(policy.parameterNames)) fail('parameterNames must be an array');
  const parameterNames=policy.parameterNames.map((name,index)=>text(name,`parameterNames[${index}]`));
  if(parameterNames.some(name=>SECRET_KEY.test(name)||name.includes('*'))||new Set(parameterNames).size!==parameterNames.length) fail('parameter names contain a secret, wildcard or duplicate');
  policy.parameterNames=[...parameterNames].sort();
  deepFreeze(policy);
  const issuedPlans=new WeakSet();

  function authorize(rawRequest){
    const request=cloneInert(rawRequest,'request');
    exactKeys(request,new Set([
      'provider','wfmTenantId','connectionId','environmentId','url','method','authPlacement',
      'taskRevision','pipelineRevision','schemaFingerprint','parameters'
    ]),'request');
    for(const field of ['provider','wfmTenantId','connectionId','environmentId','method','taskRevision','pipelineRevision','schemaFingerprint']) same(request[field],policy[field],field);
    if(request.authPlacement!=='authorization-header') fail('credentials must use the Authorization header');
    const parsed=new URL(text(request.url,'url'));
    if(parsed.protocol!=='https:'||parsed.hostname.toLowerCase()!==policy.controlPlaneHost||parsed.port||parsed.pathname!==policy.taskPath||parsed.search||parsed.hash) fail('url does not match the exact approved HTTPS task route');
    if(!request.parameters||typeof request.parameters!=='object'||Array.isArray(request.parameters)) fail('parameters must be a plain object');
    const names=Object.keys(request.parameters).sort();
    if(canonical(names)!==canonical(policy.parameterNames)) fail('parameter set does not match approved authority');
    for(const name of names) text(request.parameters[name],`parameters.${name}`);
    const scopeIdentity={
      provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
      environmentId:policy.environmentId,controlPlaneHost:policy.controlPlaneHost,
      taskPath:policy.taskPath,taskRevision:policy.taskRevision,pipelineRevision:policy.pipelineRevision,
      schemaFingerprint:policy.schemaFingerprint,credentialRevision:policy.credentialRevision
    };
    const parameterDigest=`sha256:${digest(request.parameters)}`;
    const plan=deepFreeze({
      authority:'read-ingress-only',...scopeIdentity,method:policy.method,parameterDigest,
      checkpointNamespace:`managed-task:${digest(scopeIdentity)}`,
      planFingerprint:`sha256:${digest({authority:'read-ingress-only',...scopeIdentity,method:policy.method,parameterDigest})}`
    });
    issuedPlans.add(plan);
    return plan;
  }

  function admitExecution(plan,rawReceipt){
    if(!issuedPlans.has(plan)) fail('plan was not issued by this authority');
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      'planFingerprint','ruuid','state','startedAt','completedAt','taskRevision','pipelineRevision',
      'schemaFingerprint','errorDocumentCount','failedSnapCount','reportedRecordCount','records'
    ]),'receipt');
    same(receipt.planFingerprint,plan.planFingerprint,'planFingerprint');
    same(receipt.taskRevision,plan.taskRevision,'taskRevision');
    same(receipt.pipelineRevision,plan.pipelineRevision,'pipelineRevision');
    same(receipt.schemaFingerprint,plan.schemaFingerprint,'schemaFingerprint');
    if(receipt.state!=='Completed') fail('execution is not in the Completed terminal state');
    if(integer(receipt.errorDocumentCount,'errorDocumentCount')!==0) fail('execution produced error documents');
    if(integer(receipt.failedSnapCount,'failedSnapCount')!==0) fail('execution contains failed Snaps');
    const started=instant(receipt.startedAt,'startedAt');
    const completed=instant(receipt.completedAt,'completedAt');
    if(completed<started) fail('completedAt is before startedAt');
    text(receipt.ruuid,'ruuid');
    if(!Array.isArray(receipt.records)) fail('records must be an array');
    if(integer(receipt.reportedRecordCount,'reportedRecordCount')!==receipt.records.length) fail('reportedRecordCount does not match records');
    const identities=[];
    const identityDigests=new Map();
    let exactReplayCount=0;
    for(let index=0;index<receipt.records.length;index++){
      const record=receipt.records[index];
      exactKeys(record,new Set(['sourceRecordId','sourceVersion','payloadDigest']),`records[${index}]`);
      const sourceRecordId=text(record.sourceRecordId,`records[${index}].sourceRecordId`);
      const sourceVersion=text(record.sourceVersion,`records[${index}].sourceVersion`);
      const payloadDigest=text(record.payloadDigest,`records[${index}].payloadDigest`);
      const sourceIdentity=canonical([sourceRecordId,sourceVersion]);
      const prior=identityDigests.get(sourceIdentity);
      if(prior!==undefined){
        if(prior!==payloadDigest) fail('conflicting duplicate source identity is quarantined');
        exactReplayCount++;
        continue;
      }
      identityDigests.set(sourceIdentity,payloadDigest);
      identities.push(canonical([sourceRecordId,sourceVersion,payloadDigest]));
    }
    return deepFreeze({
      reconciliationCandidate:true,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      provider:plan.provider,
      wfmTenantId:plan.wfmTenantId,
      environmentId:plan.environmentId,
      checkpointNamespace:plan.checkpointNamespace,
      planFingerprint:plan.planFingerprint,
      ruuid:receipt.ruuid,
      taskRevision:plan.taskRevision,
      pipelineRevision:plan.pipelineRevision,
      schemaFingerprint:plan.schemaFingerprint,
      startedAt:receipt.startedAt,
      completedAt:receipt.completedAt,
      reportedRecordCount:receipt.reportedRecordCount,
      uniqueRecordCount:identities.length,
      exactReplayCount,
      recordIdentities:identities
    });
  }

  return Object.freeze({authorize,admitExecution});
}
