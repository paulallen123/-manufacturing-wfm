import {createHash} from 'node:crypto';
import {assertProviderReadPlan} from './provider-read-requests.mjs';

const AUTH_HEADERS=new Set(['authorization','x-api-key','cookie']);
const FORBIDDEN_HEADERS=/^(?:host|content-length|connection|transfer-encoding|upgrade|proxy-|x-forwarded-|forwarded$|origin$|referer$)/i;

export class ProviderReadError extends Error {
  constructor(message,{code='WFM_PROVIDER_READ_FAILED',status=503,retryable=false}={}){
    super(message);
    this.name='ProviderReadError';
    this.code=code;
    this.status=status;
    this.retryable=retryable;
  }
}

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  return value.normalize('NFC').trim();
}
function safeInteger(value,name,min,max){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw new TypeError(`${name} must be between ${min} and ${max}`);
  return n;
}
function canonical(value,depth=0){
  if(depth>64) throw new ProviderReadError('provider JSON exceeds nesting limit',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) throw new ProviderReadError('provider JSON contains non-finite number',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
    return value;
  }
  if(Array.isArray(value)) return value.map(item=>canonical(item,depth+1));
  if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,canonical(item,depth+1)]));
  }
  throw new ProviderReadError('provider response is not plain JSON',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
}
const sha256=value=>createHash('sha256').update(value).digest('hex');

function normalizeStaticHeaders(headers={}){
  const out={};
  for(const [rawName,rawValue] of Object.entries(headers)){
    const name=required(rawName,'header name').toLowerCase();
    if(FORBIDDEN_HEADERS.test(name)) throw new ProviderReadError(`forbidden static request header: ${name}`,{code:'WFM_PROVIDER_REQUEST_INVALID',status:500});
    if(typeof rawValue!=='string'||/[\r\n\0]/.test(rawValue)) throw new ProviderReadError(`invalid static request header: ${name}`,{code:'WFM_PROVIDER_REQUEST_INVALID',status:500});
    out[name]=rawValue;
  }
  return out;
}
function normalizeAuthHeaders(headers={}){
  if(!headers||typeof headers!=='object'||Array.isArray(headers)) throw new ProviderReadError('credential authorizer must return header object',{code:'WFM_PROVIDER_AUTH_CONFIGURATION_INVALID',status:500});
  const out={};
  for(const [rawName,rawValue] of Object.entries(headers)){
    const name=required(rawName,'auth header name').toLowerCase();
    if(!AUTH_HEADERS.has(name)) throw new ProviderReadError(`credential authorizer returned unsupported header: ${name}`,{code:'WFM_PROVIDER_AUTH_CONFIGURATION_INVALID',status:500});
    if(typeof rawValue!=='string'||!rawValue||/[\r\n\0]/.test(rawValue)) throw new ProviderReadError(`credential authorizer returned invalid header: ${name}`,{code:'WFM_PROVIDER_AUTH_CONFIGURATION_INVALID',status:500});
    out[name]=rawValue;
  }
  if(Object.keys(out).length===0) throw new ProviderReadError('credential authorizer returned no authentication header',{code:'WFM_PROVIDER_AUTH_CONFIGURATION_INVALID',status:500});
  return out;
}
function requestFingerprint(plan){
  const safe={
    providerId:plan.binding.providerId,
    target:plan.target,
    connectionFingerprint:plan.connection.configurationFingerprint,
    method:plan.request.method,
    url:plan.request.url,
    headers:plan.request.headers,
    body:plan.request.body,
    immutableQueryId:plan.request.immutableQueryId??null
  };
  return sha256(JSON.stringify(safe));
}
async function readBoundedBody(response,maxBytes,controller){
  if(response.body===null) return Buffer.alloc(0);
  const reader=response.body?.getReader?.();
  if(!reader) throw new ProviderReadError('provider response body is not a bounded readable stream',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
  const chunks=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      if(!(value instanceof Uint8Array)) throw new ProviderReadError('provider response stream contains non-byte data',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
      total+=value.byteLength;
      if(total>maxBytes){
        controller.abort();
        throw new ProviderReadError('provider response exceeds configured byte limit',{code:'WFM_PROVIDER_RESPONSE_TOO_LARGE',status:502});
      }
      chunks.push(Buffer.from(value));
    }
  }finally{
    try{reader.releaseLock?.();}catch{}
  }
  return Buffer.concat(chunks,total);
}

