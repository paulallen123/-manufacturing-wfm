'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/workforce/lifecycle';
const INTERNAL_HEADER = 'x-wfm-integration-internal';
const EVENT_KINDS = Object.freeze([
  'STARTER','TRANSFER','LEAVER','AGENCY_ASSIGNMENT','ABSENCE','CLOCK',
  'OVERTIME_OVERRIDE','RETRO_CHANGE','INTEGRATION_OUTAGE','INTEGRATION_RECOVERY'
]);

function nowIso(){ return new Date().toISOString(); }
function sha256(v){ return createHash('sha256').update(String(v)).digest('hex'); }
function compact(v,max=240){ return String(v??'').trim().slice(0,max); }
function toMs(v){ const n=Date.parse(v); return Number.isFinite(n)?n:null; }
function secureEqual(a,b){
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length>0 && x.length===y.length && timingSafeEqual(x,y);
}
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const p=part.trim(); if(p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req,max=128*1024){
  let size=0; const chunks=[];
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=b.length;
    if(size>max){ const e=new Error('Request body too large.'); e.statusCode=413; throw e; }
    chunks.push(b);
  }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}
function eventPath(req){return String(req?.url||'/').split('?')[0]||'/';}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function assertMatchingReplay(row,event){
  const payload=event.payload&&typeof event.payload==='object'?JSON.parse(JSON.stringify(event.payload)):{};
  const submitted={kind:compact(event.kind,40).toUpperCase(),employeeId:compact(event.employeeId,120)||null,sourceKey:compact(event.sourceKey,120)||null,effectiveAtMs:toMs(event.effectiveAt),payload};
  const stored={kind:row.kind,employeeId:row.employee_id||null,sourceKey:row.source_key||null,effectiveAtMs:Number(row.effective_at_ms),payload:JSON.parse(row.payload_json)};
  if(canonical(submitted)!==canonical(stored))throw Object.assign(new Error('Event key was already used for different lifecycle content.'),{statusCode:409});
}
function publicEvent(row){
  return {
    id:row.id,eventKey:row.event_key,kind:row.kind,status:row.status,
    employeeId:row.employee_id||null,sourceKey:row.source_key||null,
    effectiveAt:new Date(row.effective_at_ms).toISOString(),
    reasonCode:row.reason_code||null,createdAt:row.created_at
  };
}

