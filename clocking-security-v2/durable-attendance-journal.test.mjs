import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DurableEvidenceJournal,DurableAttendanceRuntime} from './durable-attendance-journal.mjs';

function tmp(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-att-'));return path.join(d,'attendance.journal');}
function event(id='event-0001',kind='access_entry'){return {tenant:'acme',sourceId:'door',eventId:id,employee:'e1',kind,observedAt:'2026-09-18T06:00:00.000Z',receivedAtMs:1770000000000,metadata:{controllerId:'c1'}};}
class FakeEngine{
  constructor(){this.seen=new Map();this.applied=[];}
  ingest(x){
    const k=`${x.tenant}:${x.sourceId}:${x.eventId}`; const body=JSON.stringify(x);
    if(this.seen.has(k)){
      if(this.seen.get(k)!==body) throw Object.assign(new Error('collision'),{status:409});
      return {status:'recorded',eventId:x.eventId,decision:{status:'authoritative'},replayed:true};
    }
    if(x.kind==='invalid') throw Object.assign(new Error('invalid evidence'),{status:409});
    this.seen.set(k,body);this.applied.push(k);
    return {status:'recorded',eventId:x.eventId,decision:{status:'authoritative'},replayed:false};
  }
}

test('fsynced event survives crash before engine apply and is applied once on restart',()=>{
  const file=tmp(); const j1=new DurableEvidenceJournal({filePath:file});
  j1.appendEvent(event());
  const e2=new FakeEngine(); const j2=new DurableEvidenceJournal({filePath:file}); new DurableAttendanceRuntime({engine:e2,journal:j2});
  assert.equal(e2.applied.length,1); const [record]=j2.listEvents(); assert.equal(j2.getOutcome(record.key).ok,true);
});

test('crash after engine apply/outcome then client retry is a durable replay, not a second apply',()=>{
  const file=tmp(); const e1=new FakeEngine(); const r1=new DurableAttendanceRuntime({engine:e1,journal:new DurableEvidenceJournal({filePath:file})});
  r1.ingest(event()); assert.equal(e1.applied.length,1);
  const e2=new FakeEngine(); const r2=new DurableAttendanceRuntime({engine:e2,journal:new DurableEvidenceJournal({filePath:file})});
  assert.equal(e2.applied.length,1);
  const retry=r2.ingest(event()); assert.equal(retry.durableReplay,true); assert.equal(e2.applied.length,1);
});

test('same event id with changed content is rejected before a second durable frame',()=>{
  const file=tmp(); const r=new DurableAttendanceRuntime({engine:new FakeEngine(),journal:new DurableEvidenceJournal({filePath:file})});
  r.ingest(event());
  assert.throws(()=>r.ingest({...event(),kind:'access_exit'}),/reused for different content/);
});

test('rejected evidence gets a durable rejection outcome and is not retried forever',()=>{
  const file=tmp(); const bad=event('event-bad1','invalid');
  const r1=new DurableAttendanceRuntime({engine:new FakeEngine(),journal:new DurableEvidenceJournal({filePath:file})});
  assert.throws(()=>r1.ingest(bad),/invalid evidence/);
  const e2=new FakeEngine(); const r2=new DurableAttendanceRuntime({engine:e2,journal:new DurableEvidenceJournal({filePath:file})});
  assert.equal(e2.applied.length,0);
  assert.throws(()=>r2.ingest(bad),/invalid evidence/);
});

test('partial trailing frame from power loss is truncated without losing prior complete records',()=>{
  const file=tmp(); const j=new DurableEvidenceJournal({filePath:file}); j.appendEvent(event());
  fs.appendFileSync(file,'{"payload":');
  const sizeBefore=fs.statSync(file).size; const recovered=new DurableEvidenceJournal({filePath:file});
  assert.equal(recovered.listEvents().length,1); assert.ok(fs.statSync(file).size<sizeBefore);
});

test('checksum corruption fails closed',()=>{
  const file=tmp(); const j=new DurableEvidenceJournal({filePath:file}); j.appendEvent(event());
  let text=fs.readFileSync(file,'utf8'); text=text.replace('controllerId','controllerXd'); fs.writeFileSync(file,text);
  assert.throws(()=>new DurableEvidenceJournal({filePath:file}),/checksum mismatch/);
});

test('logic-version drift fails closed instead of silently reinterpreting payroll evidence',()=>{
  const file=tmp(); const j=new DurableEvidenceJournal({filePath:file,logicVersion:'v1'}); j.appendEvent(event());
  assert.throws(()=>new DurableEvidenceJournal({filePath:file,logicVersion:'v2'}),/logic version/);
});

test('1,000 duplicate retries persist one event and one outcome',()=>{
  const file=tmp(); const e=new FakeEngine(); const r=new DurableAttendanceRuntime({engine:e,journal:new DurableEvidenceJournal({filePath:file})});
  r.ingest(event()); for(let i=0;i<1000;i++) r.ingest(event());
  assert.equal(e.applied.length,1);
  const j2=new DurableEvidenceJournal({filePath:file}); assert.equal(j2.listEvents().length,1);
});
