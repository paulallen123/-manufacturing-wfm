import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';

const START=Date.parse('2026-09-18T06:00:00Z'), END=Date.parse('2026-09-18T14:00:00Z');

function setup(){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  for(const e of ['e1','e2']) engine.registerPerson({tenant:'acme',employee:e,sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  const coverage=new AttendanceCoverageAssurance({engine,startGraceMs:300_000,endGraceMs:300_000});
  coverage.registerShift({tenant:'acme',site:'s1',shiftId:'day1',startAt:START,endAt:END,assignments:[{employee:'e1'},{employee:'e2',workerType:'agency'}]});
  return {engine,coverage};
}

function complete(engine,e,offset=0){
  engine.ingest({tenant:'acme',sourceId:'door',eventId:`door-in-${e}-001`,employee:e,kind:'access_entry',observedAt:new Date(START+offset).toISOString(),receivedAtMs:START+60_000});
  engine.ingest({tenant:'acme',sourceId:'wifi',eventId:`wifi-in-${e}-001`,employee:e,kind:'wifi_authenticated',observedAt:new Date(START+offset+10_000).toISOString(),receivedAtMs:START+60_000});
  engine.ingest({tenant:'acme',sourceId:'door',eventId:`door-out-${e}-01`,employee:e,kind:'access_exit',observedAt:new Date(END-offset).toISOString(),receivedAtMs:END+60_000});
  engine.ingest({tenant:'acme',sourceId:'wifi',eventId:`wifi-out-${e}-01`,employee:e,kind:'wifi_disconnected',observedAt:new Date(END-offset-10_000).toISOString(),receivedAtMs:END+60_000});
}

test('one missing worker blocks payroll even when everyone else has complete real engine clocks',()=>{
  const {engine,coverage}=setup(); complete(engine,'e1');
  const r=coverage.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+600_000});
  assert.equal(r.rows.find(x=>x.employee==='e1').status,'complete');
  assert.equal(r.rows.find(x=>x.employee==='e2').status,'missing_in');
  assert.equal(r.payrollReady,false);
  assert.equal(r.unresolved,1);
});

test('all scheduled workers must have complete real engine IN/OUT before payroll can be ready',()=>{
  const {engine,coverage}=setup(); complete(engine,'e1'); complete(engine,'e2',1000);
  const r=coverage.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+600_000});
  assert.equal(r.rows.length,2);
  assert.equal(r.rows.every(x=>x.status==='complete'),true);
  assert.equal(r.payrollReady,true);
});
