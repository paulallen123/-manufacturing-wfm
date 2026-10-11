'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixture}=require('./support-recovery-fixture.cjs');
const runtime=process.env.WFM_SUPPORT_HTTP_RUNTIME;
// Explicit environment avoids silently substituting a sealed or hosted runtime.
test('composed application routes connect bounded support outcomes to authenticated tenant state',{skip:!runtime},async t=>{
 const {createAttendanceRuntime}=await import(path.join(process.env.WFM_SUPPORT_HTTP_HARNESS));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'support-repair-http-')),database=path.join(dir,'state.sqlite');
 const previous=process.env.WFM_AGENT_AUTHORITY_KEY;process.env.WFM_AGENT_AUTHORITY_KEY='ci-only-agent-authority-key-0123456789abcdef0123456789abcdef';
 const harness=createAttendanceRuntime({runtime,database});let origin;
 const request=async(url,cookie,body)=>{const r=await fetch(origin+url,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async email=>{const r=await request('/api/login',null,{email,password:'Factory-local-demo-2026!'});assert.equal(r.status,200);return r.cookie;};
 try{
  origin=await harness.start();const admin=await login('superuser@northstar.example'),employee=await login('maya@northstar.example'),foreign=await login('other@isolation.example');
  const f=fixture(t,{databasePath:database,principal:{tenant:'northstar-demo',email:'superuser@northstar.example',permissions:['company.configure']}}),inv=f.attest(f.retry()),permit=f.permit(inv);
  const payload={id:inv.id,permit,workerId:'bounded-synthetic-worker'},endpoint='/api/integrations/investigations/execute-recovery-permit';
  assert.equal((await request(endpoint,null,payload)).status,401);
  assert.equal((await request(endpoint,employee,payload)).status,403);
  const deniedForeign=await request(endpoint,foreign,payload);assert.equal(deniedForeign.status,403);assert.equal(JSON.stringify(deniedForeign.body).includes(inv.id),false);
  const executed=await request(endpoint,admin,payload);assert.equal(executed.status,200,JSON.stringify(executed.body));assert.equal(executed.body.supportRecovery.state,'verifying-recovery');
  const report=(await request('/api/support',admin)).body;assert.equal(report.service.repairWorker,'bounded-provider-recovery');assert.equal(report.service.automaticRepairs,false);assert.equal(report.incidents.find(x=>x.evidence.investigationId===inv.id).job_status,'verifying-recovery');
  f.db.exec("CREATE TRIGGER http_terminal_audit_outage BEFORE INSERT ON support_events WHEN NEW.action='provider-recovery-recovered-internal' BEGIN SELECT RAISE(ABORT,'HTTP fixture terminal audit outage'); END;");
  assert.throws(()=>f.finish(inv,executed.body),/HTTP fixture terminal audit outage/);
  const unaudited=(await request('/api/support',admin)).body.incidents.find(x=>x.evidence.investigationId===inv.id);assert.equal(unaudited.recovery.verified,false);assert.notEqual(unaudited.job_status,'recovered-internal');
  f.db.exec('DROP TRIGGER http_terminal_audit_outage');f.support.scan();await harness.stop();origin=await harness.start();
  const fresh=await login('superuser@northstar.example');const replay=await request(endpoint,fresh,payload);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.supportRecovery.state,'recovered-internal');
  const foreignReport=await request('/api/support',await login('other@isolation.example'));assert.equal(foreignReport.status,200);assert.equal(foreignReport.body.canReview,false);assert.equal(foreignReport.body.incidents,undefined);assert.equal(JSON.stringify(foreignReport.body).includes(inv.id),false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM provider_recovery_authority_events WHERE event_type='bounded-recovery-lease-acquired'").get().n,1);
 }finally{await harness.stop();if(previous===undefined)delete process.env.WFM_AGENT_AUTHORITY_KEY;else process.env.WFM_AGENT_AUTHORITY_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
