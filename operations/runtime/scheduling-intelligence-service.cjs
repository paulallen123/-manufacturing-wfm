'use strict';

const {createHash,timingSafeEqual}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {CONTRACT_VERSION,createSchedulingPlan,repairSchedulingPlan,evaluateOpenShift,evaluateSwap,capabilityContract}=require('./manufacturing-scheduling-engine.cjs');

const PREFIX='/api/operations/scheduling';
const INTERNAL_HEADER='x-wfm-scheduling-internal';
function now(){ return new Date().toISOString(); }
function hash(v){ return createHash('sha256').update(String(v)).digest('hex'); }
function compact(v,max=240){ return String(v??'').trim().slice(0,max); }
function equal(a,b){ const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length>0&&x.length===y.length&&timingSafeEqual(x,y); }
function cookie(req){ for(const part of String(req?.headers?.cookie||'').split(';')){ const p=part.trim(); if(p.startsWith('wfm_session=')) return p.slice(12); } return ''; }
function route(req){ return String(req?.url||'/').split('?')[0]||'/'; }
function json(res,status,body){ if(res.headersSent||res.writableEnded)return true; res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.end(JSON.stringify(body)); return true; }
async function body(req,max=512*1024){
  let size=0,chunks=[];
  for await(const chunk of req){ const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=b.length; if(size>max){ const e=new Error('Request body too large.'); e.statusCode=413; throw e; } chunks.push(b); }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}

