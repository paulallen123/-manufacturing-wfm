'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require('./vector-reporting-service.cjs');

function sha(v){return createHash('sha256').update(String(v)).digest('hex');}
function setup(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-reporting-'));
  const dbPath=path.join(dir,'wfm.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  const users=[
    ['manager@a.example','tenant-a','manager','manager-a'],
    ['payroll@a.example','tenant-a','payroll_admin','payroll-a'],
    ['director@a.example','tenant-a','director','director-a'],
    ['employee@a.example','tenant-a','employee','employee-a'],
    ['manager@b.example','tenant-b','manager','manager-b']
  ];
  for(const [email,tenant,role,token] of users){
    db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run(email,tenant,role);
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha(token),email,Date.now()+3600000);
  }
  db.close();
  const service=Reporting.createVectorReportingService({dbPath,...options});
  return {dir,dbPath,service,close(){service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function req(method,url,token,body){
  const r=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);
  r.method=method;r.url=url;r.headers={cookie:token?'wfm_session='+token:''};
  return r;
}
function res(){
  return {statusCode:200,headers:{},body:'',headersSent:false,writableEnded:false,setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},end(v=''){this.body=String(v);this.writableEnded=true;this.headersSent=true;}};
}
async function call(service,method,url,token,body){
  const response=res();
  const handled=await service.handleRequest(req(method,url,token,body),response);
  return {handled,status:response.statusCode,body:response.body?JSON.parse(response.body):null,headers:response.headers};
}

test('catalog is role governed and keeps payroll/audit restricted',()=>{
  assert.equal(Reporting.visibleCatalog('employee').sources.length,0);
  const manager=Reporting.visibleCatalog('manager');
  assert.ok(manager.sources.some(s=>s.id==='factory-readiness'));
  assert.equal(manager.sources.some(s=>s.id==='payroll-control'),false);
  assert.equal(manager.sources.some(s=>s.id==='audit-evidence'),false);
  const payroll=Reporting.visibleCatalog('payroll_admin');
  assert.ok(payroll.sources.some(s=>s.id==='payroll-control'));
  assert.equal(payroll.sources.some(s=>s.id==='audit-evidence'),false);
  assert.ok(Reporting.visibleCatalog('director').sources.some(s=>s.id==='audit-evidence'));
});

async function makeReport(x,token='payroll-a',sourceId='payroll-control'){
  const result=await call(x.service,'POST','/api/reporting/reports',token,{definition:{title:'Private '+sourceId,sourceId}});
  assert.equal(result.status,201);return result.body.report;
}
async function makeSchedule(x,reportId,token='payroll-a',extra={}){
  const result=await call(x.service,'POST','/api/reporting/schedules',token,{reportId,cadence:'daily',hour:16,minute:5,timeZone:'UTC',delivery:'in_app',...extra});
  assert.equal(result.status,201);return result.body.schedule;
}
function changeRole(x,email,role){const db=new DatabaseSync(x.dbPath);try{db.prepare('UPDATE users SET role=? WHERE email=?').run(role,email);}finally{db.close();}}

test('payroll actor cannot list or fetch director audit report',async()=>{
  const x=setup();try{
    const report=await makeReport(x,'director-a','audit-evidence');
    assert.deepEqual((await call(x.service,'GET','/api/reporting/reports','payroll-a')).body.reports,[]);
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+report.id,'payroll-a')).status,404);
  }finally{x.close();}
});

test('manager cannot pin, unpin, version, schedule, pause or resume another actor artifacts',async()=>{
  const x=setup();try{
    const report=await makeReport(x,'payroll-a','factory-readiness');
    const pinned=await call(x.service,'POST','/api/reporting/dashboards/pin','payroll-a',{reportId:report.id});
    const schedule=await makeSchedule(x,report.id);
    for(const action of ['pin','unpin'])assert.equal((await call(x.service,'POST','/api/reporting/dashboards/'+action,'manager-a',{reportId:report.id})).status,404);
    for(const enabled of [false,true])assert.equal((await call(x.service,'POST','/api/reporting/schedules/'+schedule.id+'/state','manager-a',{enabled})).status,404);
    assert.equal((await call(x.service,'POST','/api/reporting/reports','manager-a',{versionOf:report.id,definition:{sourceId:'factory-readiness'}})).status,404);
    assert.equal((await call(x.service,'POST','/api/reporting/schedules','manager-a',schedule.schedule)).status,404);
    assert.deepEqual((await call(x.service,'GET','/api/reporting/dashboards','manager-a')).body.dashboards,[]);
    assert.deepEqual((await call(x.service,'GET','/api/reporting/schedules','manager-a')).body.schedules,[]);
    assert.equal((await call(x.service,'GET','/api/reporting/dashboards','payroll-a')).body.dashboards[0].id,pinned.body.dashboard.id);
  }finally{x.close();}
});

