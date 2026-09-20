import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AutomaticAttendanceEvidenceEngine} from './invisible-attendance-engine.mjs';
import {DurableEvidenceJournal,DurableAttendanceRuntime} from './durable-attendance-journal.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
function journalPath(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-att-int-'));return path.join(d,'attendance.journal');}
function engine(){
  const e=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  e.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  e.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  e.registerSource({tenant:'acme',sourceId:'hmi',site:'s1',type:'mes'});
  return e;
}
function ev(sourceId,eventId,kind,at){return {tenant:'acme',sourceId,eventId,employee:'e1',kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+1000};}

test('real evidence engine reconstructs authoritative IN exactly once after restart',()=>{
  const file=journalPath(); const e1=engine(); const r1=new DurableAttendanceRuntime({engine:e1,journal:new DurableEvidenceJournal({filePath:file})});
  r1.ingest(ev('door','door-int-0001','access_entry',T));
  r1.ingest(ev('wifi','wifi-int-0001','wifi_authenticated',T+10_000));
  assert.equal(e1.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');

  const e2=engine(); const r2=new DurableAttendanceRuntime({engine:e2,journal:new DurableEvidenceJournal({filePath:file})});
  assert.equal(e2.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  const retry=r2.ingest(ev('wifi','wifi-int-0001','wifi_authenticated',T+10_000));
  assert.equal(retry.durableReplay,true);
  assert.equal(e2.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
});

test('recovery preserves strict OUT rule: weak disappearance still cannot stop pay',()=>{
  const file=journalPath(); const e1=engine(); const r1=new DurableAttendanceRuntime({engine:e1,journal:new DurableEvidenceJournal({filePath:file})});
  r1.ingest(ev('door','door-int-0002','access_entry',T));
  r1.ingest(ev('wifi','wifi-int-0002','wifi_authenticated',T+5_000));
  r1.ingest(ev('wifi','wifi-disc-0002','wifi_disconnected',T+8*60*60_000));
  assert.equal(e1.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  const e2=engine(); new DurableAttendanceRuntime({engine:e2,journal:new DurableEvidenceJournal({filePath:file})});
  assert.equal(e2.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  assert.equal(e2.audit.filter(x=>x.action==='attendance-out-authoritative').length,0);
});

test('authoritative OUT reconstructs once from door exit plus independent HMI logout',()=>{
  const file=journalPath(); const e1=engine(); const r1=new DurableAttendanceRuntime({engine:e1,journal:new DurableEvidenceJournal({filePath:file})});
  r1.ingest(ev('door','door-int-0003','access_entry',T));
  r1.ingest(ev('wifi','wifi-int-0003','wifi_authenticated',T+5_000));
  const end=T+8*60*60_000;
  r1.ingest(ev('door','door-out-int3','access_exit',end));
  r1.ingest(ev('hmi','hmi-out-int03','hmi_logout',end-10_000));
  assert.equal(e1.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  const e2=engine(); new DurableAttendanceRuntime({engine:e2,journal:new DurableEvidenceJournal({filePath:file})});
  assert.equal(e2.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(e2.audit.filter(x=>x.action==='attendance-out-authoritative').length,1);
});
