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

test('director has audit access but cannot create or read payroll reports after role drift',async()=>{
  assert.equal(Reporting.visibleCatalog('director').sources.some(s=>s.id==='payroll-control'),false);
  assert.equal(Reporting.visibleCatalog('director').sources.some(s=>s.id==='audit-evidence'),true);
  const x=setup();try{
    const report=await makeReport(x);changeRole(x,'payroll@a.example','director');
    assert.equal((await call(x.service,'POST','/api/reporting/reports','payroll-a',{definition:{sourceId:'payroll-control'}})).status,400);
    assert.deepEqual((await call(x.service,'GET','/api/reporting/reports','payroll-a')).body.reports,[]);
    assert.equal((await call(x.service,'GET','/api/reporting/reports/'+report.id,'payroll-a')).status,404);
  }finally{x.close();}
});

test('nonprimitive and unknown roles cannot grant any reporting catalog authority',()=>{
  for(const role of [['payroll_admin'],new String('payroll_admin'),{toString:()=> 'payroll_admin'},new Proxy({}, {get:()=>()=> 'payroll_admin'}),'toString','constructor','PAYROLL_ADMIN',' payroll_admin ']){
    assert.equal(Reporting.visibleCatalog(role).sources.length,0);
    assert.throws(()=>Reporting.normaliseDefinition({sourceId:'payroll-control'},role),/not permitted/);
  }
});

test('accessor and inherited actor identities are rejected without evaluating getters',async()=>{
  for(const field of ['email','tenant','role']){
    let reads=0;
    const x=setup({currentUserReader:({email,tenant})=>{
      const actor={email,tenant,role:'manager'};
      Object.defineProperty(actor,field,{get(){reads++;return field==='role'?'payroll_admin':field==='email'?email:tenant;}});
      return actor;
    }});try{
      for(const [method,url,body] of [['GET','/api/reporting/catalog'],['POST','/api/reporting/reports',{definition:{sourceId:'payroll-control'}}]]){
        assert.equal((await call(x.service,method,url,'manager-a',body)).status,401);
      }
      assert.equal(reads,0);
    }finally{x.close();}
  }
  const x=setup({currentUserReader:({email,tenant})=>Object.create({email,tenant,role:'payroll_admin'})});try{
    assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,401);
  }finally{x.close();}
});

test('proxy actors are denied and plain current identity snapshots retain isolation',async()=>{
  for(const proxy of [true,false]){
    const x=setup({currentUserReader:({email,tenant})=>proxy?new Proxy({email,tenant,role:'payroll_admin'},{}):{email:'manager@b.example',tenant:'tenant-b',role:'payroll_admin'}});try{
      assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,401);
    }finally{x.close();}
  }
});

test('public policy records cannot mutate payroll membership or templates',()=>{
  const source=Reporting.SOURCES.find(s=>s.id==='payroll-control');
  const original=source.minRole;
  try{try{source.minRole='manager';}catch{}
    assert.equal(Reporting.visibleCatalog('manager').sources.some(s=>s.id==='payroll-control'),false);
    assert.throws(()=>Reporting.normaliseDefinition({sourceId:'payroll-control'},'manager'),/not permitted/);
    assert.equal(Object.isFrozen(source),true);assert.equal(Object.isFrozen(source.fields),true);
    assert.equal(Object.isFrozen(Reporting.TEMPLATES[0]),true);assert.equal(Object.isFrozen(Reporting.TEMPLATES[0].columns),true);
  }finally{try{source.minRole=original;}catch{}}
});

test('ambient includes and filter changes cannot widen catalog or payroll creation',()=>{
  const includes=Array.prototype.includes,filter=Array.prototype.filter;
  let catalog,denied=false;
  try{
    Array.prototype.includes=()=>true;
    Array.prototype.filter=function(){return this;};
    catalog=Reporting.visibleCatalog('manager');
    try{Reporting.normaliseDefinition({sourceId:'payroll-control'},'manager');}catch{denied=true;}
  }finally{Array.prototype.includes=includes;Array.prototype.filter=filter;}
  assert.equal(catalog.sources.some(s=>s.id==='payroll-control'),false);
  assert.equal(catalog.templates.some(t=>t.sourceId==='payroll-control'),false);
  assert.equal(denied,true);
});

