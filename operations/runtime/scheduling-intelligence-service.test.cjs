'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');const {once}=require('node:events');const net=require('node:net');
const {createSchedulingIntelligenceService}=require('./scheduling-intelligence-service.cjs');
function hash(v){return createHash('sha256').update(String(v)).digest('hex');}
function res(){return {statusCode:200,headers:{},headersSent:false,writableEnded:false,body:'',setHeader(k,v){this.headers[k]=v;},end(v=''){this.body=String(v);this.writableEnded=true;this.headersSent=true;}};}
function req(method,url,{body,cookie,headers={}}={}){const r=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);r.method=method;r.url=url;r.headers={...headers};if(cookie)r.headers.cookie=cookie;return r;}
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-schedule-')),dbPath=path.join(dir,'db.sqlite'),db=new DatabaseSync(dbPath);
 db.exec("CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
 db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('m@test','alpha','manager');db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('e@test','alpha','employee');
 db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('mgr'),'m@test',Date.now()+60000);db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('emp'),'e@test',Date.now()+60000);
 for(const role of ['director','supervisor','payroll_admin','hr','unknown','']){const email='fixture-'+(role||'empty')+'@test';db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run(email,'alpha',role);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(role||'empty'),email,Date.now()+60000);}
 db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('m@bravo','bravo','manager');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('bravo'),'m@bravo',Date.now()+60000);
 db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('other-manager@test','alpha','manager');
 db.close();return {dir,dbPath};}
async function call(s,r){const x=res();await s.handleRequest(r,x);return {res:x,json:x.body?JSON.parse(x.body):null};}
function input(){return {contextRevision:'twin:1',sourceEvidence:['mes:1','hr:1'],workers:[{id:'w1',type:'EMPLOYEE',status:'ACTIVE',homeSite:'a',eligibleSites:['a'],skills:['s1'],certifications:[{name:'c1',expiresAt:'2027-01-01T00:00:00Z'}],availability:[{start:'2026-09-24T05:00:00Z',end:'2026-09-24T15:00:00Z'}],previousShiftEnd:'2026-09-23T18:00:00Z',hoursWorkedWeek:8,contractedHours:40,hourlyCost:20}],requirements:[{id:'r1',site:'a',line:'l1',role:'op',start:'2026-09-24T06:00:00Z',end:'2026-09-24T14:00:00Z',headcount:1,requiredSkills:['s1'],requiredCertifications:['c1'],evidenceRefs:['mes:1']} ]};}
test('internal shadow plan is authenticated and idempotent',async()=>{const f=fixture(),events=[],s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret',publishEvent:e=>events.push(e)});try{
 let x=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'bad'}}));assert.equal(x.res.statusCode,403);
 x=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'secret'}}));assert.equal(x.res.statusCode,201);assert.equal(x.json.plan.executionPermitted,false);
 const y=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{body:{tenant:'alpha',input:input()},headers:{'x-wfm-scheduling-internal':'secret'}}));assert.equal(y.res.statusCode,200);assert.equal(y.json.idempotent,true);assert.equal(events.length,1);
}finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}});

