'use strict';

const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createReport}=require('./vector-report-engine.cjs');
const {createTenantSnapshot}=require('./vector-context-engine.cjs');
const {providerReady,sendResendReport}=require('./vector-email-delivery.cjs');

function compact(v,max=500){return String(v??'').trim().replace(/\s+/g,' ').slice(0,max);}
function safeJson(v,fallback={}){try{return JSON.parse(v);}catch{return fallback;}}
function localParts(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'
  }).formatToParts(date);
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  const days={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {ymd:get('year')+'-'+get('month')+'-'+get('day'),dayOfWeek:days[get('weekday')],hour:Number(get('hour'))};
}
function isDue(cadence,lastRunAt,now,timeZone){
  if(!cadence?.parsed||!cadence.frequency||!timeZone)return false;
  const local=localParts(now,timeZone);
  const targetHour=Number.isInteger(cadence.hour)?cadence.hour:8;
  if(local.hour!==targetHour)return false;
  if(cadence.frequency==='WEEKLY'&&Number.isInteger(cadence.dayOfWeek)&&local.dayOfWeek!==cadence.dayOfWeek)return false;
  if(cadence.frequency==='MONTHLY'){
    const day=Number(local.ymd.slice(-2));if(day!==1)return false;
  }
  if(lastRunAt){
    try{if(localParts(new Date(lastRunAt),timeZone).ymd===local.ymd)return false;}catch{}
  }
  return true;
}
function automationPurpose(request){
  const q=compact(request,1000).toLowerCase();
  if(/\b(task|reminder|action)\b/.test(q)&&!/(report|summary|pack|email|mail|send)/.test(q))return 'TASK';
  if(/\b(report|summary|pack|update|email|mail|send)\b/.test(q))return 'REPORT';
  return 'UNSUPPORTED';
}
function wantsEmail(request){return /\b(email|mail|send)\b/i.test(String(request||''));}

async function runVectorAutomationCycle(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const env=options.env||process.env;
  const now=options.now instanceof Date?options.now:new Date(options.now||Date.now());
  const sendEmail=options.sendEmail||sendResendReport;
  if(!dbPath)throw new Error('Vector automation worker requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;');
  const select=db.prepare("SELECT * FROM vector_automations WHERE status IN ('ACTIVE','PENDING_RUNNER') ORDER BY created_at ASC");
  const tenantState=db.prepare('SELECT state FROM tenants WHERE id=?');
  const updateAutomation=db.prepare('UPDATE vector_automations SET status=?,detail_json=?,updated_at=? WHERE id=? AND tenant=?');
  const insertReport=db.prepare('INSERT INTO vector_reports(id,tenant,owner_email,title,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertTask=db.prepare('INSERT INTO vector_tasks(id,tenant,owner_email,title,status,source_request_id,detail_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const results=[];
  try{
    for(const row of select.all()){
      const detail=safeJson(row.detail_json,{});
      const cadence=detail.cadence||{};
      const stateRow=tenantState.get(row.tenant);
      if(!stateRow){
        detail.lastStatus='BLOCKED_NO_TENANT_STATE';
        updateAutomation.run('BLOCKED_CONTEXT',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
        results.push({id:row.id,status:'BLOCKED_CONTEXT',reason:'NO_TENANT_STATE'});continue;
      }
      const fresh=createTenantSnapshot(stateRow.state,{
        role:detail.role||detail.snapshot?.role,
        scope:detail.scope||detail.snapshot?.scope,
        siteIds:detail.siteIds||[],
        currentScreen:'automation',
        soWhat:detail.snapshot?.decisionLens?.soWhat,
        nextAction:detail.snapshot?.decisionLens?.nextAction
      });
      if(!fresh.ok){
        detail.lastStatus='BLOCKED_'+fresh.reason;
        updateAutomation.run('BLOCKED_CONTEXT',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
        results.push({id:row.id,status:'BLOCKED_CONTEXT',reason:fresh.reason});continue;
      }
      if(!fresh.timezone){
        detail.lastStatus='BLOCKED_TIMEZONE';
        updateAutomation.run('BLOCKED_TIMEZONE',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
        results.push({id:row.id,status:'BLOCKED_TIMEZONE'});continue;
      }
      if(!isDue(cadence,detail.lastRunAt,now,fresh.timezone)){
        results.push({id:row.id,status:'NOT_DUE'});continue;
      }
      const purpose=automationPurpose(detail.request);
      if(purpose==='UNSUPPORTED'){
        detail.lastStatus='BLOCKED_UNSUPPORTED';
        updateAutomation.run('BLOCKED_UNSUPPORTED',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
        results.push({id:row.id,status:'BLOCKED_UNSUPPORTED'});continue;
      }
      if(purpose==='TASK'){
        const taskId='vtask-'+randomUUID();
        insertTask.run(taskId,row.tenant,row.owner_email,row.title,'OPEN',row.source_request_id,JSON.stringify({request:detail.request,snapshot:fresh.snapshot,automationId:row.id}),now.toISOString(),now.toISOString());
        detail.lastRunAt=now.toISOString();detail.lastStatus='TASK_CREATED';detail.lastEntityId=taskId;
        updateAutomation.run('ACTIVE',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
        results.push({id:row.id,status:'TASK_CREATED',entityId:taskId});continue;
      }
      const report=createReport({title:row.title,request:detail.request,snapshot:fresh.snapshot});
      const reportId='vreport-'+randomUUID();
      let reportStatus='READY',deliveryResult=null,deliveryError=null;
      if(wantsEmail(detail.request)){
        if(!providerReady(env)){
          detail.lastStatus='BLOCKED_PROVIDER';
          updateAutomation.run('BLOCKED_PROVIDER',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
          results.push({id:row.id,status:'BLOCKED_PROVIDER'});continue;
        }
        try{
          deliveryResult=await sendEmail({
            token:env.WFM_VECTOR_RESEND_TOKEN,from:env.WFM_VECTOR_EMAIL_FROM,to:row.owner_email,
            subject:report.title,html:report.html,text:report.markdown,idempotencyKey:'vector-automation/'+row.id+'/'+localParts(now,fresh.timezone).ymd
          });
          reportStatus='SENT';
        }catch(error){reportStatus='DELIVERY_FAILED';deliveryError=compact(error?.message||error,300);}
      }
      insertReport.run(reportId,row.tenant,row.owner_email,report.title,reportStatus,row.source_request_id,JSON.stringify({request:detail.request,delivery:wantsEmail(detail.request)?'EMAIL':'IN_APP',report,automationId:row.id,deliveryResult,deliveryError}),now.toISOString(),now.toISOString());
      detail.lastRunAt=now.toISOString();detail.lastStatus=reportStatus;detail.lastEntityId=reportId;
      updateAutomation.run(reportStatus==='DELIVERY_FAILED'?'ACTIVE':'ACTIVE',JSON.stringify(detail),now.toISOString(),row.id,row.tenant);
      results.push({id:row.id,status:reportStatus,entityId:reportId});
    }
    return {ranAt:now.toISOString(),results};
  }finally{db.close();}
}

if(require.main===module){
  runVectorAutomationCycle().then(result=>{console.log(JSON.stringify(result));}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
}
module.exports={localParts,isDue,automationPurpose,wantsEmail,runVectorAutomationCycle};
