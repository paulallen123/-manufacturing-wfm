import assert from 'node:assert/strict';
import {createAttendanceRuntime} from './attendance-runtime-harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

assert.ok(process.env.WFM_RUNTIME,'WFM_RUNTIME is required.');
const runtime=path.resolve(process.env.WFM_RUNTIME);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vector-attendance-overlap-'));
const database=path.join(directory,'state.sqlite');
let origin;
const harness=createAttendanceRuntime({runtime,database});

async function start(){
  origin=await harness.start();
}
async function stop(){
  await harness.stop();
}
async function login(email){
  const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password:'Factory-local-demo-2026!'})});
  assert.equal(response.status,200,await response.text());
  return response.headers.get('set-cookie').split(';')[0];
}
async function api(cookie,url,options={}){
  const response=await fetch(origin+url,{...options,headers:{origin,'content-type':'application/json',cookie,...(options.headers||{})}});
  const body=await response.json();
  return {status:response.status,body};
}
async function command(cookie,name,payload){
  const bootstrap=await api(cookie,'/api/bootstrap');
  assert.equal(bootstrap.status,200);
  return api(cookie,'/api/command',{method:'POST',body:JSON.stringify({command:name,payload,version:bootstrap.body.state.version})});
}
const report=(cookie)=>api(cookie,'/api/weekly-review?period=2026-09-07');

try{
  await start();
  const proposer=await login('manager@northstar.example');
  const approver=await login('superuser@northstar.example');
  const employee=await login('maya@northstar.example');
  const otherTenant=await login('other@isolation.example');
  const initial=await report(proposer);
  assert.equal(initial.status,200);
  let chosen;
  for(const team of initial.body.teams){
    const openRows=new Set(team.issues.filter(issue=>issue.status==='open').map(issue=>issue.row));
    for(const employee of team.employees){
      const rows=team.records.filter(row=>row.employee===employee.id).sort((a,b)=>a.date.localeCompare(b.date));
      for(let index=0;index<rows.length-1;index++){
        const first=rows[index],second=rows[index+1];
        const next=new Date(first.date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);
        if(second.date===next.toISOString().slice(0,10)&&!openRows.has(first.id)){
          chosen={team,employee,first,second};break;
        }
      }
      if(chosen)break;
    }
    if(chosen)break;
  }
  assert.ok(chosen,'Fixture needs adjacent records without an open issue on the first day.');
  const rawBefore=JSON.stringify(chosen.first.raw);
  const proposed=await command(proposer,'review-amend',{
    period:initial.body.period,
    team:chosen.team.id,
    revision:chosen.team.revision,
    record:chosen.first.id,
    clockIn:chosen.first.date+'T06:00',
    clockOut:chosen.second.date+'T07:00',
    breaksConfirmed:true,
    reason:'Synthetic overlap regression: verified direct amendment proposal.'
  });
  assert.equal(proposed.status,200,JSON.stringify(proposed.body));

  const current=await report(approver);
  assert.equal(current.status,200);
  const team=current.body.teams.find(item=>item.id===chosen.team.id);
  const issue=team.issues.find(item=>item.id===proposed.body.result.id);
  assert.ok(issue&&issue.status==='open');

  const attemptedByEmployee=await command(employee,'review-resolve',{
    period:current.body.period,
    team:team.id,
    revision:team.revision,
    issue:issue.id,
    checked:true,
    decision:'accept',
    reason:'Synthetic overlap regression: employee must not approve the amendment.'
  });
  assert.equal(attemptedByEmployee.status,403,'Employee must not acquire manager review authority.');

  const attemptedByOtherTenant=await command(otherTenant,'review-resolve',{
    period:current.body.period,
    team:team.id,
    revision:team.revision,
    issue:issue.id,
    checked:true,
    decision:'accept',
    reason:'Synthetic overlap regression: another tenant must not reach this issue.'
  });
  assert.notEqual(attemptedByOtherTenant.status,200,'Another tenant must not mutate this attendance issue.');

  const afterDeniedAttempts=(await report(approver)).body;
  const stillOpen=afterDeniedAttempts.teams.find(item=>item.id===team.id).issues.find(item=>item.id===issue.id);
  assert.equal(stillOpen.status,'open','Denied attempts must not resolve the source tenant issue.');

  const accepted=await command(approver,'review-resolve',{
    period:afterDeniedAttempts.period,
    team:team.id,
    revision:afterDeniedAttempts.teams.find(item=>item.id===team.id).revision,
    issue:issue.id,
    checked:true,
    decision:'accept',
    reason:'Synthetic overlap regression: independent review must reject overlap.'
  });

  assert.equal(accepted.status,409,'An amendment overlapping another attendance record must fail before mutation.');
  const after=await report(approver);
  const afterTeam=after.body.teams.find(item=>item.id===team.id);
  const afterRow=afterTeam.records.find(item=>item.id===chosen.first.id);
  assert.equal(afterRow.correction,null,'Rejected overlap must not partially mutate attendance.');
  assert.equal(JSON.stringify(afterRow.raw),rawBefore,'Original clock evidence must remain unchanged.');
  const result={
    status:'PASS',
    scope:'Local synthetic authenticated API and SQLite regression only.',
    runtime,
    team:team.id,
    employee:chosen.employee.id,
    records:[chosen.first.id,chosen.second.id],
    checks:[
      'employee approval refused',
      'other tenant mutation refused',
      'denied attempts leave source issue open',
      'overlapping independent approval rejected',
      'rejected approval saves no correction',
      'raw clock evidence remains unchanged'
    ]
  };
  if(process.env.WFM_PROOF_OUTPUT)fs.writeFileSync(path.join(process.env.WFM_PROOF_OUTPUT,'attendance-overlap-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{
  await stop();
  fs.rmSync(directory,{recursive:true,force:true});
}
