import crypto from 'node:crypto';

const VERIFIED_SIGNED_ROLLBACK_CLIENTS=new WeakSet();
const LIFECYCLE_BOUND_SIGNED_ROLLBACK_CLIENTS=new WeakSet();

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
function safeGeneration(value,label='generation'){
  if(!Number.isSafeInteger(value)||value<0) throw new Error(`${label} invalid.`);
  return value;
}
function safeCommitment(value,label='Rollback-anchor commitment'){
  if(value===null || value===undefined) return null;
  const v=String(value).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(v)) throw new Error(`${label} invalid.`);
  return v;
}
function challengeHash(challenge){
  if(!Buffer.isBuffer(challenge) || challenge.length<32) throw new Error('Fresh rollback-anchor challenge required.');
  return crypto.createHash('sha256').update(challenge).digest('hex');
}
function parseTime(value,label){
  const ms=Date.parse(String(value||''));
  if(!Number.isFinite(ms)) throw new Error(`${label} invalid.`);
  return ms;
}
function verifySignature(receipt,publicKey){
  const {signature,...payload}=receipt;
  if(typeof signature!=='string'||!signature) throw new Error('Rollback-anchor receipt signature missing.');
  const ok=crypto.verify(null,Buffer.from(stable(payload)),publicKey,Buffer.from(signature,'base64url'));
  if(!ok) throw new Error('Rollback-anchor receipt signature invalid.');
  return payload;
}
function policyDigest(payload){ return crypto.createHash('sha256').update(stable(payload)).digest('hex'); }
function verifyAuthorityKeyPolicy({policy,trustRootPublicKeys,authorityId,now,maxAgeMs,minimumSequence=0,expectedDigest=null}){
  if(!policy||typeof policy!=='object') throw new Error('Rollback-anchor authority key policy required.');
  const rootEntries=trustRootPublicKeys instanceof Map?[...trustRootPublicKeys.entries()]:Object.entries(trustRootPublicKeys||{});
  if(rootEntries.length===0) throw new Error('Rollback-anchor authority trust roots required.');
  const roots=new Map(rootEntries.map(([k,v])=>[safeId(k,'Rollback-anchor authority trust root ID'),v]));
  const rootKeyId=safeId(policy.rootKeyId,'Rollback-anchor authority trust root ID');
  const rootKey=roots.get(rootKeyId);
  if(!rootKey) throw new Error('Rollback-anchor authority trust root is not trusted.');
  const payload=verifySignature(policy,rootKey);
  if(payload.schemaVersion!==1) throw new Error('Rollback-anchor authority key policy schema unsupported.');
  if(payload.authorityId!==authorityId) throw new Error('Rollback-anchor authority key policy identity mismatch.');
  const sequence=safeGeneration(payload.sequence,'Rollback-anchor authority key policy sequence');
  if(sequence<safeGeneration(minimumSequence,'Minimum rollback-anchor authority key policy sequence')) throw new Error('Rollback-anchor authority key policy sequence is below the required minimum.');
  const issued=parseTime(payload.issuedAt,'Rollback-anchor authority key policy issuedAt');
  const expires=parseTime(payload.expiresAt,'Rollback-anchor authority key policy expiresAt');
  if(expires<=issued || now<issued-5_000 || now>expires || now-issued>maxAgeMs) throw new Error('Rollback-anchor authority key policy is stale or outside its validity window.');
  if(!Array.isArray(payload.keys)||payload.keys.length===0) throw new Error('Rollback-anchor authority key policy has no keys.');
  const entries=new Map();
  for(const raw of payload.keys){
    const keyId=safeId(raw?.keyId,'Rollback-anchor authority key ID');
    if(entries.has(keyId)) throw new Error('Rollback-anchor authority key policy contains duplicate key IDs.');
    const status=String(raw?.status||'');
    if(!['active','retiring','revoked'].includes(status)) throw new Error('Rollback-anchor authority key status invalid.');
    const notBefore=parseTime(raw?.notBefore,'Rollback-anchor authority key notBefore');
    const notAfter=parseTime(raw?.notAfter,'Rollback-anchor authority key notAfter');
    if(notAfter<=notBefore) throw new Error('Rollback-anchor authority key validity window invalid.');
    entries.set(keyId,{keyId,status,notBefore,notAfter});
  }
  const digest=policyDigest(payload);
  if(expectedDigest!==null && String(expectedDigest).toLowerCase()!==digest) throw new Error('Rollback-anchor authority key policy digest mismatch.');
  return {sequence,digest,entries};
}

export function isVerifiedSignedRollbackAnchorClient(value){
  return Boolean(value && VERIFIED_SIGNED_ROLLBACK_CLIENTS.has(value));
}

export function isLifecycleBoundSignedRollbackAnchorClient(value){
  return Boolean(value && LIFECYCLE_BOUND_SIGNED_ROLLBACK_CLIENTS.has(value));
}

