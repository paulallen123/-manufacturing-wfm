import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(process.env.WFM_PROOF_REPO||process.cwd()),dir=mkdtempSync('/tmp/vector-payroll-proof-');
const origin='http://127.0.0.1:4108',period='2026-09-07',checks=[];let server;
async function start(){server=spawn(process.execPath,['--require',join(process.env.WFM_LOCAL_RUNTIME || join(root,'candidate-runtime'),'local-paths.cjs'),join(process.env.WFM_LOCAL_RUNTIME || join(root,'candidate-runtime'),'security-runtime/bootstrap.cjs')],{env:{...process.env,PORT:'4108',WFM_DB:join(dir,'state.sqlite'),WFM_HOSTED_STAGING:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout')),20000);server.stdout.on('data',s=>{output+=s;if(output.includes(origin)){clearTimeout(timer);resolve()}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code))})});}
async function stop(){if(server){server.kill('SIGTERM');await once(server,'exit');server=null}}
async function request(path,cookie,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,body:data,headers:r.headers,cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await request('/api/login',null,{email,password:'Factory-local-demo-2026!'});assert.equal(r.status,200);return r.cookie}
async function command(cookie,name,payload){const b=await request('/api/bootstrap',cookie);assert.equal(b.status,200);return request('/api/command',cookie,{command:name,payload,version:b.body.state.version})}
async function report(cookie){const r=await request('/api/weekly-review?period='+period,cookie);assert.equal(r.status,200);return r.body}
function pass(name){checks.push({name,status:'PASS'})}
const reason='Synthetic fixture verification only: explicitly supplied fictional attendance evidence; no customer approval.';
try{
 await start();const director=await login('superuser@northstar.example'),payroll=await login('payroll@northstar.example'),other=await login('otherpayroll@isolation.example');
 const initial=await report(director);assert.equal(initial.teams.length,4);let resolved=0;
 // Expected fictional records are defined in payroll-control.decorate, never inferred from a real rota.
 for(const t of initial.teams){for(const issue of t.issues.filter(i=>i.status==='open')){
  const current=(await report(director)).teams.find(x=>x.id===t.id),row=current.records.find(x=>x.id===issue.row);
  const payload={period,team:t.id,revision:current.revision,issue:issue.id,checked:true,reason};
  if(['missing','sync'].includes(issue.type))Object.assign(payload,{outcome:'worked',clockIn:row.date+'T06:00',clockOut:row.date+'T14:00',breakStart:row.date+'T10:00',breakEnd:row.date+'T10:30',breaksConfirmed:true});
  if(issue.type==='adjustment')payload.decision='accept';if(issue.type==='overtime')payload.decision='approve';
  const r=await command(director,'review-resolve',payload);assert.equal(r.status,200,JSON.stringify(r.body));resolved++;
 }}
 assert.equal(resolved,7);pass('seven defined synthetic exceptions resolved through authenticated API');
 for(const t of (await report(director)).teams){
  for(const category of t.categories){const r=await command(director,'review-check',{period,team:t.id,revision:t.revision,category:category.id,checked:true});assert.equal(r.status,200,JSON.stringify(r.body));}
  for(const employee of t.employees){const r=await command(director,'review-check',{period,team:t.id,revision:t.revision,employee:employee.id,checked:true});assert.equal(r.status,200,JSON.stringify(r.body));}
  const r=await command(director,'review-sign',{period,team:t.id,revision:t.revision,checked:true,attestation:'confirmed'});assert.equal(r.status,200,JSON.stringify(r.body));
 }
 assert.ok((await report(director)).teams.every(t=>t.status==='signed'));pass('all four teams signed only after category and employee checks');
 const prep=await request('/api/payroll-run?period='+period,payroll);assert.equal(prep.status,200);assert.equal(prep.body.canRelease,true,JSON.stringify(prep.body.blockers));assert.equal(prep.body.reconciliation.ok,true);pass('payroll preparation reconciles and clears required holds');
 const released=await command(payroll,'payroll-release',{period,checked:true,schemaReviewed:true});assert.equal(released.status,200,JSON.stringify(released.body));const id=released.body.result.id;
 const csv=await request('/api/payroll-export/'+encodeURIComponent(id),payroll);assert.equal(csv.status,200);assert.ok(csv.body.includes('WORKED'));const hash=createHash('sha256').update(csv.body).digest('hex');assert.equal(csv.headers.get('x-export-sha256'),hash);pass('released CSV content matches server integrity checksum');
 const duplicate=await command(payroll,'payroll-release',{period,checked:true,schemaReviewed:true});assert.equal(duplicate.status,200);assert.equal(duplicate.body.result.id,id);assert.equal(duplicate.body.result.reused,true);pass('duplicate release reuses existing batch');
 assert.equal((await request('/api/payroll-export/'+encodeURIComponent(id),other)).status,404);pass('other tenant cannot download batch');
 const sent=await command(payroll,'payroll-sent',{period,batch:id,checked:true,reason});assert.equal(sent.status,200);assert.equal(sent.body.result.status,'sent');pass('manual handoff marker saved without sending to provider');
 const blocked=await command(payroll,'payroll-void',{period,batch:id,notSubmitted:true,reason});assert.equal(blocked.status,409);pass('sent batch cannot be voided');
 await stop();await start();const fresh=await login('payroll@northstar.example');
 const saved=await request('/api/payroll-run?period='+period,fresh);assert.equal(saved.body.batches.find(b=>b.id===id).status,'sent');
 const again=await request('/api/payroll-export/'+encodeURIComponent(id),fresh);assert.equal(again.status,200);assert.equal(again.body,csv.body);pass('new login after local restart returns same saved batch and CSV bytes');
 const evidence={scope:'LOCAL authenticated API and SQLite only; no deployed or browser proof',synthetic:true,node:process.version,sourceHead:'6667f4217e0c0a8a90cab8d4c7d79f8efd628662',checks,export:{sha256:hash,rows:csv.body.trim().split('\r\n').length-1}};
 writeFileSync(join(root,'verification/vector-repair-20260920/payroll-journey-results.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{await stop();rmSync(dir,{recursive:true,force:true})}
