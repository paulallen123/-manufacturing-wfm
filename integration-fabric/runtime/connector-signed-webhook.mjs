import {createHash} from 'node:crypto';
import {validateConnectionEvidence} from './connection-test-plan.mjs';

function fail(message,code='WFM_WEBHOOK_INVALID',status=400){const e=new Error(message);e.code=code;e.status=status;throw e;}
function text(value,name,max=512){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(name+' is invalid');
  return v;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(name+' must be a plain object');
  return value;
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function integer(value,name,min,max,defaultValue){
  const raw=value===undefined?defaultValue:value,n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max)fail(name+' is outside supported bounds');
  return n;
}
function headerName(value,name){
  const v=text(value,name,100).toLowerCase();
  if(!/^[!#$%&'*+\-.^_|~0-9a-z]+$/.test(v))fail(name+' is not a valid HTTP header name');
  return v;
}
function path(value,name){
  if(!Array.isArray(value)||!value.length||value.length>16)fail(name+' must contain 1-16 segments');
  return value.map((v,i)=>{
    const s=text(v,name+'['+i+']',80);
    if(!/^[A-Za-z0-9_-]+$/.test(s)||['__proto__','prototype','constructor'].includes(s))fail(name+' contains unsafe path segment');
    return s;
  });
}
function getPath(value,parts){
  let current=value;
  for(const part of parts){
    if(!current||typeof current!=='object'||Array.isArray(current)||!Object.hasOwn(current,part))return undefined;
    current=current[part];
  }
  return current;
}
function bodyBytes(value){
  if(value instanceof Uint8Array)return Buffer.from(value);
  if(Buffer.isBuffer(value))return value;
  fail('webhook body must be Uint8Array or Buffer');
}
const sha=value=>createHash('sha256').update(value).digest('hex');
function supports(contract,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding)fail('valid connector contract required');
  if(!contract.transports.some(t=>t.adapter==='signed-events'))fail('connector does not declare signed webhook transport','WFM_WEBHOOK_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(r=>r.target===target))fail('connector target unavailable '+target,'WFM_WEBHOOK_TARGET_UNAVAILABLE');
}
function timeValue(value,kind){
  if(kind==='unix-seconds'){
    const s=String(value);
    if(!/^\d{1,12}$/.test(s))fail('webhook timestamp is invalid','WFM_WEBHOOK_TIMESTAMP_INVALID');
    const ms=Number(s)*1000;
    if(!Number.isSafeInteger(ms))fail('webhook timestamp is invalid','WFM_WEBHOOK_TIMESTAMP_INVALID');
    return ms;
  }
  const s=text(String(value),'webhook timestamp',64);
  const ms=Date.parse(s);
  if(!Number.isFinite(ms))fail('webhook timestamp is invalid','WFM_WEBHOOK_TIMESTAMP_INVALID');
  return ms;
}
function headersMap(input){
  const out={};
  for(const [name,value] of Object.entries(input||{})){
    const n=headerName(name,'request header');
    if(Array.isArray(value)||typeof value!=='string'||/[\r\n\0]/.test(value)||value.length>4096)fail('webhook header value is invalid');
    if(Object.hasOwn(out,n))fail('duplicate webhook header');
    out[n]=value;
  }
  return out;
}
function hintRules(input){
  if(!input)return null;
  const x=plain(input,'hints');
  const result={arrayPath:path(x.arrayPath,'hints.arrayPath'),fields:{}};
  const fields=plain(x.fields,'hints.fields');
  for(const [key,value] of Object.entries(fields)){
    if(!['entityId','entityKind','operation','sourceVersion'].includes(key))fail('unsupported webhook hint field '+key);
    result.fields[key]=path(value,'hints.fields.'+key);
  }
  if(!result.fields.entityId)fail('webhook hints require entityId');
  return result;
}
function extractHints(payload,rules,maxHints){
  if(!rules)return [];
  const list=getPath(payload,rules.arrayPath);
  if(!Array.isArray(list))fail('webhook hint array is missing','WFM_WEBHOOK_PAYLOAD_INVALID');
  if(list.length>maxHints)fail('webhook hint count exceeds configured bound','WFM_WEBHOOK_LIMIT');
  return list.map((item,index)=>{
    plain(item,'webhook hint '+index);
    const out={};
    for(const [key,p] of Object.entries(rules.fields)){
      const value=getPath(item,p);
      if(value===undefined||value===null||value===''){
        if(key==='entityId')fail('webhook hint entityId is missing','WFM_WEBHOOK_PAYLOAD_INVALID');
        continue;
      }
      out[key]=text(String(value),'webhook hint '+key,256);
    }
    return freeze(out);
  });
}

export function defineSignedWebhookRecipe(raw){
  const x=plain(raw,'webhook recipe');
  if(x.schemaVersion!==1)fail('webhook recipe schemaVersion must be 1');
  const timestampKind=text(x.timestampKind||'iso8601','timestampKind',32);
  if(!['iso8601','unix-seconds'].includes(timestampKind))fail('unsupported timestampKind');
  const recipe={
    schemaVersion:1,id:text(x.id,'id',128),providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),signalType:text(x.signalType,'signalType',128),
    signatureHeader:headerName(x.signatureHeader,'signatureHeader'),
    timestampHeader:headerName(x.timestampHeader,'timestampHeader'),
    deliveryIdHeader:headerName(x.deliveryIdHeader,'deliveryIdHeader'),
    timestampKind:timestampKind,
    maxSkewMs:integer(x.maxSkewMs,'maxSkewMs',1000,24*60*60*1000,5*60*1000),
    replayTtlMs:integer(x.replayTtlMs,'replayTtlMs',60*1000,7*24*60*60*1000,24*60*60*1000),
    maxBodyBytes:integer(x.maxBodyBytes,'maxBodyBytes',1,8*1024*1024,1024*1024),
    maxHints:integer(x.maxHints,'maxHints',1,10000,1000),
    hints:hintRules(x.hints)
  };
  return freeze(recipe);
}

export async function admitSignedWebhook(args={}){
  const recipe=args.recipe,contract=args.contract,connectionPlan=args.connectionPlan,connectionEvidence=args.connectionEvidence;
  const request=args.request,verifySignature=args.verifySignature,replayStore=args.replayStore;
  const nowMs=args.nowMs??Date.now(),maxConnectionAgeMs=args.maxConnectionAgeMs??24*60*60*1000;
  const r=recipe&&recipe.signalType?recipe:defineSignedWebhookRecipe(recipe);
  if(contract&&contract.provider&&contract.provider.id!==r.providerId)fail('webhook recipe provider mismatch','WFM_WEBHOOK_BINDING_MISMATCH');
  supports(contract,r.target);
  if(typeof verifySignature!=='function')throw new TypeError('verifySignature is required');
  if(!replayStore||typeof replayStore.claim!=='function')throw new TypeError('replayStore.claim is required');
  if(!connectionPlan||!connectionPlan.configuration||
     connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId)fail('webhook connection is not bound to connector contract','WFM_WEBHOOK_BINDING_MISMATCH');
  const connection=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs:nowMs,maxAgeMs:maxConnectionAgeMs});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(connection.status))fail('webhook connection proof rejected: '+connection.reasons.join(', '),'WFM_WEBHOOK_CONNECTION_NOT_VERIFIED');
  const req=plain(request,'webhook request'),headers=headersMap(req.headers);
  const body=bodyBytes(req.body);
  if(body.byteLength>r.maxBodyBytes)fail('webhook body exceeds configured limit','WFM_WEBHOOK_LIMIT');
  const signature=text(headers[r.signatureHeader],'signature header',4096);
  const deliveryId=text(headers[r.deliveryIdHeader],'delivery id',256);
  const timestampRaw=text(headers[r.timestampHeader],'timestamp header',128);
  const signedAt=timeValue(timestampRaw,r.timestampKind);
  if(Math.abs(nowMs-signedAt)>r.maxSkewMs)fail('webhook timestamp is outside allowed skew','WFM_WEBHOOK_TIMESTAMP_INVALID');
  const bodySha256=sha(body);
  const verification=plain(await verifySignature(freeze({
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    signatureHeader:r.signatureHeader,signature:signature,timestampHeader:r.timestampHeader,timestamp:timestampRaw,
    deliveryIdHeader:r.deliveryIdHeader,deliveryId:deliveryId,bodySha256:bodySha256,body:body
  })),'signature verification');
  if(verification.verified!==true)fail('webhook signature verification failed','WFM_WEBHOOK_SIGNATURE_INVALID',403);
  const keyRevision=text(verification.keyRevision,'signature keyRevision',128);
  const algorithm=text(verification.algorithm,'signature algorithm',80);
  const replay=await replayStore.claim(freeze({
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    deliveryId:deliveryId,bodySha256:bodySha256,signedAt:signedAt,expiresAt:nowMs+r.replayTtlMs
  }));
  if(replay==='conflict')fail('webhook delivery id was reused with different content','WFM_WEBHOOK_REPLAY_CONFLICT',409);
  if(replay==='duplicate')return freeze({
    schemaVersion:1,status:'DUPLICATE_IGNORED',providerId:contract.provider.id,
    tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    deliveryId:deliveryId,bodySha256:bodySha256,providerReadRequired:false,webhookRecordAuthority:false,
    checkpointAdvanceAllowed:false,businessMutationAllowed:false,customerProofClaimAllowed:false
  });
  if(replay!=='acquired')fail('webhook replay store returned invalid claim result','WFM_WEBHOOK_REPLAY_STORE_INVALID',500);
  let payload;
  try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
  catch{fail('webhook body is not valid UTF-8 JSON','WFM_WEBHOOK_PAYLOAD_INVALID');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('webhook payload must be a JSON object','WFM_WEBHOOK_PAYLOAD_INVALID');
  const hints=extractHints(payload,r.hints,r.maxHints);
  return freeze({
    schemaVersion:1,status:'SIGNAL_VERIFIED',providerId:contract.provider.id,
    tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,target:r.target,
    signalType:r.signalType,deliveryId:deliveryId,bodySha256:bodySha256,signedAt:new Date(signedAt).toISOString(),
    observedAt:new Date(nowMs).toISOString(),signature:{algorithm:algorithm,keyRevision:keyRevision},
    hints:hints,providerReadRequired:true,webhookRecordAuthority:false,reconciliationRequired:true,
    checkpointAdvanceAllowed:false,deletionAuthority:false,businessMutationAllowed:false,
    payrollAuthority:false,writeBackAuthority:false,customerProofClaimAllowed:false
  });
}
