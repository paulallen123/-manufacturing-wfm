import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AttendanceSourceSupervisor} from './attendance-source-supervisor.mjs';
import {AtomicSupervisorStateStore,DurableAttendanceSourceRuntime} from './durable-source-supervisor.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
function file(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-source-state-'));return path.join(d,'supervisor.json');}
function sup(){return new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});}
function setup(filePath){
  const runtime=new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath})});
  runtime.register({tenant:'acme',sourceId:'wifi',provider:'nps',site:'s1',supportsBackfill:true,nowMs:T});
  runtime.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T});
  runtime.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+1000});
  return runtime;
}

test('unresolved gap survives a real persistent-store restart',()=>{
  const p=file(); const a=setup(p);
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  assert.equal(a.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,false);
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath:p})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,false);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,1);
});

test('provider retry after restart is exactly-once for gap accounting',()=>{
  const p=file(); const a=setup(p);
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  const e2={tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12};
  a.event(e2);
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath:p})});
  assert.equal(b.event(e2).status,'duplicate');
  const h=b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300});
  assert.equal(h.gaps,1); assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,1);
});

test('failed durable save rolls back in-memory mutation and refuses success',()=>{
  const s=sup();
  const states=[];
  const store={load(){return null;},save(state){states.push(state); if(states.length>=2) throw new Error('disk unavailable'); return true;}};
  const r=new DurableAttendanceSourceRuntime({supervisor:s,store});
  r.register({tenant:'acme',sourceId:'wifi',provider:'nps',site:'s1',supportsBackfill:true,nowMs:T});
  assert.throws(()=>r.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T}),/disk unavailable/);
  const exported=s.exportState();
  assert.equal(exported.connectors[0].window.id,null);
});

test('corrupt canonical state fails closed on restart',()=>{
  const p=file(); setup(p);
  const frame=JSON.parse(fs.readFileSync(p,'utf8')); frame.state.connectors[0].lastSequence=999;
  fs.writeFileSync(p,JSON.stringify(frame));
  assert.throws(()=>new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath:p})}),/checksum mismatch/);
});

test('stale crash temp file cannot replace last committed canonical state',()=>{
  const p=file(); const a=setup(p);
  fs.writeFileSync(path.join(path.dirname(p),`.${path.basename(p)}.stale.tmp`),'partial');
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath:p})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}).certificationWindowId,'shift-1');
});

test('reconciliation completion is durably preserved across restart',()=>{
  const p=file(); const a=setup(p);
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  const [job]=a.pendingRecovery({tenant:'acme',sourceId:'wifi'}); a.completeRecovery({jobId:job.jobId});
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:new AtomicSupervisorStateStore({filePath:p})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,true);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,0);
});