test('accessor identity drift blocks due external delivery without evaluating the accessor',async()=>{
  let poisoned=false,reads=0,sent=0;
  const x=setup({currentUserReader:({email,tenant})=>{
    const actor={email,tenant,role:'payroll_admin'};
    if(poisoned)Object.defineProperty(actor,'role',{get(){reads++;return reads===1?'director':'payroll_admin';}});
    return actor;
  },deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {};}}});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    poisoned=true;
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')))[0].status,'BLOCKED_AUTHORITY_DRIFT');
    assert.equal(sent,0);assert.equal(reads,0);
  }finally{x.close();}
});

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
  const x=setup({deliveryAdapter:{authorize:()=>true,readback:async()=>({observed:true}),deliver:async()=>({destination:'private@payroll.example',receipt:'private-receipt'})}});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'private@payroll.example'});
    await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    const own=await call(x.service,'GET','/api/reporting/deliveries','payroll-a');assert.equal(own.body.deliveries[0].status,'UNKNOWN');
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
  let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,readback:async()=>({observed:true}),deliver:async()=>{sent++;return {id:'dst'};}}});try{
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


test('exact role matrix preserves operational access and explicit privileged memberships',()=>{
  for(const role of ['employee','manager','payroll_admin','director','admin','superuser']){
    const ids=Reporting.visibleCatalog(role).sources.map(source=>source.id);
    assert.equal(ids.includes('factory-readiness'),role!=='employee');
    assert.equal(ids.includes('payroll-control'),['payroll_admin','admin','superuser'].includes(role));
    assert.equal(ids.includes('audit-evidence'),['director','admin','superuser'].includes(role));
  }
});

test('mutation of retained actor object during adapter authorization cannot erase authority drift',async()=>{
  const actor={email:'payroll@a.example',tenant:'tenant-a',role:'payroll_admin'};
  let mutate=false,sent=0;
  const x=setup({currentUserReader:()=>actor,deliveryAdapter:{authorize:async()=>{
    if(mutate)actor.role='admin';
    return true;
  },deliver:async()=>{sent++;return {};}}});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    mutate=true;
    assert.equal((await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')))[0].status,'BLOCKED_AUTHORITY_DRIFT');
    assert.equal(sent,0);
  }finally{x.close();}
});


test('synchronous proxy identity is rejected before await can invoke its then trap',async()=>{
  let traps=0;
  const x=setup({currentUserReader:({email,tenant})=>new Proxy({email,tenant,role:'manager'},{get(target,key){traps++;return target[key];}})});try{
    assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,401);
    assert.equal(traps,0);
  }finally{x.close();}
});

test('async current identity readers retain ordinary manager catalog access',async()=>{
  const x=setup({currentUserReader:async({email,tenant})=>({email,tenant,role:'manager'})});try{
    const result=await call(x.service,'GET','/api/reporting/catalog','manager-a');
    assert.equal(result.status,200);
    assert.equal(result.body.sources.some(source=>source.id==='factory-readiness'),true);
    assert.equal(result.body.sources.some(source=>source.id==='payroll-control'),false);
  }finally{x.close();}
});


test('external adapters without readback stay recommend-only and create no dispatch intent',async()=>{
  let calls=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{calls++;return {};}}});
  try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(result[0].status,'BLOCKED_READBACK_REQUIRED');assert.equal(calls,0);
    const db=new DatabaseSync(x.dbPath);try{assert.equal(db.prepare('SELECT count(*) n FROM vector_report_delivery_intents').get().n,0);}finally{db.close();}
  }finally{x.close();}
});
for(const responseLost of [false,true])test('durable intent precedes send; '+(responseLost?'response loss':'response alone')+' remains UNKNOWN after independent readback',async()=>{
  let sent=0,read=0,seen;let x;
  const adapter={authorize:()=>true,deliver:async payload=>{
    sent++;seen=payload;const db=new DatabaseSync(x.dbPath);try{
      assert.ok(db.prepare('SELECT * FROM vector_report_delivery_intents WHERE delivery_key=?').get(payload.idempotencyKey));
      assert.throws(()=>db.exec('DELETE FROM vector_report_delivery_intents'),/reviewed reconciliation/);
    }finally{db.close();}
    if(responseLost)throw Error('synthetic accepted response lost');return {accepted:true,secret:'must not persist'};
  },readback:async payload=>{read++;assert.equal(payload,seen);return {observed:true,secret:'must not persist'};}};
  x=setup({deliveryAdapter:adapter});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(result[0].status,'UNKNOWN');assert.equal(sent,1);assert.equal(read,1);assert.equal(Object.isFrozen(seen),true);
    assert.equal(result[0].externalReceipt.reconciliationRequired,true);assert.match(result[0].externalReceipt.readbackDigest,/^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result),/must not persist/);
    await x.service.runDueSchedules(new Date('2026-09-25T16:05:00Z'));assert.equal(sent,1);
  }finally{x.close();}
});
test('two service instances cannot send the same slot twice',async()=>{
  let sent=0,read=0;const adapter={authorize:()=>true,deliver:async()=>{sent++;await new Promise(r=>setTimeout(r,20));return {};},readback:async()=>{read++;return {};}};
  const x=setup({deliveryAdapter:adapter});let second;
  try{const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    second=Reporting.createVectorReportingService({dbPath:x.dbPath,deliveryAdapter:adapter});
    await Promise.all([x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z')),second.runDueSchedules(new Date('2026-09-24T16:05:00Z'))]);
    assert.equal(sent,1);assert.equal(read,1);
    const listed=await call(x.service,'GET','/api/reporting/deliveries','payroll-a');
    assert.equal(listed.body.deliveries[0].observations.length,1);
    assert.match(listed.body.deliveries[0].observations[0].receipt.readbackDigest,/^[a-f0-9]{64}$/);
  }finally{second?.close();x.close();}
});
test('pause during awaited connector authorization prevents intent and dispatch',async()=>{
  let pause=false,sent=0,x,scheduleId;
  const adapter={authorize:async()=>{
    if(pause){const db=new DatabaseSync(x.dbPath);try{db.prepare('INSERT INTO vector_report_schedule_events(tenant,schedule_id,enabled,actor,created_at) VALUES(?,?,?,?,?)').run('tenant-a',scheduleId,0,'payroll@a.example',new Date().toISOString());}finally{db.close();}}
    return true;
  },deliver:async()=>{sent++;return {};},readback:async()=>({})};
  x=setup({deliveryAdapter:adapter});try{
    const report=await makeReport(x);scheduleId=(await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'})).id;
    pause=true;const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(result[0].status,'BLOCKED_SCHEDULE_PAUSED');assert.equal(sent,0);
  }finally{x.close();}
});
test('worker death after intent commit retains quarantine across restart, replacement report/schedule and later slot; other tenant continues',async()=>{
  const {spawnSync}=require('node:child_process');let sent=0;
  const adapter={authorize:()=>true,deliver:async()=>{sent++;return {};},readback:async()=>({})};
  const x=setup({deliveryAdapter:adapter});let restarted;
  try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'Synthetic@Example.Test'});
    const marker=path.join(x.dir,'dispatch.marker');
    const child=spawnSync(process.execPath,['-e',`const R=require(${JSON.stringify(require.resolve('./vector-reporting-service.cjs'))}); const fs=require('node:fs'); const s=R.createVectorReportingService({dbPath:process.argv[1],deliveryAdapter:{authorize:()=>true,readback:async()=>({}),deliver:async()=>{fs.appendFileSync(process.argv[2],'applied\\n');process.exit(23);}}});s.runDueSchedules(new Date('2026-09-24T16:05:00Z'));`,x.dbPath,marker],{encoding:'utf8',timeout:15000});
    assert.equal(child.status,23,child.stderr);assert.match(fs.readFileSync(marker,'utf8'),/applied/);
    restarted=Reporting.createVectorReportingService({dbPath:x.dbPath,deliveryAdapter:adapter});
    const pending=await call(restarted,'GET','/api/reporting/deliveries','payroll-a');
    assert.equal(pending.body.deliveries[0].status,'UNKNOWN');
    assert.equal(pending.body.deliveries[0].receipt.externalReceipt.dispatchOutcome,'UNKNOWN');
    assert.deepEqual((await call(restarted,'GET','/api/reporting/deliveries','manager-a')).body.deliveries,[]);
    const recovered=await restarted.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(recovered[0].status,'UNKNOWN');assert.equal(recovered[0].externalReceipt.dispatchOutcome,'UNKNOWN');
    const replacement=await makeReport(x);await makeSchedule(x,replacement.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const other=await makeReport(x,'manager-b','factory-readiness');await makeSchedule(x,other.id,'manager-b',{delivery:'email_link',destination:'synthetic@example.test'});
    const next=await restarted.runDueSchedules(new Date('2026-09-25T16:05:00Z'));
    assert.equal(next.filter(r=>r.status==='BLOCKED_RECONCILIATION_REQUIRED').length,2);assert.equal(sent,1,'only independent other tenant dispatches');
  }finally{restarted?.close();x.close();}
});

test('separate worker processes race through one durable dispatch claim',async()=>{
  const {spawn}=require('node:child_process');const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>({}),readback:async()=>({})}});
  try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const marker=path.join(x.dir,'race.marker');
    const script=`const R=require(${JSON.stringify(require.resolve('./vector-reporting-service.cjs'))});const fs=require('node:fs');const s=R.createVectorReportingService({dbPath:process.argv[1],deliveryAdapter:{authorize:()=>true,deliver:async()=>{fs.appendFileSync(process.argv[2],'applied\\n');await new Promise(r=>setTimeout(r,100));return {};},readback:async()=>({observed:true})}});s.runDueSchedules(new Date('2026-09-24T16:05:00Z')).then(()=>{s.close();},e=>{console.error(e);s.close();process.exitCode=1;});`;
    const run=()=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['-e',script,x.dbPath,marker],{stdio:['ignore','ignore','pipe']});let err='';
      child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('child exit '+code+' '+err)));
    });
    await Promise.all([run(),run()]);assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,1);
    const deliveries=await call(x.service,'GET','/api/reporting/deliveries','payroll-a');
    assert.equal(deliveries.body.deliveries.length,1);assert.equal(deliveries.body.deliveries[0].status,'UNKNOWN');
    assert.equal(deliveries.body.deliveries[0].observations.length,1);
  }finally{x.close();}
});
test('readback failure never releases quarantine or claims send failure',async()=>{
  let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {accepted:true};},readback:async()=>{throw Error('synthetic provider read unavailable');}}});
  try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));assert.equal(result[0].status,'UNKNOWN');
    assert.match(result[0].externalReceipt.readbackErrorDigest,/^[a-f0-9]{64}$/);assert.equal(result[0].externalReceipt.reconciliationRequired,true);
    await x.service.runDueSchedules(new Date('2026-09-25T16:05:00Z'));assert.equal(sent,1);
  }finally{x.close();}
});

