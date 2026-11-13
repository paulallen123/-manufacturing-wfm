'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require('../reporting/runtime/vector-reporting-service.cjs');

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

async function makeReport(x,token='payroll-a',sourceId='payroll-control'){
  const result=await call(x.service,'POST','/api/reporting/reports',token,{definition:{title:'Private '+sourceId,sourceId}});
  assert.equal(result.status,201);return result.body.report;
}
async function makeSchedule(x,reportId,token='payroll-a',extra={}){
  const result=await call(x.service,'POST','/api/reporting/schedules',token,{reportId,cadence:'daily',hour:16,minute:5,timeZone:'UTC',delivery:'in_app',...extra});
  assert.equal(result.status,201);return result.body.schedule;
}
function changeRole(x,email,role){const db=new DatabaseSync(x.dbPath);try{db.prepare('UPDATE users SET role=? WHERE email=?').run(role,email);}finally{db.close();}}


test('claim storage failure dispatches nothing and permits retry only after storage repair',async()=>{
 let sent=0; const adapter={authorize:()=>true,deliver:async()=>{sent++;return{};},readback:async()=>({})};
 const x=setup({deliveryAdapter:adapter});try{
  const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'sftp',destination:'approved/payroll'});
  const db=new DatabaseSync(x.dbPath);
  try{
   db.exec("CREATE TRIGGER synthetic_storage_failure BEFORE INSERT ON vector_report_delivery_intents BEGIN SELECT RAISE(ABORT,'synthetic storage unavailable'); END;");
   try{await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));}catch(e){assert.match(e.message,/synthetic storage unavailable/);}
   assert.equal(sent,0);assert.equal(db.prepare('SELECT count(*) n FROM vector_report_delivery_intents').get().n,0);
   db.exec('DROP TRIGGER synthetic_storage_failure');
   await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));assert.equal(sent,1);
  }finally{db.close();}
 }finally{x.close();}
});
for(const oldStatus of ['FAILED','SENT'])test('historical '+oldStatus+' external receipt cannot authorize another affected send',async()=>{
 let sent=0;const x=setup({deliveryAdapter:{authorize:()=>true,deliver:async()=>{sent++;return{};},readback:async()=>({})}});
 try{
  const report=await makeReport(x),schedule=await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'old@synthetic.example'});
  const db=new DatabaseSync(x.dbPath);
  try{db.prepare('INSERT INTO vector_report_deliveries VALUES(?,?,?,?,?,?,?,?)').run(schedule.id+':old','tenant-a',schedule.id,report.id,'email_link',oldStatus,'{}','2026-09-23T16:05:00Z');}finally{db.close();}
  const next=await makeReport(x);await makeSchedule(x,next.id,'payroll-a',{delivery:'email_link',destination:'OLD@synthetic.example'});
  await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));assert.equal(sent,0);
 }finally{x.close();}
});