export class SignedRollbackAnchorClient {
  constructor({transport,authorityPublicKeys,authorityId,anchorId,maxReceiptAgeMs=30_000,now=()=>Date.now(),randomBytes=crypto.randomBytes,authorityKeyPolicy=null,authorityTrustRootPublicKeys=null,minimumAuthorityPolicySequence=0,expectedAuthorityPolicyDigest=null,maxAuthorityPolicyAgeMs=24*60*60_000}={}){
    if(!transport?.read || !transport?.compareAndAdvance) throw new Error('Rollback-anchor transport required.');
    const entries=authorityPublicKeys instanceof Map?[...authorityPublicKeys.entries()]:Object.entries(authorityPublicKeys||{});
    if(entries.length===0) throw new Error('Rollback-anchor authority keys required.');
    this.keys=new Map(entries.map(([k,v])=>[safeId(k,'Rollback-anchor authority key ID'),v]));
    this.transport=transport;
    this.authorityId=safeId(authorityId,'Rollback-anchor authority ID');
    this.anchorId=safeId(anchorId,'Rollback-anchor ID');
    this.maxReceiptAgeMs=maxReceiptAgeMs;
    this.now=now;
    this.randomBytes=randomBytes;
    this.lastSeenGeneration=null;
    this.authorityKeyPolicy=null;
    if(authorityKeyPolicy!==null){
      this.authorityKeyPolicy=verifyAuthorityKeyPolicy({
        policy:authorityKeyPolicy,
        trustRootPublicKeys:authorityTrustRootPublicKeys,
        authorityId:this.authorityId,
        now:this.now(),
        maxAgeMs:maxAuthorityPolicyAgeMs,
        minimumSequence:minimumAuthorityPolicySequence,
        expectedDigest:expectedAuthorityPolicyDigest
      });
      for(const keyId of this.authorityKeyPolicy.entries.keys()){
        if(!this.keys.has(keyId)) throw new Error('Rollback-anchor authority key policy references unavailable key material.');
      }
      LIFECYCLE_BOUND_SIGNED_ROLLBACK_CLIENTS.add(this);
    }
    VERIFIED_SIGNED_ROLLBACK_CLIENTS.add(this);
  }

  currentState(){
    const challenge=this.randomBytes(32);
    const receipt=this.transport.read({anchorId:this.anchorId,challengeHash:challengeHash(challenge)});
    const payload=this.#verify(receipt,{operation:'read',challenge});
    const g=safeGeneration(payload.generation,'Rollback-anchor generation');
    const commitment=safeCommitment(payload.commitment);
    if(this.lastSeenGeneration!==null && g<this.lastSeenGeneration) throw new Error('Rollback-anchor authority generation regressed.');
    this.lastSeenGeneration=g;
    return {generation:g,commitment};
  }

  current(){ return this.currentState().generation; }

  advanceCommitted(expected,commitment){
    expected=safeGeneration(expected,'Expected rollback-anchor generation');
    commitment=safeCommitment(commitment);
    if(!commitment) throw new Error('Rollback-anchor commitment required.');
    const challenge=this.randomBytes(32);
    const receipt=this.transport.compareAndAdvance({anchorId:this.anchorId,expectedGeneration:expected,commitment,challengeHash:challengeHash(challenge)});
    const payload=this.#verify(receipt,{operation:'advance',challenge});
    if(payload.previousGeneration!==expected) throw new Error('Rollback-anchor receipt previous generation mismatch.');
    const g=safeGeneration(payload.generation,'Rollback-anchor advanced generation');
    if(g!==expected+1) throw new Error('Rollback-anchor authority did not advance exactly once.');
    if(safeCommitment(payload.commitment)!==commitment) throw new Error('Rollback-anchor commitment mismatch.');
    if(this.lastSeenGeneration!==null && expected<this.lastSeenGeneration) throw new Error('Rollback-anchor stale compare-and-advance rejected.');
    this.lastSeenGeneration=g;
    return {generation:g,commitment};
  }

  advance(expected){
    expected=safeGeneration(expected,'Expected rollback-anchor generation');
    const challenge=this.randomBytes(32);
    const receipt=this.transport.compareAndAdvance({anchorId:this.anchorId,expectedGeneration:expected,challengeHash:challengeHash(challenge)});
    const payload=this.#verify(receipt,{operation:'advance',challenge});
    if(payload.previousGeneration!==expected) throw new Error('Rollback-anchor receipt previous generation mismatch.');
    const g=safeGeneration(payload.generation,'Rollback-anchor advanced generation');
    if(g!==expected+1) throw new Error('Rollback-anchor authority did not advance exactly once.');
    if(this.lastSeenGeneration!==null && expected<this.lastSeenGeneration) throw new Error('Rollback-anchor stale compare-and-advance rejected.');
    this.lastSeenGeneration=g;
    return g;
  }

