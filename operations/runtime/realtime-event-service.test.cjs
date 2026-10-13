'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createRealtimeEventService,roleAllowed}=require('./realtime-event-service.cjs');

test('scheduling events require current source-owned scope on polling and live delivery',async()=>{
 const {createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scheduling-events-')),dbPath=path.join(dir,'db.sqlite'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('left','A','manager');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('left').digest('hex'),'left',Date.now()+60000);
 let permitted=true,checks=0;const s=createRealtimeEventService({dbPath,schedulingEventVisible:(actor,event)=>{checks++;return permitted&&actor.email==='left'&&event.payload.planId==='left-plan';}});
 const request=url=>Object.assign(new EventEmitter(),{url,method:'GET',headers:{cookie:'wfm_session=left'}}),response=()=>Object.assign(new EventEmitter(),{statusCode:200,writableEnded:false,setHeader(){},write(x){this.text=(this.text||'')+x;},end(x=''){this.body=String(x);this.writableEnded=true;}});
 try{
  s.publish({tenant:'A',topic:'scheduling.shadow.updated',audience:'manager',payload:{planId:'left-plan',coveragePct:100}});s.publish({tenant:'A',topic:'scheduling.shadow.updated',audience:'manager',payload:{planId:'right-plan',coveragePct:91}});
  let r=response();await s.handleRequest(request('/api/realtime/events'),r);assert.deepEqual(JSON.parse(r.body).events.map(e=>e.payload.planId),['left-plan']);
  const stream=response();await s.handleRequest(request('/api/realtime/stream'),stream);assert.equal(stream.text.includes('right-plan'),false);
  permitted=false;const before=stream.text;s.publish({tenant:'A',topic:'scheduling.repair.shadow.updated',audience:'manager',payload:{planId:'left-plan'}});assert.equal(stream.text,before,'A revoked hierarchy cannot receive an already-open stream event');
  r=response();await s.handleRequest(request('/api/realtime/events'),r);assert.equal(JSON.parse(r.body).events.length,0);assert.ok(checks>=4);
  db.exec('DELETE FROM sessions');s.publish({tenant:'A',topic:'scheduling.shadow.updated',audience:'manager',payload:{planId:'left-plan'}});assert.equal(stream.writableEnded,true,'Current session revocation closes the stream');
 }finally{s.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
 const fallbackDir=fs.mkdtempSync(path.join(os.tmpdir(),'scheduling-events-closed-')),fallback=new DatabaseSync(path.join(fallbackDir,'db'));fallback.exec('CREATE TABLE users(email TEXT,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT,email TEXT,expires INTEGER);');fallback.close();const closed=createRealtimeEventService({dbPath:path.join(fallbackDir,'db')});try{closed.publish({tenant:'A',topic:'scheduling.shadow.updated',audience:'manager',payload:{planId:'unknown'}});assert.equal(closed.eventsForTenant('A','manager').length,0,'Missing scope callback is unavailable, not tenant-wide authority');}finally{closed.close();fs.rmSync(fallbackDir,{recursive:true,force:true});}
});

test('realtime events are tenant isolated, audience filtered, ordered and replayable',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-realtime-'));
  const dbPath=path.join(dir,'wfm.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  db.close();

  const service=createRealtimeEventService({dbPath});
  const first=service.publish({tenant:'A',topic:'demand.updated',audience:'manager',payload:{kind:'demand'}});
  const second=service.publish({tenant:'A',topic:'workspace.updated',audience:'all',payload:{kind:'workspace'}});
  service.publish({tenant:'B',topic:'workspace.updated',audience:'all',payload:{kind:'other'}});

  assert.deepEqual(service.eventsForTenant('A','manager',0).map(x=>x.topic),['demand.updated','workspace.updated']);
  assert.deepEqual(service.eventsForTenant('A','employee',0).map(x=>x.topic),['workspace.updated']);
  assert.deepEqual(service.eventsForTenant('A','revoked',0),[]);
  assert.deepEqual(service.eventsForTenant('B','manager',0).map(x=>x.topic),['workspace.updated']);
  assert.deepEqual(service.eventsForTenant('A','manager',first.seq).map(x=>x.seq),[second.seq]);
  assert.ok(second.seq>first.seq);
  assert.equal(roleAllowed('employee','manager'),false);
  assert.equal(roleAllowed('admin','manager'),true);

  assert.throws(()=>service.publish({tenant:'A',topic:'bad topic',payload:{}}),/Invalid realtime event topic/);
  assert.throws(()=>service.publish({tenant:'A',topic:'x',payload:{x:'x'.repeat(20000)}}),/too large/);

  const verify=new DatabaseSync(dbPath);
  assert.throws(()=>verify.prepare('UPDATE vector_realtime_events SET topic=? WHERE seq=?').run('x',first.seq),/append only/);
  verify.close();
  service.close();
  fs.rmSync(dir,{recursive:true,force:true});
});

test('unrecognised persisted roles never inherit manager realtime audience',()=>{
  for(const role of ['revoked','unknown','contractor','',null,42]){
    assert.equal(roleAllowed(role,'manager'),false,`role ${String(role)} received manager audience`);
    assert.equal(roleAllowed(role,'admin'),false);
    assert.equal(roleAllowed(role,'all'),false);
  }
  for(const role of ['manager','director','supervisor','company-admin','payroll_admin','admin','superuser','operations','finance']){
    assert.equal(roleAllowed(role,'manager'),true,`recognised ${role} lost manager audience`);
  }
  assert.equal(roleAllowed('employee','manager'),false);
});
