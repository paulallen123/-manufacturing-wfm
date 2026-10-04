import {createHmac,randomUUID,timingSafeEqual,createHash} from 'node:crypto';

function fail(message,code='WFM_PROVIDER_HANDOFF_DENIED',status=409){
  const error=new Error(message);error.code=code;error.status=status;throw error;
}
function clean(value,max=160){
  return String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);
}
function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function providerRecoveryDigest(value){
  return createHash('sha256').update(canonical(value)).digest('hex');
}
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const b64=value=>Buffer.from(value).toString('base64url');
const unb64=value=>Buffer.from(value,'base64url').toString();

function assertStore(store){
  const methods=['create','get','consume','appendEvent','events'];
  if(!store||methods.some(method=>typeof store[method]!=='function')) throw new TypeError('provider recovery handoff requires a durable atomic store');
}
function clonePlain(value){
  const json=canonical(value);
  const parsed=JSON.parse(json);
  const walk=v=>{
    if(v&&typeof v==='object'){
      Object.values(v).forEach(walk);
      Object.freeze(v);
    }
    return v;
  };
  return walk(parsed);
}
function exactAction(value){
  const action=clean(value,100);
  if(!['integration.retry','integration.replay-idempotent'].includes(action)) fail('Provider handoff action is outside the recovery allowlist.','WFM_PROVIDER_HANDOFF_ACTION',403);
  return action;
}
function assertDigestFields(fields){
  for(const [name,value] of Object.entries(fields)){
    if(!validDigest(value)) fail(`Provider handoff ${name} is invalid.`,'WFM_PROVIDER_HANDOFF_EVIDENCE');
  }
}
function tokenCodec(secret){
  const sign=payload=>createHmac('sha256',secret).update(payload).digest('base64url');
  const encode=claims=>{
    const payload=b64(canonical(claims));
    return payload+'.'+sign(payload);
  };
  const decode=token=>{
    const parts=String(token||'').split('.');
    if(parts.length!==2) fail('Invalid provider recovery handoff token.','WFM_PROVIDER_HANDOFF_TOKEN');
    const [payload,signature]=parts;
    const expected=sign(payload);
    const a=Buffer.from(signature),b=Buffer.from(expected);
    if(a.length!==b.length||!timingSafeEqual(a,b)) fail('Provider recovery handoff signature is invalid.','WFM_PROVIDER_HANDOFF_SIGNATURE');
    let claims;
    try{claims=JSON.parse(unb64(payload));}catch{fail('Provider recovery handoff payload is invalid.','WFM_PROVIDER_HANDOFF_TOKEN');}
    return claims;
  };
  return {encode,decode};
}

