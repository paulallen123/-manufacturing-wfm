import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AttendanceSourceSupervisor} from './attendance-source-supervisor.mjs';
import {AtomicSupervisorStateStore,DurableAttendanceSourceRuntime} from './durable-source-supervisor.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
const K1=Buffer.alloc(32,0x41);
const K2=Buffer.alloc(32,0x42);
function file(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-source-state-'));return path.join(d,'supervisor.json');}
function sup(){return new AttendanceSourceSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000});}
function memoryAnchor(start=0){
  let current=start;
  return {
    current(){return current;},
    advance(expected){
      if(expected!==current) throw new Error('rollback anchor compare-and-set mismatch');
      current+=1;
      return current;
    },
    forceForTest(value){current=value;}
  };
}
function stateStore(filePath,{activeKeyId='k1',integrityKeys={k1:K1},rollbackAnchor}={}){
  return new AtomicSupervisorStateStore({filePath,activeKeyId,integrityKeys,rollbackAnchor});
}
function setup(filePath,{rollbackAnchor=memoryAnchor(),...storeOptions}={}){
  const runtime=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(filePath,{...storeOptions,rollbackAnchor})});
  runtime.register({tenant:'acme',sourceId:'wifi',provider:'nps',site:'s1',supportsBackfill:true,nowMs:T});
  runtime.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift-1',startMs:T});
  runtime.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+1000});
  return {runtime,rollbackAnchor};
}

test('unresolved gap survives a real persistent-store restart with the same independent anchor',()=>{
  const p=file(); const anchor=memoryAnchor(); const {runtime:a}=setup(p,{rollbackAnchor:anchor});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  assert.equal(a.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,false);
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,{rollbackAnchor:anchor})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,false);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,1);
});

test('provider retry after restart is exactly-once for gap accounting',()=>{
  const p=file(); const anchor=memoryAnchor(); const {runtime:a}=setup(p,{rollbackAnchor:anchor});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  const e2={tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12};
  a.event(e2);
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,{rollbackAnchor:anchor})});
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

test('tampered canonical state fails authentication on restart',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  const frame=JSON.parse(fs.readFileSync(p,'utf8')); frame.state.connectors[0].lastSequence=999;
  fs.writeFileSync(p,JSON.stringify(frame));
  assert.throws(()=>new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,{rollbackAnchor:anchor})}),/authentication failed/);
});

test('recomputing an unkeyed digest cannot forge authenticated state',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  const frame=JSON.parse(fs.readFileSync(p,'utf8'));
  frame.state.connectors[0].lastSequence=999;
  frame.integrity.mac=crypto.createHash('sha256').update(JSON.stringify(frame.state)).digest('hex');
  fs.writeFileSync(p,JSON.stringify(frame));
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/authentication failed/);
});

test('checksum-only legacy frame is rejected rather than silently trusted',()=>{
  const p=file(); const anchor=memoryAnchor();
  const legacy={schemaVersion:1,state:{version:1,config:{},connectors:[],recovery:[]},checksum:'0'.repeat(64)};
  fs.writeFileSync(p,JSON.stringify(legacy));
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/rollback generation/);
});

test('stale crash temp file cannot replace last committed canonical state',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  fs.writeFileSync(path.join(path.dirname(p),`.${path.basename(p)}.stale.tmp`),'partial');
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,{rollbackAnchor:anchor})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+1001}).certificationWindowId,'shift-1');
});

test('reconciliation completion is durably preserved across restart',()=>{
  const p=file(); const anchor=memoryAnchor(); const {runtime:a}=setup(p,{rollbackAnchor:anchor});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  const [job]=a.pendingRecovery({tenant:'acme',sourceId:'wifi'});
  assert.equal(a.completeRecovery({jobId:job.jobId}),false);
  a.event({tenant:'acme',sourceId:'wifi',providerEventId:'e-backfill-11',observedAt:new Date(T+150).toISOString(),receivedAtMs:T+275,sequence:11});
  assert.equal(a.completeRecovery({jobId:job.jobId}),true);
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,{rollbackAnchor:anchor})});
  assert.equal(b.status({tenant:'acme',sourceId:'wifi',nowMs:T+300}).periodCoverageComplete,true);
  assert.equal(b.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,0);
});

