import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync,fork} from 'node:child_process';
import {once} from 'node:events';
import {Readable} from 'node:stream';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=process.env.V036_ATOMICITY_BASELINE==='1';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'vector-kiosk-atomicity-'));
const runtime=path.join(home,'runtime');
const require=createRequire(import.meta.url);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash=x=>createHash('sha256').update(x).digest('hex');
let server,originalServer,originalPersonalStore,unpatchedServer,unpatchedPersonalStore,Personal,E,O,C,W,route,helpers,loadSource,bodySource,schema;
before(async()=>{
 if(process.env.V036_ATOMICITY_RUNTIME)fs.cpSync(process.env.V036_ATOMICITY_RUNTIME,runtime,{recursive:true});
 else execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),runtime],{
  env:{...process.env,TAR_OPTIONS:'--no-same-owner'},stdio:'pipe'});
 originalServer=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8');
 originalPersonalStore=fs.readFileSync(path.join(runtime,'lib/personal-store.cjs'),'utf8');
 const archive=path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
 unpatchedServer=execFileSync('tar',['-xOf',archive,'server.cjs'],{encoding:'utf8'});
 unpatchedPersonalStore=execFileSync('tar',['-xOf',archive,'lib/personal-store.cjs'],{encoding:'utf8'});
 if(!baseline){
  const marker='VECTOR_KIOSK_EVENT_ATOMICITY_V1';
  assert.ok(originalServer.includes(marker)&&originalPersonalStore.includes(marker),'default composition must contain both native kiosk transaction changes');
  const provenance=JSON.parse(fs.readFileSync(path.join(runtime,'LOCAL_PROOF_PROVENANCE.json'),'utf8'));
  const input=provenance.sourceInputs.find(x=>x.path==='scripts/patch-kiosk-atomicity.mjs');
  assert.equal(input?.sha256,hash(fs.readFileSync(path.join(root,'scripts/patch-kiosk-atomicity.mjs'))),'composition must record the patch source');
  for(const file of ['server.cjs','lib/personal-store.cjs']){
   const recorded=provenance.runtimeFiles.find(x=>x.path===file);
   assert.equal(recorded?.sha256,hash(fs.readFileSync(path.join(runtime,file))),'composition must inventory the patched '+file);
  }
  const {patchKioskAtomicitySources}=await import('./patch-kiosk-atomicity.mjs');
  assert.throws(()=>patchKioskAtomicitySources(originalServer,originalPersonalStore),/KIOSK_ATOMICITY_ALREADY_PATCHED/);
 }
 server=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8');
 Personal=require(path.join(runtime,'lib/personal-store.cjs'));E=require(path.join(runtime,'lib/engine'));
 O=require(path.join(runtime,'public/operations-engine.js'));C=require(path.join(runtime,'public/cost-engine.js'));
 W=require(path.join(runtime,'public/core.js'));
 const start=server.indexOf("if(url.pathname==='/api/kiosk/sync'&&req.method==='POST'){");
 const end=server.indexOf("if(url.pathname==='/api/onboarding/accept'",start);
 assert.ok(start>0&&end>start);route=server.slice(start,end);
 helpers=server.split('\n').filter(x=>/^function (tokenHash|kioskDevice|kioskDigest)\(/.test(x)).join('\n');
 loadSource=server.split('\n').find(x=>x.startsWith('function load(tenant)'));
 bodySource=server.split('\n').find(x=>x.startsWith('async function body(req)'));
 const sqlStart=server.indexOf("db.exec(`PRAGMA journal_mode=WAL;")+"db.exec(`".length;
 schema=server.slice(sqlStart,server.indexOf('`);',sqlStart));
});
after(()=>fs.rmSync(home,{recursive:true,force:true}));