test('role revoked after schedule creation blocks due delivery and appends bounded authority-drift evidence',async()=>{
  let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {id:'private-receipt'};}}});try{
    const report=await makeReport(x);await call(x.service,'POST','/api/reporting/dashboards/pin','payroll-a',{reportId:report.id});
    const schedule=await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'private@payroll.example'});
    changeRole(x,'payroll@a.example','manager');
    const blocked=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(sent,0,'revocation must prevent external send');
    assert.equal(blocked[0].status,'BLOCKED_AUTHORITY_DRIFT');
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:30Z'))).length,0);
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+report.id,'payroll-a')).status,404);
    for(const [url,key] of [['reports','reports'],['dashboards','dashboards'],['schedules','schedules'],['deliveries','deliveries']])assert.deepEqual((await call(x.service,'GET','/api/reporting/'+url,'payroll-a')).body[key],[]);
    assert.equal((await call(x.service,'POST','/api/reporting/schedules/'+schedule.id+'/state','payroll-a',{enabled:true})).status,404);
    const db=new DatabaseSync(x.dbPath);try{
      const events=db.prepare("SELECT detail_json FROM vector_report_audit WHERE event='BLOCKED_AUTHORITY_DRIFT'").all();assert.equal(events.length,1);
      assert.doesNotMatch(events[0].detail_json,/private@|private-receipt|Private payroll/);
      assert.equal(db.prepare('SELECT count(*) AS n FROM vector_report_definitions').get().n,1);
    }finally{db.close();}
  }finally{x.close();}
});

test('delivery list hides another actor external destination and receipt metadata',async()=>{
  const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>({destination:'private@payroll.example',receipt:'private-receipt'})}});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'private@payroll.example'});
    await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    const own=await call(x.service,'GET','/api/reporting/deliveries','payroll-a');assert.equal(own.body.deliveries[0].status,'SENT');
    const other=await call(x.service,'GET','/api/reporting/deliveries','manager-a');assert.deepEqual(other.body.deliveries,[]);assert.doesNotMatch(JSON.stringify(other.body),/private@|private-receipt/);
  }finally{x.close();}
});

test('unchanged creator authority survives restart and fresh login with immutable artifacts',async()=>{
  const x=setup();let restarted;try{
    const report=await makeReport(x);const dashboard=(await call(x.service,'POST','/api/reporting/dashboards/pin','payroll-a',{reportId:report.id})).body.dashboard;
    const schedule=await makeSchedule(x,report.id);await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));x.service.close();
    const db=new DatabaseSync(x.dbPath);try{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha('payroll-a'));db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha('fresh-payroll'),'payroll@a.example',Date.now()+3600000);}finally{db.close();}
    restarted=Reporting.createVectorReportingService({dbPath:x.dbPath});
    assert.deepEqual((await call(restarted,'GET','/api/reporting/reports/'+report.id,'fresh-payroll')).body.report,report);
    assert.equal((await call(restarted,'GET','/api/reporting/dashboards','fresh-payroll')).body.dashboards[0].id,dashboard.id);
    assert.equal((await call(restarted,'GET','/api/reporting/schedules','fresh-payroll')).body.schedules[0].id,schedule.id);
    assert.equal((await call(restarted,'GET','/api/reporting/deliveries','fresh-payroll')).body.deliveries.length,1);
    assert.equal((await restarted.runDueSchedules(new Date('2026-09-24T16:05:00Z'))).length,0);
  }finally{restarted?.close();x.close();}
});

