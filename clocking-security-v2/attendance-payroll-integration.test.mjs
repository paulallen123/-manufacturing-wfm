import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';
import { AttendancePayrollGate } from './attendance-payroll-gate.mjs';

const START=Date.parse('2026-09-18T06:00:00Z');
const END=Date.parse('2026-09-18T14:00:00Z');

function setup(){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:24*60*60_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  const coverage=new AttendanceCoverageAssurance({engine,startGraceMs:300_000,endGraceMs:300_000});
  coverage.registerShift({tenant:'acme',site:'s1',shiftId:'shift1',startAt:START,endAt:END,assignments:[{employee:'e1'}]});
  coverage.setCoveragePlan({tenant:'acme',site:'s1',employee:'e1',routes:[
    {domain:'physical_access',sourceId:'door',role:'anchor_in'},
    {domain:'physical_access',sourceId:'door',role:'departure_anchor'},
    {domain:'network_auth',sourceId:'wifi',role:'corroborator'}
  ]});
  const certifier=new AttendanceClaimCertifier({coverage});
  return {engine,coverage,certifier,payroll:new AttendancePayrollGate({coverage,certifier})};
}
function event(sourceId,eventId,kind,at){
  return {tenant:'acme',sourceId,eventId,employee:'e1',kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+1000};
}
function health(periodCoverageComplete=true){
  return [
    {sourceId:'door',state:'healthy',pendingRecovery:false,periodCoverageComplete},
    {sourceId:'wifi',state:'healthy',pendingRecovery:false,periodCoverageComplete}
  ];
}
function clockIn(engine){
  engine.ingest(event('door','door-in-0001','access_entry',START));
  engine.ingest(event('wifi','wifi-in-0001','wifi_authenticated',START+5000));
}
function clockOut(engine){
  engine.ingest(event('door','door-out-001','access_exit',END));
  engine.ingest(event('wifi','wifi-out-001','wifi_disconnected',END-5000));
}

test('real attendance engine flows a fully verified interval into payroll input only after shift close',()=>{
  const x=setup(); clockIn(x.engine); clockOut(x.engine);
  const p=x.payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:END+301_000,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health(true)});
  assert.equal(p.payrollReady,true);
  assert.equal(p.attendanceInputs.length,1);
  assert.equal(p.attendanceInputs[0].inAt,new Date(START).toISOString());
  assert.equal(p.attendanceInputs[0].outAt,new Date(END).toISOString());
  assert.equal(p.attendanceInputs[0].provenance.basis,'automatic_evidence');
});

test('caller cannot omit a planned source from continuity quorum to force payroll ready',()=>{
  const x=setup(); clockIn(x.engine); clockOut(x.engine);
  const p=x.payroll.projectShift({
    tenant:'acme',site:'s1',shiftId:'shift1',nowMs:END+301_000,shiftWindowClosed:true,
    expectedSourceIds:['door'],
    sourceHealth:[{sourceId:'door',state:'healthy',pendingRecovery:false,periodCoverageComplete:true}]
  });
  assert.equal(p.payrollReady,false);
  assert.equal(p.attendanceInputs.length,0);
  assert.equal(p.certification.sourceContinuityPeriod,false);
});

test('real missing OUT cannot reach payroll; audited manager correction resolves payroll without upgrading automatic certification',()=>{
  const x=setup(); clockIn(x.engine);
  let p=x.payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:END+301_000,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health(true)});
  assert.equal(p.payrollReady,false); assert.equal(p.attendanceInputs.length,0); assert.equal(p.certification.claimLevel,'NOT_CERTIFIED');
  x.payroll.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'review-1',actorId:'manager-1',reasonCode:'CONFIRMED_EXIT',correctedInAt:START,correctedOutAt:END,reviewedAt:END+301_000});
  p=x.payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:END+301_000,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health(true)});
  assert.equal(p.payrollReady,true); assert.equal(p.attendanceInputs.length,1); assert.equal(p.attendanceInputs[0].provenance.basis,'manager_correction');
  assert.equal(p.certification.claimLevel,'NOT_CERTIFIED'); assert.equal(p.certification.claim,null);
});

test('real complete attendance is still excluded when source continuity for the shift is not proven',()=>{
  const x=setup(); clockIn(x.engine); clockOut(x.engine);
  const p=x.payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:END+301_000,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health(false)});
  assert.equal(p.payrollReady,false); assert.equal(p.attendanceInputs.length,0); assert.equal(p.reviewRequired.length,1);
  assert.equal(p.reviewRequired[0].provenance.basis,'source_continuity_not_verified');
});