const tables=['personal_policy','personal_profile','personal_identity','personal_clock','personal_event','personal_session','personal_receipt','audit_events','kiosk_events','kiosk_devices'];
function snapshot(db){return Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));}
function counts(db){return Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT count(*) n FROM '+t).get().n]));}
function fixture(){
 const dir=fs.mkdtempSync(path.join(home,'case-')),file=path.join(dir,'state.sqlite'),db=new DatabaseSync(file);
 db.exec(schema);const personal=Personal.createStore(db),tenant='fictional-alpha',other='fictional-beta';
 let state=E.decorate(W.seed());for(const name of ['cost-engine','payroll-control','work-rules','readiness-engine','schedule-publication','org-admin','onboarding-engine']){
  state=require(path.join(runtime,'public/'+name+'.js')).decorate(state);
 }
 const person=state.staff.find(p=>p.id==='e0');assert.ok(person?.site);
 db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant,state.version,JSON.stringify(state));
 db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(other,state.version,JSON.stringify(state));
 const device='KIOSK-SYNTHETIC-01',secret='v036-fictional-device-secret-0000000000000000000';
 db.prepare('INSERT INTO kiosk_devices VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(device,tenant,person.site,'Fictional kiosk',hash(secret),'active',0,null,'fixture-only',new Date().toISOString(),null);
 const helper=new Function('db','E','createHash','timingSafeEqual',helpers+';return {kioskDevice,kioskDigest};')(db,E,createHash,timingSafeEqual);
 const deps=Object.fromEntries(['P','R','RD','SP','OA','ON'].map((key,i)=>[key,require(path.join(runtime,'public/'+['payroll-control','work-rules','readiness-engine','schedule-publication','org-admin','onboarding-engine'][i]+'.js'))]));
 const load=new Function('db','ON','OA','SP','RD','R','P','C',loadSource+';return load;')(db,deps.ON,deps.OA,deps.SP,deps.RD,deps.R,deps.P,C);
 const body=new Function('E',bodySource+';return body;')(E);
 const handler=new AsyncFunction('req','res','url','db','personal','E','O','C','load','kioskDevice','kioskDigest','body','json',route);
 const reader=new DatabaseSync(file,{readOnly:true}),observed=[];
 // Passive second-connection visibility only. It never changes SQL, throws,
 // delays, terminates a process or interrupts a transaction.
 const prepare=db.prepare.bind(db);
 db.prepare=function(sql){
  const stmt=prepare(sql);if(!sql.startsWith('INSERT INTO kiosk_events('))return stmt;
  return {run(...args){observed.push({...counts(reader),lastSequence:reader.prepare('SELECT last_sequence FROM kiosk_devices WHERE id=?').get(device).last_sequence});return stmt.run(...args);}};
 };
 async function sync(events){
  const req=Object.assign(Readable.from([Buffer.from(JSON.stringify({events}))]),{method:'POST',url:'/api/kiosk/sync',headers:{'content-type':'application/json','x-device-id':device,authorization:'Device '+secret}});
  const res={};await handler(req,res,new URL('http://fixture.invalid/api/kiosk/sync'),db,personal,E,O,C,load,helper.kioskDevice,helper.kioskDigest,body,(_res,status,value)=>{res.status=status;res.body=value;});
  assert.equal(res.status,200);return res.body;
 }
 const at=Date.now()-3600000;
 const event=(id='event-00001',sequence=1,type='in',offset=0)=>({eventId:id,sequence,employee:person.id,type,capturedAt:new Date(at+offset).toISOString(),clockOffsetMs:0});
 const a={tenant,personId:person.id,role:'employee',permissions:[]};
 return {db,reader,file,personal,tenant,other,person,device,secret,a,sync,event,observed,
  close(){if(db.isTransaction)db.exec('ROLLBACK');reader.close();db.close();}};
}

test('personal command composes with an ordinary caller transaction and rolls back as one unit',()=>{
 const f=fixture();try{
  f.personal.register(f.a,{id:f.a.personId,name:'Fictional employee',site:f.person.site});
  const before=snapshot(f.db);f.db.exec('BEGIN IMMEDIATE');
  const input={command:'clock',payload:{revision:0,type:'in'},idempotencyKey:'ordinary-outer-01'};
  const first=f.personal.command(f.a,input,Date.now()-1000,[],{registeredDevice:true});
  const replay=f.personal.command(f.a,input,Date.now(),[],{registeredDevice:true});
  assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);
  assert.equal(f.db.isTransaction,true);assert.equal(counts(f.reader).personal_event,0);
  f.db.exec('ROLLBACK');assert.deepEqual(snapshot(f.db),before);
 }finally{f.close();}
});

