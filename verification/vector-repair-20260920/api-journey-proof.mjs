import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {verifiedRuntimeProvenance} from './runtime-provenance.mjs';
const root=resolve(process.env.WFM_PROOF_REPO || process.cwd());
const runtime=verifiedRuntimeProvenance(process.env.WFM_LOCAL_RUNTIME || join(root,'candidate-runtime'));
const dir=mkdtempSync(join(tmpdir(),'vector-api-proof-'));
const fixtureAsOf='2026-09-10T12:00:00.000Z';
const dbPath=join(dir,'state.sqlite'),origin='http://127.0.0.1:4107';
const checks=[],observations=[];let server;
async function start(){server=spawn(process.execPath,['--require',join(process.env.WFM_LOCAL_RUNTIME || join(root,'candidate-runtime'),'local-paths.cjs'),join(process.env.WFM_LOCAL_RUNTIME || join(root,'candidate-runtime'),'security-runtime/bootstrap.cjs')],{env:{...process.env,PORT:'4107',WFM_DB:dbPath,WFM_HOSTED_STAGING:'false',NODE_ENV:'test',WFM_TENANT_CLOCK_ISO:fixtureAsOf},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout')),20000);server.stdout.on('data',s=>{output+=s;if(output.includes(origin)){clearTimeout(timer);resolve()}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code))})});}
async function stop(){if(server){server.kill('SIGTERM');await once(server,'exit');server=null;}}
async function req(path,cookie,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});let b;try{b=await r.json()}catch{b=null}return {status:r.status,body:b,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(email){const r=await req('/api/login',null,{email,password:'Factory-local-demo-2026!'});assert.equal(r.status,200);return r.cookie;}
async function bootstrap(cookie){const r=await req('/api/bootstrap',cookie);assert.equal(r.status,200);return r.body;}
function check(name,fn){fn();checks.push({name,status:'PASS'});}
try{
 await start();
 const employee=await login('maya@northstar.example'),manager=await login('manager@northstar.example'),other=await login('other@isolation.example'),payroll=await login('payroll@northstar.example');
 check('unauthenticated state refused',()=>{});assert.equal((await req('/api/bootstrap')).status,401);
 const initial=await bootstrap(employee),personal=(await req('/api/personal',employee)).body;
 const calendar=await req('/api/tenant-calendar',employee);
 check('synthetic journey uses the reviewed authoritative calendar',()=>{assert.equal(calendar.status,200);assert.equal(calendar.body.asOf,fixtureAsOf);assert.equal(personal.serverTime,calendar.body.asOf);assert.ok(personal.shifts.length>=4,'reviewed fixture must supply four future shifts');assert.ok(personal.shifts.every(shift=>Date.parse(shift.end)>Date.parse(calendar.body.asOf)));});
 const date=personal.shifts[1].start.slice(0,10),payload={date,hours:7.5};
 const created=await req('/api/personal/work',employee,{command:'leave-request',payload,version:initial.state.version});
 check('employee leave creates pending saved request',()=>{assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.result.status,'pending')});
 const id=created.body.result.id;
 const after=await bootstrap(employee),afterPersonal=(await req('/api/personal',employee)).body;
 check('refresh returns new leave and reserved balance',()=>{assert.equal(after.state.requests.find(x=>x.id===id).status,'pending');assert.equal(afterPersonal.leave.pendingMinutes,450);assert.equal(afterPersonal.leave.availableMinutes,personal.leave.availableMinutes-450)});
 const duplicate=await req('/api/personal/work',employee,{command:'leave-request',payload,version:initial.state.version});
 check('duplicate submission with stale version rejected',()=>assert.equal(duplicate.status,409));
 const overlap=await req('/api/personal/work',employee,{command:'leave-request',payload,version:after.state.version});
 check('duplicate overlapping request with fresh version rejected',()=>assert.equal(overlap.status,409));
 const ownDecision=await req('/api/command',employee,{command:'leave-decision',payload:{id,decision:'approved',reviewed:true},version:after.state.version});
 check('employee cannot approve own request',()=>assert.equal(ownDecision.status,403));
 const otherState=await bootstrap(other);
 const cross=await req('/api/command',other,{command:'leave-decision',payload:{id,decision:'declined',reviewed:true,reason:'Synthetic isolation test'},version:otherState.state.version});
 check('other tenant cannot act on request identifier',()=>assert.equal(cross.status,404));
 const managerState=await bootstrap(manager);
 const approved=await req('/api/command',manager,{command:'leave-decision',payload:{id,decision:'approved',reviewed:true},version:managerState.state.version});
 observations.push({name:'approval attempt',status:approved.status,result:approved.body});
 if(approved.status!==200){assert.equal(approved.status,409);checks.push({name:'unsafe staffing approval fails closed',status:'PASS'});const declined=await req('/api/command',manager,{command:'leave-decision',payload:{id,decision:'declined',reviewed:true,reason:'Synthetic proof: coverage is unavailable for this shift'},version:managerState.state.version});assert.equal(declined.status,200);}
 const expected=approved.status===200?'approved':'declined';
 const fresh=await login('maya@northstar.example');
 check('new login sees manager saved decision',()=>{});assert.equal((await bootstrap(fresh)).state.requests.find(x=>x.id===id).status,expected);
 const base=await bootstrap(employee);
 const conflict=await Promise.all([2,3].map(i=>req('/api/personal/work',employee,{command:'leave-request',payload:{date:personal.shifts[i].start.slice(0,10),hours:7.5},version:base.state.version})));
 check('conflicting concurrent versions commit once',()=>assert.deepEqual(conflict.map(x=>x.status).sort(),[200,409]));
 check('employee cannot read payroll',()=>{});assert.equal((await req('/api/payroll-run',employee)).status,403);
 const pay=(await req('/api/payroll-run',payroll));assert.equal(pay.status,200);observations.push({name:'payroll holds',canRelease:pay.body.canRelease,blockerCount:pay.body.blockers?.length});
 const version=(await bootstrap(payroll)).state.version;
 const release=await req('/api/command',payroll,{command:'payroll-release',payload:{period:'2026-09-07',checked:true,schemaReviewed:true},version});
 check('payroll cannot release before required sign-offs',()=>assert.equal(release.status,409));
 await stop();await start();
 const restarted=await login('maya@northstar.example');
 check('controlled local process restart retains manager decision',()=>{});assert.equal((await bootstrap(restarted)).state.requests.find(x=>x.id===id).status,expected);
 const db=new DatabaseSync(dbPath,{readOnly:true});
 const audit=db.prepare("SELECT action,detail FROM audit_events WHERE tenant='northstar-demo' AND action IN ('leave-request','leave-decision') ORDER BY id").all();
 check('audit has saved decision in same persisted database',()=>assert.ok(audit.some(x=>x.action==='leave-decision')));
 db.close();
 const evidence={scope:'LOCAL composed candidate only; not deployed UI proof',node:process.version,runtime,synthetic:true,checks,observations,dbPath};
 const output=resolve(process.env.WFM_PROOF_OUTPUT || join(root,'verification/vector-repair-20260920'));
 mkdirSync(output,{recursive:true});
 writeFileSync(join(output,'api-journey-results.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,result:'PASS',observations},null,2));
}finally{await stop()}
