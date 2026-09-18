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
test('sequence gap immediately removes 100% continuity until backfill completes',()=>{
 const s=setup();
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
 let h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}); assert.equal(h.periodCoverageComplete,false); assert.equal(h.state,'reconciling');
 const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'}); s.completeRecovery({jobId:job.jobId});
 h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}); assert.equal(h.periodCoverageComplete,true);
});
test('reconnect without backfill permanently blocks that certification window',()=>{
 const s=setup(false); s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000}); const h=s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}); assert.equal(h.periodCoverageComplete,false); assert.equal(h.pendingRecovery,false);
});
test('new certification window resets historical continuity state',()=>{
 const s=setup(false); s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+1000}); assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}).periodCoverageComplete,false);
 s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-2',startMs:T+2000}); s.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+2000}); assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+2001}).periodCoverageComplete,true);
});
