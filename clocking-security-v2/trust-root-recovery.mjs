import crypto from 'node:crypto';

function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function safeId(value,label){
  const v=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(v)) throw new Error(`${label} invalid.`);
  return v;
}
function safeEpoch(value,label='Recovery epoch'){
  if(!Number.isSafeInteger(value)||value<0) throw new Error(`${label} invalid.`);
  return value;
}
function parseTime(value,label){
  const ms=Date.parse(String(value||''));
  if(!Number.isFinite(ms)) throw new Error(`${label} invalid.`);
  return ms;
}
function sha(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function publicKeyFingerprint(key){
  const publicKey=key?.type==='public'?key:crypto.createPublicKey(key);
  const der=publicKey.export({type:'spki',format:'der'});
  return crypto.createHash('sha256').update(der).digest('hex');
}
function normalizedRootSet(rootPublicKeys){
  const entries=rootPublicKeys instanceof Map?[...rootPublicKeys.entries()]:Object.entries(rootPublicKeys||{});
  if(entries.length===0) throw new Error('Rollback-anchor authority trust roots required.');
  const seen=new Set();
  return entries.map(([id,key])=>{
    const rootKeyId=safeId(id,'Rollback-anchor authority trust root ID');
    if(seen.has(rootKeyId)) throw new Error('Duplicate rollback-anchor authority trust root ID.');
    seen.add(rootKeyId);
    return {rootKeyId,fingerprint:publicKeyFingerprint(key)};
  }).sort((a,b)=>a.rootKeyId.localeCompare(b.rootKeyId));
}
function normalizedRecoveryKeys(recoveryPublicKeys){
  const entries=recoveryPublicKeys instanceof Map?[...recoveryPublicKeys.entries()]:Object.entries(recoveryPublicKeys||{});
  if(entries.length<2) throw new Error('At least two independent recovery custodians are required.');
  const custodians=new Map();
  const fingerprints=new Map();
  for(const [id,key] of entries){
    const custodianId=safeId(id,'Recovery custodian ID');
    if(custodians.has(custodianId)) throw new Error('Duplicate recovery custodian ID.');
    const fingerprint=publicKeyFingerprint(key);
    if(fingerprints.has(fingerprint)) throw new Error('Recovery custodians must use independent public keys.');
    fingerprints.set(fingerprint,custodianId);
    custodians.set(custodianId,key);
  }
  return custodians;
}
function recoveryPayload(packageValue){
  const signatures=Array.isArray(packageValue?.signatures)?packageValue.signatures:null;
  if(!signatures) throw new Error('Trust-root recovery signatures required.');
  const {signatures:_,...payload}=packageValue;
  return payload;
}

export function trustRootSetDigest(rootPublicKeys){ return sha(normalizedRootSet(rootPublicKeys)); }
export function trustRootRecoveryDigest(packageValue){ return sha(recoveryPayload(packageValue)); }

export function createTrustRootRecoveryPackage({
  authorityId='wfm-security-anchor-authority',
  trustDomainId,
  recoveryEpoch,
  previousRootPublicKeys,
  newRootPublicKeys,
  issuedAtMs=Date.now(),
  expiresAtMs=issuedAtMs+15*60_000,
  reason='PLANNED_ROTATION',
  changeId,
  signatures=[]
}={}){
  const allowedReasons=new Set(['PLANNED_ROTATION','ROOT_COMPROMISE','ROOT_LOSS']);
  if(!allowedReasons.has(reason)) throw new Error('Trust-root recovery reason invalid.');
  const payload={
    schemaVersion:1,
    authorityId:safeId(authorityId,'Rollback-anchor authority ID'),
    trustDomainId:safeId(trustDomainId,'Trust-root recovery trust domain ID'),
    recoveryEpoch:safeEpoch(recoveryEpoch),
    previousRootSetDigest:trustRootSetDigest(previousRootPublicKeys),
    newRootSetDigest:trustRootSetDigest(newRootPublicKeys),
    issuedAt:new Date(issuedAtMs).toISOString(),
    expiresAt:new Date(expiresAtMs).toISOString(),
    reason,
    changeId:safeId(changeId,'Trust-root recovery change ID')
  };
  return {...payload,signatures:signatures.map(s=>({custodianId:safeId(s.custodianId,'Recovery custodian ID'),signature:String(s.signature||'')}))};
}

export function signTrustRootRecoveryPackage(packageValue,{custodianId,privateKey}={}){
  if(!privateKey) throw new Error('Recovery custodian private key required.');
  const payload=recoveryPayload(packageValue);
  const signature=crypto.sign(null,Buffer.from(stable(payload)),privateKey).toString('base64url');
  const next=(packageValue.signatures||[]).filter(s=>s.custodianId!==custodianId);
  next.push({custodianId:safeId(custodianId,'Recovery custodian ID'),signature});
  return {...payload,signatures:next};
}

export function verifyTrustRootRecovery({
  packageValue,
  currentRootPublicKeys,
  proposedRootPublicKeys,
  recoveryCustodianPublicKeys,
  requiredApprovals=2,
  minimumRecoveryEpoch=0,
  expectedRecoveryDigest=null,
  expectedAuthorityId='wfm-security-anchor-authority',
  expectedTrustDomainId,
  nowMs=Date.now(),
  maxAgeMs=15*60_000
}={}){
  if(!packageValue||typeof packageValue!=='object') throw new Error('Trust-root recovery package required.');
  if(packageValue.schemaVersion!==1) throw new Error('Trust-root recovery schema unsupported.');
  if(packageValue.authorityId!==safeId(expectedAuthorityId,'Rollback-anchor authority ID')) throw new Error('Trust-root recovery authority identity mismatch.');
  if(packageValue.trustDomainId!==safeId(expectedTrustDomainId,'Expected trust-root recovery trust domain ID')) throw new Error('Trust-root recovery trust domain mismatch.');
  const epoch=safeEpoch(packageValue.recoveryEpoch);
  if(epoch<=safeEpoch(minimumRecoveryEpoch,'Minimum recovery epoch')) throw new Error('Trust-root recovery epoch must advance beyond the accepted epoch.');
  const currentDigest=trustRootSetDigest(currentRootPublicKeys);
  if(packageValue.previousRootSetDigest!==currentDigest) throw new Error('Trust-root recovery previous-root digest mismatch.');
  const proposedDigest=trustRootSetDigest(proposedRootPublicKeys);
  if(packageValue.newRootSetDigest!==proposedDigest) throw new Error('Trust-root recovery proposed-root digest mismatch.');
  if(proposedDigest===currentDigest) throw new Error('Trust-root recovery must change the root set.');
  const issued=parseTime(packageValue.issuedAt,'Trust-root recovery issuedAt');
  const expires=parseTime(packageValue.expiresAt,'Trust-root recovery expiresAt');
  if(expires<=issued || nowMs<issued-5_000 || nowMs>expires || nowMs-issued>maxAgeMs) throw new Error('Trust-root recovery package is stale or outside its validity window.');
  if(!['PLANNED_ROTATION','ROOT_COMPROMISE','ROOT_LOSS'].includes(packageValue.reason)) throw new Error('Trust-root recovery reason invalid.');
  safeId(packageValue.changeId,'Trust-root recovery change ID');

  const payload=recoveryPayload(packageValue);
  const digest=sha(payload);
  if(expectedRecoveryDigest!==null && String(expectedRecoveryDigest).toLowerCase()!==digest) throw new Error('Trust-root recovery package digest mismatch.');

  const custodians=normalizedRecoveryKeys(recoveryCustodianPublicKeys);
  if(!Number.isSafeInteger(requiredApprovals)||requiredApprovals<2||requiredApprovals>custodians.size) throw new Error('Trust-root recovery approval threshold invalid.');
  if(!Array.isArray(packageValue.signatures)) throw new Error('Trust-root recovery signatures required.');
  const approved=new Set();
  for(const entry of packageValue.signatures){
    const custodianId=safeId(entry?.custodianId,'Recovery custodian ID');
    if(approved.has(custodianId)) throw new Error('Duplicate recovery custodian approval.');
    const key=custodians.get(custodianId);
    if(!key) throw new Error('Trust-root recovery approval from untrusted custodian.');
    const signature=String(entry?.signature||'');
    if(!signature) throw new Error('Trust-root recovery signature missing.');
    const ok=crypto.verify(null,Buffer.from(stable(payload)),key,Buffer.from(signature,'base64url'));
    if(!ok) throw new Error('Trust-root recovery signature invalid.');
    approved.add(custodianId);
  }
  if(approved.size<requiredApprovals) throw new Error('Trust-root recovery approval quorum not met.');

  return {
    authorityId:packageValue.authorityId,
    trustDomainId:packageValue.trustDomainId,
    recoveryEpoch:epoch,
    previousRootSetDigest:currentDigest,
    newRootSetDigest:proposedDigest,
    recoveryDigest:digest,
    approvedCustodians:[...approved].sort(),
    rootPublicKeys:new Map(proposedRootPublicKeys instanceof Map?[...proposedRootPublicKeys.entries()]:Object.entries(proposedRootPublicKeys||{}))
  };
}
