'use strict';
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

function sha(v){return createHash('sha256').update(String(v??'')).digest('hex');}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function tokenOf(req){for(const p of String(req?.headers?.cookie||'').split(';')){const x=p.trim();if(x.startsWith('wfm_session='))return x.slice(12);}return '';}
function family(p){
  if(p.startsWith('/api/operations/autopilot'))return'autopilot';
  if(p.startsWith('/api/operations/intelligence'))return'decision-intelligence';
  if(p.startsWith('/api/workforce/lifecycle'))return'workforce-lifecycle';
  if(p.startsWith('/api/integrations'))return'integration';
  if(p.startsWith('/api/implementation'))return'implementation';
  if(p.startsWith('/api/learning/training'))return'training';
  if(p.startsWith('/api/learning'))return'learning';
  if(p.startsWith('/api/realtime'))return'realtime';
  if(p==='/api/login'||p==='/api/logout'||p.startsWith('/api/staging-access'))return'identity';
  return p.startsWith('/api/')?'other-api':'non-api';
}
function risk(method,f){const m=String(method||'GET').toUpperCase();if(m==='GET'||m==='HEAD')return'LOW';return['autopilot','workforce-lifecycle','implementation','integration','identity'].includes(f)?'HIGH':'MEDIUM';}
function scenarios(f,r){
  const base=['provider-total-outage','stale-or-contradictory-data','restart-mid-action','customer-correction-of-vecta'];
  const map={
    autopilot:['lost-write-acknowledgement','rollback-failure','telemetry-blackout','poisoned-memory-or-prompt'],
    'workforce-lifecycle':['lost-write-acknowledgement','payroll-deadline-with-unresolved-evidence','cross-tenant-injection'],
    integration:['schema-drift','customer-has-no-upstream-system','lost-write-acknowledgement'],
    implementation:['schema-drift','customer-has-no-upstream-system','rollback-failure'],
    training:['model-or-agent-unavailable','poisoned-memory-or-prompt'],
    learning:['model-or-agent-unavailable','poisoned-memory-or-prompt'],
    identity:['identity-provider-outage','cross-tenant-injection','regional-cloud-outage'],
    realtime:['telemetry-blackout','regional-cloud-outage'],
    'decision-intelligence':['model-or-agent-unavailable','customer-correction-of-vecta']
  };
  const out=[...base,...(map[f]||[])];if(r==='HIGH')out.push('dependency-failure-during-consequential-action');return[...new Set(out)];
}
function disabled(){return{observeHttpCompletion(){return{queued:false,reason:'SAFETY_LEVER'};},async drainAllForTests(){},summaryForTests(){return{events:[],findings:[],candidates:[],disabled:true};},registerRemediator(){throw new Error('Guardian disabled.');},close(){}};}