test('cross-tenant 404 and append-only triggers preserve every persisted artifact',async()=>{
  const x=setup();try{
    const report=await makeReport(x);await call(x.service,'POST','/api/reporting/dashboards/pin','payroll-a',{reportId:report.id});const schedule=await makeSchedule(x,report.id);await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+report.id,'manager-b')).status,404);
    assert.equal((await call(x.service,'POST','/api/reporting/schedules/'+schedule.id+'/state','manager-b',{enabled:false})).status,404);
    const db=new DatabaseSync(x.dbPath);try{
      for(const table of ['vector_report_definitions','vector_report_dashboards','vector_report_schedules','vector_report_schedule_events','vector_report_deliveries','vector_report_audit']){
        assert.throws(()=>db.exec('DELETE FROM '+table),/immutable|append only/i);
        assert.throws(()=>db.exec('UPDATE '+table+' SET tenant=tenant'),/immutable|append only/i);
      }
    }finally{db.close();}
  }finally{x.close();}
});

test('DST spring-forward and repeated fall-back local slots deliver only once',async()=>{
  let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {id:'dst'};}}});try{
    const report=await makeReport(x,'manager-a','factory-readiness');await makeSchedule(x,report.id,'manager-a',{hour:1,minute:30,timeZone:'Europe/London',delivery:'email_link',destination:'manager@example.test'});
    assert.equal((await x.service.runDueSchedules(new Date('2026-03-29T00:30:00Z'))).length,0);
    assert.equal((await x.service.runDueSchedules(new Date('2026-03-29T01:30:00Z'))).length,0,'nonexistent spring local slot must not deliver');
    assert.equal((await x.service.runDueSchedules(new Date('2026-10-25T00:30:00Z'))).length,1);
    assert.equal((await x.service.runDueSchedules(new Date('2026-10-25T01:30:00Z'))).length,0);
    assert.equal(sent,1,'duplicate local fall-back slot must not send twice');
  }finally{x.close();}
});

test('current connector authority is required again when due',async()=>{
  let allowed=true,sent=0;const x=setup({deliveryAdapter:{authorize:()=>allowed,deliver:async()=>{sent++;return {};}}});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'sftp',destination:'private/path'});allowed=false;
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')))[0].status,'BLOCKED_AUTHORITY_DRIFT');assert.equal(sent,0);
  }finally{x.close();}
});

test('role change while reading a save request cannot create a newly restricted report',async()=>{
  const x=setup();try{
    const request=Readable.from((async function*(){changeRole(x,'payroll@a.example','manager');yield Buffer.from(JSON.stringify({definition:{sourceId:'payroll-control'}}));})());
    request.method='POST';request.url='/api/reporting/reports';request.headers={cookie:'wfm_session=payroll-a'};
    const response=res();await x.service.handleRequest(request,response);
    assert.equal(response.statusCode,400);
    const db=new DatabaseSync(x.dbPath);try{assert.equal(db.prepare('SELECT count(*) n FROM vector_report_definitions').get().n,0);}finally{db.close();}
  }finally{x.close();}
});

test('delivery rechecks creator role after awaiting connector authorization',async()=>{
  let revoke=false,sent=0;let x;const adapter={authorize:async()=>{if(revoke)changeRole(x,'payroll@a.example','manager');return true;},deliver:async()=>{sent++;return {};}};
  x=setup({deliveryAdapter:adapter});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'private@payroll.example'});revoke=true;
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')))[0].status,'BLOCKED_AUTHORITY_DRIFT');assert.equal(sent,0);
  }finally{x.close();}
});

test('connector role drift blocks delivery even when the source remains permitted',async()=>{
  let drift=false,sent=0;let x;
  const adapter={authorize:async actor=>{if(drift)changeRole(x,'payroll@a.example','manager');return actor.role==='payroll_admin';},deliver:async()=>{sent++;return {};}};
  x=setup({deliveryAdapter:adapter});try{
    const report=await makeReport(x,'payroll-a','factory-readiness');
    const schedule=await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'private@payroll.example'});drift=true;
    const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(result[0].status,'BLOCKED_AUTHORITY_DRIFT');assert.equal(sent,0);
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+report.id,'payroll-a')).status,200,'source still permitted after connector role drift');
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:30Z'))).length,0);
    const db=new DatabaseSync(x.dbPath);try{
      assert.equal(db.prepare("SELECT count(*) n FROM vector_report_audit WHERE event='BLOCKED_AUTHORITY_DRIFT'").get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM vector_report_schedules WHERE id=?').get(schedule.id).n,1);
    }finally{db.close();}
  }finally{x.close();}
});