test('ordinary inner business refusal preserves the caller transaction and prior caller work',()=>{
 const f=fixture();try{
  f.personal.register(f.a,{id:f.a.personId,name:'Fictional employee',site:f.person.site});
  f.db.exec('CREATE TABLE caller_work(id TEXT PRIMARY KEY)');f.db.exec('BEGIN IMMEDIATE');
  f.db.prepare('INSERT INTO caller_work VALUES(?)').run('retained');
  assert.throws(()=>f.personal.command(f.a,{command:'clock',payload:{revision:0,type:'out'},idempotencyKey:'ordinary-refusal-01'},Date.now(),[],{registeredDevice:true}),error=>!error.message.includes('within a transaction'));
  assert.equal(f.db.isTransaction,true);f.db.exec('COMMIT');
  assert.equal(f.db.prepare('SELECT count(*) n FROM caller_work').get().n,1);assert.equal(counts(f.db).personal_event,0);
 }finally{f.close();}
});

test('standalone personal command retains commit and exact idempotent replay behavior',()=>{
 const f=fixture();try{
  f.personal.register(f.a,{id:f.a.personId,name:'Fictional employee',site:f.person.site});
  const input={command:'clock',payload:{revision:0,type:'in'},idempotencyKey:'standalone-event-01'};
  const result=f.personal.command(f.a,input,Date.now()-1000,[],{registeredDevice:true});
  assert.equal(f.db.isTransaction,false);assert.equal(counts(f.reader).personal_event,1);
  const before=snapshot(f.db),again=f.personal.command(f.a,input,Date.now(),[],{registeredDevice:true});
  assert.equal(again.id,result.id);assert.equal(again.replayed,true);assert.deepEqual(snapshot(f.db),before);
 }finally{f.close();}
});

test('native kiosk event has no separately visible personal commit before receipt and cursor',async()=>{
 const f=fixture();try{
  const r=await f.sync([f.event()]);assert.equal(r.accepted,1);assert.equal(r.held,0);assert.equal(r.lastSequence,1);
  assert.equal(f.observed.length,1);assert.equal(f.observed[0].lastSequence,0);
  for(const t of tables.filter(t=>t!=='kiosk_devices'))assert.equal(f.observed[0][t],0,t+' must remain uncommitted until kiosk receipt/cursor commit');
  const s=snapshot(f.reader);assert.equal(s.personal_event.length,1);assert.equal(s.personal_receipt.length,1);assert.equal(s.kiosk_events.length,1);assert.equal(s.audit_events.length,1);
  assert.equal(s.kiosk_devices[0].last_sequence,1);assert.equal(s.personal_clock[0].revision,1);assert.equal(s.kiosk_events[0].employee,f.a.personId);
  assert.equal(s.personal_event[0].id,JSON.parse(s.kiosk_events[0].result).personalEventId);
 }finally{f.close();}
});

test('native replay, reused event content and sequence gap preserve durable state',async()=>{
 const f=fixture();try{
  const e=f.event();await f.sync([e]);const before=snapshot(f.reader);
  const replay=await f.sync([e]);assert.equal(replay.results[0].replayed,true);assert.deepEqual(snapshot(f.reader),before);
  const conflict=await f.sync([{...e,type:'out'}]);assert.equal(conflict.held,1);assert.deepEqual(snapshot(f.reader),before);
  const gap=await f.sync([f.event('event-00003',3,'out',1000)]);assert.equal(gap.held,1);assert.deepEqual(snapshot(f.reader),before);
 }finally{f.close();}
});