test('authority revoked during dispatch blocks external readback while preserving UNKNOWN',async()=>{
  let reads=0,x;const adapter={authorize:()=>true,deliver:async()=>{changeRole(x,'payroll@a.example','director');return {accepted:true};},readback:async()=>{reads++;return {};}};
  x=setup({deliveryAdapter:adapter});try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(result[0].status,'UNKNOWN');assert.equal(reads,0);assert.equal(result[0].externalReceipt.readbackAttempted,false);
    assert.equal(result[0].externalReceipt.reconciliationRequired,true);
  }finally{x.close();}
});
for(const status of ['SENT','FAILED'])test('historical response-only '+status+' receipt contains replacement schedule after upgrade',async()=>{
  let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {};},readback:async()=>({})}});
  try{
    const oldReport=await makeReport(x);const oldSchedule=await makeSchedule(x,oldReport.id,'payroll-a',{delivery:'email_link',destination:'Synthetic@Example.Test'});
    const db=new DatabaseSync(x.dbPath);try{db.prepare('INSERT INTO vector_report_deliveries VALUES(?,?,?,?,?,?,?,?)').run(oldSchedule.id+':old','tenant-a',oldSchedule.id,oldReport.id,'email_link',status,JSON.stringify({status}),new Date().toISOString());}finally{db.close();}
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    const result=await x.service.runDueSchedules(new Date('2026-09-25T16:05:00Z'));
    assert.equal(result.length,2);assert.ok(result.every(r=>r.status==='BLOCKED_RECONCILIATION_REQUIRED'));assert.equal(sent,0);
  }finally{x.close();}
});

test('identity change on final preclaim read cannot replace the actor authorized for dispatch',async()=>{
  let armed=false,reads=0,sent=0;
  const x=setup({currentUserReader:({email,tenant})=>{
    if(armed)reads++;
    return {email,tenant,role:armed&&reads===6?'employee':'payroll_admin'};
  },deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return {};},readback:async()=>({})}});
  try{
    const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});
    // Selection read + schedule/report/recheck/final authorization reads =5;
    // the sixth read is the last preclaim snapshot after access resolves.
    armed=true;const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
    assert.equal(reads,6);assert.equal(result[0].status,'BLOCKED_AUTHORITY_DRIFT');assert.equal(sent,0);
  }finally{x.close();}
});