function evaluateEvent(prior,event){
  const kind=compact(event.kind,40).toUpperCase();
  if(!EVENT_KINDS.includes(kind)) return {status:'REJECTED',reasonCode:'UNKNOWN_EVENT_KIND'};
  const effectiveAtMs=toMs(event.effectiveAt);
  if(effectiveAtMs===null) return {status:'REJECTED',reasonCode:'INVALID_EFFECTIVE_AT'};
  const employeeId=compact(event.employeeId,120);
  const payload=event.payload&&typeof event.payload==='object'&&!Array.isArray(event.payload)?event.payload:{};
  const accepted=prior.filter(x=>x.status==='ACCEPTED');
  const employeeEvents=employeeId?accepted.filter(x=>x.employeeId===employeeId):[];
  const starters=employeeEvents.filter(x=>x.kind==='STARTER').sort((a,b)=>a.effectiveAtMs-b.effectiveAtMs);
  const leavers=employeeEvents.filter(x=>x.kind==='LEAVER').sort((a,b)=>a.effectiveAtMs-b.effectiveAtMs);
  const latestStart=[...starters].reverse().find(x=>x.effectiveAtMs<=effectiveAtMs);
  const firstEnd=leavers.find(x=>x.effectiveAtMs>=Number(latestStart?.effectiveAtMs||0));
  const activeAt=Boolean(latestStart && (!firstEnd || effectiveAtMs<=firstEnd.effectiveAtMs));

  if(kind==='INTEGRATION_OUTAGE'||kind==='INTEGRATION_RECOVERY'){
    const sourceKey=compact(event.sourceKey,120);
    if(!sourceKey) return {status:'REJECTED',reasonCode:'SOURCE_REQUIRED'};
    const sourceEvents=accepted.filter(x=>x.sourceKey===sourceKey);
    const lastOutage=[...sourceEvents].reverse().find(x=>x.kind==='INTEGRATION_OUTAGE');
    const lastRecovery=[...sourceEvents].reverse().find(x=>x.kind==='INTEGRATION_RECOVERY');
    if(kind==='INTEGRATION_RECOVERY'){
      if(!lastOutage || (lastRecovery&&lastRecovery.effectiveAtMs>=lastOutage.effectiveAtMs))
        return {status:'REJECTED',reasonCode:'NO_OPEN_OUTAGE'};
      if(!compact(payload.checkpoint,200)) return {status:'REJECTED',reasonCode:'RECOVERY_CHECKPOINT_REQUIRED'};
    }
    return {status:'ACCEPTED',reasonCode:kind==='INTEGRATION_OUTAGE'?'SOURCE_DEGRADED_FAIL_CLOSED':'SOURCE_RECOVERY_CHECKPOINTED',
      sourceKey,payrollMutation:false,sourceDataDeleted:false};
  }

  if(!employeeId) return {status:'REJECTED',reasonCode:'EMPLOYEE_REQUIRED'};

  if(kind==='STARTER'){
    if(!compact(payload.location,120)||!compact(payload.department,120))
      return {status:'REJECTED',reasonCode:'STARTER_STRUCTURE_REQUIRED'};
    if(starters.some(x=>!leavers.some(l=>l.effectiveAtMs>=x.effectiveAtMs&&l.effectiveAtMs<effectiveAtMs)))
      return {status:'REJECTED',reasonCode:'EMPLOYMENT_ALREADY_ACTIVE'};
    return {status:'ACCEPTED',reasonCode:'STARTER_VALIDATED',payrollMutation:false};
  }

  if(kind==='TRANSFER'){
    if(!activeAt) return {status:'REJECTED',reasonCode:'TRANSFER_OUTSIDE_EMPLOYMENT'};
    if(!compact(payload.location,120)&&!compact(payload.department,120))
      return {status:'REJECTED',reasonCode:'TRANSFER_DESTINATION_REQUIRED'};
    return {status:'ACCEPTED',reasonCode:'EFFECTIVE_DATED_TRANSFER',payrollMutation:false};
  }

  if(kind==='LEAVER'){
    if(!activeAt) return {status:'REJECTED',reasonCode:'LEAVER_OUTSIDE_EMPLOYMENT'};
    return {status:'ACCEPTED',reasonCode:'LEAVER_VALIDATED',payrollMutation:false};
  }

  if(kind==='AGENCY_ASSIGNMENT'){
    if(!activeAt) return {status:'REJECTED',reasonCode:'AGENCY_OUTSIDE_EMPLOYMENT'};
    const agencyId=compact(payload.agencyId,120);
    const endMs=payload.endAt?toMs(payload.endAt):null;
    if(!agencyId) return {status:'REJECTED',reasonCode:'AGENCY_ID_REQUIRED'};
    if(payload.endAt && (endMs===null||endMs<effectiveAtMs)) return {status:'REJECTED',reasonCode:'INVALID_AGENCY_WINDOW'};
    const overlap=employeeEvents.filter(x=>x.kind==='AGENCY_ASSIGNMENT').some(x=>{
      const p=x.payload||{}; const end=p.endAt?toMs(p.endAt):Number.POSITIVE_INFINITY;
      return x.effectiveAtMs<=Number(endMs??Number.POSITIVE_INFINITY)&&effectiveAtMs<=end;
    });
    if(overlap) return {status:'REJECTED',reasonCode:'OVERLAPPING_AGENCY_ASSIGNMENT'};
    return {status:'ACCEPTED',reasonCode:'AGENCY_ASSIGNMENT_VALIDATED',payrollMutation:false};
  }

  if(kind==='ABSENCE'){
    const endMs=toMs(payload.endAt);
    if(!activeAt) return {status:'REJECTED',reasonCode:'ABSENCE_OUTSIDE_EMPLOYMENT'};
    if(endMs===null||endMs<=effectiveAtMs) return {status:'REJECTED',reasonCode:'INVALID_ABSENCE_WINDOW'};
    if(firstEnd&&endMs>firstEnd.effectiveAtMs) return {status:'REJECTED',reasonCode:'ABSENCE_AFTER_LEAVER'};
    return {status:'ACCEPTED',reasonCode:'ABSENCE_WINDOW_VALIDATED',payrollMutation:false};
  }

  if(kind==='CLOCK'){
    if(!activeAt) return {status:'REJECTED',reasonCode:'CLOCK_OUTSIDE_EMPLOYMENT'};
    const clockType=compact(payload.clockType,30).toUpperCase();
    if(!['IN','OUT','BREAK_START','BREAK_END'].includes(clockType))
      return {status:'REJECTED',reasonCode:'INVALID_CLOCK_TYPE'};
    const duplicate=employeeEvents.some(x=>x.kind==='CLOCK'&&x.effectiveAtMs===effectiveAtMs&&
      compact(x.payload?.clockType,30).toUpperCase()===clockType);
    if(duplicate) return {status:'REJECTED',reasonCode:'DUPLICATE_CLOCK'};
    return {status:'ACCEPTED',reasonCode:'CLOCK_VALIDATED',payrollMutation:false};
  }

  if(kind==='OVERTIME_OVERRIDE'){
    const minutes=Number(payload.minutes);
    if(!activeAt) return {status:'REJECTED',reasonCode:'OVERTIME_OUTSIDE_EMPLOYMENT'};
    if(!Number.isFinite(minutes)||minutes<=0) return {status:'REJECTED',reasonCode:'INVALID_OVERTIME'};
    if(!compact(payload.approvalRef,160)||!compact(payload.approvedBy,160))
      return {status:'REQUIRES_APPROVAL',reasonCode:'OVERTIME_APPROVAL_REQUIRED',payrollMutation:false};
    return {status:'ACCEPTED',reasonCode:'OVERTIME_APPROVED',payrollMutation:false};
  }

  if(kind==='RETRO_CHANGE'){
    const target=compact(payload.targetEventId,100);
    if(!target||!compact(payload.reason,300)||!compact(payload.approvalRef,160))
      return {status:'REJECTED',reasonCode:'RETRO_EVIDENCE_REQUIRED'};
    const targetEvent=accepted.find(x=>x.id===target&&x.employeeId===employeeId);
    if(!targetEvent) return {status:'REJECTED',reasonCode:'RETRO_TARGET_NOT_FOUND'};
    return {status:'ACCEPTED',reasonCode:'RETRO_APPEND_ONLY_CORRECTION',payrollMutation:false,originalEventPreserved:true};
  }

  return {status:'REJECTED',reasonCode:'UNHANDLED_EVENT'};
}

