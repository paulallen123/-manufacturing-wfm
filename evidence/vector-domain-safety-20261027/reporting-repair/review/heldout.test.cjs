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

test('proxy descriptor traps and revoked proxy actors are rejected without trap execution',async()=>{
 let traps=0;
 const revoked=Proxy.revocable({email:'manager@a.example',tenant:'tenant-a',role:'admin'},{});revoked.revoke();
 for(const candidate of [new Proxy({},{getOwnPropertyDescriptor(){traps++;throw Error('trap');},get(){traps++;throw Error('trap');}}),revoked.proxy]){
  const x=setup({currentUserReader:()=>candidate});try{assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,401);}finally{x.close();}
 }
 assert.equal(traps,0);
});

test('null-prototype own primitive actors work while boxed identity fields fail closed',async()=>{
 for(const field of ['email','tenant','role',null]){
  const x=setup({currentUserReader:({email,tenant})=>{
   const actor=Object.assign(Object.create(null),{email,tenant,role:'manager'});
   if(field)actor[field]=new String(actor[field]);return actor;
  }});try{assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,field?401:200);}finally{x.close();}
 }
});

test('reader receives frozen identity binding and cannot rewrite refresh tenant',async()=>{
 let observed=false;
 const x=setup({currentUserReader:principal=>{
  observed=true;assert.equal(Object.isFrozen(principal),true);
  assert.throws(()=>{principal.tenant='tenant-b';},TypeError);
  return {email:principal.email,tenant:'tenant-b',role:'admin'};
 }});try{assert.equal((await call(x.service,'GET','/api/reporting/catalog','manager-a')).status,401);assert.equal(observed,true);}finally{x.close();}
});

test('retained actor email or tenant mutation during external authorization blocks delivery',async()=>{
 for(const field of ['email','tenant']){
  const actor={email:'payroll@a.example',tenant:'tenant-a',role:'payroll_admin'};let drift=false,sent=0;
  const x=setup({currentUserReader:()=>actor,deliveryAdapter:{authorize:async()=>{
   if(drift)actor[field]=field==='email'?'manager@b.example':'tenant-b';return true;
  },deliver:async()=>{sent++;return {};}}});
  try{const report=await makeReport(x);await makeSchedule(x,report.id,'payroll-a',{delivery:'email_link',destination:'synthetic@example.test'});drift=true;
   const result=await x.service.runDueSchedules(new Date('2026-09-24T16:05:00Z'));
   assert.equal(result[0].status,'BLOCKED_AUTHORITY_DRIFT');assert.equal(sent,0);
  }finally{x.close();}
 }
});

test('public catalog views cannot overwrite source authority or nested template policy',()=>{
 const view=Reporting.visibleCatalog('admin');const payroll=view.sources.find(x=>x.id==='payroll-control');
 assert.throws(()=>Object.defineProperty(payroll,'minRole',{value:'manager'}),TypeError);
 assert.throws(()=>payroll.fields.push('secret'),TypeError);
 for(const t of view.templates){assert.equal(Object.isFrozen(t),true);assert.equal(Object.isFrozen(t.columns),true);}
 view.sources.length=0;view.templates.length=0;
 assert.equal(Reporting.visibleCatalog('manager').sources.some(x=>x.id==='payroll-control'),false);
 assert.equal(Reporting.visibleCatalog('admin').sources.length,8);
});