export async function executeProviderRead({
  plan,
  contract,
  credentialAuthorizer,
  fetchImpl=globalThis.fetch,
  maxResponseBytes=4*1024*1024,
  timeoutMs=15_000,
  clock=()=>Date.now()
}={}){
  assertProviderReadPlan(plan,contract);
  if(typeof credentialAuthorizer!=='function') throw new TypeError('credentialAuthorizer is required');
  if(typeof fetchImpl!=='function') throw new TypeError('fetchImpl is required');
  const byteLimit=safeInteger(maxResponseBytes,'maxResponseBytes',1,64*1024*1024);
  const deadline=safeInteger(timeoutMs,'timeoutMs',1,120_000);
  const method=required(plan.request.method,'request.method').toUpperCase();
  if(!['GET','HEAD','POST'].includes(method)) throw new ProviderReadError('provider read method is not allowlisted',{code:'WFM_PROVIDER_REQUEST_INVALID',status:500});
  if(method==='POST'&&plan.request.readViaPostProven!==true) throw new ProviderReadError('POST transport lacks explicit read semantics',{code:'WFM_PROVIDER_READ_VIA_POST_NOT_PROVEN',status:500});
  if((method==='GET'||method==='HEAD')&&plan.request.body!==null&&plan.request.body!==undefined) throw new ProviderReadError('GET/HEAD provider read cannot carry a body',{code:'WFM_PROVIDER_REQUEST_INVALID',status:500});
  if(method==='POST'&&typeof plan.request.body!=='string') throw new ProviderReadError('read-via-POST requires an immutable string body',{code:'WFM_PROVIDER_REQUEST_INVALID',status:500});

  const authHeaders=normalizeAuthHeaders(await credentialAuthorizer(Object.freeze({
    credentialRef:plan.credentialRef,
    providerId:plan.binding.providerId,
    tenantId:plan.binding.tenantId,
    connectionId:plan.binding.connectionId,
    endpointHost:plan.route.endpointHost,
    auth:Object.freeze(structuredClone(plan.request.auth||{}))
  })));
  const staticHeaders=normalizeStaticHeaders(plan.request.headers||{});
  for(const name of Object.keys(authHeaders)){
    if(Object.hasOwn(staticHeaders,name)) throw new ProviderReadError(`authentication header conflicts with static request header: ${name}`,{code:'WFM_PROVIDER_AUTH_CONFIGURATION_INVALID',status:500});
  }
  const headers={...staticHeaders,...authHeaders};
  const controller=new AbortController();
  const started=Number(clock());
  if(!Number.isSafeInteger(started)||started<0) throw new TypeError('clock returned invalid time');
  const timer=setTimeout(()=>controller.abort(),deadline);
  let response,body,status;
  try{
    response=await fetchImpl(plan.request.url,{
      method,
      headers,
      body:method==='POST'?plan.request.body:undefined,
      redirect:'error',
      signal:controller.signal
    });
    status=Number(response?.status);
    if(!Number.isInteger(status)) throw new ProviderReadError('provider returned invalid HTTP status',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
    if(status===401||status===403) throw new ProviderReadError('provider authentication or permission rejected',{code:'WFM_PROVIDER_AUTH_REJECTED',status:502,retryable:false});
    if(status===429) throw new ProviderReadError('provider rate limit reached',{code:'WFM_PROVIDER_RATE_LIMITED',status:503,retryable:true});
    if(status<200||status>=300) throw new ProviderReadError(`provider returned HTTP ${status}`,{code:'WFM_PROVIDER_HTTP_ERROR',status:502,retryable:status>=500});
    body=await readBoundedBody(response,byteLimit,controller);
  }catch(error){
    if(error instanceof ProviderReadError) throw error;
    if(controller.signal.aborted) throw new ProviderReadError('provider read timed out',{code:'WFM_PROVIDER_READ_TIMEOUT',status:504,retryable:true});
    throw new ProviderReadError('provider read transport failed',{code:'WFM_PROVIDER_TRANSPORT_ERROR',status:503,retryable:true});
  }finally{
    clearTimeout(timer);
  }
  let data=null;
  if(method!=='HEAD'&&body.length){
    try{data=canonical(JSON.parse(body.toString('utf8')));}catch(error){
      if(error instanceof ProviderReadError) throw error;
      throw new ProviderReadError('provider response is not valid JSON',{code:'WFM_PROVIDER_RESPONSE_INVALID',status:502});
    }
  }
  const completed=Number(clock());
  if(!Number.isSafeInteger(completed)||completed<started) throw new TypeError('clock returned invalid completion time');
  return Object.freeze({
    data,
    receipt:Object.freeze({
      schemaVersion:1,
      providerId:plan.binding.providerId,
      tenantId:plan.binding.tenantId,
      connectionId:plan.binding.connectionId,
      target:plan.target,
      configurationFingerprint:plan.connection.configurationFingerprint,
      requestFingerprint:requestFingerprint(plan),
      responseSha256:sha256(body),
      httpStatus:status,
      observedAt:new Date(completed).toISOString(),
      latencyMs:completed-started,
      readOnly:true,
      checkpointAdvanceAllowed:false
    })
  });
}
