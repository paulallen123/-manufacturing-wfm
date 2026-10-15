'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {reconcileScheduleToAttendance}=require('./schedule-attendance-reconciliation.cjs');
const plan={contractVersion:'VECTOR_MANUFACTURING_SCHEDULER_V1',tenant:'a',planId:'p1',assignments:[{slotId:'s1',workerId:'w1',start:'2026-09-24T06:00:00Z',end:'2026-09-24T14:00:00Z'}]};
test('fails closed until existing attendance payroll gate is ready',()=>{const r=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:false,attendanceInputs:[{employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'}]}});assert.equal(r.ready,false);assert.equal(r.rows.length,0);assert.ok(r.blockers.includes('ATTENDANCE_PAYROLL_GATE_NOT_READY'));});
test('reconciles schedule to gate-authorised interval without calculating pay',()=>{const r=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[{employee:'w1',inAt:'2026-09-24T06:05:00Z',outAt:'2026-09-24T14:20:00Z',provenance:{basis:'automatic_evidence'}}]}});assert.equal(r.ready,true);assert.equal(r.rows[0].lateMinutes,5);assert.equal(r.rows[0].overtimeCandidateHours,0.25);assert.equal(r.payCalculationPerformed,false);assert.equal(r.payrollAuthority,false);});
test('missing or unexpected verified attendance is an explicit blocker',()=>{const r=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[{employee:'other',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'}]}});assert.equal(r.ready,false);assert.ok(r.blockers.includes('SCHEDULE_ASSIGNMENT_WITHOUT_VERIFIED_ATTENDANCE'));assert.ok(r.blockers.includes('UNEXPECTED_VERIFIED_ATTENDANCE'));});
test('one attendance interval cannot reconcile two shifts for the same worker',()=>{
  const twoShiftPlan={...plan,assignments:[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-25T06:00:00Z',end:'2026-09-25T14:00:00Z'}]};
  const r=reconcileScheduleToAttendance({plan:twoShiftPlan,payrollProjection:{payrollReady:true,attendanceInputs:[{employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'}]}});
  assert.equal(r.ready,false);
  assert.equal(r.rows[0].status,'RECONCILED');
  assert.equal(r.rows[1].status,'MISSING_VERIFIED_ATTENDANCE');
});
test('separate intervals reconcile separate shifts for the same worker',()=>{
  const twoShiftPlan={...plan,assignments:[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-25T06:00:00Z',end:'2026-09-25T14:00:00Z'}]};
  const r=reconcileScheduleToAttendance({plan:twoShiftPlan,payrollProjection:{payrollReady:true,attendanceInputs:[
    {employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'},
    {employee:'w1',inAt:'2026-09-25T06:00:00Z',outAt:'2026-09-25T14:00:00Z'}
  ]}});
  assert.equal(r.ready,true);
  assert.deepEqual(r.rows.map(x=>x.status),['RECONCILED','RECONCILED']);
  assert.equal(r.unexpectedAttendance.length,0);
});
test('duplicate attendance intervals are retained as unexpected evidence',()=>{
  const interval={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'};
  const r=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[interval,interval]}});
  assert.equal(r.ready,false);
  assert.equal(r.rows[0].status,'RECONCILED');
  assert.equal(r.unexpectedAttendance.length,1);
  assert.ok(r.blockers.includes('UNEXPECTED_VERIFIED_ATTENDANCE'));
});
test('overlapping evidence has an order-invariant maximum one-to-one assignment',()=>{
  const assignments=[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-24T14:00:00Z',end:'2026-09-24T22:00:00Z'}];
  const narrow={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'};
  const broad={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T22:00:00Z'};
  const results=[];
  for(const orderedAssignments of [assignments,[...assignments].reverse()])for(const attendanceInputs of [[broad,narrow],[narrow,broad]]){
    results.push(reconcileScheduleToAttendance({plan:{...plan,assignments:orderedAssignments},payrollProjection:{payrollReady:true,attendanceInputs}}));
  }
  assert.ok(results.every(r=>r.ready===true));
  assert.ok(results.every(r=>r.rows.find(x=>x.slotId==='s1').actualHours===8));
  assert.ok(results.every(r=>r.rows.find(x=>x.slotId==='s2').actualHours===16));
  assert.equal(new Set(results.map(r=>r.reconciliationId)).size,1);
});
test('byte-identical attendance evidence cannot cover two shifts',()=>{
  const duplicate={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T22:00:00Z',provenance:{basis:'automatic_evidence',exportId:'one'}};
  const assignments=[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-24T14:00:00Z',end:'2026-09-24T22:00:00Z'}];
  const r=reconcileScheduleToAttendance({plan:{...plan,assignments},payrollProjection:{payrollReady:true,attendanceInputs:[duplicate,{...duplicate,provenance:{...duplicate.provenance}}]}});
  assert.equal(r.ready,false);
  assert.equal(r.rows.filter(x=>x.status==='RECONCILED').length,1);
  assert.equal(r.rows.filter(x=>x.status==='MISSING_VERIFIED_ATTENDANCE').length,1);
  assert.equal(r.unexpectedAttendance.length,1);
  assert.ok(r.blockers.includes('UNEXPECTED_VERIFIED_ATTENDANCE'));
});
test('a contested interval is reassigned when another shift has no alternative',()=>{
  const assignments=[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-24T13:00:00Z',end:'2026-09-24T21:00:00Z'}];
  const exact={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'};
  const alternative={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T12:00:00Z'};
  const r=reconcileScheduleToAttendance({plan:{...plan,assignments},payrollProjection:{payrollReady:true,attendanceInputs:[exact,alternative]}});
  assert.equal(r.ready,true);
  assert.equal(r.rows.find(x=>x.slotId==='s1').actualHours,6);
  assert.equal(r.rows.find(x=>x.slotId==='s2').actualHours,8);
});
test('the same source interval stays single-use despite unrelated metadata',()=>{
  const assignments=[plan.assignments[0],{...plan.assignments[0],slotId:'s2',start:'2026-09-24T14:00:00Z',end:'2026-09-24T22:00:00Z'}];
  const first={employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T22:00:00Z',provenance:{basis:'automatic_evidence',exportId:'one'}};
  const second={...first,displayNote:'duplicate row'};
  const r=reconcileScheduleToAttendance({plan:{...plan,assignments},payrollProjection:{payrollReady:true,attendanceInputs:[first,second]}});
  assert.equal(r.ready,false);
  assert.equal(r.quality.reconciledAssignments,1);
  assert.equal(r.unexpectedAttendance.length,1);
  const reversed=reconcileScheduleToAttendance({plan:{...plan,assignments},payrollProjection:{payrollReady:true,attendanceInputs:[second,first]}});
  assert.equal(reversed.reconciliationId,r.reconciliationId);
});