test('tenant security freeze blocks due delivery with unchanged creator role',async()=>{
  const x=setup();try{
    const report=await makeReport(x);await makeSchedule(x,report.id);
    const db=new DatabaseSync(x.dbPath);try{db.exec("CREATE TABLE identity_tenant_control(tenant TEXT PRIMARY KEY,privileged_freeze INTEGER);INSERT INTO identity_tenant_control VALUES('tenant-a',1)");}finally{db.close();}
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')))[0].status,'BLOCKED_AUTHORITY_DRIFT');
  }finally{x.close();}
});

test('same-tenant manager cannot list or fetch payroll report created by payroll',async()=>{
  const x=setup();
  try{
    const made=await call(x.service,'POST','/api/reporting/reports','payroll-a',{definition:{title:'Restricted payroll',sourceId:'payroll-control'}});
    assert.equal(made.status,201);
    const list=await call(x.service,'GET','/api/reporting/reports','manager-a');
    assert.deepEqual(list.body.reports,[],'manager must not discover the restricted payroll definition');
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+made.body.report.id,'manager-a')).status,404);
  }finally{x.close();}
});

test('definition validation refuses arbitrary fields, sources and privilege escalation',()=>{
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'payroll-control'},'manager'),/not permitted/i);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'https://example.invalid/raw'},'director'),/unknown report source/i);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'factory-readiness',columns:['passwordHash']},'manager'),/not allowed/i);
  const d=Reporting.normaliseDefinition({
    title:'Coverage',
    sourceId:'factory-readiness',
    columns:['department','requiredHours','plannedHours','gapHours'],
    calculations:[{label:'Recomputed gap',left:'requiredHours',operator:'difference',right:'plannedHours'}],
    filters:[{field:'gapHours',operator:'gt',value:0}],
    sorts:[{field:'gapHours',direction:'desc'}],
    comparison:'previous_week'
  },'manager');
  assert.equal(d.endpoint,'/api/readiness');
  assert.equal(d.includeEvidence,true);
  assert.equal(d.calculations[0].operator,'difference');
  assert.match(d.claimBoundary,/Source-bound/);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'factory-readiness',calculations:[{left:'requiredHours',operator:'eval',right:'plannedHours'}]},'manager'),/unsupported calculated metric/i);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'factory-readiness',calculations:[{left:'passwordHash',operator:'sum',right:'plannedHours'}]},'manager'),/approved source fields/i);
});

test('saved reports are tenant isolated, immutable and audited',async()=>{
  const x=setup();
  try{
    const created=await call(x.service,'POST','/api/reporting/reports','manager-a',{definition:{
      title:'Factory gaps',
      sourceId:'factory-readiness',
      columns:['department','requiredHours','plannedHours','gapHours'],
      filters:[{field:'gapHours',operator:'gt',value:0}],
      sorts:[{field:'gapHours',direction:'desc'}]
    }});
    assert.equal(created.status,201);
    assert.match(created.body.report.id,/^vr-/);
    const id=created.body.report.id;

    const listA=await call(x.service,'GET','/api/reporting/reports','manager-a');
    const listB=await call(x.service,'GET','/api/reporting/reports','manager-b');
    assert.equal(listA.status,200);
    assert.equal(listA.body.reports.length,1);
    assert.equal(listB.body.reports.length,0);

    const cross=await call(x.service,'GET','/api/reporting/reports/'+encodeURIComponent(id),'manager-b');
    assert.equal(cross.status,404);

    const employee=await call(x.service,'GET','/api/reporting/catalog','employee-a');
    assert.equal(employee.status,403);

    const auditDenied=await call(x.service,'GET','/api/reporting/audit','manager-a');
    assert.equal(auditDenied.status,403);
    const audit=await call(x.service,'GET','/api/reporting/audit','director-a');
    assert.equal(audit.status,200);
    assert.ok(audit.body.events.some(e=>e.event==='REPORT_CREATED'));

    const db=new DatabaseSync(x.dbPath);
    assert.throws(()=>db.prepare('UPDATE vector_report_definitions SET title=? WHERE id=?').run('mutated',id),/immutable/i);
    db.close();
  }finally{x.close();}
});


