'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  normalizeRole,classifyCommand,executionPolicy,assistantEnvelope
}=require('./vector-intelligence-layer.cjs');
const {sanitizeSnapshot,createReport,parseCadence}=require('./vector-report-engine.cjs');
const {providerReady,sendResendReport}=require('./vector-email-delivery.cjs');

const PREFIX='/api/intelligence/vector';

function nowIso(){return new Date().toISOString();}
function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function compact(v,max=500){return String(v??'').trim().replace(/\s+/g,' ').slice(0,max);}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const p=part.trim();
    if(p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded)return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req,max=128*1024){
  let size=0;const chunks=[];
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;
    if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;}
    chunks.push(b);
  }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}
function safeJson(v,fallback={}){try{return JSON.parse(v);}catch{return fallback;}}
function commandTitle(text){
  const t=compact(text,120);
  return t||'Vector request';
}
function publicRequest(row){
  return {
    id:row.id,intent:row.intent,status:row.status,title:row.title,
    role:row.role,scope:row.scope,currentScreen:row.current_screen,
    createdAt:row.created_at,detail:safeJson(row.detail_json,{})
  };
}

function createVectorIntelligenceControlPlane(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath)throw new Error('Vector intelligence control plane requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS vector_intelligence_requests('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,email TEXT NOT NULL,intent TEXT NOT NULL,status TEXT NOT NULL,'+
      'title TEXT NOT NULL,request_text TEXT NOT NULL,role TEXT NOT NULL,scope TEXT NOT NULL,current_screen TEXT NOT NULL,'+
      'detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS vector_intelligence_requests_tenant_created ON vector_intelligence_requests(tenant,created_at DESC);'+
    'CREATE TABLE IF NOT EXISTS vector_tasks('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,'+
      'source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS vector_automations('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,'+
      'source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS vector_reports('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,'+
      'source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS vector_dashboard_preferences('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,'+
      'source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'
  );

  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const insertRequest=db.prepare('INSERT INTO vector_intelligence_requests(id,tenant,email,intent,status,title,request_text,role,scope,current_screen,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const listRequests=db.prepare('SELECT * FROM vector_intelligence_requests WHERE tenant=? ORDER BY created_at DESC LIMIT ?');
  const countRequests=db.prepare('SELECT intent,status,COUNT(*) n FROM vector_intelligence_requests WHERE tenant=? GROUP BY intent,status');
  const insertTask=db.prepare('INSERT INTO vector_tasks(id,tenant,owner_email,title,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertAutomation=db.prepare('INSERT INTO vector_automations(id,tenant,owner_email,title,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertReport=db.prepare('INSERT INTO vector_reports(id,tenant,owner_email,title,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertPreference=db.prepare('INSERT INTO vector_dashboard_preferences(id,tenant,owner_email,kind,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const updateRequestStatus=db.prepare('UPDATE vector_intelligence_requests SET status=?,updated_at=? WHERE id=? AND tenant=?');
  const updateReportStatus=db.prepare('UPDATE vector_reports SET status=?,detail_json=?,updated_at=? WHERE id=? AND tenant=?');
  const listTasks=db.prepare('SELECT * FROM vector_tasks WHERE tenant=? ORDER BY created_at DESC LIMIT ?');
  const listAutomations=db.prepare('SELECT * FROM vector_automations WHERE tenant=? ORDER BY created_at DESC LIMIT ?');
  const listReports=db.prepare('SELECT * FROM vector_reports WHERE tenant=? ORDER BY created_at DESC LIMIT ?');
  const listPreferences=db.prepare('SELECT * FROM vector_dashboard_preferences WHERE tenant=? ORDER BY created_at DESC LIMIT ?');

  function ctx(req){
    const token=cookieToken(req);
    return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function requireUser(req,res){
    const c=ctx(req);
    if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}
    return c;
  }
  function roleContext(c,body={}){
    return {
      role:c.role,
      jobTitle:body.jobTitle||c.role,
      siteCount:body.siteCount,
      siteIds:Array.isArray(body.siteIds)?body.siteIds:[],
      currentScreen:body.currentScreen||'overview'
    };
  }
  function persistAction(c,envelope,snapshotInput={}){
    const id='vai-'+randomUUID();
    const created=nowIso();
    const snapshot=sanitizeSnapshot({
      ...snapshotInput,
      role:envelope.role,
      scope:envelope.scope,
      currentScreen:envelope.currentScreen,
      generatedAt:snapshotInput?.generatedAt||created
    });
    const cadence=parseCadence(envelope.command.text,new Date(created));
    const detail={
      policy:envelope.policy,
      siteIds:envelope.siteIds,
      requestedAt:envelope.requestedAt,
      snapshot,
      cadence,
      execution:{
        analysisEngine:'CLIENT_ASSISTANT',
        reportEngine:'VECTOR_REPORT_ENGINE_V1',
        deliveryProviderConfigured:providerReady(),
        schedulerConfigured:Boolean(process.env.WFM_VECTOR_AUTOMATION_RUNNER)
      }
    };
    let status='ACCEPTED';
    if(envelope.policy.mode==='BLOCK')status='BLOCKED';
    if(envelope.policy.mode==='EXPLICIT_CONFIRMATION')status='AWAITING_CONFIRMATION';
    if(envelope.command.intent==='CREATE_REPORT')status='READY';
    if(envelope.command.intent==='EMAIL_REPORT')status=process.env.WFM_VECTOR_EMAIL_PROVIDER?'READY_FOR_DELIVERY':'READY_NOT_SENT';
    if(envelope.command.intent==='CREATE_AUTOMATION')status='CONFIGURED_PENDING_WORKER';
    insertRequest.run(
      id,c.tenant,c.email,envelope.command.intent,status,commandTitle(envelope.command.text),
      envelope.command.text,envelope.role,envelope.scope,envelope.currentScreen,
      JSON.stringify(detail),created,created
    );

    if(status==='BLOCKED'||status==='AWAITING_CONFIRMATION') return {id,status,detail,created:null};

    const common=[c.tenant,c.email,commandTitle(envelope.command.text),id,created,created];
    let createdEntity=null;
    if(envelope.command.intent==='CREATE_TASK'){
      const entityId='vtask-'+randomUUID();
      insertTask.run(entityId,common[0],common[1],common[2],'OPEN',common[3],JSON.stringify({request:envelope.command.text,snapshot}),common[4],common[5]);
      createdEntity={kind:'TASK',id:entityId,status:'OPEN'};
    }else if(envelope.command.intent==='CREATE_AUTOMATION'){
      const entityId='vauto-'+randomUUID();
      const entityStatus=process.env.WFM_VECTOR_AUTOMATION_RUNNER&&cadence.parsed?'ACTIVE':'PENDING_RUNNER';
      insertAutomation.run(entityId,common[0],common[1],common[2],entityStatus,common[3],JSON.stringify({request:envelope.command.text,cadence,snapshot}),common[4],common[5]);
      createdEntity={kind:'AUTOMATION',id:entityId,status:entityStatus,cadence};
    }else if(envelope.command.intent==='CREATE_REPORT'||envelope.command.intent==='EMAIL_REPORT'){
      const entityId='vreport-'+randomUUID();
      const report=createReport({title:common[2],request:envelope.command.text,snapshot});
      const delivery=envelope.command.intent==='EMAIL_REPORT'?'EMAIL':'IN_APP';
      const entityStatus=delivery==='EMAIL'?(process.env.WFM_VECTOR_EMAIL_PROVIDER?'READY_FOR_DELIVERY':'READY_NOT_SENT'):'READY';
      insertReport.run(entityId,common[0],common[1],report.title,entityStatus,common[3],JSON.stringify({
        request:envelope.command.text,delivery,emailProviderReady:providerReady(),report
      }),common[4],common[5]);
      createdEntity={kind:'REPORT',id:entityId,status:entityStatus,delivery,report:{title:report.title,markdown:report.markdown,html:report.html}};
    }else if(envelope.command.intent==='CHANGE_WIDGET'||envelope.command.intent==='CHANGE_CHART'){
      const entityId='vpref-'+randomUUID();
      insertPreference.run(entityId,common[0],common[1],envelope.command.intent,
        'ACTIVE',common[3],JSON.stringify({request:envelope.command.text,currentScreen:envelope.currentScreen,snapshot}),common[4],common[5]);
      createdEntity={kind:'PREFERENCE',id:entityId,status:'ACTIVE'};
    }
    return {id,status,detail,created:createdEntity};
  }

  async function deliverEmailReport(c,persisted){
    const created=persisted?.created;
    if(!created||created.kind!=='REPORT'||created.delivery!=='EMAIL')return persisted;
    if(!providerReady())return persisted;
    const now=nowIso();
    try{
      const delivery=await sendResendReport({
        token:process.env.WFM_VECTOR_RESEND_TOKEN,
        from:process.env.WFM_VECTOR_EMAIL_FROM,
        to:c.email,
        subject:created.report.title,
        html:created.report.html,
        text:created.report.markdown,
        idempotencyKey:'vector-report/'+created.id
      });
      created.status='SENT';
      created.deliveryResult=delivery;
      persisted.status='SENT';
      const row=listReports.all(c.tenant,100).find(x=>x.id===created.id);
      const detail=row?safeJson(row.detail_json,{}):{};
      detail.deliveryResult=delivery;
      updateReportStatus.run('SENT',JSON.stringify(detail),now,created.id,c.tenant);
      updateRequestStatus.run('SENT',now,persisted.id,c.tenant);
    }catch(error){
      created.status='DELIVERY_FAILED';
      created.deliveryError=compact(error?.message||error,300);
      persisted.status='DELIVERY_FAILED';
      const row=listReports.all(c.tenant,100).find(x=>x.id===created.id);
      const detail=row?safeJson(row.detail_json,{}):{};
      detail.deliveryError=created.deliveryError;
      updateReportStatus.run('DELIVERY_FAILED',JSON.stringify(detail),now,created.id,c.tenant);
      updateRequestStatus.run('DELIVERY_FAILED',now,persisted.id,c.tenant);
    }
    return persisted;
  }

  async function command(req,res,c){
    const body=await readJson(req);
    const text=compact(body.text,2000);
    if(!text)return writeJson(res,400,{error:'text is required.'});
    const context=roleContext(c,body);
    const envelope=assistantEnvelope(text,context);
    let persisted=persistAction(c,envelope,body.snapshot||{});
    if(envelope.command.intent==='EMAIL_REPORT')persisted=await deliverEmailReport(c,persisted);
    return writeJson(res,persisted.status==='BLOCKED'?403:202,{
      requestId:persisted.id,
      status:persisted.status,
      created:persisted.created,
      envelope,
      handoff: envelope.command.intent==='ANALYSE'||envelope.command.intent==='NAVIGATE'
        ? {target:'CLIENT_ASSISTANT',ready:true}
        : {target:'VECTOR_CONTROL_PLANE',ready:persisted.status!=='CONFIGURED_PENDING_WORKER'},
      capabilities:{
        analysis:true,
        reports:true,
        reportGeneration:true,
        tasks:true,
        automations:true,
        dashboardPreferences:true,
        emailDelivery:providerReady()
      }
    });
  }

  function status(req,res,c){
    const counts=countRequests.all(c.tenant).map(r=>({intent:r.intent,status:r.status,count:Number(r.n)}));
    const role=normalizeRole({role:c.role});
    return writeJson(res,200,{
      role:role.key,scope:role.scope,counts,
      capabilities:{
        analysis:true,
        reports:true,
        reportGeneration:true,
        tasks:true,
        automations:true,
        dashboardPreferences:true,
        emailDelivery:providerReady(),
        automationRunner:Boolean(process.env.WFM_VECTOR_AUTOMATION_RUNNER)
      }
    });
  }

  function requests(req,res,c){
    const rows=listRequests.all(c.tenant,50).map(publicRequest);
    return writeJson(res,200,{requests:rows});
  }

  function publicEntity(row){
    return {
      id:row.id,title:row.title,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
      detail:safeJson(row.detail_json,{})
    };
  }
  function tasks(req,res,c){return writeJson(res,200,{tasks:listTasks.all(c.tenant,100).map(publicEntity)});}
  function automations(req,res,c){return writeJson(res,200,{automations:listAutomations.all(c.tenant,100).map(publicEntity)});}
  function reports(req,res,c){return writeJson(res,200,{reports:listReports.all(c.tenant,100).map(publicEntity)});}
  function preferences(req,res,c){return writeJson(res,200,{preferences:listPreferences.all(c.tenant,100).map(publicEntity)});}

  async function handleRequest(req,res){
    const path=pathOf(req);
    if(!path.startsWith(PREFIX))return false;
    const c=requireUser(req,res);if(!c)return true;
    const method=String(req.method||'GET').toUpperCase();
    try{
      if(path===PREFIX+'/status'&&method==='GET')return status(req,res,c);
      if(path===PREFIX+'/requests'&&method==='GET')return requests(req,res,c);
      if(path===PREFIX+'/tasks'&&method==='GET')return tasks(req,res,c);
      if(path===PREFIX+'/automations'&&method==='GET')return automations(req,res,c);
      if(path===PREFIX+'/reports'&&method==='GET')return reports(req,res,c);
      if(path===PREFIX+'/preferences'&&method==='GET')return preferences(req,res,c);
      if(path===PREFIX+'/command'&&method==='POST')return await command(req,res,c);
      return writeJson(res,404,{error:'Unknown Vector intelligence endpoint.'});
    }catch(error){
      return writeJson(res,error.statusCode||500,{error:error.statusCode?error.message:'Vector intelligence request failed safely.'});
    }
  }

  function close(){try{db.close();}catch{}}
  return {handleRequest,close};
}

module.exports={createVectorIntelligenceControlPlane};
