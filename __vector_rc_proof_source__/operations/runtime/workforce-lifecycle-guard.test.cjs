'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createWorkforceLifecycleGuard,evaluateEvent}=require('./workforce-lifecycle-guard.cjs');

const starter=(id='E1',at='2026-09-01T08:00:00Z')=>({id:'s1',kind:'STARTER',status:'ACCEPTED',employeeId:id,effectiveAtMs:Date.parse(at),payload:{location:'Plant 1',department:'Production'}});

test('clocking handles overnight shift evidence and rejects duplicate or post-leaver clocks',()=>{
  const prior=[starter()];
  const overnightIn=evaluateEvent(prior,{kind:'CLOCK',employeeId:'E1',effectiveAt:'2026-09-10T22:00:00Z',payload:{clockType:'IN'}});
  assert.equal(overnightIn.status,'ACCEPTED');
  const withIn=[...prior,{id:'c1',kind:'CLOCK',status:'ACCEPTED',employeeId:'E1',effectiveAtMs:Date.parse('2026-09-10T22:00:00Z'),payload:{clockType:'IN'}}];
  assert.equal(evaluateEvent(withIn,{kind:'CLOCK',employeeId:'E1',effectiveAt:'2026-09-10T22:00:00Z',payload:{clockType:'IN'}}).reasonCode,'DUPLICATE_CLOCK');
  assert.equal(evaluateEvent(withIn,{kind:'CLOCK',employeeId:'E1',effectiveAt:'2026-09-11T06:00:00Z',payload:{clockType:'OUT'}}).status,'ACCEPTED');
  const left=[...withIn,{id:'l1',kind:'LEAVER',status:'ACCEPTED',employeeId:'E1',effectiveAtMs:Date.parse('2026-09-30T17:00:00Z'),payload:{}}];
  assert.equal(evaluateEvent(left,{kind:'CLOCK',employeeId:'E1',effectiveAt:'2026-10-01T08:00:00Z',payload:{clockType:'IN'}}).reasonCode,'CLOCK_OUTSIDE_EMPLOYMENT');
});

test('absence windows cannot silently extend beyond employment',()=>{
  const prior=[starter(),{id:'l1',kind:'LEAVER',status:'ACCEPTED',employeeId:'E1',effectiveAtMs:Date.parse('2026-09-30T17:00:00Z'),payload:{}}];
  assert.equal(evaluateEvent(prior,{kind:'ABSENCE',employeeId:'E1',effectiveAt:'2026-09-20T00:00:00Z',payload:{endAt:'2026-09-21T00:00:00Z'}}).status,'ACCEPTED');
  assert.equal(evaluateEvent(prior,{kind:'ABSENCE',employeeId:'E1',effectiveAt:'2026-09-29T00:00:00Z',payload:{endAt:'2026-10-02T00:00:00Z'}}).reasonCode,'ABSENCE_AFTER_LEAVER');
});