  #verify(receipt,{operation,challenge}){
    if(!receipt||typeof receipt!=='object') throw new Error('Rollback-anchor signed receipt required.');
    const keyId=safeId(receipt.keyId,'Rollback-anchor authority key ID');
    const key=this.keys.get(keyId);
    if(!key) throw new Error('Rollback-anchor authority key is not trusted.');
    if(this.authorityKeyPolicy){
      const policyEntry=this.authorityKeyPolicy.entries.get(keyId);
      if(!policyEntry) throw new Error('Rollback-anchor authority key is absent from the current signed policy.');
      if(!['active','retiring'].includes(policyEntry.status)) throw new Error('Rollback-anchor authority key is revoked by the current signed policy.');
      const now=this.now();
      if(now<policyEntry.notBefore || now>policyEntry.notAfter) throw new Error('Rollback-anchor authority key is outside its signed validity window.');
    }
    const payload=verifySignature(receipt,key);
    if(payload.schemaVersion!==1) throw new Error('Rollback-anchor receipt schema unsupported.');
    if(payload.authorityId!==this.authorityId) throw new Error('Rollback-anchor authority identity mismatch.');
    if(payload.anchorId!==this.anchorId) throw new Error('Rollback-anchor identity mismatch.');
    if(payload.operation!==operation) throw new Error('Rollback-anchor receipt operation mismatch.');
    if(payload.challengeHash!==challengeHash(challenge)) throw new Error('Rollback-anchor receipt is not fresh for this request.');
    const issued=parseTime(payload.issuedAt,'Rollback-anchor receipt issuedAt');
    const expires=parseTime(payload.expiresAt,'Rollback-anchor receipt expiresAt');
    const now=this.now();
    if(expires<=issued || now<issued-5_000 || now>expires || now-issued>this.maxReceiptAgeMs){
      throw new Error('Rollback-anchor receipt is stale or outside its validity window.');
    }
    safeGeneration(payload.generation,'Rollback-anchor receipt generation');
    if(operation==='advance') safeGeneration(payload.previousGeneration,'Rollback-anchor receipt previous generation');
    return payload;
  }
}

export function createSyntheticSignedAuthorityKeyPolicy({authorityId='wfm-security-anchor-authority',rootKeyId='trust-root-1',rootPrivateKey,sequence=1,issuedAtMs=Date.now(),expiresAtMs=issuedAtMs+60*60_000,keys=[]}={}){
  if(!rootPrivateKey) ({privateKey:rootPrivateKey}=crypto.generateKeyPairSync('ed25519'));
  const payload={
    schemaVersion:1,
    authorityId:safeId(authorityId,'Rollback-anchor authority ID'),
    sequence:safeGeneration(sequence,'Rollback-anchor authority key policy sequence'),
    issuedAt:new Date(issuedAtMs).toISOString(),
    expiresAt:new Date(expiresAtMs).toISOString(),
    keys:keys.map(raw=>({
      keyId:safeId(raw?.keyId,'Rollback-anchor authority key ID'),
      status:String(raw?.status||''),
      notBefore:new Date(raw?.notBeforeMs??issuedAtMs).toISOString(),
      notAfter:new Date(raw?.notAfterMs??expiresAtMs).toISOString()
    }))
  };
  const signed={...payload,rootKeyId:safeId(rootKeyId,'Rollback-anchor authority trust root ID')};
  return {...signed,signature:crypto.sign(null,Buffer.from(stable(signed)),rootPrivateKey).toString('base64url')};
}

export function authorityKeyPolicyDigest(policy){
  if(!policy||typeof policy!=='object') throw new Error('Rollback-anchor authority key policy required.');
  const {signature,...payload}=policy;
  return policyDigest(payload);
}

export function createSyntheticSignedRollbackAuthority({authorityId='wfm-security-anchor-authority',anchorId='attendance-source-continuity',keyId='authority-1',privateKey,now=()=>Date.now(),initialGeneration=0}={}){
  let generation=safeGeneration(initialGeneration);
  let commitment=null;
  if(!privateKey) ({privateKey}=crypto.generateKeyPairSync('ed25519'));
  const sign=(payload)=>({...payload,keyId,signature:crypto.sign(null,Buffer.from(stable({...payload,keyId})),privateKey).toString('base64url')});
  const receipt=({operation,challengeHash:ch,previousGeneration=null})=>{
    const issued=now();
    const payload={
      schemaVersion:1,authorityId,anchorId,operation,
      generation,commitment,challengeHash:ch,
      issuedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+15_000).toISOString()
    };
    if(operation==='advance') payload.previousGeneration=previousGeneration;
    return sign(payload);
  };
  return {
    read({anchorId:requested,challengeHash}){
      if(requested!==anchorId) throw new Error('unknown anchor');
      return receipt({operation:'read',challengeHash});
    },
    compareAndAdvance({anchorId:requested,expectedGeneration,commitment:nextCommitment=null,challengeHash}){
      if(requested!==anchorId) throw new Error('unknown anchor');
      if(expectedGeneration!==generation) throw new Error('compare-and-set mismatch');
      const previous=generation; generation+=1; commitment=safeCommitment(nextCommitment);
      return receipt({operation:'advance',challengeHash,previousGeneration:previous});
    },
    forceGenerationForTest(value){generation=safeGeneration(value);},
    generation(){return generation;}
  };
}