test('completed domain refusal preserves accepted batch prefix and leaves later event queued',async()=>{
 const f=fixture();try{
  const r=await f.sync([f.event(),f.event('event-00002',2,'in',1000),f.event('event-00003',3,'out',2000)]);
  assert.equal(r.accepted,1);assert.equal(r.held,1);assert.equal(r.results.length,2);assert.equal(r.lastSequence,1);
  const c=counts(f.reader);assert.equal(c.personal_event,1);assert.equal(c.personal_receipt,1);assert.equal(c.kiosk_events,1);assert.equal(c.audit_events,1);
  const later=await f.sync([f.event('event-00002',2,'out',2000)]);assert.equal(later.accepted,1);assert.equal(later.lastSequence,2);
 }finally{f.close();}
});

test('native completed in/out session and receipts agree after ordinary database close/reopen',async()=>{
 const f=fixture();const file=f.file;try{
  const r=await f.sync([f.event(),f.event('event-00002',2,'out',1800000)]);assert.equal(r.accepted,2);assert.equal(r.lastSequence,2);
  const before=snapshot(f.reader);assert.equal(before.personal_session.length,1);assert.equal(before.personal_event.length,2);assert.equal(before.kiosk_events.length,2);
  assert.equal(before.personal_event.every(x=>x.tenant===f.tenant),true);assert.equal(before.audit_events.every(x=>x.tenant===f.tenant),true);
  f.close();const reopened=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(snapshot(reopened),before);}finally{reopened.close();}
 }finally{if(f.db.isOpen)f.close();}
});

async function boot(file){
 const childFile=path.join(home,'normal-server-child.cjs');
 if(!fs.existsSync(childFile))fs.writeFileSync(childFile,`
'use strict';const assert=require('node:assert/strict'),http=require('node:http'),original=http.createServer;let inflight=0;const externalAttempts=[];
http.createServer=function(...args){const s=original.apply(this,args);s.prependListener('request',(_r,res)=>{inflight++;res.once('finish',()=>inflight--);});s.once('listening',()=>process.send({type:'ready',port:s.address().port}));return s;};
globalThis.fetch=async()=>{externalAttempts.push('blocked');throw Error('NO_EXTERNAL_PROVIDER_NETWORK');};
process.on('message',m=>{if(m.type==='status')process.send({type:'status',inflight,externalAttempts});if(m.type==='normal-stop'){assert.equal(inflight,0);assert.equal(externalAttempts.length,0);const hs=process.listeners('SIGTERM').filter(f=>String(f).includes('clearInterval(supportTimer)')&&String(f).includes('db.close()'));assert.equal(hs.length,1);hs[0]();}});
require(process.argv[2]);
`);
 const child=fork(childFile,[path.join(runtime,'server.cjs')],{execPath:process.execPath,execArgv:[],silent:true,env:{PATH:path.dirname(process.execPath),PORT:'0',WFM_DB:file,WFM_HOSTED_STAGING:'false',WFM_SUPPORT_ENABLED:'false',WFM_INTEGRATIONS_JSON:'[]',WFM_OUTBOUND_INTEGRATIONS_JSON:'[]',WFM_INBOUND_WEBHOOKS_JSON:'[]',WFM_PAYROLL_RECEIPT_PROFILES_JSON:'[]'}});
 const logs=[];child.stdout.on('data',b=>logs.push(String(b)));child.stderr.on('data',b=>logs.push(String(b)));
 const exited=once(child,'exit');const ready=await new Promise((resolve,reject)=>{child.on('message',m=>{if(m.type==='ready')resolve(m);});child.once('exit',(c,s)=>reject(Error('Native startup ended '+c+'/'+s+' '+logs.join(''))));});
 async function status(){const response=once(child,'message');child.send({type:'status'});return(await response)[0];}
 async function stop(){assert.equal((await status()).inflight,0);child.send({type:'normal-stop'});const [code,signal]=await exited;assert.equal(code,0,logs.join(''));assert.equal(signal,null);}
 async function sync(device,secret,events){const res=await fetch('http://127.0.0.1:'+ready.port+'/api/kiosk/sync',{method:'POST',headers:{'content-type':'application/json','x-device-id':device,authorization:'Device '+secret},body:JSON.stringify({events})});assert.equal(res.status,200);return res.json();}
 return {child,stop,status,sync};
}