test('the existing composed bootstrap enforces operational roles on real scheduling HTTP routes',async t=>{
 const root=path.resolve(__dirname,'../..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'scheduling-route-permission-')),dbPath=path.join(directory,'state.sqlite');
 const composer=path.join(root,'scripts/compose-vector-local-runtime.mjs'),sourceMode=fs.existsSync(composer),runtime=sourceMode?path.join(directory,'runtime'):'/app';
 let child,db;
 t.after(async()=>{db?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}fs.rmSync(directory,{recursive:true,force:true});});
 if(sourceMode)execFileSync(process.execPath,[composer,runtime],{stdio:'pipe'});
 else assert.ok(fs.existsSync(path.join(runtime,'security-runtime/bootstrap.cjs')),'Scheduling HTTP proof requires the source composer or the actual /app bootstrap; missing proof prerequisites cannot be skipped');
 assert.equal(fs.readFileSync(path.join(runtime,'operations-runtime/scheduling-intelligence-service.cjs'),'utf8'),fs.readFileSync(path.join(__dirname,'scheduling-intelligence-service.cjs'),'utf8'),'The composed bootstrap must use these exact service bytes');
 const portServer=net.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
 const origin='http://127.0.0.1:'+port;
 child=spawn(process.execPath,[...(sourceMode?['--require',path.join(runtime,'local-paths.cjs')]:[]),path.join(runtime,'security-runtime/bootstrap.cjs')],{
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,WFM_DB:dbPath,PORT:String(port),WFM_HOSTED_STAGING:'false',NODE_ENV:'test',WFM_IDENTITY_SURVIVAL_GUARD:'enforce',WFM_SCHEDULING_INTERNAL_TOKEN:'scheduling-test-only',WFM_TENANT_CLOCK_ISO:'2026-09-24T12:00:00Z',WFM_TENANT_TIMEZONE:'Europe/London',WFM_AGENTS_API_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 let diagnostics='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{diagnostics=(diagnostics+data).slice(-8000);});
 const deadline=Date.now()+30000;let ready=false;
 while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Composed runtime exited: '+diagnostics);try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(ready,true,'Composed runtime startup: '+diagnostics);
 db=new DatabaseSync(dbPath);
 for(const tenant of ['schedule-alpha','schedule-bravo'])db.prepare('INSERT INTO tenants(id,version,state) VALUES(?,?,?)').run(tenant,1,'{}');
 for(const [token,role,tenant] of [['manager','manager','schedule-alpha'],['director','director','schedule-alpha'],['supervisor','supervisor','schedule-alpha'],['payroll_admin','payroll_admin','schedule-alpha'],['hr','hr','schedule-alpha'],['unknown','unknown','schedule-alpha'],['employee','employee','schedule-alpha'],['bravo','manager','schedule-bravo']]){
  const email=token+'@scheduling.fixture';db.prepare('INSERT INTO users(email,tenant,person_id,role,costs,salt,password_hash,permissions) VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'fixture-'+token,role,0,'fixture-disabled','00','[]');
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('composed-'+token),email,Date.now()+120000);
 }
 const httpCall=async(route,token,body,extraHeaders={})=>{const response=await fetch(origin+'/api/operations/scheduling'+route,{method:body===undefined?'GET':'POST',headers:{...(token?{cookie:'wfm_session=composed-'+token}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
 const plans={};
 for(const tenant of ['schedule-alpha','schedule-bravo']){const created=await httpCall('/plan/shadow',null,{tenant,input:input()},{'x-wfm-scheduling-internal':'scheduling-test-only'});assert.equal(created.status,201);assert.equal(created.body.authority,'NO_EXECUTION');assert.equal(created.body.plan.executionPermitted,false);plans[tenant]=created.body.plan.planId;}
 for(const role of ['payroll_admin','hr','unknown','employee'])await t.test(role+' cannot read the existing mounted plan route',async()=>{
  const result=await httpCall('/plans',role);assert.equal(result.status,403);assert.equal(result.body.plans,undefined);
 });
 for(const role of ['manager','director','supervisor'])await t.test(role+' retains same-tenant plan and unpersisted scenario access',async()=>{
  const read=await httpCall('/plans?tenant=schedule-bravo',role);assert.equal(read.status,200);assert.equal(read.body.tenant,'schedule-alpha');assert.equal(read.body.plans.length,1);assert.equal(read.body.plans[0].planId,plans['schedule-alpha']);
  const scenario=await httpCall('/what-if',role,{tenant:'schedule-bravo',input:input()});assert.equal(scenario.status,200);assert.equal(scenario.body.plan.tenant,'schedule-alpha');assert.equal(scenario.body.persisted,false);assert.equal(scenario.body.authority,'NO_EXECUTION');
 });
 await t.test('cross-tenant, unauthenticated and internal worker controls remain intact',async()=>{
  const bravo=await httpCall('/plans?tenant=schedule-alpha','bravo');assert.equal(bravo.status,200);assert.equal(bravo.body.plans.length,1);assert.equal(bravo.body.plans[0].planId,plans['schedule-bravo']);
  assert.equal((await httpCall('/plans')).status,401);assert.equal((await httpCall('/plan/shadow','manager',{tenant:'schedule-alpha',input:input()})).status,403);
  const injection=await httpCall('/plans','manager',undefined,{'x-wfm-role':'director'});assert.equal(injection.status,400,'Existing identity guard remains enabled');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vector_schedule_plans').get().n,2);
  assert.throws(()=>db.exec("UPDATE vector_schedule_plans SET context_revision='forged'"),/append only/);
 });
});

for(const role of ['payroll_admin','hr','unknown',''])test('authenticated '+(role||'empty-role')+' cannot read a seeded scheduling plan',async()=>{
 const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
  const seeded=await call(s,req('POST','/api/operations/scheduling/plan/shadow',{headers:{'x-wfm-scheduling-internal':'secret'},body:{tenant:'alpha',input:input()}}));assert.equal(seeded.res.statusCode,201);
  const cookie='wfm_session='+(role||'empty');
  for(const route of ['/plans','/capabilities','/reconciliations']){
   const denied=await call(s,req('GET','/api/operations/scheduling'+route,{cookie}));
   assert.equal(denied.res.statusCode,403,'Non-operational role must be denied before disclosing scheduling data');assert.equal(denied.json.plans,undefined);
  }
  const stored=s.recentPlans('alpha');assert.equal(stored.length,1);assert.equal(stored[0].planId,seeded.json.plan.planId);
 }finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('all operational roles retain read and scenario access without a company configuration permission',async()=>{
 const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
  for(const token of ['mgr','director','supervisor']){
   const cookie='wfm_session='+token;
   const capabilities=await call(s,req('GET','/api/operations/scheduling/capabilities',{cookie}));assert.equal(capabilities.res.statusCode,200);assert.equal(capabilities.json.tenant,'alpha');
   const scenario=await call(s,req('POST','/api/operations/scheduling/what-if',{cookie,body:{tenant:'bravo',input:{...input(),tenant:'bravo'}}}));
   assert.equal(scenario.res.statusCode,200);assert.equal(scenario.json.plan.tenant,'alpha');assert.equal(scenario.json.persisted,false);assert.equal(scenario.json.plan.executionPermitted,false);assert.equal(scenario.json.authority,'NO_EXECUTION');
  }
  assert.equal(s.recentPlans('alpha').length,0);assert.equal(s.recentPlans('bravo').length,0);
 }finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('plan reads remain tenant-bound despite forged query scope, absent and expired sessions are denied',async()=>{
 const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'});try{
  for(const tenant of ['alpha','bravo'])assert.equal((await call(s,req('POST','/api/operations/scheduling/plan/shadow',{headers:{'x-wfm-scheduling-internal':'secret'},body:{tenant,input:input()}}))).res.statusCode,201);
  for(const [token,tenant] of [['mgr','alpha'],['bravo','bravo']]){
   const result=await call(s,req('GET','/api/operations/scheduling/plans?tenant=other',{cookie:'wfm_session='+token}));
   assert.equal(result.res.statusCode,200);assert.equal(result.json.tenant,tenant);assert.equal(result.json.plans.length,1);assert.ok(result.json.plans.every(plan=>plan.tenant===tenant));
  }
  assert.equal((await call(s,req('GET','/api/operations/scheduling/plans'))).res.statusCode,401);
  const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE sessions SET expires=0 WHERE token_hash=?').run(hash('mgr'));db.close();
  assert.equal((await call(s,req('GET','/api/operations/scheduling/plans',{cookie:'wfm_session=mgr'}))).res.statusCode,401);
 }finally{s.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
function scenarioBody(route){
 const sample=input(),worker=sample.workers[0],requirement=sample.requirements[0];
 if(route==='/forecast/what-if')return {input:{observations:[10,11,12,13,14,15].map((value,i)=>({at:new Date(Date.UTC(2026,8,1+i)).toISOString(),value,evidenceRef:'synthetic:'+i})),horizonPeriods:1}};
 if(route==='/open-shift/evaluate')return {input:{requirement,workers:[worker]}};
 if(route==='/swap/evaluate')return {input:{workerA:worker,workerB:{...worker,id:'w2'},requirementA:requirement,requirementB:{...requirement,id:'r2'}}};
 return {input:sample};
}
for(const route of ['/what-if','/forecast/what-if','/open-shift/evaluate','/swap/evaluate'])for(const [name,mutate,status] of [
 ['revoked role',db=>db.exec("UPDATE users SET role='payroll_admin' WHERE email='m@test'"),403],
 ['changed operational role',db=>db.exec("UPDATE users SET role='supervisor' WHERE email='m@test'"),403],
 ['deleted session',db=>db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash('mgr')),401],
 ['expired session',db=>db.prepare('UPDATE sessions SET expires=0 WHERE token_hash=?').run(hash('mgr')),401],
 ['changed tenant',db=>db.exec("UPDATE users SET tenant='bravo' WHERE email='m@test'"),403],
 ['changed principal',db=>db.prepare("UPDATE sessions SET email='other-manager@test' WHERE token_hash=?").run(hash('mgr')),403]
])test(route+' rejects '+name+' during the awaited request body without disclosure or persistence',async()=>{
 const f=fixture(),s=createSchedulingIntelligenceService({dbPath:f.dbPath,internalToken:'secret'}),db=new DatabaseSync(f.dbPath);try{
  const request=Readable.from((async function*(){mutate(db);yield JSON.stringify(scenarioBody(route));})());request.method='POST';request.url='/api/operations/scheduling'+route;request.headers={cookie:'wfm_session=mgr'};
  const result=await call(s,request);assert.equal(result.res.statusCode,status,JSON.stringify(result.json));assert.equal(result.json.plan,undefined);assert.equal(result.json.result,undefined);assert.equal(result.json.forecast,undefined);assert.equal(s.recentPlans('alpha').length,0);assert.equal(s.recentPlans('bravo').length,0);
 }finally{db.close();s.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
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
