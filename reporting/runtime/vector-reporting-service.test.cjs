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
function setup(){
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
  const service=Reporting.createVectorReportingService({dbPath});
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

test('definition validation refuses arbitrary fields, sources and privilege escalation',()=>{
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'payroll-control'},'manager'),/not permitted/i);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'https://example.invalid/raw'},'director'),/unknown report source/i);
  assert.throws(()=>Reporting.normaliseDefinition({sourceId:'factory-readiness',columns:['passwordHash']},'manager'),/not allowed/i);
  const d=Reporting.normaliseDefinition({
    title:'Coverage',
    sourceId:'factory-readiness',
    columns:['department','requiredHours','plannedHours','gapHours'],
    filters:[{field:'gapHours',operator:'gt',value:0}],
    sorts:[{field:'gapHours',direction:'desc'}],
    comparison:'previous_week'
  },'manager');
  assert.equal(d.endpoint,'/api/readiness');
  assert.equal(d.includeEvidence,true);
  assert.match(d.claimBoundary,/Source-bound/);
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
