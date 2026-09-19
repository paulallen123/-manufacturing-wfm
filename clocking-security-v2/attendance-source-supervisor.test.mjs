import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';
const T=Date.parse('2026-09-18T06:00:00Z');
function setup(supportsBackfill=true){
 const s=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000});
 s.register({tenant:'acme',sourceId:'wifi',provider:'nps',domain:'network_auth',site:'s1',supportsBackfill,nowMs:T});
 s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T});
 s.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T}); return s;
}
test('healthy source starts with complete continuity window',()=>{
 const s=setup(); const h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1000}); assert.equal(h.periodCoverageComplete,true); assert.equal(h.state,'healthy');
});
test('sequence gap cannot be declared recovered before the missing event is observed',()=>{
 const s=setup();
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
 let h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}); assert.equal(h.periodCoverageComplete,false); assert.equal(h.state,'reconciling');
 const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'}); assert.equal(s.completeRecovery({jobId:job.jobId}),false);
 h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}); assert.equal(h.periodCoverageComplete,false);
});
test('sequence gap restores continuity only after the missing sequence is actually ingested',()=>{
 const s=setup();
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
 const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e-backfill-11',observedAt:new Date(T+150).toISOString(),receivedAtMs:T+275,sequence:11});
 assert.equal(s.completeRecovery({jobId:job.jobId}),true);
 const h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}); assert.equal(h.periodCoverageComplete,true);
});
test('caller cannot mutate recovery evidence through a pendingRecovery copy',()=>{
 const s=setup();
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
 const [copy]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'}); copy.recoveredSequences.push(11);
 const [fresh]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'}); assert.deepEqual(fresh.recoveredSequences,[]); assert.equal(s.completeRecovery({jobId:fresh.jobId}),false);
});
test('reconnect without backfill permanently blocks that certification window',()=>{
 const s=setup(false); s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000}); const h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}); assert.equal(h.periodCoverageComplete,false); assert.equal(h.pendingRecovery,false);
});
test('same-window replay cannot erase an unrecoverable continuity gap',()=>{
 const s=setup(false);
 s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000});
 assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}).periodCoverageComplete,false);
 const replay=s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T});
 assert.equal(replay.periodCoverageComplete,false);
 assert.throws(()=>s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T+1500}),/changed its start time/);
 assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1501}).periodCoverageComplete,false);
});
test('connector registration replay cannot reset continuity or change authority configuration',()=>{
 const s=setup(false);
 s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000});
 s.register({tenant:'acme',sourceId:'wifi',provider:'nps',domain:'network_auth',site:'s1',supportsBackfill:false,nowMs:T+1200});
 let h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1201});
 assert.equal(h.periodCoverageComplete,false); assert.equal(h.reconnects,1);
 assert.throws(()=>s.register({tenant:'acme',sourceId:'wifi',provider:'nps',domain:'network_auth',site:'s2',supportsBackfill:false,nowMs:T+1300}),/explicit migration required/);
 h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1301}); assert.equal(h.site,'s1'); assert.equal(h.periodCoverageComplete,false);
});
test('prior certification-window IDs cannot be replayed after moving to a new shift',()=>{
 const s=setup();
 s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-2',startMs:T+2000});
 assert.throws(()=>s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T}),/window ID replay/);
 assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+2001}).certificationWindowId,'shift-2');
});
test('new certification window resets historical continuity state',()=>{
 const s=setup(false); s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000}); assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}).periodCoverageComplete,false);
 s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-2',startMs:T+2000}); s.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+2000}); assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+2001}).periodCoverageComplete,true);
});