function createWorkforceLifecycleGuard(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const internalToken=options.internalToken||process.env.WFM_LIFECYCLE_INTERNAL_TOKEN||process.env.WFM_INTEGRATION_INTERNAL_TOKEN||'';
  if(!dbPath) throw new Error('Workforce lifecycle guard requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS workforce_lifecycle_events('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,event_key TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,'+
      'employee_id TEXT,source_key TEXT,effective_at_ms INTEGER NOT NULL,payload_json TEXT NOT NULL,'+
      'reason_code TEXT,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant,event_key));'+
    'CREATE TRIGGER IF NOT EXISTS no_workforce_lifecycle_update BEFORE UPDATE ON workforce_lifecycle_events '+
      "BEGIN SELECT RAISE(ABORT,'Workforce lifecycle events are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_workforce_lifecycle_delete BEFORE DELETE ON workforce_lifecycle_events '+
      "BEGIN SELECT RAISE(ABORT,'Workforce lifecycle events are append only.'); END;"
  );
  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const byKey=db.prepare('SELECT * FROM workforce_lifecycle_events WHERE tenant=? AND event_key=?');
  const tenantRows=db.prepare('SELECT * FROM workforce_lifecycle_events WHERE tenant=? ORDER BY effective_at_ms,id');
  const insert=db.prepare('INSERT INTO workforce_lifecycle_events(id,tenant,event_key,kind,status,employee_id,source_key,effective_at_ms,payload_json,reason_code,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');

  function ctx(req){
    const token=cookieToken(req); return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function requireManager(req,res){
    const c=ctx(req);
    if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}
    if(String(c.role).toLowerCase()==='employee'){writeJson(res,403,{error:'Lifecycle evidence requires an authorised manager or administrator.'});return null;}
    return c;
  }
  function requireInternal(req,res){
    if(!internalToken){writeJson(res,503,{error:'Trusted lifecycle worker is not configured.'});return false;}
    if(!secureEqual(req?.headers?.[INTERNAL_HEADER],internalToken)){writeJson(res,403,{error:'Trusted lifecycle worker is required.'});return false;}
    return true;
  }
  function priorForTenant(tenant){
    return tenantRows.all(tenant).map(row=>({
      id:row.id,eventKey:row.event_key,kind:row.kind,status:row.status,employeeId:row.employee_id,
      sourceKey:row.source_key,effectiveAtMs:Number(row.effective_at_ms),payload:JSON.parse(row.payload_json)
    }));
  }

  function applyTrustedEvent(input={}){
    const tenant=compact(input.tenant,120),eventKey=compact(input.eventKey,160);if(!tenant||!eventKey)throw new Error('tenant and eventKey are required.');const source=input.event&&typeof input.event==='object'?input.event:{},event={kind:source.kind,employeeId:source.employeeId,sourceKey:source.sourceKey,effectiveAt:source.effectiveAt,payload:source.payload};const existing=byKey.get(tenant,eventKey);if(existing){assertMatchingReplay(existing,event);return{event:publicEvent(existing),decision:JSON.parse(existing.detail_json),idempotent:true};}const decision=evaluateEvent(priorForTenant(tenant),event),id='wf-'+sha256(tenant+'|'+eventKey).slice(0,32),effectiveAtMs=toMs(event.effectiveAt)??Date.now();insert.run(id,tenant,eventKey,compact(event.kind,40).toUpperCase(),decision.status,compact(event.employeeId,120)||null,compact(event.sourceKey,120)||null,effectiveAtMs,JSON.stringify(event.payload&&typeof event.payload==='object'?event.payload:{}),decision.reasonCode||null,JSON.stringify(decision),nowIso());const row=byKey.get(tenant,eventKey);return{event:publicEvent(row),decision,idempotent:false};
  }
  function getTrustedEvent(input={}){const tenant=compact(input.tenant,120),eventKey=compact(input.eventKey,160),row=tenant&&eventKey?byKey.get(tenant,eventKey):null;return row?{...publicEvent(row),tenant:row.tenant,payload:JSON.parse(row.payload_json)}:null;}

  async function ingest(req,res){
    const body=await readJson(req);
    const tenant=compact(body.tenant,120), eventKey=compact(body.eventKey,160);
    if(!tenant||!eventKey) return writeJson(res,400,{error:'tenant and eventKey are required.'});
    const event={
      kind:body.kind,employeeId:body.employeeId,sourceKey:body.sourceKey,
      effectiveAt:body.effectiveAt,payload:body.payload
    };
    const existing=byKey.get(tenant,eventKey);
    if(existing){assertMatchingReplay(existing,event);return writeJson(res,200,{event:publicEvent(existing),idempotent:true});}
    const decision=evaluateEvent(priorForTenant(tenant),event);
    const id='wf-'+sha256(tenant+'|'+eventKey).slice(0,32);
    const effectiveAtMs=toMs(event.effectiveAt)??Date.now();
    insert.run(id,tenant,eventKey,compact(event.kind,40).toUpperCase(),decision.status,
      compact(event.employeeId,120)||null,compact(event.sourceKey,120)||null,effectiveAtMs,
      JSON.stringify(event.payload&&typeof event.payload==='object'?event.payload:{}),
      decision.reasonCode||null,JSON.stringify(decision),nowIso());
    const row=byKey.get(tenant,eventKey);
    const status=decision.status==='ACCEPTED'?201:decision.status==='REQUIRES_APPROVAL'?409:422;
    return writeJson(res,status,{event:publicEvent(row),decision});
  }

  function status(req,res){
    const c=requireManager(req,res); if(!c)return true;
    const rows=tenantRows.all(c.tenant);
    const counts={};
    for(const row of rows) counts[row.status]=(counts[row.status]||0)+1;
    const outages=new Map();
    for(const row of rows){
      if(!row.source_key)continue;
      if(row.kind==='INTEGRATION_OUTAGE')outages.set(row.source_key,'DEGRADED');
      if(row.kind==='INTEGRATION_RECOVERY')outages.set(row.source_key,'RECOVERED');
    }
    return writeJson(res,200,{
      tenant:c.tenant,eventCount:rows.length,counts,
      sources:[...outages.entries()].map(([sourceKey,state])=>({sourceKey,state})),
      recent:rows.slice(-20).map(publicEvent)
    });
  }

  async function handleRequest(req,res){
    const path=eventPath(req); if(!path.startsWith(PREFIX))return false;
    try{
      if(req.method==='POST'&&path===PREFIX+'/event'){
        if(!requireInternal(req,res))return true;
        return await ingest(req,res);
      }
      if(req.method==='GET'&&path===PREFIX+'/status')return status(req,res);
      return writeJson(res,404,{error:'Workforce lifecycle endpoint not found.'});
    }catch(error){
      return writeJson(res,Number(error?.statusCode||500),{error:error?.statusCode?error.message:'Workforce lifecycle guard failed safely.'});
    }
  }

  return {handleRequest,applyTrustedEvent,getTrustedEvent,close(){try{db.close();}catch{}}};
}

module.exports={createWorkforceLifecycleGuard,evaluateEvent,EVENT_KINDS};

