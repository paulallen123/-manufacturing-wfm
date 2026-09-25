'use strict';

// NON-RUNTIME REFERENCE IMPLEMENTATION.
// This module exists to prove the security contract for the missing provider-recovery
// hand-off before it is applied to canonical WFM source. It is not imported by the
// sealed 0.6.76 application and must never be treated as a production patch.
const {createHmac,randomUUID,timingSafeEqual}=require('node:crypto');

function fail(message,code='WFM_PROVIDER_HANDOFF_DENIED',status=409){const e=Error(message);e.code=code;e.status=status;throw e;}
function clean(v,max=160){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return require('node:crypto').createHash('sha256').update(canonical(v)).digest('hex');}
function b64(v){return Buffer.from(v).toString('base64url');}
function unb64(v){return Buffer.from(v,'base64url').toString();}
function validDigest(v){return typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);}

function createStore(db,{key,now=Date.now,maxTtlMs=120000}={}){
  if(!db)throw Error('Provider recovery handoff requires a database.');
  const secret=Buffer.from(String(key||''));
  if(secret.length<32)throw Error('Provider recovery handoff key must be at least 32 bytes.');
  db.exec(`CREATE TABLE IF NOT EXISTS provider_recovery_handoffs(
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    provider_run_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_digest TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    verification_digest TEXT NOT NULL,
    safety_decision_digest TEXT NOT NULL,
    action_grant_jti TEXT NOT NULL,
    continuation_json TEXT NOT NULL,
    continuation_digest TEXT NOT NULL,
    state_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    UNIQUE(action_grant_jti)
  );
  CREATE INDEX IF NOT EXISTS provider_recovery_handoffs_scope
    ON provider_recovery_handoffs(tenant,provider_run_id,expires_at);
  CREATE TABLE IF NOT EXISTS provider_recovery_handoff_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handoff_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS provider_recovery_handoff_events_no_update BEFORE UPDATE ON provider_recovery_handoff_events BEGIN SELECT RAISE(ABORT,'Handoff events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS provider_recovery_handoff_events_no_delete BEFORE DELETE ON provider_recovery_handoff_events BEGIN SELECT RAISE(ABORT,'Handoff events are append-only'); END;`);

  const stamp=()=>Number(now());
  const sign=payload=>createHmac('sha256',secret).update(payload).digest('base64url');
  function tokenFor(claims){const payload=b64(canonical(claims));return payload+'.'+sign(payload);}
  function verifyToken(token){
    const parts=String(token||'').split('.');if(parts.length!==2)fail('Invalid provider recovery handoff token.','WFM_PROVIDER_HANDOFF_TOKEN');
    const [payload,sig]=parts,expected=sign(payload),a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!timingSafeEqual(a,b))fail('Provider recovery handoff signature is invalid.','WFM_PROVIDER_HANDOFF_SIGNATURE');
    let claims;try{claims=JSON.parse(unb64(payload));}catch{fail('Provider recovery handoff payload is invalid.','WFM_PROVIDER_HANDOFF_TOKEN');}
    return claims;
  }
  function event(row,type,detail={}){db.prepare('INSERT INTO provider_recovery_handoff_events(handoff_id,tenant,event_type,detail_json,created_at) VALUES(?,?,?,?,?)').run(row.id,row.tenant,type,JSON.stringify(detail),stamp());}
  function row(id){const r=db.prepare('SELECT * FROM provider_recovery_handoffs WHERE id=?').get(id);if(!r)fail('Provider recovery handoff not found.','WFM_PROVIDER_HANDOFF_NOT_FOUND',404);return r;}
  function publicStatus({tenant,handoffId}){
    const r=row(handoffId);if(r.tenant!==tenant)fail('Provider recovery handoff not found.','WFM_PROVIDER_HANDOFF_NOT_FOUND',404);
    return {handoffId:r.id,providerRunId:r.provider_run_id,action:r.action_type,status:r.consumed_at?'consumed':stamp()>r.expires_at?'expired':'ready',expiresAt:r.expires_at,continuationDigest:r.continuation_digest};
  }
  function issueInternal(input){
    const x=input&&typeof input==='object'?input:{};
    const tenant=clean(x.tenant,100),providerRunId=clean(x.providerRunId,120),workerId=clean(x.workerId,120),actionType=clean(x.actionType,100),actorType=clean(x.actorType,60);
    if(actorType!=='deterministic-recovery-executor')fail('Only the deterministic recovery executor can create a provider handoff.','WFM_PROVIDER_HANDOFF_ACTOR',403);
    if(!tenant||!providerRunId||!workerId)fail('Provider handoff scope is incomplete.','WFM_PROVIDER_HANDOFF_SCOPE');
    if(!['integration.retry','integration.replay-idempotent'].includes(actionType))fail('Provider handoff action is outside the recovery allowlist.','WFM_PROVIDER_HANDOFF_ACTION',403);
    const safety=x.safetyDecision||{};
    if(safety.allowed!==true||safety.type!==actionType||safety.tenant!==tenant||safety.targetTenant!==tenant||!validDigest(safety.decisionDigest))fail('Matching deterministic safety authority is required.','WFM_PROVIDER_HANDOFF_SAFETY',403);
    for(const [name,value] of Object.entries({targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,verificationDigest:x.verificationDigest,stateDigest:x.stateDigest}))if(!validDigest(value))fail(`Provider handoff ${name} is invalid.`,'WFM_PROVIDER_HANDOFF_EVIDENCE');
    const grantJti=clean(x.actionGrantJti,120);if(!grantJti)fail('Consumed action grant identity is required.','WFM_PROVIDER_HANDOFF_GRANT');
    if(!x.nextRequest||typeof x.nextRequest!=='object'||Array.isArray(x.nextRequest))fail('Internal continuation request is required.','WFM_PROVIDER_HANDOFF_CONTINUATION');
    const continuationJson=canonical(x.nextRequest),continuationDigest=digest(x.nextRequest),createdAt=stamp(),ttl=Math.max(1000,Math.min(maxTtlMs,Number(x.ttlMs||60000))),expiresAt=createdAt+ttl,id=randomUUID();
    db.prepare(`INSERT INTO provider_recovery_handoffs(id,tenant,provider_run_id,worker_id,action_type,target_digest,evidence_digest,verification_digest,safety_decision_digest,action_grant_jti,continuation_json,continuation_digest,state_digest,created_at,expires_at,consumed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(id,tenant,providerRunId,workerId,actionType,x.targetDigest,x.evidenceDigest,x.verificationDigest,safety.decisionDigest,grantJti,continuationJson,continuationDigest,x.stateDigest,createdAt,expiresAt);
    const r=row(id);event(r,'handoff-issued',{providerRunId,workerId,actionType,targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,verificationDigest:x.verificationDigest,safetyDecisionDigest:safety.decisionDigest,actionGrantJti:grantJti,continuationDigest,stateDigest:x.stateDigest,expiresAt});
    const claims={v:1,jti:id,tenant,providerRunId,workerId,actionType,targetDigest:x.targetDigest,evidenceDigest:x.evidenceDigest,verificationDigest:x.verificationDigest,safetyDecisionDigest:safety.decisionDigest,actionGrantJti:grantJti,continuationDigest,stateDigest:x.stateDigest,exp:expiresAt};
    return {internalToken:tokenFor(claims),publicReceipt:{handoffId:id,providerRunId,action:actionType,status:'ready',expiresAt,continuationDigest}};
  }
  function consumeInternal({token,tenant,providerRunId,workerId,currentStateDigest}){
    const c=verifyToken(token),t=stamp();
    if(c.tenant!==tenant||c.providerRunId!==providerRunId||c.workerId!==workerId)fail('Provider recovery handoff scope changed.','WFM_PROVIDER_HANDOFF_SCOPE',403);
    if(!validDigest(currentStateDigest)||c.stateDigest!==currentStateDigest)fail('Provider run state changed after handoff issuance.','WFM_PROVIDER_HANDOFF_STALE');
    if(t>Number(c.exp))fail('Provider recovery handoff expired.','WFM_PROVIDER_HANDOFF_EXPIRED');
    const r=row(c.jti);
    if(r.tenant!==tenant||r.provider_run_id!==providerRunId||r.worker_id!==workerId)fail('Stored provider handoff scope changed.','WFM_PROVIDER_HANDOFF_SCOPE',403);
    if(r.consumed_at)fail('Provider recovery handoff was already consumed.','WFM_PROVIDER_HANDOFF_REPLAY');
    if(t>r.expires_at)fail('Provider recovery handoff expired.','WFM_PROVIDER_HANDOFF_EXPIRED');
    const bindings={action_type:'actionType',target_digest:'targetDigest',evidence_digest:'evidenceDigest',verification_digest:'verificationDigest',safety_decision_digest:'safetyDecisionDigest',action_grant_jti:'actionGrantJti',continuation_digest:'continuationDigest',state_digest:'stateDigest'};
    for(const [column,claim] of Object.entries(bindings))if(r[column]!==c[claim])fail('Provider recovery handoff binding changed.','WFM_PROVIDER_HANDOFF_TAMPER');
    const nextRequest=JSON.parse(r.continuation_json);if(digest(nextRequest)!==r.continuation_digest)fail('Provider recovery continuation integrity failed.','WFM_PROVIDER_HANDOFF_TAMPER');
    db.prepare('UPDATE provider_recovery_handoffs SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(t,r.id);
    event(r,'handoff-consumed',{workerId,providerRunId,stateDigest:currentStateDigest,continuationDigest:r.continuation_digest});
    return {providerRunId,workerId,action:r.action_type,nextRequest,continuationDigest:r.continuation_digest};
  }
  function events({tenant,handoffId}){const r=row(handoffId);if(r.tenant!==tenant)fail('Provider recovery handoff not found.','WFM_PROVIDER_HANDOFF_NOT_FOUND',404);return db.prepare('SELECT event_type,detail_json,created_at FROM provider_recovery_handoff_events WHERE handoff_id=? AND tenant=? ORDER BY id').all(handoffId,tenant).map(x=>({type:x.event_type,detail:JSON.parse(x.detail_json),createdAt:x.created_at}));}
  return {issueInternal,consumeInternal,publicStatus,events};
}

module.exports={createStore,digest,canonical};
