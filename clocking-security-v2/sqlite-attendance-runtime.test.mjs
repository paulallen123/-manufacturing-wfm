import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { SQLiteAttendanceRuntime } from './sqlite-attendance-runtime.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
const workerPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'sqlite-attendance-worker.mjs');
function dbPath(){ const d=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-sqlite-att-')); return path.join(d,'attendance.db'); }
function engine(){ return new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000}); }
function bootstrap(file){
  const e=engine();
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  e.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  e.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  e.registerPerson({tenant:'beta',employee:'e1',sites:['s9']});
  e.registerSource({tenant:'beta',sourceId:'door',site:'s9',type:'access'});
  e.registerSource({tenant:'beta',sourceId:'wifi',site:'s9',type:'radius'});
  const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  r.close();
}
function event(sourceId,eventId,kind,at){ return {tenant:'acme',sourceId,eventId,employee:'e1',kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+10_000}; }
function runWorker(file,payload){
  return new Promise((resolve,reject)=>{
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const child=spawn(process.execPath,[workerPath,file,encoded],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>stdout+=d);
    child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);
    child.on('close',code=>{
      let parsed; try{ parsed=JSON.parse(stdout||'{}'); }catch{ return reject(new Error(`worker JSON parse failed: ${stdout}\n${stderr}`)); }
      resolve({code,stderr,...parsed});
    });
  });
}

// This is deliberately cross-process rather than Promise.all against one JS
// object: it exercises real SQLite writer contention and stale in-memory engines.
test('two processes racing the same provider event persist and apply it exactly once',async()=>{
  const file=dbPath(); bootstrap(file);
  const payload=event('door','door-concurrent-0001','access_entry',T);
  const [a,b]=await Promise.all([runWorker(file,payload),runWorker(file,payload)]);
  assert.equal(a.ok,true); assert.equal(b.ok,true);
  const first=[a,b].filter(x=>x.receipt?.replayed===false).length;
  const replay=[a,b].filter(x=>x.receipt?.durableReplay===true).length;
  assert.equal(first,1); assert.equal(replay,1);

  const e=engine(); const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  assert.equal(r.storedEventCount(),1);
  assert.equal(e.audit.filter(x=>x.action==='attendance-evidence-recorded').length,1);
  r.close();
});

test('different evidence arriving concurrently across processes still produces one authoritative IN',async()=>{
  const file=dbPath(); bootstrap(file);
  const door=event('door','door-concurrent-0002','access_entry',T);
  const wifi=event('wifi','wifi-concurrent-0002','wifi_authenticated',T+5000);
  const [a,b]=await Promise.all([runWorker(file,door),runWorker(file,wifi)]);
  assert.equal(a.ok,true); assert.equal(b.ok,true);

  const e=engine(); const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  assert.equal(r.storedEventCount(),2);
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
  r.close();
});

test('same provider event id with conflicting concurrent content fails closed',async()=>{
  const file=dbPath(); bootstrap(file);
  const aEvent=event('door','door-collision-0001','access_entry',T);
  const bEvent=event('door','door-collision-0001','access_exit',T);
  const results=await Promise.all([runWorker(file,aEvent),runWorker(file,bEvent)]);
  assert.equal(results.filter(x=>x.ok===true).length,1);
  const rejected=results.find(x=>x.ok===false);
  assert.equal(rejected.status,409);
  assert.match(rejected.message,/reused for different content/);

  const e=engine(); const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  assert.equal(r.storedEventCount(),1);
  assert.equal(e.audit.filter(x=>x.action==='attendance-evidence-recorded').length,1);
  r.close();
});

test('rejected poison event is durably rejected once and never mutates canonical engine state',async()=>{
  const file=dbPath(); bootstrap(file);
  const bad={...event('door','door-poison-0001','access_entry',T),employee:'missing'};
  const [a,b]=await Promise.all([runWorker(file,bad),runWorker(file,bad)]);
  assert.equal(a.ok,false); assert.equal(b.ok,false);
  assert.equal(a.status,404); assert.equal(b.status,404);

  const e=engine(); const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  assert.equal(r.storedEventCount(),1);
  assert.equal(e.events.size,0);
  assert.equal(e.audit.length,0);
  r.close();
});

test('same source and event ids in different tenants remain isolated under concurrent ingestion',async()=>{
  const file=dbPath(); bootstrap(file);
  const base=event('door','shared-cross-tenant-0001','access_entry',T);
  const beta={...base,tenant:'beta'};
  const [a,b]=await Promise.all([runWorker(file,base),runWorker(file,beta)]);
  assert.equal(a.ok,true); assert.equal(b.ok,true);

  const e=engine(); const r=new SQLiteAttendanceRuntime({filePath:file,engine:e});
  assert.equal(r.storedEventCount(),2);
  const evidenceAudit=e.audit.filter(x=>x.action==='attendance-evidence-recorded');
  assert.equal(evidenceAudit.length,2);
  assert.deepEqual(new Set(evidenceAudit.map(x=>x.tenant)),new Set(['acme','beta']));
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(e.getState({tenant:'beta',employee:'e1',site:'s9'}).status,'outside');
  r.close();
});
