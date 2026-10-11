'use strict';
// Bounded authority bridge from independently verified provider investigations to provider-job lease recovery.
// External provider/tool output may be provenance-attested for audit, but it never selects the action or target.
const {createHash}=require('node:crypto');
const PI=require('./provider-investigation.cjs');

const TOOL_ID='provider-recovery-executor';
const AGENT_SCOPE='integration-recovery';
const ACTIONS=new Set(['integration.retry','integration.replay-idempotent']);
function fail(message,status=400,code='WFM_PROVIDER_RECOVERY_DENIED'){const e=Error(message);e.status=status;e.code=code;throw e;}
function clean(v,max=160){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(canonical(v)).digest('hex');}
function validDigest(v){return typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);}
function admin(actor){return Boolean(actor&&Array.isArray(actor.permissions)&&actor.permissions.includes('company.configure'));}

function createExecutor({db,providerJobs,investigations,authority,now=Date.now}={}){
 if(!db||!providerJobs||typeof providerJobs.detail!=='function'||typeof providerJobs.acquire!=='function')throw Error('Provider recovery requires the provider job store.');
 if(!investigations||typeof investigations.detail!=='function')throw Error('Provider recovery requires provider investigations.');
 if(!authority||typeof authority.issueActionToken!=='function'||typeof authority.consumeActionToken!=='function'||typeof authority.verifyToolOutput!=='function')throw Error('Provider recovery requires deterministic agent-tool authority.');
 db.exec(`CREATE TABLE IF NOT EXISTS provider_recovery_authority_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,investigation_id TEXT NOT NULL,provider_run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,action_type TEXT NOT NULL,target_digest TEXT NOT NULL,verification_digest TEXT NOT NULL,
  provenance_digest TEXT,grant_jti TEXT,executor_id TEXT,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS provider_recovery_authority_scope ON provider_recovery_authority_events(tenant,investigation_id,id);
 CREATE TRIGGER IF NOT EXISTS provider_recovery_authority_no_update BEFORE UPDATE ON provider_recovery_authority_events BEGIN SELECT RAISE(ABORT,'Provider recovery authority events are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS provider_recovery_authority_no_delete BEFORE DELETE ON provider_recovery_authority_events BEGIN SELECT RAISE(ABORT,'Provider recovery authority events are append-only'); END;`);
 const stamp=()=>new Date(Number(now())).toISOString();
 function requireAdmin(actor){if(!admin(actor))fail('Company configuration permission required.',403,'WFM_PROVIDER_RECOVERY_PERMISSION');}
 function event(x,type,detail={}){db.prepare(`INSERT INTO provider_recovery_authority_events(tenant,investigation_id,provider_run_id,event_type,action_type,target_digest,verification_digest,provenance_digest,grant_jti,executor_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(x.tenant,x.investigation.id,x.run.id,type,x.action,x.targetDigest,x.investigation.verificationDigest,x.provenance?.contentDigest||null,x.grantJti||null,x.executorId||null,JSON.stringify(detail),stamp());}
 function current(actor,id){
  requireAdmin(actor);const investigation=investigations.detail(actor,id);
  if(investigation.tenant!==actor.tenant)fail('Provider investigation not found.',404,'WFM_PROVIDER_RECOVERY_SCOPE');
  if(investigation.status!=='ready_for_bounded_executor')fail('Provider investigation is not ready for bounded execution.',409,'WFM_PROVIDER_RECOVERY_NOT_READY');
  const action=clean(investigation.proposedAction,100);if(!ACTIONS.has(action))fail('Provider recovery action is outside the bounded allowlist.',403,'WFM_PROVIDER_RECOVERY_ACTION_DENIED');
  if(!validDigest(investigation.evidenceDigest)||!validDigest(investigation.verificationDigest))fail('Provider recovery evidence is incomplete.',409,'WFM_PROVIDER_RECOVERY_EVIDENCE');
  const safety=investigation.remediation?.safety;if(investigation.remediation?.status!=='approved-for-bounded-executor'||safety?.allowed!==true||safety.type!==action||safety.tenant!==actor.tenant||safety.targetTenant!==actor.tenant||!validDigest(safety.decisionDigest))fail('Matching deterministic safety authority is required.',403,'WFM_PROVIDER_RECOVERY_SAFETY');
  const run=providerJobs.detail(actor,investigation.providerRunId),freshEvidence=PI.safeEvidence(run),freshDigest=PI.evidenceDigest(freshEvidence);
  if(freshDigest!==investigation.evidenceDigest)fail('Provider run evidence changed after independent verification.',409,'WFM_PROVIDER_RECOVERY_STALE_EVIDENCE');
  const d=run.diagnostics||{};
  if(d.authentication?.status==='expired'||d.freshness?.status==='critical_stale')fail('Provider recovery health requires fresh verification before execution.',409,'WFM_PROVIDER_RECOVERY_DEGRADED_HEALTH');
  if(action==='integration.retry'&&!(run.state==='retry'&&d.retryReady===true&&d.resumeFromCheckpoint===true))fail('Provider retry is no longer eligible.',409,'WFM_PROVIDER_RECOVERY_STATE_CHANGED');
  if(action==='integration.replay-idempotent'&&!(run.state==='running'&&d.leaseExpired===true&&d.resumeFromCheckpoint===true))fail('Provider checkpoint replay is no longer eligible.',409,'WFM_PROVIDER_RECOVERY_STATE_CHANGED');
  const targetDigest=digest({v:1,tenant:actor.tenant,investigationId:investigation.id,providerRunId:run.id,action,evidenceDigest:investigation.evidenceDigest,verificationDigest:investigation.verificationDigest,state:run.state,nextRequestDigest:run.nextRequestDigest,updatedAt:run.updatedAt});
  return {tenant:actor.tenant,investigation,run,action,safety,targetDigest};
 }
 function verifyObservation(base,observation){
  if(!observation||typeof observation!=='object')fail('Signed provider/tool observation is required before a recovery permit can be issued.',409,'WFM_PROVIDER_RECOVERY_PROVENANCE_REQUIRED');
  const inputDigest=clean(observation.inputDigest,64),toolId=clean(observation.toolId,120),requestId=clean(observation.requestId,120),sourceType=clean(observation.sourceType||'provider-payload',40);
  const verified=authority.verifyToolOutput({token:observation.token,content:observation.content,sourceType,tenant:base.tenant,agentScope:AGENT_SCOPE,toolId,requestId,inputDigest});
  return {verified:true,trust:verified.trust,usableForReasoning:verified.usableForReasoning,authorityGranted:false,ignoredForAuthority:true,contentDigest:verified.provenance.contentDigest,toolId:verified.provenance.toolId,requestId:verified.provenance.requestId,security:verified.provenance.security};
 }
 function issuePermit(actor,id,{providerObservation,ttlMs=60_000}={}){
  const base=current(actor,id),provenance=verifyObservation(base,providerObservation);
  const issued=authority.issueActionToken({tenant:base.tenant,agentScope:AGENT_SCOPE,toolId:TOOL_ID,actionType:base.action,targetDigest:base.targetDigest,safetyDecision:base.safety,ttlMs});
  event({...base,provenance,grantJti:issued.grant.jti},'permit-issued',{externalObservation:{trust:provenance.trust,usableForReasoning:provenance.usableForReasoning,ignoredForAuthority:true,security:provenance.security},claimBoundary:'External content provenance is retained for audit only; deterministic retained provider-run state plus attested dry-run verification select the action and target.'});
  return {permit:issued.token,grant:{...issued.grant},providerObservation:provenance,target:{investigationId:base.investigation.id,providerRunId:base.run.id,targetDigest:base.targetDigest},claimBoundary:'This permit can only reacquire an already verified retry/replay provider job lease. It cannot change payroll, schedules, permissions, employment, qualifications or production records and it does not itself call the provider.'};
 }
 function preflightPermit(actor,id,{permit,workerId}={}){
  const base=current(actor,id),executorId=clean(workerId,100);if(!executorId)fail('Bounded recovery worker identity is required.',400,'WFM_PROVIDER_RECOVERY_WORKER');
  const {grant}=authority.verifyActionToken({token:permit,tenant:base.tenant,agentScope:AGENT_SCOPE,toolId:TOOL_ID,actionType:base.action,targetDigest:base.targetDigest,decisionDigest:base.safety.decisionDigest});
  const row=db.prepare('SELECT * FROM agent_action_grants WHERE jti=?').get(grant.jti);
  if(!row||row.tenant!==base.tenant)fail('Recovery grant is not registered.',403,'WFM_AGENT_ACTION_NOT_REGISTERED');
  if(row.consumed_at!==null)fail('Recovery grant has already been consumed.',409,'WFM_AGENT_ACTION_REPLAY');
  return {validated:true}; // Read-only admission; executePermit repeats every check before consumption.
 }
 function executePermit(actor,id,{permit,workerId,leaseMs=60_000}={}){
  let base,executorId,consumed;
  try{
   base=current(actor,id);executorId=clean(workerId,100);if(!executorId)fail('Bounded recovery worker identity is required.',400,'WFM_PROVIDER_RECOVERY_WORKER');
   consumed=authority.consumeActionToken({token:permit,tenant:base.tenant,agentScope:AGENT_SCOPE,toolId:TOOL_ID,actionType:base.action,targetDigest:base.targetDigest,decisionDigest:base.safety.decisionDigest,executorId});
  }catch(error){error.recoveryPreDispatchRejected=true;throw error;} // acquire has not been invoked; durable grant state must also confirm non-consumption.

  let run;try{run=providerJobs.acquire(base.run.id,executorId,{leaseMs,beforeAcquire:()=>current(actor,id),onAcquired:acquired=>event({...base,run:acquired,executorId,grantJti:consumed.jti},'bounded-recovery-lease-acquired',{state:acquired.state,leaseOwner:acquired.leaseOwner,leaseExpiresAt:acquired.leaseExpiresAt,leaseGeneration:acquired.leaseGeneration,action:base.action})});}catch(error){event({...base,executorId,grantJti:consumed.jti},'permit-consumed-acquire-failed',{code:clean(error.code||'',80),status:Number(error.status||500),messageDigest:digest(String(error.message||error))});throw error;}
  return {executed:true,action:base.action,investigationId:base.investigation.id,providerRunId:run.id,state:run.state,leaseOwner:run.leaseOwner,leaseExpiresAt:run.leaseExpiresAt,leaseGeneration:run.leaseGeneration,grantJti:consumed.jti,providerNetworkCall:false,businessMutation:false,claimBoundary:'Execution is limited to reacquiring the durable provider job from an independently verified retry/checkpoint-replay state. The normal provider adapter still owns any subsequent network call and normal integration validation/reconciliation.'};
 }
 function status(){return {configured:true,toolId:TOOL_ID,agentScope:AGENT_SCOPE,actions:[...ACTIONS].sort(),requiresSignedExternalObservation:true,requiresAttestedIndependentVerification:true,providerNetworkCall:false,businessMutation:false,claimBoundary:'Bounded executor only reacquires verified provider retry/replay work. Signed external output remains untrusted and cannot select authority.'};}
 function events(actor,id){requireAdmin(actor);const inv=investigations.detail(actor,id);return db.prepare('SELECT event_type,action_type,target_digest,verification_digest,provenance_digest,grant_jti,executor_id,detail_json,created_at FROM provider_recovery_authority_events WHERE tenant=? AND investigation_id=? ORDER BY id').all(actor.tenant,inv.id).map(r=>({type:r.event_type,action:r.action_type,targetDigest:r.target_digest,verificationDigest:r.verification_digest,provenanceDigest:r.provenance_digest||null,grantJti:r.grant_jti||null,executorId:r.executor_id||null,detail:JSON.parse(r.detail_json),createdAt:r.created_at}));}
 return {issuePermit,preflightPermit,executePermit,status,events};
}
module.exports={TOOL_ID,AGENT_SCOPE,ACTIONS,createExecutor,digest};
