'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createVectorIntelligenceControlPlane}=require('./vector-intelligence-control-plane.cjs');

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-intelligence-'));
  const dbPath=path.join(dir,'test.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('ops@example.com','tenant-a','Operations Manager');
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256('token'),'ops@example.com',Date.now()+60000);
  db.close();
  return {dir,dbPath};
}
function req(url,method='GET',body=null){
  const chunks=body?[Buffer.from(JSON.stringify(body))]:[];
  return {
    url,method,headers:{cookie:'wfm_session=token'},
    async *[Symbol.asyncIterator](){for(const c of chunks)yield c;}
  };
}
function res(){
  return {
    headersSent:false,writableEnded:false,headers:{},
    setHeader(k,v){this.headers[k]=v;},
    end(v){this.body=v;this.writableEnded=true;}
  };
}

test('status exposes role-aware capability surface',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req('/api/intelligence/vector/status'),response);
  assert.equal(response.statusCode,200);
  const body=JSON.parse(response.body);
  assert.equal(body.role,'OPS_MANAGER');
  assert.equal(body.scope,'MULTI_SITE');
  assert.equal(body.capabilities.analysis,true);
  cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('report requests generate a scoped stored report immediately',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{
    text:'create a weekly labour report',currentScreen:'costs',siteCount:4,siteIds:['a','b','c','d'],snapshot:{site:'All sites',metrics:[{label:'Labour vs plan',value:'-4.8%',detail:'Verified current value'}],decisionLens:{soWhat:'Labour is below plan overall.',nextAction:'Review sites above plan before adding labour.'}}
  }),response);
  assert.equal(response.statusCode,202);
  const body=JSON.parse(response.body);
  assert.equal(body.envelope.command.intent,'CREATE_REPORT');
  assert.equal(body.status,'READY');
  assert.equal(body.created.kind,'REPORT');
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT status,detail_json FROM vector_reports').get();
  assert.equal(row.status,'READY');
  const detail=JSON.parse(row.detail_json);
  assert.match(detail.report.markdown,/Labour vs plan: -4.8%/);
  assert.match(detail.report.markdown,/Review sites above plan/);
  db.close();cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('tasks are created immediately inside user scope',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{
    text:'set a task to review agency spend',currentScreen:'agency'
  }),response);
  const body=JSON.parse(response.body);
  assert.equal(body.envelope.command.intent,'CREATE_TASK');
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT status,title FROM vector_tasks').get();
  assert.equal(row.status,'OPEN');
  assert.match(row.title,/agency spend/i);
  db.close();cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('dashboard changes persist as active preferences',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{
    text:'change this graph to a line chart',currentScreen:'insights'
  }),response);
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT kind,status FROM vector_dashboard_preferences').get();
  assert.equal(row.kind,'CHANGE_CHART');
  assert.equal(row.status,'ACTIVE');
  db.close();cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});


test('email report fails closed when no email provider is configured',async()=>{
  const s=setup();delete process.env.WFM_VECTOR_EMAIL_PROVIDER;const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{
    text:'email this report to me',currentScreen:'costs',snapshot:{metrics:[{label:'Cost',value:'£100'}]}
  }),response);
  const body=JSON.parse(response.body);
  assert.equal(body.status,'READY_NOT_SENT');
  assert.equal(body.created.delivery,'EMAIL');
  assert.equal(body.created.status,'READY_NOT_SENT');
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT status FROM vector_reports').get();
  assert.equal(row.status,'READY_NOT_SENT');
  db.close();cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('report and task list endpoints return tenant-scoped entities',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{text:'create a labour report',snapshot:{metrics:[{label:'Coverage',value:'98%'}]}}),res());
  await cp.handleRequest(req('/api/intelligence/vector/command','POST',{text:'set a task to review agency spend'}),res());
  const rr=res(),tr=res();
  await cp.handleRequest(req('/api/intelligence/vector/reports'),rr);
  await cp.handleRequest(req('/api/intelligence/vector/tasks'),tr);
  assert.equal(JSON.parse(rr.body).reports.length,1);
  assert.equal(JSON.parse(tr.body).tasks.length,1);
  cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('unauthenticated requests fail closed',async()=>{
  const s=setup();const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  const request=req('/api/intelligence/vector/status');request.headers={};
  await cp.handleRequest(request,response);
  assert.equal(response.statusCode,401);
  cp.close();fs.rmSync(s.dir,{recursive:true,force:true});
});
