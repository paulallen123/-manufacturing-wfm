'use strict';
const {createHash}=require('node:crypto');
const writeContexts=new WeakMap();
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
function clean(v,max=240){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function json(value){return JSON.stringify(value??null);}
function parse(value,fallback=null){try{return value===null||value===undefined?fallback:JSON.parse(value);}catch{return fallback;}}
function digest(value){return createHash('sha256').update(JSON.stringify(value??null)).digest('hex');}
function idFor(tenant,connectorId,runKey){return 'PJ-'+createHash('sha256').update(`${tenant}|${connectorId}|${runKey}`).digest('hex').slice(0,24);}
function iso(ms){return new Date(Number(ms)).toISOString();}
function int(v,name,min,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`${name} is invalid.`);return n;}
function canConfigure(actor){if(!(actor?.permissions||[]).includes('company.configure'))fail('Company configuration permission required.',403);}
function createStore(db,{now=Date.now}={}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS provider_adapter_runs(
  id TEXT PRIMARY KEY,tenant TEXT NOT NULL,connector_id TEXT NOT NULL,provider TEXT NOT NULL,object_type TEXT NOT NULL,
  adapter_name TEXT NOT NULL,provider_version TEXT NOT NULL,fixture_contract TEXT NOT NULL,run_key TEXT NOT NULL,
  start_request_json TEXT NOT NULL,next_request_json TEXT,state TEXT NOT NULL,failures INTEGER NOT NULL DEFAULT 0,max_failures INTEGER NOT NULL,
  pages_completed INTEGER NOT NULL DEFAULT 0,source_records INTEGER NOT NULL DEFAULT 0,staged_records INTEGER NOT NULL DEFAULT 0,
  held_records INTEGER NOT NULL DEFAULT 0,retries INTEGER NOT NULL DEFAULT 0,last_cursor TEXT,last_source_version TEXT,
  last_source_at TEXT,last_ingested_at TEXT,last_http_status INTEGER,last_http_latency_ms INTEGER,token_expires_at INTEGER,freshness_slo_seconds INTEGER,
  failures_streak INTEGER NOT NULL DEFAULT 0,requeue_count INTEGER NOT NULL DEFAULT 0,last_requeue_reason TEXT,last_requeue_actor TEXT,
  lease_owner TEXT,lease_expires_at INTEGER,available_at INTEGER NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
  UNIQUE(tenant,connector_id,run_key));
 CREATE TABLE IF NOT EXISTS provider_adapter_run_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES provider_adapter_runs(id),tenant TEXT NOT NULL,event_type TEXT NOT NULL,
  worker_id TEXT,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS provider_adapter_runs_tenant_state ON provider_adapter_runs(tenant,state,available_at);
 CREATE INDEX IF NOT EXISTS provider_adapter_run_events_run ON provider_adapter_run_events(run_id,id);
 `);
 const cols=new Set(db.prepare('PRAGMA table_info(provider_adapter_runs)').all().map(x=>x.name));
 if(!cols.has('failures_streak')){db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN failures_streak INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE provider_adapter_runs SET failures_streak=failures');}
 if(!cols.has('requeue_count'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN requeue_count INTEGER NOT NULL DEFAULT 0');
 if(!cols.has('last_requeue_reason'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_requeue_reason TEXT');
 if(!cols.has('last_requeue_actor'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_requeue_actor TEXT');
 if(!cols.has('last_source_at'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_source_at TEXT');
 if(!cols.has('last_ingested_at'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_ingested_at TEXT');
 if(!cols.has('last_http_status'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_http_status INTEGER');
 if(!cols.has('last_http_latency_ms'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN last_http_latency_ms INTEGER');
 if(!cols.has('token_expires_at'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN token_expires_at INTEGER');
 if(!cols.has('freshness_slo_seconds'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN freshness_slo_seconds INTEGER');
 if(!cols.has('lease_generation'))db.exec('ALTER TABLE provider_adapter_runs ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0');
 // Persistent SQL boundary: legacy connections cannot bypass the application lease checks.
 // The connection-local permit exists only around an authorised synchronous UPDATE.
 let context=writeContexts.get(db);
 if(!context){
  context={permit:null};writeContexts.set(db,context);
  db.function('vector_provider_write_fence',(id,generation)=>context.permit?.id===id&&context.permit.generation===generation?1:0);
 }
 db.exec(`CREATE TRIGGER IF NOT EXISTS vector_provider_generation_write_guard
 BEFORE UPDATE ON provider_adapter_runs BEGIN
  SELECT CASE WHEN vector_provider_write_fence(OLD.id,OLD.lease_generation)<>1
   THEN RAISE(ABORT,'Provider generation write requires current store authority.') END;
 END;`);
 function guardedUpdate(run,write){
  if(context.permit)fail('Nested provider write authority is denied.',409);
  context.permit={id:run.id,generation:run.lease_generation};
  try{return write();}finally{context.permit=null;}
 }

 const insertEvent=db.prepare('INSERT INTO provider_adapter_run_events(run_id,tenant,event_type,worker_id,detail_json,created_at) VALUES(?,?,?,?,?,?)');
 function event(run,type,worker,detail={}){insertEvent.run(run.id,run.tenant,type,worker||null,json(detail),iso(now()));}
 function ensure(spec){
  const tenant=clean(spec?.tenant,80),connectorId=clean(spec?.connectorId,100),provider=clean(spec?.provider,60),objectType=clean(spec?.objectType,40),adapterName=clean(spec?.adapterName,80),providerVersion=clean(spec?.providerVersion,80),fixtureContract=clean(spec?.fixtureContract,160),runKey=clean(spec?.runKey,160);
  if(!tenant||!connectorId||!provider||!objectType||!adapterName||!providerVersion||!fixtureContract||!runKey)fail('Provider run identity is incomplete.');
  const maxFailures=int(spec.maxFailures??3,'Provider job max failures',1,20),start=structuredClone(spec.startRequest||{}),id=idFor(tenant,connectorId,runKey),at=iso(now());
  const prior=db.prepare('SELECT * FROM provider_adapter_runs WHERE tenant=? AND connector_id=? AND run_key=?').get(tenant,connectorId,runKey);
  const fingerprint=digest({provider,objectType,adapterName,providerVersion,fixtureContract,start,maxFailures});
  if(prior){
   const priorFingerprint=digest({provider:prior.provider,objectType:prior.object_type,adapterName:prior.adapter_name,providerVersion:prior.provider_version,fixtureContract:prior.fixture_contract,start:parse(prior.start_request_json,{}),maxFailures:prior.max_failures});
   if(priorFingerprint!==fingerprint)fail('Provider run key was reused for a different adapter contract.',409);
   return view(prior,true);
  }
  db.prepare(`INSERT INTO provider_adapter_runs(id,tenant,connector_id,provider,object_type,adapter_name,provider_version,fixture_contract,run_key,start_request_json,next_request_json,state,max_failures,available_at,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tenant,connectorId,provider,objectType,adapterName,providerVersion,fixtureContract,runKey,json(start),json(start),'pending',maxFailures,Number(now()),at,at);
  const run=db.prepare('SELECT * FROM provider_adapter_runs WHERE id=?').get(id);event(run,'created',null,{contract:fixtureContract,providerVersion,requestDigest:digest(start)});return view(run,false);
 }
 function raw(id){const run=db.prepare('SELECT * FROM provider_adapter_runs WHERE id=?').get(String(id||''));if(!run)fail('Provider adapter run not found.',404);return run;}
 function acquire(id,workerId,{leaseMs=60_000,beforeAcquire,onAcquired}={}){
  const worker=clean(workerId,100);if(!worker)fail('Provider worker identity is required.');leaseMs=int(leaseMs,'Provider lease duration',1000,900_000);const ts=Number(now());
  db.exec('BEGIN IMMEDIATE');try{
   let run=raw(id),recovering=run.state==='running'&&Number(run.lease_expires_at||0)<=ts;
   const eligible=run.state==='pending'||(run.state==='retry'&&Number(run.available_at)<=ts)||recovering;
   if(!eligible){if(run.state==='running')fail('Provider adapter run is already leased.',409);if(run.state==='retry')fail('Provider adapter run is waiting for its retry window.',409);fail(`Provider adapter run cannot be acquired from ${run.state}.`,409);}
   if(beforeAcquire){if(typeof beforeAcquire!=='function')fail('Invalid provider acquire precondition.',500);const result=beforeAcquire();if(result&&typeof result.then==='function')fail('Provider acquire precondition must be synchronous.',500);}
   const expires=ts+leaseMs,at=iso(ts);guardedUpdate(run,()=>db.prepare("UPDATE provider_adapter_runs SET state='running',lease_owner=?,lease_expires_at=?,lease_generation=lease_generation+1,updated_at=? WHERE id=?").run(worker,expires,at,run.id));run=raw(run.id);event(run,recovering?'lease-recovered':'lease-acquired',worker,{leaseExpiresAt:iso(expires),leaseGeneration:run.lease_generation});const acquired=view(run,false,true);if(onAcquired){if(typeof onAcquired!=='function')fail('Invalid provider acquire audit callback.',500);const result=onAcquired(acquired);if(result&&typeof result.then==='function')fail('Provider acquire audit must be synchronous.',500);}db.exec('COMMIT');return acquired;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function assertLease(run,worker,generation){if(!Number.isSafeInteger(generation)||generation<1||generation!==run.lease_generation)fail('Provider adapter lease generation is missing or stale.',409);if(run.state!=='running'||run.lease_owner!==worker)fail('Provider adapter lease is not held by this worker.',409);if(Number(run.lease_expires_at||0)<=Number(now()))fail('Provider adapter lease expired before the state update.',409);}
 function checkpoint(id,workerId,input={}){
  const worker=clean(workerId,100),run=raw(id);assertLease(run,worker,input.leaseGeneration);const next=input.nextRequest===null?null:structuredClone(input.nextRequest||{}),pages=int(input.pages??1,'Provider checkpoint pages',0,1000),source=int(input.sourceRecords??0,'Provider checkpoint source records',0,1_000_000),staged=int(input.stagedRecords??0,'Provider checkpoint staged records',0,1_000_000),held=int(input.heldRecords??0,'Provider checkpoint held records',0,1_000_000),retries=int(input.retries??0,'Provider checkpoint retries',0,1000),ts=Number(now()),at=iso(ts);
  const parseIso=(value,name)=>{if(value===null||value===undefined||value==='')return null;const ms=Date.parse(String(value));if(!Number.isFinite(ms))fail(`${name} is invalid.`);return {ms,iso:new Date(ms).toISOString()};};
  const sourceAt=parseIso(input.sourceAt,'Provider source timestamp'),ingestedAt=parseIso(input.ingestedAt,'Provider ingestion timestamp')||(sourceAt?{ms:ts,iso:at}:null);if(sourceAt&&ingestedAt&&sourceAt.ms>ingestedAt.ms)fail('Provider source timestamp is after ingestion timestamp.');
  const httpStatus=input.httpStatus===null||input.httpStatus===undefined?null:int(input.httpStatus,'Provider HTTP status',100,599),httpLatencyMs=input.httpLatencyMs===null||input.httpLatencyMs===undefined?null:int(input.httpLatencyMs,'Provider HTTP latency',0,600_000),tokenExpiresAt=input.tokenExpiresAt===null||input.tokenExpiresAt===undefined?null:int(input.tokenExpiresAt,'Provider token expiry',1,9_007_199_254_740_991),freshnessSloSeconds=input.freshnessSloSeconds===null||input.freshnessSloSeconds===undefined?null:int(input.freshnessSloSeconds,'Provider freshness SLO',1,604_800);
  return leaseTransaction(run,worker,input.leaseGeneration,()=>{const changed=guardedUpdate(run,()=>db.prepare(`UPDATE provider_adapter_runs SET next_request_json=?,pages_completed=pages_completed+?,source_records=source_records+?,staged_records=staged_records+?,held_records=held_records+?,retries=retries+?,last_cursor=?,last_source_version=?,last_source_at=COALESCE(?,last_source_at),last_ingested_at=COALESCE(?,last_ingested_at),last_http_status=COALESCE(?,last_http_status),last_http_latency_ms=COALESCE(?,last_http_latency_ms),token_expires_at=COALESCE(?,token_expires_at),freshness_slo_seconds=COALESCE(?,freshness_slo_seconds),updated_at=? WHERE id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?`).run(next===null?null:json(next),pages,source,staged,held,retries,clean(input.cursor,240)||null,clean(input.sourceVersion,120)||null,sourceAt?.iso||null,ingestedAt?.iso||null,httpStatus,httpLatencyMs,tokenExpiresAt,freshnessSloSeconds,at,run.id,worker,input.leaseGeneration,Number(now())));if(changed.changes!==1)fail('Provider adapter lease changed before update.',409);
  const updated=raw(run.id);event(updated,'checkpoint',worker,{nextRequestDigest:next===null?null:digest(next),pages,sourceRecords:source,stagedRecords:staged,heldRecords:held,retries,cursor:updated.last_cursor,sourceVersion:updated.last_source_version,sourceAt:updated.last_source_at||null,ingestedAt:updated.last_ingested_at||null,httpStatus:updated.last_http_status??null,httpLatencyMs:updated.last_http_latency_ms??null,tokenExpiresAt:updated.token_expires_at?iso(updated.token_expires_at):null,freshnessSloSeconds:updated.freshness_slo_seconds??null});return view(updated,false,true);});
 }
 function complete(id,workerId,summary={}){const worker=clean(workerId,100),run=raw(id);assertLease(run,worker,summary.leaseGeneration);return leaseTransaction(run,worker,summary.leaseGeneration,()=>{const at=iso(now());const changed=guardedUpdate(run,()=>db.prepare("UPDATE provider_adapter_runs SET state='completed',next_request_json=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,completed_at=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?").run(at,at,run.id,worker,summary.leaseGeneration,Number(now())));if(changed.changes!==1)fail('Provider adapter lease changed before update.',409);const updated=raw(run.id);event(updated,'completed',worker,{complete:summary.complete!==false,heldRecords:updated.held_records,pagesCompleted:updated.pages_completed,recoveredTerminalCheckpoint:summary.recoveredTerminalCheckpoint===true});return view(updated,false,false);});}
 function failRun(id,workerId,error,{retryDelayMs=0,leaseGeneration}={}){const worker=clean(workerId,100),run=raw(id);assertLease(run,worker,leaseGeneration);return leaseTransaction(run,worker,leaseGeneration,()=>{retryDelayMs=int(retryDelayMs,'Provider retry delay',0,3_600_000);const failures=run.failures+1,streak=Number(run.failures_streak||0)+1,state=streak>=run.max_failures?'dead_letter':'retry',available=Number(now())+retryDelayMs,at=iso(now()),message=clean(error?.message||error||'Provider adapter run failed.',500);const changed=guardedUpdate(run,()=>db.prepare("UPDATE provider_adapter_runs SET state=?,failures=?,failures_streak=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?").run(state,failures,streak,available,message,at,run.id,worker,leaseGeneration,Number(now())));if(changed.changes!==1)fail('Provider adapter lease changed before update.',409);const updated=raw(run.id);event(updated,state==='dead_letter'?'dead-lettered':'retry-scheduled',worker,{failure:failures,failureStreak:streak,maxFailures:run.max_failures,retryAt:state==='retry'?iso(available):null,error:message});return view(updated,false,false);});}
 function leaseTransaction(run,worker,generation,write){
  db.exec('BEGIN IMMEDIATE');try{
   const current=raw(run.id);assertLease(current,worker,generation);
   // A concurrent callback on the same lease must not overwrite a newer checkpoint.
   if(current.updated_at!==run.updated_at||current.pages_completed!==run.pages_completed||current.failures!==run.failures)fail('Provider adapter state changed before update.',409);
   const result=write();db.exec('COMMIT');return result;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 }
 function diagnostics(run,{staleMs=5*60_000}={}){
  const ts=Number(now()),dead=run.state==='dead_letter',retry=run.state==='retry',running=run.state==='running',completed=run.state==='completed';
  const recordDelta=Number(run.source_records||0)-Number(run.staged_records||0)-Number(run.held_records||0),leaseExpired=running&&Number(run.lease_expires_at||0)>0&&Number(run.lease_expires_at)<=ts,retryReady=retry&&Number(run.available_at||0)<=ts,terminalCheckpointPendingFinalization=!completed&&Number(run.pages_completed||0)>0&&run.next_request_json===null,updated=Date.parse(run.updated_at),staleActive=!completed&&Number.isFinite(updated)&&ts-updated>staleMs;
  const reconciliation=recordDelta===0?(completed?(Number(run.held_records||0)>0?'completed_with_holds':'reconciled'):'balanced_so_far'):'count_mismatch';
  const sourceMs=run.last_source_at?Date.parse(run.last_source_at):NaN,ingestedMs=run.last_ingested_at?Date.parse(run.last_ingested_at):NaN,slo=Number(run.freshness_slo_seconds||0),sourceAgeSeconds=Number.isFinite(sourceMs)?Math.max(0,Math.floor((ts-sourceMs)/1000)):null,sourceToIngestMs=Number.isFinite(sourceMs)&&Number.isFinite(ingestedMs)?Math.max(0,ingestedMs-sourceMs):null;
  const freshnessStatus=!Number.isFinite(sourceMs)||!Number.isSafeInteger(slo)||slo<=0?'unknown':sourceAgeSeconds<=slo?'fresh':sourceAgeSeconds<=slo*3?'stale':'critical_stale';
  const tokenExpiry=Number(run.token_expires_at||0),tokenExpiresInSeconds=tokenExpiry>0?Math.floor((tokenExpiry-ts)/1000):null,authStatus=tokenExpiry<=0?'unknown':tokenExpiresInSeconds<=0?'expired':tokenExpiresInSeconds<=86400?'expiring':'valid';
  let severity='informational',recommendedAction='Review the run state before starting a worker.';
  if(recordDelta!==0){severity='action_required';recommendedAction='Source, staged and held record totals do not reconcile. Stop automation and inspect retained page/batch evidence before resuming.';}
  else if(authStatus==='expired'){severity='action_required';recommendedAction='Provider authentication evidence is expired. Renew the authorised credential path before resuming provider work.';}
  else if(dead){severity='action_required';recommendedAction='Review the retained failure and provider evidence, correct the external/configuration cause, then explicitly requeue this run.';}
  else if(leaseExpired&&terminalCheckpointPendingFinalization){severity='action_required';recommendedAction='The worker lease expired after a terminal provider checkpoint. Recover by finalising the durable job without refetching the provider or starting a second import.';}
  else if(leaseExpired){severity='action_required';recommendedAction='The worker lease expired. Recover the run from its retained checkpoint with an authorised worker; do not start a second untracked import.';}
  else if(freshnessStatus==='critical_stale'){severity='action_required';recommendedAction='Provider source data is more than three freshness SLOs old. Treat downstream decisions as stale until the feed and reconciliation are restored.';}
  else if(retry){severity=retryReady?'retry_ready':'retry_pending';recommendedAction=retryReady?'The retry window is open. An authorised worker can resume from the retained checkpoint.':'Wait for the retry window or investigate the retained error if failures continue.';}
  else if(running){severity=staleActive?'review':'running';recommendedAction=staleActive?'This active run has not checkpointed recently. Review worker health before intervening.':'Allow the current lease to finish unless it expires and is recovered.';}
  else if(freshnessStatus==='stale'){severity='review';recommendedAction='Provider source data is outside its freshness SLO. Review connector health, provider backlog and retained checkpoints before relying on the data.';}
  else if(authStatus==='expiring'){severity='review';recommendedAction='Provider authentication expires within 24 hours. Refresh or rotate it through the authorised credential process before continuity is at risk.';}
  else if(completed&&Number(run.held_records||0)>0){severity='review';recommendedAction='The run completed with held source records. Review the held evidence before treating source reconciliation as complete.';}
  else if(completed){severity='healthy';recommendedAction='No recovery action is required.';}
  return {canRequeue:dead,resumeFromCheckpoint:Number(run.pages_completed||0)>0&&Boolean(run.next_request_json),terminalCheckpointPendingFinalization,severity,recommendedAction,reconciliation,recordDelta,leaseExpired,retryReady,staleActive,freshness:{status:freshnessStatus,sloSeconds:slo||null,sourceAgeSeconds,sourceToIngestMs,sourceAt:run.last_source_at||null,ingestedAt:run.last_ingested_at||null},authentication:{status:authStatus,expiresAt:tokenExpiry>0?iso(tokenExpiry):null,expiresInSeconds:tokenExpiresInSeconds},transport:{lastHttpStatus:run.last_http_status??null,lastHttpLatencyMs:run.last_http_latency_ms??null}};
 }
 function view(run,replayed=false,includeRequest=false){return {id:run.id,tenant:run.tenant,connectorId:run.connector_id,provider:run.provider,objectType:run.object_type,adapterName:run.adapter_name,providerVersion:run.provider_version,fixtureContract:run.fixture_contract,runKey:run.run_key,state:run.state,failures:run.failures,failureStreak:Number(run.failures_streak||0),maxFailures:run.max_failures,requeueCount:Number(run.requeue_count||0),lastRequeueReason:run.last_requeue_reason||null,lastRequeueActor:run.last_requeue_actor||null,pagesCompleted:run.pages_completed,sourceRecords:run.source_records,stagedRecords:run.staged_records,heldRecords:run.held_records,retries:run.retries,lastCursor:run.last_cursor,lastSourceVersion:run.last_source_version,lastSourceAt:run.last_source_at||null,lastIngestedAt:run.last_ingested_at||null,lastHttpStatus:run.last_http_status??null,lastHttpLatencyMs:run.last_http_latency_ms??null,tokenExpiresAt:run.token_expires_at?iso(run.token_expires_at):null,freshnessSloSeconds:run.freshness_slo_seconds??null,nextRequestDigest:run.next_request_json?digest(parse(run.next_request_json,{})):null,leaseGeneration:Number(run.lease_generation||0),leaseOwner:run.lease_owner||null,leaseExpiresAt:run.lease_expires_at?iso(run.lease_expires_at):null,availableAt:iso(run.available_at),lastError:run.last_error||null,createdAt:run.created_at,updatedAt:run.updated_at,completedAt:run.completed_at||null,replayed,diagnostics:diagnostics(run),...(includeRequest?{nextRequest:run.next_request_json===null?null:parse(run.next_request_json,{})}:{})};}
 function requeue(actor,id,input={}){canConfigure(actor);db.exec('BEGIN IMMEDIATE');try{const run=raw(id);if(run.tenant!==actor.tenant)fail('Provider adapter run not found.',404);if(run.state!=='dead_letter')fail('Only a dead-letter provider run can be requeued.',409);const reason=clean(input.reason,240);if(reason.length<12)fail('Provide a reviewed requeue reason of at least 12 characters.');if(input.expectedUpdatedAt&&String(input.expectedUpdatedAt)!==String(run.updated_at))fail('Provider run evidence changed. Refresh before requeueing.',409);const at=iso(now()),who=clean(actor?.email||actor?.personId||'company-configurator',120);const changed=guardedUpdate(run,()=>db.prepare("UPDATE provider_adapter_runs SET state='retry',failures_streak=0,requeue_count=requeue_count+1,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_requeue_reason=?,last_requeue_actor=?,updated_at=? WHERE id=? AND tenant=? AND state='dead_letter' AND lease_generation=? AND requeue_count=?").run(Number(now()),reason,who,at,run.id,actor.tenant,run.lease_generation,run.requeue_count));if(changed.changes!==1)fail('Provider recovery state changed before requeue.',409);const updated=raw(run.id);event(updated,'requeued',who,{reason,priorFailures:run.failures,priorFailureStreak:Number(run.failures_streak||0),resumeFromCheckpoint:diagnostics(updated).resumeFromCheckpoint});db.exec('COMMIT');return view(updated,false,false);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
 function report(actor){canConfigure(actor);return db.prepare('SELECT * FROM provider_adapter_runs WHERE tenant=? ORDER BY created_at DESC LIMIT 100').all(actor.tenant).map(r=>view(r));}
 function observability(actor){
  canConfigure(actor);const rows=db.prepare('SELECT * FROM provider_adapter_runs WHERE tenant=? ORDER BY created_at DESC LIMIT 200').all(actor.tenant),runs=rows.map(r=>view(r));
  const byState={},byProvider={},connectionMap=new Map();let actionRequired=0,review=0,reconciliationMismatches=0,heldRecords=0,retryReady=0,expiredLeases=0,staleConnections=0,criticalStaleConnections=0,authExpiring=0,authExpired=0;
  for(const r of runs){byState[r.state]=(byState[r.state]||0)+1;byProvider[r.provider]=(byProvider[r.provider]||0)+1;heldRecords+=Number(r.heldRecords||0);if(r.diagnostics.severity==='action_required')actionRequired++;if(r.diagnostics.severity==='review')review++;if(r.diagnostics.reconciliation==='count_mismatch')reconciliationMismatches++;if(r.diagnostics.retryReady)retryReady++;if(r.diagnostics.leaseExpired)expiredLeases++;const f=r.diagnostics.freshness?.status;if(f==='stale')staleConnections++;if(f==='critical_stale')criticalStaleConnections++;const auth=r.diagnostics.authentication?.status;if(auth==='expiring')authExpiring++;if(auth==='expired')authExpired++;const key=`${r.connectorId}|${r.objectType}`;if(!connectionMap.has(key))connectionMap.set(key,{connectorId:r.connectorId,provider:r.provider,objectType:r.objectType,state:r.state,severity:r.diagnostics.severity,reconciliation:r.diagnostics.reconciliation,freshness:r.diagnostics.freshness,authentication:r.diagnostics.authentication,transport:r.diagnostics.transport,lastActivityAt:r.updatedAt,lastCompletedAt:r.completedAt,failureStreak:r.failureStreak,heldRecords:r.heldRecords});}
  return {totalRuns:runs.length,totalConnections:connectionMap.size,actionRequired,review,retryReady,expiredLeases,reconciliationMismatches,heldRecords,staleConnections,criticalStaleConnections,authExpiring,authExpired,byState,byProvider,connections:[...connectionMap.values()],lastActivityAt:runs[0]?.updatedAt||null,monitoringModel:{signals:['latency','traffic','errors','freshness','reconciliation','authentication-expiry','worker-lease','retry/dead-letter'],telemetryConvention:'OpenTelemetry-compatible naming can be emitted by hosted instrumentation; this local control plane stores deterministic safe evidence only.'},limitations:['Reconciliation health proves only internal run accounting. It does not certify provider completeness, vendor schema compatibility or successful source-to-business acceptance.','Freshness is evaluated only when the adapter supplies a trustworthy provider source timestamp and configured SLO; unknown freshness is never treated as fresh.']};
 }
 function detail(actor,id){canConfigure(actor);const run=raw(id);if(run.tenant!==actor.tenant)fail('Provider adapter run not found.',404);const events=db.prepare('SELECT event_type,worker_id,detail_json,created_at FROM provider_adapter_run_events WHERE run_id=? ORDER BY id').all(run.id).map(e=>({type:e.event_type,workerId:e.worker_id||null,detail:parse(e.detail_json,{}),createdAt:e.created_at}));return {...view(run),events};}
 // Receiving writes and their audit share the lease database's write lock.
 // This accepts only a synchronous trusted receiver; never hold a lock across await.
 function stageTransaction(receiverDb,scope,cfg,write){
  if(receiverDb!==db)fail('Provider staging requires the lease database connection.',409);
  db.exec('BEGIN IMMEDIATE');try{
   const check=()=>{const run=raw(scope.jobId);assertLease(run,clean(scope.workerId,100),scope.leaseGeneration);if(run.tenant!==cfg.tenant||run.connector_id!==cfg.id||run.provider!==cfg.provider||run.object_type!==scope.objectType)fail('Provider staging identity mismatch.',403);return run;};
   check();const result=write();if(result&&typeof result.then==='function')fail('Provider receiving commit must be synchronous.',500);
   const run=check();event(run,'stage-committed',clean(scope.workerId,100),{leaseGeneration:scope.leaseGeneration,batchId:result.id,replayed:Boolean(result.replayed)});
   db.exec('COMMIT');return result;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 }
 return {ensure,acquire,stageTransaction,assertLeaseHeld:(id,worker,generation)=>{assertLease(raw(id),clean(worker,100),generation);return true;},checkpoint,complete,fail:failRun,requeue,report,observability,detail,raw:(id)=>view(raw(id),false,true)};
}
module.exports={createStore,digest};
