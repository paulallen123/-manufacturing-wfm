'use strict';

// Experimental L1 evidence only. Verification is never an execution permit for WFM.
const {createHash,sign,verify}=require('node:crypto');
const PERMIT_DOMAIN='WFM_SHADOW_EXECUTION_PERMIT_V1\n';
const RECEIPT_DOMAIN='WFM_SHADOW_EXECUTION_RECEIPT_V1\n';
const PERMIT_FIELDS=['tenant','site','action','resources','tools','policyHash','buildHash','dataClass','issuedAt','expiresAt','nonce','maxCalls'];
const RECEIPT_FIELDS=['executorBuildHash','startedAt','endedAt','tools','resources','callCount','transcriptHash','status','reasonCode'];
const TRUST_LEVEL='L1_SOFTWARE_SIGNED';

function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function exactly(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
function identifier(value){return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value);}
function hash(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function boundedList(value,allowEmpty=false){
  return Array.isArray(value)&&value.length<17&&(allowEmpty||value.length>0)&&
    value.every(identifier)&&new Set(value).size===value.length;
}
function permitShape(p){
  return exactly(p,['schemaVersion','trustLevel','keyId',...PERMIT_FIELDS,'signature'])&&
    p.schemaVersion===1&&p.trustLevel===TRUST_LEVEL&&identifier(p.keyId)&&
    identifier(p.tenant)&&identifier(p.site)&&identifier(p.action)&&
    boundedList(p.resources)&&boundedList(p.tools)&&hash(p.policyHash)&&hash(p.buildHash)&&
    ['workforce-metadata','operations-metadata','security-metadata'].includes(p.dataClass)&&
    Number.isSafeInteger(p.issuedAt)&&Number.isSafeInteger(p.expiresAt)&&p.issuedAt>=0&&
    p.expiresAt>p.issuedAt&&p.expiresAt-p.issuedAt<=300000&&identifier(p.nonce)&&
    Number.isSafeInteger(p.maxCalls)&&p.maxCalls>0&&p.maxCalls<=100&&typeof p.signature==='string';
}
function receiptShape(r){
  return exactly(r,['schemaVersion','trustLevel','keyId','permitDigest',...RECEIPT_FIELDS,'signature'])&&
    r.schemaVersion===1&&r.trustLevel===TRUST_LEVEL&&identifier(r.keyId)&&hash(r.permitDigest)&&
    hash(r.executorBuildHash)&&Number.isSafeInteger(r.startedAt)&&Number.isSafeInteger(r.endedAt)&&
    r.startedAt>=0&&r.endedAt>=r.startedAt&&boundedList(r.tools,true)&&boundedList(r.resources,true)&&
    Number.isSafeInteger(r.callCount)&&r.callCount>=0&&r.callCount<=100&&hash(r.transcriptHash)&&
    ['SUCCEEDED','FAILED','INCOMPLETE','ROLLED_BACK'].includes(r.status)&&
    typeof r.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(r.reasonCode)&&typeof r.signature==='string';
}
function unsigned(record){const copy={...record};delete copy.signature;return copy;}
function signature(domain,record,privateKey){return sign(null,Buffer.from(domain+canonical(unsigned(record))),privateKey).toString('base64url');}
function validSignature(domain,record,key){
  return /^[A-Za-z0-9_-]{86}$/.test(record.signature)&&
    verify(null,Buffer.from(domain+canonical(unsigned(record))),key,Buffer.from(record.signature,'base64url'));
}
function result(reason){return {ok:false,reason};}
function publicKeyFor(record,options){
  if(!(options.revokedKeyIds instanceof Set)||options.revokedKeyIds.has(record.keyId))return null;
  const key=options.publicKeys?.get(record.keyId);
  return key?.type==='public'&&key.asymmetricKeyType==='ed25519'?key:null;
}
function verifyPermit(permit,options={}){
  try{
    if(!permitShape(permit))return result('INVALID_PERMIT');
    const key=publicKeyFor(permit,options);
    if(!key)return result('KEY_UNAVAILABLE_OR_REVOKED');
    if(!validSignature(PERMIT_DOMAIN,permit,key))return result('BAD_SIGNATURE');
    const now=options.now?.();
    if(!Number.isSafeInteger(now)||now<permit.issuedAt||now>permit.expiresAt)return result('EXPIRED_OR_NOT_YET_VALID');
    if(permit.tenant!==options.tenant||permit.site!==options.site||permit.policyHash!==options.policyHash||permit.buildHash!==options.buildHash)return result('SCOPE_MISMATCH');
    if(options.consume){
      if(typeof options.nonceLedger?.claim!=='function')return result('REPLAY_LEDGER_UNAVAILABLE');
      if(options.nonceLedger.claim(`${permit.tenant}:${permit.keyId}:${permit.nonce}`)!==true)return result('REPLAYED_PERMIT');
    }
    return {ok:true,trustLevel:TRUST_LEVEL,executionAuthorityGranted:false};
  }catch{return result('VERIFIER_UNAVAILABLE');}
}
function verifyReceipt(receipt,permit,options={}){
  const permitResult=verifyPermit(permit,{...options,consume:false});
  if(!permitResult.ok)return permitResult;
  try{
    if(!receiptShape(receipt))return result('INVALID_RECEIPT');
    if(receipt.keyId!==permit.keyId||receipt.permitDigest!==digest(unsigned(permit)))return result('PERMIT_MISMATCH');
    const key=publicKeyFor(receipt,options);
    if(!key)return result('KEY_UNAVAILABLE_OR_REVOKED');
    if(!validSignature(RECEIPT_DOMAIN,receipt,key))return result('BAD_SIGNATURE');
    if(receipt.executorBuildHash!==permit.buildHash||receipt.startedAt<permit.issuedAt||receipt.endedAt>permit.expiresAt)return result('EXECUTION_CONTEXT_MISMATCH');
    if(receipt.callCount>permit.maxCalls||receipt.tools.some(x=>!permit.tools.includes(x))||receipt.resources.some(x=>!permit.resources.includes(x)))return result('PERMIT_BOUNDS_EXCEEDED');
    if(receipt.status==='SUCCEEDED'&&receipt.callCount===0)return result('EMPTY_SUCCESS');
    return {ok:true,trustLevel:TRUST_LEVEL,executionAuthorityGranted:false,status:receipt.status};
  }catch{return result('VERIFIER_UNAVAILABLE');}
}
function createShadowEvidence({privateKey,keyId,now=Date.now}={}){
  if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519'||!identifier(keyId)||typeof now!=='function')throw Error('Ed25519 signing key, key ID and clock required.');
  return {
    issuePermit(fields){
      if(!exactly(fields,PERMIT_FIELDS))throw Error('Permit contains missing or unexpected fields.');
      const record={schemaVersion:1,trustLevel:TRUST_LEVEL,keyId,...fields,signature:''};
      if(!permitShape(record)||now()<record.issuedAt||now()>record.expiresAt)throw Error('Invalid shadow permit.');
      record.signature=signature(PERMIT_DOMAIN,record,privateKey);
      return Object.freeze(record);
    },
    issueReceipt(permit,fields){
      if(!exactly(fields,RECEIPT_FIELDS))throw Error('Receipt contains missing or unexpected fields.');
      const record={schemaVersion:1,trustLevel:TRUST_LEVEL,keyId,permitDigest:digest(unsigned(permit)),...fields,signature:''};
      if(!receiptShape(record))throw Error('Invalid shadow receipt.');
      record.signature=signature(RECEIPT_DOMAIN,record,privateKey);
      return Object.freeze(record);
    }
  };
}
module.exports={createShadowEvidence,verifyPermit,verifyReceipt,digest};
