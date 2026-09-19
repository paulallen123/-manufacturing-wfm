import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';
import { AttendancePayrollGate } from './attendance-payroll-gate.mjs';

const START=Date.parse('2026-09-18T06:00:00Z');
const END=Date.parse('2026-09-18T14:00:00Z');
const REVIEWED=END+301_000;

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
  return {engine,payroll:new AttendancePayrollGate({coverage,certifier})};
}

function event(sourceId,eventId,kind,at){
  return {tenant:'acme',sourceId,eventId,employee:'e1',kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+1000};
}
function health(){
  return [
    {sourceId:'door',state:'healthy',pendingRecovery:false,periodCoverageComplete:true},
    {sourceId:'wifi',state:'healthy',pendingRecovery:false,periodCoverageComplete:true}
  ];
}
function project(payroll){
  return payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:REVIEWED,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health()});
}

test('late authoritative evidence invalidates an older manager correction until explicitly re-reviewed',()=>{
  const {engine,payroll}=setup();
  engine.ingest(event('door','door-in-1','access_entry',START));
  engine.ingest(event('wifi','wifi-in-1','wifi_authenticated',START+5000));

  let p=project(payroll);
  assert.equal(p.payrollReady,false);
  assert.equal(p.reviewRequired[0].originalAttendanceStatus,'missing_out');

  payroll.recordCorrection({
    tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'review-1',actorId:'manager-1',reasonCode:'CONFIRMED_EXIT',
    correctedInAt:START,correctedOutAt:END,reviewedAt:REVIEWED
  });
  p=project(payroll);
  assert.equal(p.payrollReady,true);
  assert.equal(p.attendanceInputs[0].provenance.reviewId,'review-1');

  // A delayed provider backfill changes the underlying attendance decision after
  // the manager reviewed it. The old correction must not silently remain payroll
  // authority; ambiguity returns to review until a manager sees the new evidence.
  engine.ingest(event('wifi','wifi-out-late-1','wifi_disconnected',END-5000));
  engine.ingest(event('door','door-out-late-1','access_exit',END));

  p=project(payroll);
  assert.equal(p.payrollReady,false);
  assert.equal(p.attendanceInputs.length,0);
  assert.equal(p.reviewRequired.length,1);
  assert.equal(p.reviewRequired[0].provenance.basis,'manager_correction_stale_after_attendance_change');
  assert.equal(p.reviewRequired[0].provenance.reviewId,'review-1');
  assert.equal(p.reviewRequired[0].priorReviewedAttendanceStatus,'missing_out');
  assert.equal(p.reviewRequired[0].originalAttendanceStatus,'complete');

  payroll.recordCorrection({
    tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'review-2',actorId:'manager-1',reasonCode:'RECONFIRMED_AFTER_BACKFILL',
    correctedInAt:START,correctedOutAt:END,reviewedAt:REVIEWED+1,supersedesReviewId:'review-1'
  });
  p=payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:REVIEWED+1,shiftWindowClosed:true,expectedSourceIds:['door','wifi'],sourceHealth:health()});
  assert.equal(p.payrollReady,true);
  assert.equal(p.attendanceInputs.length,1);
  assert.equal(p.attendanceInputs[0].provenance.basis,'manager_correction');
  assert.equal(p.attendanceInputs[0].provenance.reviewId,'review-2');
  assert.equal(payroll.verifyAuditChain(),true);
});
