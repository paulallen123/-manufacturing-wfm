'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSchedulingIntelligenceService}=require('./scheduling-intelligence-service.cjs');
function hash(v){return createHash('sha256').update(String(v)).digest('hex');}
function res(){return {statusCode:200,headers:{},headersSent:false,writableEnded:false,body:'',setHeader(k,v){this.headers[k]=v;},end(v=''){this.body=String(v);this.writableEnded=true;this.headersSent=true;}};}
function req(method,url,{body,cookie,headers={}}={}){const r=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);r.method=method;r.url=url;r.headers={...headers};if(cookie)r.headers.cookie=cookie;return r;}
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-schedule-')),dbPath=path.join(dir,'db.sqlite'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
 db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('m@test','alpha','manager');db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('e@test','alpha','employee');
 db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('mgr'),'m@test',Date.now()+60000);db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('emp'),'e@test',Date.now()+60000);db.close();return {dir,dbPath};}
async function call(s,r){const x=res();await s.handleRequest(r,x);return {res:x,json:x.body?JSON.parse(x.body):null};}
function input(){return {contextRevision:'twin:1',sourceEvidence:['mes:1','hr:1'],workers:[{id:'w1',type:'EMPLOYEE',status:'ACTIVE',homeSite:'a',eligibleSites:['a'],skills:['s1'],certifications:[{name:'c1',expiresAt:'2027-01-01T00:00:00Z'}],availability:[{start:'2026-09-24T05:00:00Z',end:'2026-09-24T15:00:00Z'}],previousShiftEnd:'2026-09-23T18:00:00Z',hoursWorkedWeek:8,contractedHours:40,hourlyCost:20}],requirements:[{id:'r1',site:'a',line:'l1',role:'op',start:'2026-09-24T06:00:00Z',end:'2026-09-24T14:00:00Z',headcount:1,requiredSkills:['s1'],requiredCertifications:['c1'],evidenceRefs:['mes:1']} ]};}
test('internal shadow plan is authenticated and idempotent',async()=>{const f=fixture(),events=[],s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret',publishEvent:e=>events.push(e)});try{
 let x=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'bad'}}));assert.equal(x.res.statusCode,403);
 x=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'secret'}}));assert.equal(x.res.statusCode,201);assert.equal(x.json.plan.executionPermitted,false);
 const y=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'secret'}}));assert.equal(y.res.statusCode,200);assert.equal(y.json.idempotent,true);assert.equal(events.length,1);
}finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}});
test('manager capabilities work and employee access is denied',async()=>{const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
 const m=await call(s,req('GET','/api/operations/scheduling/capabilities',{cookie:'wfm_session=mgr'}));assert.equal(m.res.statusCode,200);assert.equal(m.json.tableStakes.shiftSwapValidation,true);
 const e=await call(s,req('GET','/api/operations/scheduling/capabilities',{cookie:'wfm_session=emp'}));assert.equal(e.res.statusCode,403);
}finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}});
test('manager what-if never persists or grants execution authority',async()=>{const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
 const x=await call(s,req('POST','/api/operations/scheduling/what-if',{cookie:'wfm_session=mgr',body:{input:input()}}));assert.equal(x.res.statusCode,200);assert.equal(x.json.scenarioOnly,true);assert.equal(x.json.plan.executionPermitted,false);
 const p=await call(s,req('GET','/api/operations/scheduling/plans',{cookie:'wfm_session=mgr'}));assert.equal(p.json.plans.length,0);
}finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}});
test('stored plan can be repaired in shadow mode after no-show',async()=>{const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
 const created=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'secret'}}));
 const workers=[input().workers[0],{...input().workers[0],id:'w2',hourlyCost:22}];
 const x=await call(s,req('POST','/api/operations/scheduling/repair/shadow',{body:{tenant:'alpha',priorPlanId:created.json.plan.planId,input:{workers,contextRevision:'twin:2',event:{type:'NO_SHOW',unavailableWorkerIds:['w1'],evidenceRef:'clock:1'},sourceEvidence:['clock:1']}},headers:{'x-wfm-scheduling-internal':'secret'}}));
 assert.equal(x.res.statusCode,201);assert.equal(x.json.repair.executionPermitted,false);assert.equal(x.json.repair.repairedPlan.assignments[0].workerId,'w2');
}finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}});
