'use strict';
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome,digest}=require('./decision-episode.cjs');
const {executeT9AutopilotAction}=require('./t9-autopilot-adapter.cjs');
const PREFIX='/api/operations/autopilot',PERMIT_TTL_MS=15*60*1000;
function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function compact(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v){const n=Date.parse(String(v??''));return Number.isFinite(n)?new Date(n).toISOString():null;}
function cookieToken(req){for(const part of String(req?.headers?.cookie||'').split(';')){const p=part.trim();if(p.startsWith('wfm_session='))return p.slice(12);}return '';}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function writeJson(res,status,body){if(res.headersSent||res.writableEnded)return true;res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));return true;}
async function readJson(req,max=131072){let size=0,chunks=[];for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;}chunks.push(b);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}}
function safePlan(input={}){
 if(compact(input.adapter,80)!=='workforce-lifecycle')throw new Error('Unsupported Autopilot execution adapter.');
 if(input.reversible!==true)throw new Error('Autopilot execution requires a reversible action.');
 const a=input.action&&typeof input.action==='object'&&!Array.isArray(input.action)?input.action:null;if(!a)throw new Error('Autopilot action is required.');
 const kind=compact(a.kind,40).toUpperCase();if(!['OVERTIME_OVERRIDE','AGENCY_ASSIGNMENT'].includes(kind))throw new Error('Autopilot workforce execution is limited to approved overtime or agency assignment actions.');
 if(!compact(a.employeeId,120)||!iso(a.effectiveAt))throw new Error('Autopilot workforce action requires employeeId and effectiveAt.');
 const rb=input.rollback&&typeof input.rollback==='object'&&!Array.isArray(input.rollback)?input.rollback:null;if(!rb||!compact(rb.eventKey,160)||!compact(rb.reason,300))throw new Error('Autopilot execution requires an explicit rollback plan.');
 return {adapter:'workforce-lifecycle',reversible:true,action:{eventKey:compact(a.eventKey,160)||'autopilot-action',kind,employeeId:compact(a.employeeId,120),effectiveAt:iso(a.effectiveAt),payload:a.payload&&typeof a.payload==='object'&&!Array.isArray(a.payload)?JSON.parse(JSON.stringify(a.payload)):{}},rollback:{eventKey:compact(rb.eventKey,160),reason:compact(rb.reason,300)},expectedOutcome:input.expectedOutcome&&typeof input.expectedOutcome==='object'&&!Array.isArray(input.expectedOutcome)?JSON.parse(JSON.stringify(input.expectedOutcome)):null};
}
function promote(shadow){return createDecisionEpisode({tenant:shadow.tenant,site:shadow.site,decisionType:shadow.decisionType,triggerId:shadow.triggerId,triggeredAt:shadow.triggeredAt,contextRevision:shadow.contextRevision,mode:'HUMAN_APPROVAL',sourceEvidence:shadow.sourceEvidence,objective:{...(shadow.objective?.weights||{}),uncertaintyPenalty:shadow.objective?.uncertaintyPenalty},options:shadow.options});}
function createAutopilotExecutionEngine(options={}){
 const dbPath=options.dbPath||process.env.WFM_DB,lifecycle=options.lifecycleAdapter,publish=typeof options.publishEvent==='function'?options.publishEvent:null;if(!dbPath)throw new Error('Autopilot execution engine requires WFM_DB.');
 const db=new DatabaseSync(dbPath);
 db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;"+
 "CREATE TABLE IF NOT EXISTS vector_autopilot_permits(permit_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,episode_id TEXT NOT NULL,selected_episode_json TEXT NOT NULL,plan_json TEXT NOT NULL,actor_ref TEXT NOT NULL,issued_at TEXT NOT NULL,expires_at TEXT NOT NULL);"+
 "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_permit_update BEFORE UPDATE ON vector_autopilot_permits BEGIN SELECT RAISE(ABORT,'Autopilot permits are append only.'); END;"+
 "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_permit_delete BEFORE DELETE ON vector_autopilot_permits BEGIN SELECT RAISE(ABORT,'Autopilot permits are append only.'); END;"+
 "CREATE TABLE IF NOT EXISTS vector_autopilot_execution_events(id INTEGER PRIMARY KEY AUTOINCREMENT,execution_id TEXT NOT NULL,permit_id TEXT NOT NULL,tenant TEXT NOT NULL,state TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);"+
 "CREATE INDEX IF NOT EXISTS vector_autopilot_execution_idx ON vector_autopilot_execution_events(execution_id,id);"+
 "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_execution_update BEFORE UPDATE ON vector_autopilot_execution_events BEGIN SELECT RAISE(ABORT,'Autopilot execution evidence is append only.'); END;"+
 "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_execution_delete BEFORE DELETE ON vector_autopilot_execution_events BEGIN SELECT RAISE(ABORT,'Autopilot execution evidence is append only.'); END;");
 const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
 const ep=db.prepare('SELECT episode_json FROM vector_decision_episodes WHERE tenant=? AND episode_id=?'),permitQ=db.prepare('SELECT * FROM vector_autopilot_permits WHERE tenant=? AND permit_id=?');
 const permitI=db.prepare('INSERT INTO vector_autopilot_permits VALUES(?,?,?,?,?,?,?,?)'),eventI=db.prepare('INSERT INTO vector_autopilot_execution_events(execution_id,permit_id,tenant,state,detail_json,created_at) VALUES(?,?,?,?,?,?)');
 const executionQ=db.prepare('SELECT state,detail_json,created_at FROM vector_autopilot_execution_events WHERE execution_id=? ORDER BY id'),tenantQ=db.prepare('SELECT execution_id,permit_id,state,detail_json,created_at FROM vector_autopilot_execution_events WHERE tenant=? ORDER BY id DESC LIMIT ?');
 function ctx(req){const t=cookieToken(req);return t?auth.get(sha256(t),Date.now())||null:null;}
 function manager(req,res){const c=ctx(req);if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}if(String(c.role).toLowerCase()==='employee'){writeJson(res,403,{error:'Autopilot execution requires an authorised manager or administrator.'});return null;}return c;}
 function log(executionId,permitId,tenant,state,detail={}){eventI.run(executionId,permitId,tenant,state,JSON.stringify(detail),new Date().toISOString());try{publish?.({tenant,topic:'autopilot.execution.updated',audience:'manager',payload:{executionId,state}});}catch{}}
 function last(executionId){const r=executionQ.all(executionId).at(-1);return r?{state:r.state,detail:JSON.parse(r.detail_json),createdAt:r.created_at}:null;}
 function issueHumanPermit({tenant,episodeId,optionId,actorRef,contextRevision,plan,now=Date.now()}){
  const row=ep.get(tenant,episodeId);if(!row)throw Object.assign(new Error('Decision episode not found.'),{statusCode:404});
  const shadow=JSON.parse(row.episode_json);if(shadow.mode!=='SHADOW')throw Object.assign(new Error('Only a Shadow decision may enter this approval route.'),{statusCode:409});
  if(compact(contextRevision,180)!==shadow.contextRevision)throw Object.assign(new Error('Decision context changed. Re-simulate before approval.'),{statusCode:409});
  const selected=selectDecisionOption(promote(shadow),{optionId,selectedAt:new Date(now).toISOString(),actorRef,authorityDecision:'HUMAN_APPROVED'}),safe=safePlan(plan);
  const issuedAt=new Date(now).toISOString(),expiresAt=new Date(now+PERMIT_TTL_MS).toISOString(),payload={tenant,episodeId:selected.episodeId,shadowEpisodeId:episodeId,optionId:selected.selection.optionId,contextRevision:selected.contextRevision,actorRef:compact(actorRef,180),issuedAt,expiresAt,plan:safe},permitId='ap-'+digest(payload).slice(0,40);
  if(!permitQ.get(tenant,permitId))permitI.run(permitId,tenant,selected.episodeId,JSON.stringify(selected),JSON.stringify(safe),payload.actorRef,issuedAt,expiresAt);
  return {permitId,...payload};
 }
 async function executePermit({tenant,permitId,currentContextRevision}){
  const p=permitQ.get(tenant,permitId);if(!p)throw Object.assign(new Error('Autopilot permit not found.'),{statusCode:404});if(Date.parse(p.expires_at)<=Date.now())throw Object.assign(new Error('Autopilot permit expired. Re-approve current evidence.'),{statusCode:409});
  const selected=JSON.parse(p.selected_episode_json);if(compact(currentContextRevision,180)!==selected.contextRevision)throw Object.assign(new Error('Decision context changed. Execution refused.'),{statusCode:409});
  const plan=JSON.parse(p.plan_json),executionId='exec-'+digest({permitId,tenant,contextRevision:selected.contextRevision}).slice(0,40),prior=last(executionId);if(prior&&['VERIFIED','ROLLED_BACK','CONTAINED'].includes(prior.state))return {executionId,idempotent:true,...prior};
  if(!lifecycle?.applyTrustedEvent)throw Object.assign(new Error('Authoritative workforce execution adapter is unavailable.'),{statusCode:503});
  log(executionId,permitId,tenant,'PREPARED',{episodeId:selected.episodeId,optionId:selected.selection.optionId,planDigest:digest(plan),trustContract:'VECTOR_T9_TRUST_SPINE_V1'});
  try{
   const governed=await executeT9AutopilotAction({tenant,permit:p,selected,plan,lifecycle});
   if(governed.state==='VERIFIED'){
    log(executionId,permitId,tenant,'APPLIED',{eventId:governed.eventId,trustReceiptDigest:governed.trustReceiptDigest});
    let outcome=null;if(plan.expectedOutcome?.actual&&Array.isArray(plan.expectedOutcome.evidenceRefs)&&plan.expectedOutcome.evidenceRefs.length)outcome=recordDecisionOutcome(selected,{observedAt:new Date().toISOString(),evidenceRefs:plan.expectedOutcome.evidenceRefs,actual:plan.expectedOutcome.actual,notes:'T9-governed Autopilot outcome supplied after independent lifecycle verification.'});
    log(executionId,permitId,tenant,'VERIFIED',{eventId:governed.eventId,outcomeDigest:outcome?.outcomeDigest||null,trustReceiptDigest:governed.trustReceiptDigest,evidenceLedgerHeadDigest:governed.evidenceLedgerHeadDigest,authorityGrantDigest:governed.authorityGrantDigest});
    return {executionId,idempotent:false,state:'VERIFIED',detail:{eventId:governed.eventId,outcomeDigest:outcome?.outcomeDigest||null,trustReceiptDigest:governed.trustReceiptDigest}};
   }
   if(governed.state==='ROLLED_BACK'){
    log(executionId,permitId,tenant,'VERIFY_FAILED',{error:'T9 independent postcondition verification failed; compensating rollback executed.',failureCode:governed.failureCode||null});
    log(executionId,permitId,tenant,'ROLLED_BACK',{rollbackEventId:governed.rollbackEventId||null,evidenceLedgerHeadDigest:governed.evidenceLedgerHeadDigest,authorityGrantDigest:governed.authorityGrantDigest});
    return {executionId,idempotent:false,state:'ROLLED_BACK',detail:{rollbackEventId:governed.rollbackEventId||null}};
   }
   log(executionId,permitId,tenant,'CONTAINED',{reason:governed.reason||'T9_CONTAINED',failureCode:governed.failureCode||null,appliedEventId:governed.appliedEventId||null,evidenceLedgerHeadDigest:governed.evidenceLedgerHeadDigest||null,authorityGrantDigest:governed.authorityGrantDigest||null});
   return {executionId,idempotent:false,state:'CONTAINED',detail:{reason:governed.reason||'T9_CONTAINED'}};
  }catch(error){
   log(executionId,permitId,tenant,'VERIFY_FAILED',{error:compact(error.message,300),failureCode:compact(error.code||'VECTOR_T9_GUARD_REJECTED',120)});
   log(executionId,permitId,tenant,'CONTAINED',{reason:'T9_GUARD_REJECTED',failureCode:compact(error.code||'VECTOR_T9_GUARD_REJECTED',120)});
   return {executionId,idempotent:false,state:'CONTAINED',detail:{reason:'T9_GUARD_REJECTED',failureCode:compact(error.code||'VECTOR_T9_GUARD_REJECTED',120)}};
  }
 }
 function statusForTenant(tenant,limit=50){return tenantQ.all(tenant,Math.max(1,Math.min(100,Number(limit)||50))).map(r=>({executionId:r.execution_id,permitId:r.permit_id,state:r.state,detail:JSON.parse(r.detail_json),createdAt:r.created_at}));}
 async function handleRequest(req,res){const path=pathOf(req);if(!path.startsWith(PREFIX))return false;try{const c=manager(req,res);if(!c)return true;if(req.method==='GET'&&path===PREFIX+'/status')return writeJson(res,200,{contractVersion:'VECTOR_AUTOPILOT_EXECUTION_V1',tenant:c.tenant,events:statusForTenant(c.tenant)});if(req.method==='POST'&&path===PREFIX+'/permit'){const b=await readJson(req),permit=issueHumanPermit({tenant:c.tenant,episodeId:compact(b.episodeId,180),optionId:compact(b.optionId,120),actorRef:c.email,contextRevision:compact(b.contextRevision,180),plan:b.plan});return writeJson(res,201,{contractVersion:'VECTOR_AUTOPILOT_PERMIT_V1',permit});}if(req.method==='POST'&&path===PREFIX+'/execute'){const b=await readJson(req),result=await executePermit({tenant:c.tenant,permitId:compact(b.permitId,180),currentContextRevision:compact(b.contextRevision,180)});return writeJson(res,result.state==='VERIFIED'?200:409,{contractVersion:'VECTOR_AUTOPILOT_EXECUTION_V1',result});}return writeJson(res,404,{error:'Autopilot execution endpoint not found.'});}catch(error){return writeJson(res,Number(error?.statusCode||500),{error:error?.statusCode?error.message:'Autopilot execution failed safely.'});}}
 return {handleRequest,issueHumanPermit,executePermit,statusForTenant,close(){try{db.close();}catch{}}};
}
module.exports={createAutopilotExecutionEngine,safePlan};