test('integrity key rotation accepts retained old key and rewrites with active new key',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  const oldFrame=fs.readFileSync(p);
  const rotating={activeKeyId:'k2',integrityKeys:{k1:K1,k2:K2},rollbackAnchor:anchor};
  const b=new DurableAttendanceSourceRuntime({supervisor:sup(),store:stateStore(p,rotating)});
  b.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+1500});
  const newFrame=JSON.parse(fs.readFileSync(p,'utf8'));
  assert.equal(newFrame.integrity.keyId,'k2');
  assert.doesNotThrow(()=>stateStore(p,{activeKeyId:'k2',integrityKeys:{k2:K2},rollbackAnchor:anchor}).load());

  const oldPath=path.join(path.dirname(p),'old.json');
  fs.writeFileSync(oldPath,oldFrame);
  assert.throws(()=>stateStore(oldPath,{activeKeyId:'k2',integrityKeys:{k2:K2},rollbackAnchor:anchor}).load(),/not trusted|rollback detected/);
});

test('replaying an older valid authenticated state is rejected by the independent monotonic anchor',()=>{
  const p=file(); const anchor=memoryAnchor(); const {runtime}=setup(p,{rollbackAnchor:anchor});
  const oldFrame=fs.readFileSync(p);
  runtime.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+2000});
  const current=JSON.parse(fs.readFileSync(p,'utf8'));
  assert.ok(current.rollbackGeneration>JSON.parse(oldFrame).rollbackGeneration);
  fs.writeFileSync(p,oldFrame);
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/rollback detected/);
});

test('deleting state cannot reset history when independent anchor has advanced',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  assert.ok(anchor.current()>0);
  fs.unlinkSync(p);
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/missing while rollback anchor is advanced/);
});

test('attacker cannot forge a higher rollback generation without the integrity key',()=>{
  const p=file(); const anchor=memoryAnchor(); setup(p,{rollbackAnchor:anchor});
  const frame=JSON.parse(fs.readFileSync(p,'utf8'));
  frame.rollbackGeneration=anchor.current()+1;
  anchor.forceForTest(frame.rollbackGeneration);
  fs.writeFileSync(p,JSON.stringify(frame));
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/authentication failed/);
});

test('authenticated file ahead of the independent anchor fails closed without advancing trust',()=>{
  const p=file(); const anchor=memoryAnchor();
  const state={version:1,config:{},connectors:[],recovery:[]};
  stateStore(p,{rollbackAnchor:anchor}).save(state);
  assert.equal(anchor.current(),1);
  anchor.forceForTest(0);
  assert.throws(()=>stateStore(p,{rollbackAnchor:anchor}).load(),/rollback detected/);
  assert.equal(anchor.current(),0);
});

test('anchor outage never publishes staged state and freezes the stale writer until restart',()=>{
  const p=file(); const anchor=memoryAnchor();
  let failOnce=true;
  const flakyAnchor={
    current(){ return anchor.current(); },
    advance(expected){
      if(failOnce){ failOnce=false; throw new Error('simulated anchor outage'); }
      return anchor.advance(expected);
    }
  };
  const state={version:1,config:{},connectors:[],recovery:[]};
  const store=stateStore(p,{rollbackAnchor:flakyAnchor});
  assert.throws(()=>store.save(state),/simulated anchor outage/);
  assert.equal(fs.existsSync(p),false);
  assert.equal(anchor.current(),0);
  assert.equal(store.requiresRecovery(),true);
  assert.throws(()=>store.save(state),/requires restart\/recovery/);

  const restarted=stateStore(p,{rollbackAnchor:anchor});
  assert.equal(restarted.load(),null);
  assert.equal(restarted.requiresRecovery(),false);
  restarted.save(state);
  assert.deepEqual(stateStore(p,{rollbackAnchor:anchor}).load(),state);
  assert.equal(anchor.current(),1);
});

test('unexpected anchor generation never publishes staged state and store freezes until recovery',()=>{
  const p=file();
  const badAnchor={current(){return 0;},advance(){return 2;}};
  const store=stateStore(p,{rollbackAnchor:badAnchor});
  const state={version:1,config:{},connectors:[],recovery:[]};
  assert.throws(()=>store.save(state),/did not advance exactly once/);
  assert.equal(fs.existsSync(p),false);
  assert.equal(store.requiresRecovery(),true);
  assert.throws(()=>store.save(state),/requires restart\/recovery/);
});
