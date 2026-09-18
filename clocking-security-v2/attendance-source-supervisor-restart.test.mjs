import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
function make(){
  const s=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  s.register({tenant:'acme',sourceId:'wifi',provider:'nps',site:'s1',supportsBackfill:true,nowMs:T});
  s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T});
  s.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+1000});
  return s;
}

test('restart preserves an unresolved sequence gap and keeps certification blocked',()=>{
  const a=make();
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  assert.equal(a.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,false);
  const snap=a.exportState();

  const b=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  b.restoreState(snap);
  const h=b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300});
  assert.equal(h.periodCoverageComplete,false);
  assert.equal(h.pendingRecovery,true);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,1);
});

test('restart preserves last sequence so a later event cannot hide a missing range',()=>{
  const a=make();
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:100});
  const snap=a.exportState();
  const b=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  b.restoreState(snap);
  b.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:103});
  const [job]=b.pendingRecovery({tenant:'acme',sourceId:'wifi'});
  assert.equal(job.expected,101); assert.equal(job.received,103);
});

test('completed reconciliation remains complete after restart only after missing sequence was observed',()=>{
  const a=make();
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  const [job]=a.pendingRecovery({tenant:'acme',sourceId:'wifi'});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e-backfill-11',observedAt:new Date(T+150).toISOString(),receivedAtMs:T+275,sequence:11});
  assert.equal(a.completeRecovery({jobId:job.jobId}),true);
  assert.equal(a.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,true);
  const b=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  b.restoreState(a.exportState());
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,true);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,0);
});

test('forged persisted sequence recovery evidence is rejected',()=>{
  const a=make();
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  const snap=a.exportState();
  snap.recovery[0].recoveredSequences=[12];
  const b=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  assert.throws(()=>b.restoreState(snap),/Invalid persisted sequence-gap recovery evidence/);
});

test('configuration drift cannot silently reinterpret persisted continuity state',()=>{
  const a=make();
  const b=new AttendanceSourceSupervisor({heartbeatSlaMs:20_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});
  assert.throws(()=>b.restoreState(a.exportState()),/configuration changed/);
});