function createSchedulingIntelligenceService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const internal=options.internalToken||process.env.WFM_SCHEDULING_INTERNAL_TOKEN||process.env.WFM_DEMAND_INTERNAL_TOKEN||process.env.WFM_INTEGRATION_INTERNAL_TOKEN||'';
  const publish=typeof options.publishEvent==='function'?options.publishEvent:null;
  if(!dbPath) throw new Error('Scheduling intelligence service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS vector_schedule_plans(tenant TEXT NOT NULL,plan_id TEXT NOT NULL,context_revision TEXT NOT NULL,plan_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant,plan_id));'+
    'CREATE INDEX IF NOT EXISTS vector_schedule_plan_tenant_created ON vector_schedule_plans(tenant,created_at DESC);'+
    "CREATE TRIGGER IF NOT EXISTS no_vector_schedule_plan_update BEFORE UPDATE ON vector_schedule_plans BEGIN SELECT RAISE(ABORT,'Vector schedule plans are append only.'); END;"+
    "CREATE TRIGGER IF NOT EXISTS no_vector_schedule_plan_delete BEFORE DELETE ON vector_schedule_plans BEGIN SELECT RAISE(ABORT,'Vector schedule plans are append only.'); END;"+
    'CREATE TABLE IF NOT EXISTS vector_schedule_repairs(tenant TEXT NOT NULL,repair_id TEXT NOT NULL,prior_plan_id TEXT NOT NULL,repair_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant,repair_id));'+
    "CREATE TRIGGER IF NOT EXISTS no_vector_schedule_repair_update BEFORE UPDATE ON vector_schedule_repairs BEGIN SELECT RAISE(ABORT,'Vector schedule repairs are append only.'); END;"+
    "CREATE TRIGGER IF NOT EXISTS no_vector_schedule_repair_delete BEFORE DELETE ON vector_schedule_repairs BEGIN SELECT RAISE(ABORT,'Vector schedule repairs are append only.'); END;"
  );
  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const planById=db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? AND plan_id=?');
  const insertPlan=db.prepare('INSERT INTO vector_schedule_plans(tenant,plan_id,context_revision,plan_json,created_at) VALUES(?,?,?,?,?)');
  const listPlans=db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? ORDER BY created_at DESC,plan_id DESC LIMIT ?');
  const repairById=db.prepare('SELECT repair_json FROM vector_schedule_repairs WHERE tenant=? AND repair_id=?');
  const insertRepair=db.prepare('INSERT INTO vector_schedule_repairs(tenant,repair_id,prior_plan_id,repair_json,created_at) VALUES(?,?,?,?,?)');
  function ctx(req){ const t=cookie(req); return t?auth.get(hash(t),Date.now())||null:null; }
  function manager(req,res){
    const c=ctx(req); if(!c){json(res,401,{error:'Sign in is required.'});return null;}
    if(String(c.role).toLowerCase()==='employee'){json(res,403,{error:'Scheduling intelligence requires an authorised manager or administrator.'});return null;}
    return c;
  }
  function trusted(req,res){
    if(!internal){json(res,503,{error:'Trusted scheduling worker is not configured.'});return false;}
    if(!equal(req?.headers?.[INTERNAL_HEADER],internal)){json(res,403,{error:'Trusted scheduling worker is required.'});return false;}
    return true;
  }
  function savePlan(plan){
    const found=planById.get(plan.tenant,plan.planId);
    if(found)return {plan:JSON.parse(found.plan_json),idempotent:true};
    insertPlan.run(plan.tenant,plan.planId,plan.contextRevision,JSON.stringify(plan),now());
    try{publish?.({tenant:plan.tenant,topic:'scheduling.shadow.updated',audience:'manager',payload:{planId:plan.planId,coveragePct:plan.quality?.coveragePct??null,executionPermitted:false}});}catch{}
    return {plan,idempotent:false};
  }
  function saveRepair(tenant,repair){
    const found=repairById.get(tenant,repair.repairId);
    if(found)return {repair:JSON.parse(found.repair_json),idempotent:true};
    insertRepair.run(tenant,repair.repairId,repair.priorPlanId,JSON.stringify(repair),now());
    try{publish?.({tenant,topic:'scheduling.repair.shadow.updated',audience:'manager',payload:{repairId:repair.repairId,priorPlanId:repair.priorPlanId,changeCount:repair.changeCount,executionPermitted:false}});}catch{}
    return {repair,idempotent:false};
  }
  async function handleRequest(req,res){
    const path=route(req); if(!path.startsWith(PREFIX))return false;
    try{
      if(req.method==='POST'&&path===PREFIX+'/plan/shadow'){
        if(!trusted(req,res))return true; const b=await body(req),tenant=compact(b.tenant,120); if(!tenant)return json(res,400,{error:'tenant is required.'});
        const saved=savePlan(createSchedulingPlan({...b.input,tenant})); return json(res,saved.idempotent?200:201,{contractVersion:CONTRACT_VERSION,...saved,authority:'NO_EXECUTION'});
      }
      if(req.method==='POST'&&path===PREFIX+'/repair/shadow'){
        if(!trusted(req,res))return true; const b=await body(req),tenant=compact(b.tenant,120),priorPlanId=compact(b.priorPlanId,180);
        if(!tenant||!priorPlanId)return json(res,400,{error:'tenant and priorPlanId are required.'});
        const row=planById.get(tenant,priorPlanId); if(!row)return json(res,404,{error:'Prior schedule plan was not found.'});
        const saved=saveRepair(tenant,repairSchedulingPlan({...b.input,priorPlan:JSON.parse(row.plan_json)}));
        return json(res,saved.idempotent?200:201,{contractVersion:CONTRACT_VERSION,...saved,authority:'NO_EXECUTION'});
      }
      const c=manager(req,res); if(!c)return true;
      if(req.method==='GET'&&path===PREFIX+'/capabilities')return json(res,200,{tenant:c.tenant,...capabilityContract()});
      if(req.method==='GET'&&path===PREFIX+'/plans')return json(res,200,{contractVersion:CONTRACT_VERSION,tenant:c.tenant,plans:listPlans.all(c.tenant,20).map(r=>JSON.parse(r.plan_json))});
      if(req.method==='POST'&&path===PREFIX+'/what-if'){const b=await body(req);return json(res,200,{contractVersion:CONTRACT_VERSION,scenarioOnly:true,persisted:false,plan:createSchedulingPlan({...b.input,tenant:c.tenant}),authority:'NO_EXECUTION'});}
      if(req.method==='POST'&&path===PREFIX+'/open-shift/evaluate'){const b=await body(req);return json(res,200,{contractVersion:CONTRACT_VERSION,tenant:c.tenant,result:evaluateOpenShift(b.input||{})});}
      if(req.method==='POST'&&path===PREFIX+'/swap/evaluate'){const b=await body(req);return json(res,200,{contractVersion:CONTRACT_VERSION,tenant:c.tenant,result:evaluateSwap(b.input||{})});}
      return json(res,404,{error:'Scheduling intelligence endpoint not found.'});
    }catch(error){return json(res,Number(error?.statusCode||400),{error:compact(error?.message||'Scheduling intelligence failed safely.',300),executionPermitted:false});}
  }
  return {handleRequest,capabilityContract,close(){try{db.close();}catch{}}};
}
module.exports={createSchedulingIntelligenceService,PREFIX,INTERNAL_HEADER};