export function createProviderRecoveryHandoffAuthority({
  store,key,now=Date.now,maxTtlMs=120_000
}={}){
  assertStore(store);
  const secret=Buffer.from(String(key||''));
  if(secret.length<32) throw new TypeError('provider recovery handoff key must be at least 32 bytes');
  if(typeof now!=='function') throw new TypeError('now must be a function');
  const maxTtl=Number(maxTtlMs);
  if(!Number.isSafeInteger(maxTtl)||maxTtl<1_000||maxTtl>10*60_000) throw new TypeError('maxTtlMs must be between 1 second and 10 minutes');
  const codec=tokenCodec(secret);
  const stamp=()=>{
    const value=Number(now());
    if(!Number.isSafeInteger(value)||value<0) throw new Error('clock returned invalid time');
    return value;
  };

  async function issueInternal(input){
    const x=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
    const actorType=clean(x.actorType,60);
    if(actorType!=='deterministic-recovery-executor') fail('Only the deterministic recovery executor can create a provider handoff.','WFM_PROVIDER_HANDOFF_ACTOR',403);
    const tenant=clean(x.tenant,100),providerRunId=clean(x.providerRunId,120),workerId=clean(x.workerId,120);
    if(!tenant||!providerRunId||!workerId) fail('Provider handoff scope is incomplete.','WFM_PROVIDER_HANDOFF_SCOPE');
    const actionType=exactAction(x.actionType);
    const safety=x.safetyDecision||{};
    if(safety.allowed!==true||safety.type!==actionType||safety.tenant!==tenant||safety.targetTenant!==tenant||!validDigest(safety.decisionDigest)){
      fail('Matching deterministic safety authority is required.','WFM_PROVIDER_HANDOFF_SAFETY',403);
    }
    assertDigestFields({
      targetDigest:x.targetDigest,
      evidenceDigest:x.evidenceDigest,
      verificationDigest:x.verificationDigest,
      stateDigest:x.stateDigest
    });
    const actionGrantJti=clean(x.actionGrantJti,120);
    if(!actionGrantJti) fail('Consumed action grant identity is required.','WFM_PROVIDER_HANDOFF_GRANT');
    if(!x.nextRequest||typeof x.nextRequest!=='object'||Array.isArray(x.nextRequest)) fail('Internal continuation request is required.','WFM_PROVIDER_HANDOFF_CONTINUATION');
    const continuation=clonePlain(x.nextRequest);
    const continuationDigest=providerRecoveryDigest(continuation);
    const createdAt=stamp();
    const ttl=Math.max(1_000,Math.min(maxTtl,Number(x.ttlMs||60_000)));
    if(!Number.isSafeInteger(ttl)) fail('Provider recovery handoff TTL is invalid.','WFM_PROVIDER_HANDOFF_TTL');
    const expiresAt=createdAt+ttl;
    const id=randomUUID();
    const row=clonePlain({
      id,tenant,providerRunId,workerId,actionType,
      targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,verificationDigest:x.verificationDigest,
      safetyDecisionDigest:safety.decisionDigest,actionGrantJti,
      continuation,continuationDigest,stateDigest:x.stateDigest,
      createdAt,expiresAt,consumedAt:null
    });
    const created=await store.create(row);
    if(created!==true) fail('Provider recovery handoff could not be durably created.','WFM_PROVIDER_HANDOFF_STORE');
    await store.appendEvent(clonePlain({
      handoffId:id,tenant,type:'handoff-issued',createdAt,
      detail:{
        providerRunId,workerId,actionType,targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,
        verificationDigest:x.verificationDigest,safetyDecisionDigest:safety.decisionDigest,
        actionGrantJti,continuationDigest,stateDigest:x.stateDigest,expiresAt
      }
    }));
    const claims={
      v:1,jti:id,tenant,providerRunId,workerId,actionType,
      targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,verificationDigest:x.verificationDigest,
      safetyDecisionDigest:safety.decisionDigest,actionGrantJti,continuationDigest,stateDigest:x.stateDigest,exp:expiresAt
    };
    return clonePlain({
      internalToken:codec.encode(claims),
      publicReceipt:{handoffId:id,providerRunId,action:actionType,status:'ready',expiresAt,continuationDigest}
    });
  }

  async function publicStatus({tenant,handoffId}={}){
    const t=clean(tenant,100),id=clean(handoffId,120);
    const row=await store.get(id);
    if(!row||row.tenant!==t) fail('Provider recovery handoff not found.','WFM_PROVIDER_HANDOFF_NOT_FOUND',404);
    const current=stamp();
    return clonePlain({
      handoffId:row.id,providerRunId:row.providerRunId,action:row.actionType,
      status:row.consumedAt?'consumed':current>row.expiresAt?'expired':'ready',
      expiresAt:row.expiresAt,continuationDigest:row.continuationDigest
    });
  }

  async function consumeInternal({token,tenant,providerRunId,workerId,currentStateDigest}={}){
    const claims=codec.decode(token);
    const current=stamp();
    if(claims.tenant!==tenant||claims.providerRunId!==providerRunId||claims.workerId!==workerId){
      fail('Provider recovery handoff scope changed.','WFM_PROVIDER_HANDOFF_SCOPE',403);
    }
    if(!validDigest(currentStateDigest)||claims.stateDigest!==currentStateDigest) fail('Provider run state changed after handoff issuance.','WFM_PROVIDER_HANDOFF_STALE');
    if(current>Number(claims.exp)) fail('Provider recovery handoff expired.','WFM_PROVIDER_HANDOFF_EXPIRED');
    const row=await store.get(claims.jti);
    if(!row||row.tenant!==tenant||row.providerRunId!==providerRunId||row.workerId!==workerId) fail('Stored provider handoff scope changed.','WFM_PROVIDER_HANDOFF_SCOPE',403);
    if(row.consumedAt) fail('Provider recovery handoff was already consumed.','WFM_PROVIDER_HANDOFF_REPLAY');
    if(current>row.expiresAt) fail('Provider recovery handoff expired.','WFM_PROVIDER_HANDOFF_EXPIRED');
    const bindings={
      actionType:'actionType',targetDigest:'targetDigest',evidenceDigest:'evidenceDigest',
      verificationDigest:'verificationDigest',safetyDecisionDigest:'safetyDecisionDigest',
      actionGrantJti:'actionGrantJti',continuationDigest:'continuationDigest',stateDigest:'stateDigest'
    };
    for(const [rowKey,claimKey] of Object.entries(bindings)){
      if(row[rowKey]!==claims[claimKey]) fail('Provider recovery handoff binding changed.','WFM_PROVIDER_HANDOFF_TAMPER');
    }
    if(providerRecoveryDigest(row.continuation)!==row.continuationDigest) fail('Provider recovery continuation integrity failed.','WFM_PROVIDER_HANDOFF_TAMPER');
    const consumed=await store.consume(row.id,current);
    if(consumed!==true) fail('Provider recovery handoff was already consumed.','WFM_PROVIDER_HANDOFF_REPLAY');
    await store.appendEvent(clonePlain({
      handoffId:row.id,tenant,type:'handoff-consumed',createdAt:current,
      detail:{workerId,providerRunId,stateDigest:currentStateDigest,continuationDigest:row.continuationDigest}
    }));
    return clonePlain({
      providerRunId,workerId,action:row.actionType,
      nextRequest:row.continuation,continuationDigest:row.continuationDigest
    });
  }

  async function events({tenant,handoffId}={}){
    const status=await publicStatus({tenant,handoffId});
    const rows=await store.events(status.handoffId,tenant);
    return clonePlain(rows);
  }

  return Object.freeze({issueInternal,consumeInternal,publicStatus,events});
}