test('actual native HTTP completes, exits cleanly, then reopens the same kiosk receipt for exact replay',async()=>{
 const file=path.join(home,'native-process.sqlite');let app=await boot(file);
 try{
  const db=new DatabaseSync(file),state=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get('northstar-demo').state),person=state.staff.find(p=>p.id==='e0');
  const device='KIOSK-CLEAN-PROCESS',secret='synthetic-clean-process-device-00000000000000000';
  db.prepare('INSERT INTO kiosk_devices VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(device,'northstar-demo',person.site,'Fictional clean-process kiosk',hash(secret),'active',0,null,'fixture-only',new Date().toISOString(),null);db.close();
  const event={eventId:'clean-process-event-01',sequence:1,employee:person.id,type:'in',capturedAt:new Date(Date.now()-60000).toISOString(),clockOffsetMs:0};
  const r=await app.sync(device,secret,[event]);assert.equal(r.accepted,1);assert.equal(r.lastSequence,1);
  let reader=new DatabaseSync(file,{readOnly:true}),before;try{before=snapshot(reader);}finally{reader.close();}
  assert.equal(before.personal_event.length,1);assert.equal(before.kiosk_events.length,1);assert.deepEqual((await app.status()).externalAttempts,[]);
  await app.stop();reader=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(snapshot(reader),before);}finally{reader.close();}
  app=await boot(file);const replay=await app.sync(device,secret,[event]);assert.equal(replay.accepted,1);assert.equal(replay.results[0].replayed,true);
  reader=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(snapshot(reader),before);}finally{reader.close();}
  await app.stop();
 }finally{if(app.child.exitCode===null)await app.stop();}
});


test('policy and profile commands also preserve outer transaction ownership and ordinary rollback',()=>{
 const f=fixture();try{
  f.personal.register(f.a,{id:f.a.personId,name:'Fictional employee',site:f.person.site});
  const before=snapshot(f.db),admin={...f.a,permissions:['company.configure']};
  f.db.exec('BEGIN IMMEDIATE');
  f.personal.command(admin,{command:'policy',payload:{revision:0,reason:'Fictional reviewed test setting',clockEnabled:true},idempotencyKey:'outer-policy-01'});
  f.personal.command(f.a,{command:'profile',payload:{revision:0,fields:{locale:'fr-FR'}},idempotencyKey:'outer-profile-01'});
  assert.equal(f.db.isTransaction,true);assert.equal(f.personal.getPolicy(f.tenant).revision,1);assert.equal(f.personal.getProfile(f.a).revision,1);
  assert.equal(counts(f.reader).personal_policy,0);assert.equal(counts(f.reader).personal_profile,0);
  f.db.exec('ROLLBACK');assert.deepEqual(snapshot(f.db),before);
 }finally{f.close();}
});

test('standalone policy and profile commits retain exact receipts and refuse protected fields',()=>{
 const f=fixture();try{
  f.personal.register(f.a,{id:f.a.personId,name:'Fictional employee',site:f.person.site});
  const admin={...f.a,permissions:['company.configure']};
  const input={command:'policy',payload:{revision:0,reason:'Fictional reviewed test setting',clockEnabled:true},idempotencyKey:'single-policy-01'};
  const policy=f.personal.command(admin,input);assert.equal(policy.policy.revision,1);
  const profile=f.personal.command(f.a,{command:'profile',payload:{revision:0,fields:{locale:'fr-FR'}},idempotencyKey:'single-profile-01'});assert.equal(profile.profile.revision,1);
  const before=snapshot(f.reader);assert.equal(f.personal.command(admin,input).replayed,true);assert.deepEqual(snapshot(f.reader),before);
  assert.throws(()=>f.personal.command(f.a,{command:'profile',payload:{revision:1,fields:{role:'director'}},idempotencyKey:'protected-profile-01'}),/not editable/);
  assert.deepEqual(snapshot(f.reader),before);assert.equal(f.db.isTransaction,false);
 }finally{f.close();}
});