test('overtime override requires explicit approval and never directly mutates payroll',()=>{
  const prior=[starter()];
  const pending=evaluateEvent(prior,{kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-15T18:00:00Z',payload:{minutes:120}});
  assert.equal(pending.status,'REQUIRES_APPROVAL');
  assert.equal(pending.payrollMutation,false);
  const approved=evaluateEvent(prior,{kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-15T18:00:00Z',payload:{minutes:120,approvalRef:'APR-1',approvedBy:'manager@alpha'}});
  assert.equal(approved.status,'ACCEPTED');
  assert.equal(approved.payrollMutation,false);
});

test('agency assignments require bounded valid windows and reject overlaps',()=>{
  const prior=[starter()];
  const first=evaluateEvent(prior,{kind:'AGENCY_ASSIGNMENT',employeeId:'E1',effectiveAt:'2026-09-01T08:00:00Z',payload:{agencyId:'A1',endAt:'2026-09-30T17:00:00Z'}});
  assert.equal(first.status,'ACCEPTED');
  const withAgency=[...prior,{id:'a1',kind:'AGENCY_ASSIGNMENT',status:'ACCEPTED',employeeId:'E1',effectiveAtMs:Date.parse('2026-09-01T08:00:00Z'),payload:{agencyId:'A1',endAt:'2026-09-30T17:00:00Z'}}];
  assert.equal(evaluateEvent(withAgency,{kind:'AGENCY_ASSIGNMENT',employeeId:'E1',effectiveAt:'2026-09-15T08:00:00Z',payload:{agencyId:'A2',endAt:'2026-10-01T17:00:00Z'}}).reasonCode,'OVERLAPPING_AGENCY_ASSIGNMENT');
});

test('starter transfer leaver are effective-dated and fail closed outside employment',()=>{
  const prior=[starter()];
  assert.equal(evaluateEvent(prior,{kind:'TRANSFER',employeeId:'E1',effectiveAt:'2026-09-15T00:00:00Z',payload:{location:'Plant 2'}}).status,'ACCEPTED');
  const left=[...prior,{id:'l1',kind:'LEAVER',status:'ACCEPTED',employeeId:'E1',effectiveAtMs:Date.parse('2026-09-30T17:00:00Z'),payload:{}}];
  assert.equal(evaluateEvent(left,{kind:'TRANSFER',employeeId:'E1',effectiveAt:'2026-10-01T00:00:00Z',payload:{location:'Plant 3'}}).reasonCode,'TRANSFER_OUTSIDE_EMPLOYMENT');
  assert.equal(evaluateEvent(left,{kind:'LEAVER',employeeId:'E1',effectiveAt:'2026-10-02T00:00:00Z',payload:{}}).reasonCode,'LEAVER_OUTSIDE_EMPLOYMENT');
});

test('retro changes preserve the original event and require evidence',()=>{
  const prior=[starter()];
  const denied=evaluateEvent(prior,{kind:'RETRO_CHANGE',employeeId:'E1',effectiveAt:'2026-09-10T00:00:00Z',payload:{targetEventId:'s1'}});
  assert.equal(denied.reasonCode,'RETRO_EVIDENCE_REQUIRED');
  const accepted=evaluateEvent(prior,{kind:'RETRO_CHANGE',employeeId:'E1',effectiveAt:'2026-09-10T00:00:00Z',payload:{targetEventId:'s1',reason:'Correct location',approvalRef:'APR-RETRO-1'}});
  assert.equal(accepted.status,'ACCEPTED');
  assert.equal(accepted.originalEventPreserved,true);
});

test('integration outage cannot delete source data and recovery requires a checkpoint',()=>{
  const outage=evaluateEvent([],{kind:'INTEGRATION_OUTAGE',sourceKey:'workday',effectiveAt:'2026-09-18T10:00:00Z',payload:{}});
  assert.equal(outage.status,'ACCEPTED');
  assert.equal(outage.sourceDataDeleted,false);
  const prior=[{id:'o1',kind:'INTEGRATION_OUTAGE',status:'ACCEPTED',sourceKey:'workday',effectiveAtMs:Date.parse('2026-09-18T10:00:00Z'),payload:{}}];
  assert.equal(evaluateEvent(prior,{kind:'INTEGRATION_RECOVERY',sourceKey:'workday',effectiveAt:'2026-09-18T10:10:00Z',payload:{}}).reasonCode,'RECOVERY_CHECKPOINT_REQUIRED');
  assert.equal(evaluateEvent(prior,{kind:'INTEGRATION_RECOVERY',sourceKey:'workday',effectiveAt:'2026-09-18T10:10:00Z',payload:{checkpoint:'page-42'}}).status,'ACCEPTED');
});

function sha(v){return createHash('sha256').update(String(v)).digest('hex');}
function response(){return{statusCode:200,headersSent:false,writableEnded:false,body:'',setHeader(){},end(v=''){this.body=String(v);this.headersSent=true;this.writableEnded=true;}};}
async function call(engine,token,method,url,body,headers={}){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=method;req.url=url;
  req.headers={...(token?{cookie:'wfm_session='+token}:{}),...headers};const res=response();
  assert.equal(await engine.handleRequest(req,res),true);return{status:res.statusCode,body:res.body?JSON.parse(res.body):null};
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-lifecycle-'));const dbPath=path.join(dir,'db.sqlite');const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha',1,'{}');db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo',1,'{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha','alpha','m1','manager',1,'s','00','[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@bravo','bravo','m2','manager',1,'s','00','[]');
  const ta='a'.repeat(64),tb='b'.repeat(64);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(ta),'manager@alpha',Date.now()+60000);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(tb),'manager@bravo',Date.now()+60000);db.close();
  const engine=createWorkforceLifecycleGuard({dbPath,internalToken:'trusted-worker-token'});
  return{dir,dbPath,engine,ta,tb,close(){engine.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('HTTP lifecycle ingestion is idempotent, append-only and tenant isolated',async()=>{
  const f=fixture();try{
    const h={'x-wfm-integration-internal':'trusted-worker-token'};
    const body={tenant:'alpha',eventKey:'starter-1',kind:'STARTER',employeeId:'E1',effectiveAt:'2026-09-01T08:00:00Z',payload:{location:'Plant 1',department:'Production'}};
    const one=await call(f.engine,null,'POST','/api/workforce/lifecycle/event',body,h);assert.equal(one.status,201);
    const replay=await call(f.engine,null,'POST','/api/workforce/lifecycle/event',body,h);assert.equal(replay.status,200);assert.equal(replay.body.idempotent,true);
    const alpha=await call(f.engine,f.ta,'GET','/api/workforce/lifecycle/status');const bravo=await call(f.engine,f.tb,'GET','/api/workforce/lifecycle/status');
    assert.equal(alpha.body.eventCount,1);assert.equal(bravo.body.eventCount,0);
    const db=new DatabaseSync(f.dbPath);
    assert.throws(()=>db.exec("UPDATE workforce_lifecycle_events SET status='ACCEPTED'"),/append only/);
    assert.throws(()=>db.exec('DELETE FROM workforce_lifecycle_events'),/append only/);
    db.close();
  }finally{f.close();}
});
