'use strict';

const {randomUUID,createHash}=require('node:crypto');
const Remediation=require('./autonomous-remediation.cjs');

const WORKER_CLASSES=new Set(['disposable-test-worker','disposable-engineering-worker','staging-verifier']);
const INVESTIGATION_STATES=new Set(['needs_review','awaiting_verification','verification_failed','ready_for_bounded_executor']);

function fail(message,status=400){throw Object.assign(Error(message),{status});}
function clean(v,max=160){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function admin(a){return Boolean(a&&Array.isArray(a.permissions)&&a.permissions.includes('company.configure'));}
function sha(value){return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function evidenceDigest(v){return createHash('sha256').update(canonical(v)).digest('hex');}
function validDigest(v){return typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);}

function safeEvidence(run){
  const d=run.diagnostics||{};
  return {
    schemaVersion:2,
    providerRunId:clean(run.id,100),
    provider:clean(run.provider,80),
    objectType:clean(run.objectType,80),
    adapterName:clean(run.adapterName,120),
    providerVersion:clean(run.providerVersion,80),
    fixtureContract:clean(run.fixtureContract,160),
    state:clean(run.state,40),
    leaseGeneration:Number(run.leaseGeneration||0),
    leaseOwner:run.leaseOwner?clean(run.leaseOwner,100):null,
    leaseExpiresAt:run.leaseExpiresAt||null,
    availableAt:run.availableAt||null,
    pagesCompleted:Number(run.pagesCompleted||0),
    sourceRecords:Number(run.sourceRecords||0),
    stagedRecords:Number(run.stagedRecords||0),
    heldRecords:Number(run.heldRecords||0),
    retries:Number(run.retries||0),
    failures:Number(run.failures||0),
    failureStreak:Number(run.failureStreak||0),
    requeueCount:Number(run.requeueCount||0),
    lastSourceVersion:run.lastSourceVersion?clean(run.lastSourceVersion,120):null,
    nextRequestDigest:validDigest(run.nextRequestDigest)?run.nextRequestDigest:null,
    lastErrorDigest:run.lastError?sha(String(run.lastError)):null,
    updatedAt:clean(run.updatedAt,50),
    completedAt:run.completedAt?clean(run.completedAt,50):null,
    diagnostics:{
      reconciliation:clean(d.reconciliation,60),
      recordDelta:Number(d.recordDelta||0),
      leaseExpired:d.leaseExpired===true,
      retryReady:d.retryReady===true,
      staleActive:d.staleActive===true,
      resumeFromCheckpoint:d.resumeFromCheckpoint===true,
      authentication:{status:clean(d.authentication?.status||'unknown',40),expiresAt:d.authentication?.expiresAt||null},
      freshness:{status:clean(d.freshness?.status||'unknown',40),sloSeconds:d.freshness?.sloSeconds||null,sourceAt:d.freshness?.sourceAt||null,ingestedAt:d.freshness?.ingestedAt||null}
    }
  };
}

function classify(run){
  const d=run.diagnostics||{};
  if(d.authentication?.status==='expired')return {code:'provider-authentication-expired',severity:'high',status:'needs_review',runbook:null,reason:'Provider authentication has expired. Renew the authorised credential and obtain fresh independent verification before recovery.'};
  if(d.freshness?.status==='critical_stale')return {code:'provider-source-critical-stale',severity:'high',status:'needs_review',runbook:null,reason:'Provider source data is critically stale. Restore source continuity and obtain fresh independent verification before recovery.'};
  if(d.reconciliation==='count_mismatch')return {code:'provider-reconciliation-mismatch',severity:'high',status:'needs_review',runbook:null,reason:'Source, staged and held record counts do not reconcile. Automation must remain stopped while retained evidence is reviewed.'};
  if(run.state==='dead_letter')return {code:'provider-dead-letter',severity:'high',status:'needs_review',runbook:null,reason:'The provider run exhausted its bounded failure streak. Corrective cause review is required before any replay.'};
  if(run.state==='completed'&&d.reconciliation==='completed_with_holds')return {code:'provider-held-records',severity:'review',status:'needs_review',runbook:null,reason:'The provider run completed with held source records. Reconciliation is incomplete until those records are reviewed.'};
  if(d.leaseExpired){
    if(d.resumeFromCheckpoint)return {code:'provider-expired-lease',severity:'high',status:'awaiting_verification',runbook:'integration-stuck-replay',reason:'The worker lease expired after at least one committed checkpoint. A disposable worker must prove restart-safe replay before bounded execution can be eligible.'};
    return {code:'provider-expired-lease-no-checkpoint',severity:'high',status:'needs_review',runbook:null,reason:'The worker lease expired before a resumable checkpoint was committed. Automatic replay is not eligible.'};
  }
  if(d.retryReady){
    if(d.resumeFromCheckpoint)return {code:'provider-retry-ready',severity:'review',status:'awaiting_verification',runbook:'integration-transient',reason:'The retry window is open and a committed checkpoint exists. Independent dry-run proof is required before any bounded executor can be eligible.'};
    return {code:'provider-retry-no-checkpoint',severity:'review',status:'needs_review',runbook:null,reason:'The retry window is open but no resumable checkpoint exists. Review is required before restarting from the beginning.'};
  }
  if(d.staleActive)return {code:'provider-stale-active',severity:'review',status:'needs_review',runbook:null,reason:'The run has not checkpointed recently but its lease has not expired. Worker health evidence is required before intervention.'};
  return null;
}

function createStore(db,{providerJobs,support=null,verificationWorkers=null,now=Date.now}={}){
  let boundedExecutor=null;
  if(!providerJobs||typeof providerJobs.report!=='function'||typeof providerJobs.detail!=='function')throw Error('Provider investigation requires the provider job store.');
  db.exec(`CREATE TABLE IF NOT EXISTS provider_investigations(
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL REFERENCES tenants(id),
    provider_run_id TEXT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    runbook TEXT,
    proposed_action TEXT,
    evidence_digest TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    remediation_json TEXT,
    verification_digest TEXT,
    verification_worker_class TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant,provider_run_id,evidence_digest));
    CREATE INDEX IF NOT EXISTS provider_investigations_scope ON provider_investigations(tenant,updated_at);
    CREATE TABLE IF NOT EXISTS provider_investigation_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id TEXT NOT NULL REFERENCES provider_investigations(id),
      tenant TEXT NOT NULL REFERENCES tenants(id),
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS provider_investigation_events_no_update BEFORE UPDATE ON provider_investigation_events BEGIN SELECT RAISE(ABORT,'Provider investigation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS provider_investigation_events_no_delete BEFORE DELETE ON provider_investigation_events BEGIN SELECT RAISE(ABORT,'Provider investigation events are append-only'); END;`);
  const stamp=()=>new Date(Number(now())).toISOString();
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}};
  function requireAdmin(actor){if(!admin(actor))fail('Company configuration permission required.',403);}
  function raw(id){const row=db.prepare('SELECT * FROM provider_investigations WHERE id=?').get(id);if(!row)fail('Provider investigation not found.',404);return row;}
  function event(row,type,actor,detail={}){db.prepare('INSERT INTO provider_investigation_events(investigation_id,tenant,event_type,actor,detail_json,created_at) VALUES(?,?,?,?,?,?)').run(row.id,row.tenant,type,clean(actor,120)||'system:provider-investigator',JSON.stringify(detail),stamp());}
  function parseRow(row){
    const evidence=JSON.parse(row.evidence_json),remediation=row.remediation_json?JSON.parse(row.remediation_json):null;
    return {id:row.id,tenant:row.tenant,providerRunId:row.provider_run_id,code:row.code,severity:row.severity,status:row.status,runbook:row.runbook||null,proposedAction:row.proposed_action||null,evidenceDigest:row.evidence_digest,evidence,remediation,verificationDigest:row.verification_digest||null,verificationWorkerClass:row.verification_worker_class||null,verifiedAt:row.verified_at||null,createdAt:row.created_at,updatedAt:row.updated_at,executor:boundedExecutor?{connected:true,...boundedExecutor.status()}:{connected:false,status:'not-connected',notice:'No bounded provider-recovery executor is configured. An eligible plan is evidence only and cannot mutate provider or workforce state.'}};
  }
  function createFromRun(actor,run){
    const c=classify(run);if(!c)return {created:false,reused:false,investigation:null};
    const evidence=safeEvidence(run),digest=evidenceDigest(evidence),old=db.prepare('SELECT * FROM provider_investigations WHERE tenant=? AND provider_run_id=? AND evidence_digest=?').get(actor.tenant,run.id,digest);
    if(old)return {created:false,reused:true,investigation:parseRow(old),systemFinding:systemFinding(old)};
    const remediation=c.runbook?Remediation.plan({tenant:actor.tenant,runbook:c.runbook,evidenceDigest:digest,dryRunVerified:false,confidence:1}):null;
    const id=randomUUID(),at=stamp(),proposedAction=remediation?.action||null;
    db.prepare('INSERT INTO provider_investigations(id,tenant,provider_run_id,code,severity,status,runbook,proposed_action,evidence_digest,evidence_json,remediation_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,actor.tenant,run.id,c.code,c.severity,c.status,c.runbook,proposedAction,digest,JSON.stringify(evidence),remediation?JSON.stringify(remediation):null,at,at);
    const row=raw(id);event(row,'investigation-opened','system:provider-investigator',{code:c.code,severity:c.severity,status:c.status,reason:c.reason,evidenceDigest:digest,runbook:c.runbook});
    return {created:true,reused:false,investigation:parseRow(row),systemFinding:systemFinding(row)};
  }
  function systemFinding(row){const evidence=JSON.parse(row.evidence_json);return {tenant:row.tenant,area:'integrations',code:row.code,severity:row.severity,evidence:{source:'provider-investigation',investigationId:row.id,providerRunId:row.provider_run_id,provider:evidence.provider,objectType:evidence.objectType,state:evidence.state,reconciliation:evidence.diagnostics.reconciliation,evidenceDigest:row.evidence_digest,verification:'deterministic-observation'},fingerprintKey:row.provider_run_id};}
  function attachReady(actor,row){if(!verificationWorkers||!row.runbook||!['awaiting_verification','verification_failed'].includes(row.status))return null;const proof=verificationWorkers.passedFor(actor,{investigationId:row.id,evidenceDigest:row.evidence_digest,requireAttested:true});if(!proof)return null;const current=providerJobs.detail(actor,row.provider_run_id),currentEvidence=safeEvidence(current),currentDigest=evidenceDigest(currentEvidence);if(currentDigest!==row.evidence_digest)return null;const remediation=Remediation.plan({tenant:actor.tenant,runbook:row.runbook,evidenceDigest:row.evidence_digest,verificationDigest:proof.proofDigest,dryRunVerified:true,confidence:1});const status=remediation.status==='approved-for-bounded-executor'?'ready_for_bounded_executor':'verification_failed',at=stamp();db.prepare('UPDATE provider_investigations SET status=?,remediation_json=?,verification_digest=?,verification_worker_class=?,verified_at=?,updated_at=? WHERE id=?').run(status,JSON.stringify(remediation),proof.proofDigest,proof.workerClass,at,at,row.id);const updated=raw(row.id);event(updated,status==='ready_for_bounded_executor'?'attested-independent-verification-attached':'attested-independent-verification-rejected','system:verification-orchestrator',{verificationJobId:proof.jobId,workerClass:proof.workerClass,proofDigest:proof.proofDigest,sourceContentSha256:proof.sourceContentSha256,artifactManifestSha256:proof.artifactManifestSha256,attested:proof.attested===true,attestation:proof.attestation?{keyId:proof.attestation.keyId,statementDigest:proof.attestation.statementDigest,issuer:proof.attestation.issuer,subject:proof.attestation.subject,builderId:proof.attestation.builderId,repository:proof.attestation.repository,workflowRef:proof.attestation.workflowRef}:null,remediationStatus:remediation.status});return parseRow(updated);}
  function attachReadyForTenant(actor){if(!verificationWorkers)return 0;let attached=0;for(const row of db.prepare("SELECT * FROM provider_investigations WHERE tenant=? AND status IN ('awaiting_verification','verification_failed') AND runbook IS NOT NULL").all(actor.tenant)){if(attachReady(actor,row))attached++;}return attached;}
  function scanTenant(actor){requireAdmin(actor);let created=0,reused=0,ignored=0;for(const run of providerJobs.report(actor)){const out=tx(()=>createFromRun(actor,run));if(out.created)created++;else if(out.reused)reused++;else ignored++;if(out.systemFinding&&support&&typeof support.recordSystemFinding==='function')support.recordSystemFinding(out.systemFinding);}const verified=attachReadyForTenant(actor);if(support?.reconcileProviderRecovery)support.reconcileProviderRecovery(actor);return {created,reused,ignored,verified,total:created+reused};}
  function scanAll(){let created=0,reused=0,ignored=0;for(const {id:tenant} of db.prepare('SELECT id FROM tenants').all()){const actor={tenant,email:'system:provider-investigator',permissions:['company.configure']},r=scanTenant(actor);created+=r.created;reused+=r.reused;ignored+=r.ignored;}return {created,reused,ignored,total:created+reused};}
  function report(actor){requireAdmin(actor);const rows=db.prepare('SELECT * FROM provider_investigations WHERE tenant=? ORDER BY updated_at DESC,id DESC LIMIT 100').all(actor.tenant).map(parseRow),byStatus={},byCode={};for(const r of rows){byStatus[r.status]=(byStatus[r.status]||0)+1;byCode[r.code]=(byCode[r.code]||0)+1;}return {investigations:rows,summary:{total:rows.length,needsReview:Number(byStatus.needs_review||0),awaitingVerification:Number(byStatus.awaiting_verification||0),verificationFailed:Number(byStatus.verification_failed||0),readyForBoundedExecutor:Number(byStatus.ready_for_bounded_executor||0),byCode,executorConnected:Boolean(boundedExecutor)},limitations:['Investigation evidence is derived from retained provider-run state and internal reconciliation. It is not provider certification or proof that an external system is complete.',boundedExecutor?'A configured bounded executor can only reacquire an independently verified retry/checkpoint-replay provider job under deterministic one-shot authority; it does not itself call the provider or mutate workforce business records.':'No repair executor is connected. Ready-for-bounded-executor requires cryptographically verified remote provenance plus the existing verification checks; it still means no action has run.']};}
  function detail(actor,id){requireAdmin(actor);const row=raw(id);if(row.tenant!==actor.tenant)fail('Provider investigation not found.',404);const events=db.prepare('SELECT event_type,actor,detail_json,created_at FROM provider_investigation_events WHERE investigation_id=? ORDER BY id').all(id).map(x=>({type:x.event_type,actor:x.actor,detail:JSON.parse(x.detail_json),createdAt:x.created_at}));return {...parseRow(row),events};}
  function requestVerification(actor,id,input={}){requireAdmin(actor);if(!verificationWorkers)fail('Independent verification worker is not configured.',503);const row=raw(id);if(row.tenant!==actor.tenant)fail('Provider investigation not found.',404);return verificationWorkers.request(actor,parseRow(row),input);}
  function verificationJobs(actor){requireAdmin(actor);return verificationWorkers?verificationWorkers.report(actor):[];}
  function verificationJobDetail(actor,id){requireAdmin(actor);if(!verificationWorkers)fail('Independent verification worker is not configured.',503);return verificationWorkers.detail(actor,id);}
  function connectBoundedExecutor(executor){if(!executor||typeof executor.status!=='function'||typeof executor.issuePermit!=='function'||typeof executor.executePermit!=='function')fail('Bounded provider recovery executor is invalid.',500);boundedExecutor=executor;return executor.status();}
  function issueRecoveryPermit(actor,id,input){requireAdmin(actor);if(!boundedExecutor)fail('Bounded provider recovery executor is not configured.',503);return boundedExecutor.issuePermit(actor,id,input);}
  function executeRecoveryPermit(actor,id,input){requireAdmin(actor);if(!boundedExecutor)fail('Bounded provider recovery executor is not configured.',503);const execute=()=>boundedExecutor.executePermit(actor,id,input);return support?.executeProviderRecovery?support.executeProviderRecovery(actor,id,input,execute,typeof boundedExecutor.preflightPermit==='function'?()=>boundedExecutor.preflightPermit(actor,id,input):null):execute();}
  function recoveryEvents(actor,id){requireAdmin(actor);if(!boundedExecutor)fail('Bounded provider recovery executor is not configured.',503);return boundedExecutor.events(actor,id);}
  if(support?.connectProviderRecovery)support.connectProviderRecovery({detail,events:recoveryEvents,runDetail:(actor,id)=>providerJobs.detail(actor,id),status:()=>boundedExecutor?boundedExecutor.status():{configured:false}});
  return {scanTenant,scanAll,report,detail,requestVerification,verificationJobs,verificationJobDetail,attachReadyForTenant,connectBoundedExecutor,issueRecoveryPermit,executeRecoveryPermit,recoveryEvents,classify,safeEvidence,evidenceDigest};
}

module.exports={WORKER_CLASSES,INVESTIGATION_STATES,safeEvidence,classify,evidenceDigest,createStore};
