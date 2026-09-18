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
function safeGeneration(value,label='generation'){
  if(!Number.isSafeInteger(value)||value<0) throw new Error(`${label} invalid.`);
  return value;
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

export class SignedRollbackAnchorClient {
  constructor({transport,authorityPublicKeys,authorityId,anchorId,maxReceiptAgeMs=30_000,now=()=>Date.now(),randomBytes=crypto.randomBytes}={}){
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
  }

  current(){
    const challenge=this.randomBytes(32);
    const receipt=this.transport.read({anchorId:this.anchorId,challengeHash:challengeHash(challenge)});
    const payload=this.#verify(receipt,{operation:'read',challenge});
    const g=safeGeneration(payload.generation,'Rollback-anchor generation');
    if(this.lastSeenGeneration!==null && g<this.lastSeenGeneration) throw new Error('Rollback-anchor authority generation regressed.');
    this.lastSeenGeneration=g;
    return g;
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

export function createSyntheticSignedRollbackAuthority({authorityId='wfm-security-anchor-authority',anchorId='attendance-source-continuity',keyId='authority-1',privateKey,now=()=>Date.now(),initialGeneration=0}={}){
  let generation=safeGeneration(initialGeneration);
  if(!privateKey) ({privateKey}=crypto.generateKeyPairSync('ed25519'));
  const sign=(payload)=>({...payload,keyId,signature:crypto.sign(null,Buffer.from(stable({...payload,keyId})),privateKey).toString('base64url')});
  const receipt=({operation,challengeHash:ch,previousGeneration=null})=>{
    const issued=now();
    const payload={
      schemaVersion:1,authorityId,anchorId,operation,
      generation,challengeHash:ch,
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
    compareAndAdvance({anchorId:requested,expectedGeneration,challengeHash}){
      if(requested!==anchorId) throw new Error('unknown anchor');
      if(expectedGeneration!==generation) throw new Error('compare-and-set mismatch');
      const previous=generation; generation+=1;
      return receipt({operation:'advance',challengeHash,previousGeneration:previous});
    },
    forceGenerationForTest(value){generation=safeGeneration(value);},
    generation(){return generation;}
  };
}