test('transformation preserves every native byte outside the kiosk route and personal command',async()=>{
 const {patchKioskAtomicitySources}=await import('./patch-kiosk-atomicity.mjs');
 const p=patchKioskAtomicitySources(unpatchedServer,unpatchedPersonalStore);
 const start=unpatchedServer.indexOf("if(url.pathname==='/api/kiosk/sync'"),end=unpatchedServer.indexOf("if(url.pathname==='/api/onboarding/accept'",start);
 assert.equal(p.server.slice(0,start),unpatchedServer.slice(0,start));assert.ok(p.server.endsWith(unpatchedServer.slice(end)));
 const command=unpatchedPersonalStore.indexOf(' function command('),sessions=unpatchedPersonalStore.indexOf(' function sessions(',command);
 assert.equal(p.personalStore.slice(0,command),unpatchedPersonalStore.slice(0,command));assert.ok(p.personalStore.endsWith(unpatchedPersonalStore.slice(sessions)));
 assert.equal((p.server.match(/VECTOR_KIOSK_EVENT_ATOMICITY_V1/g)||[]).length,1);
 assert.equal((p.personalStore.match(/VECTOR_KIOSK_EVENT_ATOMICITY_V1/g)||[]).length,1);
});

test('ambiguous or missing source anchors and second application are refused',async()=>{
 const {patchKioskAtomicitySources}=await import('./patch-kiosk-atomicity.mjs');
 assert.throws(()=>patchKioskAtomicitySources(unpatchedServer.replace('const digest=kioskDigest(x),prior=', 'const digest=kioskDigest(x),prior ='),unpatchedPersonalStore),/ANCHOR_CHANGED/);
 assert.throws(()=>patchKioskAtomicitySources(unpatchedServer,unpatchedPersonalStore.replace("const digest=hash({cmd,x});db.exec('BEGIN IMMEDIATE');try{","const digest=hash({cmd,x});throw Error('changed');")),/ANCHOR_CHANGED/);
 const p=patchKioskAtomicitySources(unpatchedServer,unpatchedPersonalStore);
 assert.throws(()=>patchKioskAtomicitySources(p.server,p.personalStore),/ALREADY_PATCHED/);
 assert.throws(()=>patchKioskAtomicitySources(unpatchedServer+unpatchedServer,unpatchedPersonalStore),/kiosk-route/);
});

test('CLI computes and validates both outputs before writing either native source file',async()=>{
 const {patchKioskAtomicitySources}=await import('./patch-kiosk-atomicity.mjs');
 const output=path.join(home,'cli-runtime');fs.mkdirSync(path.join(output,'lib'),{recursive:true});
 const serverFile=path.join(output,'server.cjs'),storeFile=path.join(output,'lib/personal-store.cjs'),cli=path.join(root,'scripts/patch-kiosk-atomicity.mjs');
 fs.writeFileSync(serverFile,unpatchedServer);fs.writeFileSync(storeFile,unpatchedPersonalStore+'\n/* fixture */');
 execFileSync(process.execPath,[cli,output],{stdio:'pipe'});
 const expected=patchKioskAtomicitySources(unpatchedServer,unpatchedPersonalStore+'\n/* fixture */');
 assert.equal(fs.readFileSync(serverFile,'utf8'),expected.server);assert.equal(fs.readFileSync(storeFile,'utf8'),expected.personalStore);
 fs.writeFileSync(serverFile,unpatchedServer);fs.writeFileSync(storeFile,'not the native store');
 assert.throws(()=>execFileSync(process.execPath,[cli,output],{stdio:'pipe'}));
 assert.equal(fs.readFileSync(serverFile,'utf8'),unpatchedServer);assert.equal(fs.readFileSync(storeFile,'utf8'),'not the native store');
});

