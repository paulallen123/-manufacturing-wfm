#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAttendanceRuntime} from './attendance-runtime-harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime=path.resolve(process.env.WFM_RUNTIME||'');
assert.ok(process.env.WFM_RUNTIME,'WFM_RUNTIME is required.');
const expectedPayrollControl='cd30aa670efa57260fad61817a7ef4c50b20fcec3aca7f0c7ff9161aa2398f21';
const digest=value=>createHash('sha256').update(value).digest('hex');
assert.equal(digest(fs.readFileSync(path.join(runtime,'public/payroll-control.js'))),expectedPayrollControl,'Unexpected hardened payroll-control source.');

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vector-attendance-payroll-'));
let origin;
const period='2026-09-07';
const database=path.join(directory,'state.sqlite');
const checks=[];
const harness=createAttendanceRuntime({runtime,database});

async function start(){
  origin=await harness.start();
}
async function stop(){await harness.stop();}
async function request(url,cookie,body){
  const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();
  let result;
  try{result=JSON.parse(text);}catch{result=text;}
  return {status:response.status,body:result,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email){const response=await request('/api/login',null,{email,password:'Factory-local-demo-2026!'});assert.equal(response.status,200);return response.cookie;}
async function command(cookie,name,payload){const bootstrap=await request('/api/bootstrap',cookie);assert.equal(bootstrap.status,200);return request('/api/command',cookie,{command:name,payload,version:bootstrap.body.state.version});}
async function report(cookie){const response=await request('/api/weekly-review?period='+period,cookie);assert.equal(response.status,200);return response.body;}
const reason='Synthetic attendance-integrity acceptance only; no customer or provider action.';
const pass=name=>checks.push(name);

try{
  await start();
  const director=await login('superuser@northstar.example');
  const payroll=await login('payroll@northstar.example');
  const isolated=await login('otherpayroll@isolation.example');
  const initial=await report(director);
  assert.equal(initial.teams.length,4);
  let resolved=0;
  for(const originalTeam of initial.teams){
    for(const originalIssue of originalTeam.issues.filter(issue=>issue.status==='open')){
      const team=(await report(director)).teams.find(item=>item.id===originalTeam.id);
      const issue=team.issues.find(item=>item.id===originalIssue.id);
      const row=team.records.find(item=>item.id===issue.row);
      const payload={period,team:team.id,revision:team.revision,issue:issue.id,checked:true,reason};
      if(['missing','sync'].includes(issue.type))Object.assign(payload,{outcome:'worked',clockIn:row.date+'T06:00',clockOut:row.date+'T14:00',breakStart:row.date+'T10:00',breakEnd:row.date+'T10:30',breaksConfirmed:true});
      if(issue.type==='adjustment')payload.decision='accept';
      if(issue.type==='overtime')payload.decision='approve';
      const response=await command(director,'review-resolve',payload);
      assert.equal(response.status,200,JSON.stringify(response.body));
      resolved++;
    }
  }
  assert.equal(resolved,7);
  pass('all seven seeded exceptions, including the valid adjustment, resolved');

  for(const summary of (await report(director)).teams){
    let team=(await report(director)).teams.find(item=>item.id===summary.id);
    for(const category of team.categories){
      const response=await command(director,'review-check',{period,team:team.id,revision:team.revision,category:category.id,checked:true});
      assert.equal(response.status,200,JSON.stringify(response.body));
      team=(await report(director)).teams.find(item=>item.id===summary.id);
    }
    for(const employee of team.employees){
      const response=await command(director,'review-check',{period,team:team.id,revision:team.revision,employee:employee.id,checked:true});
      assert.equal(response.status,200,JSON.stringify(response.body));
      team=(await report(director)).teams.find(item=>item.id===summary.id);
    }
    const signed=await command(director,'review-sign',{period,team:team.id,revision:team.revision,checked:true,attestation:'confirmed'});
    assert.equal(signed.status,200,JSON.stringify(signed.body));
  }
  assert.ok((await report(director)).teams.every(team=>team.status==='signed'));
  pass('all four teams signed after required checks');

  const preparation=await request('/api/payroll-run?period='+period,payroll);
  assert.equal(preparation.status,200);
  assert.equal(preparation.body.canRelease,true,JSON.stringify(preparation.body.blockers));
  assert.equal(preparation.body.reconciliation.ok,true);
  pass('payroll reconciliation cleared after valid corrections');

  const released=await command(payroll,'payroll-release',{period,checked:true,schemaReviewed:true});
  assert.equal(released.status,200,JSON.stringify(released.body));
  const batch=released.body.result.id;
  const csv=await request('/api/payroll-export/'+encodeURIComponent(batch),payroll);
  assert.equal(csv.status,200);
  const csvSha256=digest(csv.body);
  assert.equal(csv.headers.get('x-export-sha256'),csvSha256);
  assert.equal((await request('/api/payroll-export/'+encodeURIComponent(batch),isolated)).status,404);
  pass('checksum-bound export produced and remained tenant-isolated');

  const sent=await command(payroll,'payroll-sent',{period,batch,checked:true,reason});
  assert.equal(sent.status,200);
  assert.equal(sent.body.result.status,'sent');
  await stop();
  await start();
  const freshPayroll=await login('payroll@northstar.example');
  const saved=await request('/api/payroll-run?period='+period,freshPayroll);
  assert.equal(saved.body.batches.find(item=>item.id===batch).status,'sent');
  const savedCsv=await request('/api/payroll-export/'+encodeURIComponent(batch),freshPayroll);
  assert.equal(savedCsv.body,csv.body);
  pass('batch and exact export persisted across restart and fresh login');

  const result={
    status:'PASS',
    scope:'Local synthetic authenticated API and SQLite only; no deployed, browser, provider or customer proof.',
    node:process.version,
    runtime,
    payrollControlSha256:expectedPayrollControl,
    checks,
    export:{sha256:csvSha256,rows:csv.body.trim().split('\r\n').length-1}
  };
  if(process.env.WFM_PROOF_OUTPUT)fs.writeFileSync(path.join(process.env.WFM_PROOF_OUTPUT,'attendance-payroll-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{
  await stop();
  fs.rmSync(directory,{recursive:true,force:true});
}