test('dashboard pinning creates immutable tenant-bound versions',async()=>{
  const x=setup();
  try{
    const made=await call(x.service,'POST','/api/reporting/reports','manager-a',{definition:{title:'Coverage',sourceId:'factory-readiness',columns:['department','gapHours']}});
    const reportId=made.body.report.id;
    const first=await call(x.service,'POST','/api/reporting/dashboards/pin','manager-a',{reportId});
    assert.equal(first.status,201);
    assert.deepEqual(first.body.dashboard.dashboard.reportIds,[reportId]);
    const second=await call(x.service,'POST','/api/reporting/dashboards/pin','manager-a',{reportId});
    assert.equal(second.status,201);
    assert.equal(second.body.dashboard.versionOf,first.body.dashboard.id);
    assert.deepEqual(second.body.dashboard.dashboard.reportIds,[reportId]);
    const removed=await call(x.service,'POST','/api/reporting/dashboards/unpin','manager-a',{reportId});
    assert.equal(removed.status,201);
    assert.deepEqual(removed.body.dashboard.dashboard.reportIds,[]);
    const other=await call(x.service,'GET','/api/reporting/dashboards','manager-b');
    assert.equal(other.status,200);
    assert.equal(other.body.dashboards.length,0);
    const db=new DatabaseSync(x.dbPath);
    assert.throws(()=>db.prepare('UPDATE vector_report_dashboards SET created_by=? WHERE id=?').run('x',first.body.dashboard.id),/immutable/i);
    db.close();
  }finally{x.close();}
});

test('daily in-app schedules generate one governed delivery per local minute and external delivery fails closed',async()=>{
  const x=setup();
  try{
    const made=await call(x.service,'POST','/api/reporting/reports','manager-a',{definition:{title:'Coverage',sourceId:'factory-readiness',columns:['department','gapHours']}});
    const reportId=made.body.report.id;
    const now=new Date('2026-09-24T16:05:00.000Z');
    const scheduled=await call(x.service,'POST','/api/reporting/schedules','manager-a',{reportId,cadence:'daily',hour:16,minute:5,timeZone:'UTC',delivery:'in_app'});
    assert.equal(scheduled.status,201);
    const deliveries=await x.service.runDueSchedules(now);
    assert.equal(deliveries.length,1);
    assert.equal(deliveries[0].reportId,reportId);
    assert.equal(deliveries[0].status,'READY');
    assert.equal((await x.service.runDueSchedules(now)).length,0,'same local minute must be idempotent');
    const list=await call(x.service,'GET','/api/reporting/deliveries','manager-a');
    assert.equal(list.status,200);
    assert.equal(list.body.deliveries.length,1);
    assert.equal(list.body.deliveries[0].receipt.claimBoundary.includes('live report'),true);
    const scheduleId=scheduled.body.schedule.id;
    const paused=await call(x.service,'POST','/api/reporting/schedules/'+encodeURIComponent(scheduleId)+'/state','manager-a',{enabled:false});
    assert.equal(paused.status,200);
    assert.equal(paused.body.schedule.enabled,false);
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-25T16:05:00.000Z'))).length,0,'paused schedule must not deliver');
    const scheduleList=await call(x.service,'GET','/api/reporting/schedules','manager-a');
    assert.equal(scheduleList.body.schedules[0].enabled,false);
    const blocked=await call(x.service,'POST','/api/reporting/schedules','manager-a',{reportId,cadence:'daily',hour:16,minute:5,timeZone:'UTC',delivery:'email_link',destination:'user@example.com'});
    assert.equal(blocked.status,400);
    assert.match(blocked.body.error,/adapter is not configured/i);
  }finally{x.close();}
});