function createT9CustomerGuardian(options={}){
  if(options.enabled===false||process.env.WFM_T9_CUSTOMER_GUARDIAN==='off')return disabled();
  const dbPath=options.dbPath||process.env.WFM_DB;if(!dbPath)throw new Error('T9 Customer Guardian requires WFM_DB.');
  const db=new DatabaseSync(dbPath),q=[],remediators=new Map(),maxQ=Math.max(32,Number(options.maxQueue)||512),threshold=Math.max(250,Number(options.latencyThresholdMs)||2500);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;"+
    "CREATE TABLE IF NOT EXISTS vector_t9_guardian_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,route_family TEXT NOT NULL,method TEXT NOT NULL,live_status INTEGER NOT NULL,duration_ms INTEGER NOT NULL,risk TEXT NOT NULL,scenarios_json TEXT NOT NULL,findings_json TEXT NOT NULL,created_at TEXT NOT NULL);"+
    "CREATE TABLE IF NOT EXISTS vector_t9_guardian_finding_events(id INTEGER PRIMARY KEY AUTOINCREMENT,finding_key TEXT NOT NULL,tenant TEXT NOT NULL,type TEXT NOT NULL,route_family TEXT NOT NULL,state TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);"+
    "CREATE TABLE IF NOT EXISTS vector_t9_guardian_scenario_candidates(candidate_id TEXT PRIMARY KEY,signature TEXT NOT NULL,scenario_json TEXT NOT NULL,created_at TEXT NOT NULL);"+
    "CREATE TRIGGER IF NOT EXISTS no_t9_guardian_event_update BEFORE UPDATE ON vector_t9_guardian_events BEGIN SELECT RAISE(ABORT,'append only'); END;"+
    "CREATE TRIGGER IF NOT EXISTS no_t9_guardian_event_delete BEFORE DELETE ON vector_t9_guardian_events BEGIN SELECT RAISE(ABORT,'append only'); END;"+
    "CREATE TRIGGER IF NOT EXISTS no_t9_guardian_finding_update BEFORE UPDATE ON vector_t9_guardian_finding_events BEGIN SELECT RAISE(ABORT,'append only'); END;"+
    "CREATE TRIGGER IF NOT EXISTS no_t9_guardian_finding_delete BEFORE DELETE ON vector_t9_guardian_finding_events BEGIN SELECT RAISE(ABORT,'append only'); END;");
  const auth=db.prepare('SELECT u.tenant FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const ev=db.prepare('INSERT INTO vector_t9_guardian_events(tenant,route_family,method,live_status,duration_ms,risk,scenarios_json,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const fe=db.prepare('INSERT INTO vector_t9_guardian_finding_events(finding_key,tenant,type,route_family,state,detail_json,created_at) VALUES(?,?,?,?,?,?,?)');
  const cnt=db.prepare("SELECT COUNT(*) n FROM vector_t9_guardian_finding_events WHERE type=? AND route_family=? AND state='DETECTED'");
  const cand=db.prepare('INSERT OR IGNORE INTO vector_t9_guardian_scenario_candidates(candidate_id,signature,scenario_json,created_at) VALUES(?,?,?,?)');
  const allEv=db.prepare('SELECT * FROM vector_t9_guardian_events ORDER BY id'),allFe=db.prepare('SELECT * FROM vector_t9_guardian_finding_events ORDER BY id'),allCa=db.prepare('SELECT * FROM vector_t9_guardian_scenario_candidates ORDER BY candidate_id');

  function registerRemediator(type,s){
    if(!type||!s||s.safe!==true||typeof s.apply!=='function'||typeof s.verify!=='function')throw new Error('Certified safe remediator required.');
    if(!s.actorId||!s.verifierId||s.actorId===s.verifierId)throw new Error('Distinct repair and verifier identities required.');
    remediators.set(String(type),Object.freeze({...s}));
  }
  for(const [k,v] of Object.entries(options.remediators||{}))registerRemediator(k,v);

  function tenant(tokenHash){try{return tokenHash?(auth.get(tokenHash,Date.now())?.tenant||'__platform__'):'__platform__';}catch{return'__platform__';}}
  function findings(o){const a=[];if(o.status>=500)a.push({type:'LIVE_FAILURE_OBSERVED',severity:'HIGH'});if(o.status===429)a.push({type:'CAPACITY_PRESSURE',severity:'MEDIUM'});if(o.ms>threshold&&o.family!=='realtime')a.push({type:'LATENCY_RISK',severity:'MEDIUM'});return a;}
  function state(key,o,f,state,detail={}){fe.run(key,o.tenant,f.type,o.family,state,JSON.stringify(detail),new Date().toISOString());}
  async function repair(key,o,f){
    const r=remediators.get(f.type);if(!r){state(key,o,f,'REPAIR_REQUIRED',{reason:'NO_CERTIFIED_SAFE_REMEDIATOR'});return;}
    const ctx=Object.freeze({tenant:o.tenant,routeFamily:o.family,findingType:f.type,signalDigest:sha(o.family+'|'+f.type+'|'+Math.floor(o.status/100))});
    let applied=null;
    try{state(key,o,f,'REPAIR_STARTED',{actorId:r.actorId});applied=await r.apply(ctx);if(await r.verify(ctx,applied)){state(key,o,f,'AUTO_FIXED_VERIFIED',{actorId:r.actorId,verifierId:r.verifierId});return;}if(typeof r.rollback==='function')try{await r.rollback(ctx,applied);}catch{}state(key,o,f,'REPAIR_FAILED',{reason:'VERIFY_FAILED'});}catch(e){if(applied&&typeof r.rollback==='function')try{await r.rollback(ctx,applied);}catch{}state(key,o,f,'REPAIR_FAILED',{reason:'SAFE_REPAIR_EXCEPTION',errorDigest:sha(e?.message)});}
  }
  async function processObservation(o){
    o.tenant=o.tenant||tenant(o.tokenHash);const ss=scenarios(o.family,o.risk).map(id=>({id,state:'SHADOW_REHEARSAL_ONLY',productionMutation:false,proofClaim:'NONE'})),fs=findings(o);
    ev.run(o.tenant,o.family,o.method,o.status,o.ms,o.risk,JSON.stringify(ss),JSON.stringify(fs),new Date().toISOString());
    for(const f of fs){const key='gf-'+sha(o.tenant+'|'+o.family+'|'+f.type).slice(0,40);state(key,o,f,'DETECTED',{severity:f.severity});const n=Number(cnt.get(f.type,o.family)?.n||0);if(n>=3){const sig=o.family+'|'+f.type;cand.run('scenario-'+sha(sig).slice(0,32),sig,JSON.stringify({status:'PROPOSAL_ONLY',mayGrantAuthority:false,routeFamily:o.family,findingType:f.type,occurrences:n}),new Date().toISOString());}await repair(key,o,f);}
  }
  function observeHttpCompletion({req,statusCode,durationMs}={}){
    const p=pathOf(req);if(!p.startsWith('/api/'))return{queued:false};const f=family(p);if(f==='realtime'&&p.endsWith('/stream'))return{queued:false};
    const o={tokenHash:tokenOf(req)?sha(tokenOf(req)):'',family:f,method:String(req?.method||'GET').toUpperCase(),status:Number(statusCode)||0,ms:Math.round(Number(durationMs)||0)};o.risk=risk(o.method,o.family);
    if(q.length>=maxQ){if(o.risk!=='HIGH'&&o.status<500)return{queued:false,dropped:'LOW_RISK_BACKPRESSURE'};q.shift();}q.push(o);return{queued:true};
  }
  async function drain(){const o=q.shift();if(!o)return false;await processObservation(o);return true;}
  async function drainAllForTests(){while(await drain()){}}
  const timer=setInterval(()=>{drain().catch(()=>{});},Math.max(50,Number(options.tickMs)||250));if(timer.unref)timer.unref();
  return{observeHttpCompletion,drainAllForTests,registerRemediator,summaryForTests(){return{events:allEv.all().map(r=>({...r,scenarios:JSON.parse(r.scenarios_json),findings:JSON.parse(r.findings_json)})),findings:allFe.all().map(r=>({...r,detail:JSON.parse(r.detail_json)})),candidates:allCa.all().map(r=>({...r,scenario:JSON.parse(r.scenario_json)}))};},close(){clearInterval(timer);try{db.close();}catch{}}};
}
module.exports={createT9CustomerGuardian,family,scenarios,risk};
