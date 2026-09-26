import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const FINGERPRINT=/^sha256:[a-f0-9]{64}$/;
const REGIONS=new Set(['AU','EU','UK','US']);
const ROTATION_REASONS=new Set(['scheduled-expiry','expired-access-token','provider-401']);

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
    if(Object.getPrototypeOf(value)!==Array.prototype||Object.keys(value).length!==value.length) fail(`${path} must be a dense plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    return value.map((_,index)=>{
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${index}] contains executable data`);
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

function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be a safe integer from ${minimum} to ${maximum}`);
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

function fingerprint(value,name){
  const normalized=text(value,name);
  if(!FINGERPRINT.test(normalized)) fail(`${name} must be a sha256 fingerprint`);
  return normalized;
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createRotatingOAuthTransition(input){
  const policy=cloneInert(input,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','installationId','region','apiHost',
    'clientRevision','requiredScope','maximumAccessTtlSeconds'
  ]),'policy');
  for(const field of ['provider','wfmTenantId','connectionId','installationId','region','apiHost','clientRevision','requiredScope']){
    policy[field]=text(policy[field],field);
  }
  policy.region=policy.region.toUpperCase();
  if(!REGIONS.has(policy.region)) fail('region must be one of AU, EU, UK or US');
  policy.apiHost=policy.apiHost.toLowerCase();
  if(policy.apiHost.includes('*')||policy.apiHost.includes('/')||policy.apiHost.includes(':')) fail('apiHost must be an exact HTTPS host');
  const expectedHost=`${policy.installationId.toLowerCase()}.${policy.region.toLowerCase()}.deputy.com`;
  if(policy.apiHost!==expectedHost) fail('apiHost does not match the exact installation and region');
  policy.maximumAccessTtlSeconds=integer(policy.maximumAccessTtlSeconds,'maximumAccessTtlSeconds',{minimum:1});
  deepFreeze(policy);

  const issuedPlans=new WeakSet();
  const admittedPlans=new WeakSet();
  const attemptIds=new Set();

  function authorize(rawRequest){
    const request=cloneInert(rawRequest,'request');
    exactKeys(request,new Set([
      'provider','wfmTenantId','connectionId','installationId','region','apiHost','clientRevision',
      'attemptId','observedCredentialGeneration','observedRefreshFingerprint','requestedAt',
      'currentAccessExpiresAt','reason'
    ]),'request');
    for(const field of ['provider','wfmTenantId','connectionId','installationId','region','apiHost','clientRevision']){
      same(request[field],policy[field],field);
    }
    const attemptId=text(request.attemptId,'attemptId');
    if(attemptIds.has(attemptId)) fail('attemptId was already authorised');
    const expectedGeneration=integer(request.observedCredentialGeneration,'observedCredentialGeneration');
    if(expectedGeneration===Number.MAX_SAFE_INTEGER) fail('credential generation cannot advance safely');
    const priorRefreshFingerprint=fingerprint(request.observedRefreshFingerprint,'observedRefreshFingerprint');
    const requestedAtMs=instant(request.requestedAt,'requestedAt');
    instant(request.currentAccessExpiresAt,'currentAccessExpiresAt');
    const reason=text(request.reason,'reason');
    if(!ROTATION_REASONS.has(reason)) fail('reason is not an approved OAuth rotation reason');
    const sourceScope={
      provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
      installationId:policy.installationId,region:policy.region,apiHost:policy.apiHost,
      clientRevision:policy.clientRevision,requiredScope:policy.requiredScope
    };
    const plan=deepFreeze({
      authority:'rotating-oauth-compare-and-swap',
      ...sourceScope,
      attemptId,
      expectedGeneration,
      nextGeneration:expectedGeneration+1,
      priorRefreshFingerprint,
      requestedAt:new Date(requestedAtMs).toISOString(),
      currentAccessExpiresAt:request.currentAccessExpiresAt,
      reason,
      storeWriteAuthority:'compare-and-swap-only',
      transitionNamespace:`oauth-rotation:${digest(sourceScope)}`,
      planFingerprint:`sha256:${digest({...sourceScope,attemptId,expectedGeneration,priorRefreshFingerprint,requestedAt:request.requestedAt,currentAccessExpiresAt:request.currentAccessExpiresAt,reason})}`
    });
    attemptIds.add(attemptId);
    issuedPlans.add(plan);
    return plan;
  }

  function admit(plan,rawReceipt){
    if(!issuedPlans.has(plan)) fail('plan was not issued by this authority');
    if(admittedPlans.has(plan)) fail('plan was already admitted');
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      'planFingerprint','status','endpointHost','scope','observedStoredGeneration',
      'priorRefreshFingerprint','newAccessFingerprint','newRefreshFingerprint',
      'issuedAt','receivedAt','expiresInSeconds'
    ]),'receipt');
    same(receipt.planFingerprint,plan.planFingerprint,'planFingerprint');
    if(integer(receipt.status,'status')!==200) fail('refresh response did not succeed');
    same(receipt.endpointHost,plan.apiHost,'endpointHost');
    same(receipt.scope,plan.requiredScope,'scope');
    same(integer(receipt.observedStoredGeneration,'observedStoredGeneration'),plan.expectedGeneration,'observedStoredGeneration');
    const priorRefreshFingerprint=fingerprint(receipt.priorRefreshFingerprint,'priorRefreshFingerprint');
    same(priorRefreshFingerprint,plan.priorRefreshFingerprint,'priorRefreshFingerprint');
    const newAccessFingerprint=fingerprint(receipt.newAccessFingerprint,'newAccessFingerprint');
    const newRefreshFingerprint=fingerprint(receipt.newRefreshFingerprint,'newRefreshFingerprint');
    if(newRefreshFingerprint===priorRefreshFingerprint) fail('refresh credential did not rotate');
    if(newAccessFingerprint===priorRefreshFingerprint||newAccessFingerprint===newRefreshFingerprint) fail('access and refresh credential fingerprints must be distinct');
    const issuedAtMs=instant(receipt.issuedAt,'issuedAt');
    const receivedAtMs=instant(receipt.receivedAt,'receivedAt');
    const requestedAtMs=instant(plan.requestedAt,'requestedAt');
    if(issuedAtMs<requestedAtMs) fail('issuedAt predates the authorised request');
    if(receivedAtMs<issuedAtMs) fail('receivedAt predates issuedAt');
    const expiresInSeconds=integer(receipt.expiresInSeconds,'expiresInSeconds',{minimum:1,maximum:policy.maximumAccessTtlSeconds});
    admittedPlans.add(plan);
    return deepFreeze({
      rotationCandidate:true,
      reconciliationRequired:true,
      storeWriteAuthority:'compare-and-swap-only',
      provider:plan.provider,
      wfmTenantId:plan.wfmTenantId,
      connectionId:plan.connectionId,
      installationId:plan.installationId,
      region:plan.region,
      apiHost:plan.apiHost,
      clientRevision:plan.clientRevision,
      attemptId:plan.attemptId,
      transitionNamespace:plan.transitionNamespace,
      planFingerprint:plan.planFingerprint,
      expectedPreviousGeneration:plan.expectedGeneration,
      nextGeneration:plan.nextGeneration,
      priorRefreshFingerprint,
      newAccessFingerprint,
      newRefreshFingerprint,
      issuedAt:receipt.issuedAt,
      receivedAt:receipt.receivedAt,
      expiresInSeconds
    });
  }

  return Object.freeze({authorize,admit});
}
