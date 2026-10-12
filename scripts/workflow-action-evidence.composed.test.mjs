import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {createAttendanceRuntime} from '../verification/vector-repair-20260921/attendance-runtime-harness.mjs';

test('composed workflow evidence reads existing authorised sources without replaying a browser session',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-workflow-reader-'));
 const runtime=path.join(dir,'runtime');
 const root=path.resolve(import.meta.dirname,'..');
 execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:root,env:{...process.env,PATH:process.platform==='win32'?path.dirname(process.execPath)+';C:\\Windows\\System32;'+process.env.PATH:process.env.PATH},stdio:'pipe'});
 const harness=createAttendanceRuntime({runtime,database:path.join(dir,'state.sqlite')});
 let localDb,defaultGuard,delegated;
 t.after(async()=>{await harness.stop();defaultGuard?.close();delegated?.close();localDb?.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 const origin=await harness.start();let cookie='';
 async function request(url,body){const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{origin,'user-agent':'Vector-Workflow-Reader-Regression',...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,body:await response.json()};}
 const anonymous=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07');assert.equal(anonymous.status,401);
 const anonymousOptOut=await fetch(origin+'/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07',{headers:{origin,'user-agent':'Vector-Workflow-Reader-Regression','x-action-evidence-handled-by-server':'true'}});assert.equal(anonymousOptOut.status,401);await anonymousOptOut.body.cancel();
 const login=await request('/api/login',{email:'superuser@northstar.example',password:'Factory-local-demo-2026!'});assert.equal(login.status,200,JSON.stringify(login.body));
 const source=await request('/api/weekly-review?period=2026-09-07');assert.equal(source.status,200);
 for(const workflow of ['time-review','weekly-signoff','absence']){
  const result=await request('/api/workforce/lifecycle/action-evidence/'+workflow+(workflow==='absence'?'':'?period=2026-09-07'));
  assert.equal(result.status,200,workflow+': '+JSON.stringify(result.body));
  assert.equal(result.body.workflow,workflow);assert.equal(result.body.scope.tenant,'northstar-demo');
  assert.equal(result.body.contractVersion,'WFM_WORKFLOW_ACTION_EVIDENCE_V1');
  assert.ok(['available','partial','unavailable'].includes(result.body.availability));
  assert.match(result.body.contextKey,/^[a-f0-9]{64}$/);
  if(workflow==='absence')assert.deepEqual(result.body.items,[],'native absence schema supplies diagnostics, never inferred confirmation');
 }
 const stillSignedIn=await request('/api/bootstrap');assert.equal(stillSignedIn.status,200,'in-process evidence reads must preserve the original session');
 const forged=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07&tenant=other');assert.equal(forged.status,400);
 const branch=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07&team=not-owned');assert.equal(branch.status,403);
 const option=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07&actionEvidenceHandledByServer=true');assert.equal(option.status,400);
 const write=await request('/api/workforce/lifecycle/action-evidence/time-review',{actionEvidenceHandledByServer:true});assert.equal(write.status,405);
 const unknown=await request('/api/workforce/lifecycle/action-evidence/no-source');assert.equal(unknown.status,404);
 localDb=new DatabaseSync(path.join(dir,'state.sqlite'));
 const guardModule=createRequire(import.meta.url)(path.join(runtime,'operations-runtime/workforce-lifecycle-guard.cjs'));
 defaultGuard=guardModule.createWorkforceLifecycleGuard({dbPath:path.join(dir,'state.sqlite')});
 const response={statusCode:200,headersSent:false,writableEnded:false,setHeader(){},end(value){this.body=JSON.parse(value);this.writableEnded=true;this.headersSent=true;}};
 await defaultGuard.handleRequest({method:'GET',url:'/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07',headers:{cookie}},response);
 assert.equal(response.statusCode,503,'unconfigured standalone guards retain their closed source-reader contract');
 assert.equal(response.body.code,'WFM_ACTION_EVIDENCE_SOURCE_READER_REQUIRED');
 delegated=guardModule.createWorkforceLifecycleGuard({dbPath:path.join(dir,'state.sqlite'),actionEvidenceHandledByServer:true});
 assert.equal(await delegated.handleRequest({method:'GET',url:'/api/workforce/lifecycle/action-evidence/time-review',headers:{}},{}),false);
 const otherResponse={...response,headersSent:false,writableEnded:false,statusCode:200};
 assert.equal(await delegated.handleRequest({method:'GET',url:'/api/workforce/lifecycle/action-evidence-not-owned',headers:{}},otherResponse),true);
 assert.equal(otherResponse.statusCode,404,'unrelated lifecycle paths retain the original guard');
 const lifecycleResponse={...response,headersSent:false,writableEnded:false,statusCode:200};
 await delegated.handleRequest({method:'GET',url:'/api/workforce/lifecycle/status',headers:{}},lifecycleResponse);
 assert.equal(lifecycleResponse.statusCode,401,'the existing lifecycle status route still requires its original authority');
 // Revocation modifies the real stored principal and is observed on the next
 // authenticated HTTP read. No request-supplied role can regain source authority.
 localDb.prepare('UPDATE users SET role=? WHERE email=?').run('employee','superuser@northstar.example');
 const revoked=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07');assert.equal(revoked.status,403);
 const managers=localDb.prepare("SELECT email,person_id FROM users WHERE tenant=? AND role='manager'").all('northstar-demo');
 const org=stillSignedIn.body.state.org;
 const descendants=id=>{const ids=new Set([id]);for(let more=true;more;){more=false;for(const node of org)if(ids.has(node.parent)&&!ids.has(node.id)){ids.add(node.id);more=true;}}return ids;};
 const scoped=managers.map(manager=>({manager,allowed:descendants(manager.person_id)})).find(x=>source.body.teams.some(team=>!x.allowed.has(team.id)));
 assert.ok(scoped,'the retained fixture must include a manager and another reporting branch');
 cookie='';assert.equal((await request('/api/login',{email:scoped.manager.email,password:'Factory-local-demo-2026!'})).status,200);
 const managerRead=await request('/api/weekly-review?period=2026-09-07');assert.equal(managerRead.status,200);assert.ok(managerRead.body.teams.every(team=>scoped.allowed.has(team.id)));
 const forbidden=source.body.teams.find(team=>!scoped.allowed.has(team.id));
 const foreignBranch=await request('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07&team='+encodeURIComponent(forbidden.id));assert.equal(foreignBranch.status,403,'same-tenant source/team membership cannot broaden reporting access');
 const headerOptOut=await fetch(origin+'/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07&team='+encodeURIComponent(forbidden.id),{headers:{origin,cookie,'user-agent':'Vector-Workflow-Reader-Regression','x-action-evidence-handled-by-server':'true'}});assert.equal(headerOptOut.status,403);await headerOptOut.body.cancel();
});
