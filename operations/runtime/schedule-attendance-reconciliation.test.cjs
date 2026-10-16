'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {reconcileScheduleToAttendance}=require('./schedule-attendance-reconciliation.cjs');
const {spawnSync}=require('node:child_process');
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
test('inherited entries cannot erase a declared shift',()=>{
  const original=Array.prototype.entries;
  let result;
  try{
    Array.prototype.entries=function*(){};
    result=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[]}});
  }finally{Array.prototype.entries=original;}
  assert.equal(result.ready,false);
  assert.equal(result.quality.scheduledAssignments,1);
  assert.equal(result.rows[0].status,'MISSING_VERIFIED_ATTENDANCE');
});
test('inherited filter cannot erase schedule and unexpected evidence',()=>{
  const original=Array.prototype.filter;
  let result;
  try{
    Array.prototype.filter=function(){return [];};
    result=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[{employee:'other',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'}]}});
  }finally{Array.prototype.filter=original;}
  assert.equal(result.ready,false);
  assert.equal(result.quality.scheduledAssignments,1);
  assert.equal(result.unexpectedAttendance.length,1);
});
test('sparse, accessor and custom-traversal input arrays are rejected',()=>{
  const hole=new Array(1);
  const accessor=[plan.assignments[0]];
  Object.defineProperty(accessor,'0',{get(){return plan.assignments[0];}});
  const custom=[plan.assignments[0]];
  custom[Symbol.iterator]=function*(){};
  for(const assignments of [hole,accessor,custom]){
    assert.throws(()=>reconcileScheduleToAttendance({plan:{...plan,assignments},payrollProjection:{payrollReady:true,attendanceInputs:[]}}));
  }
  const evidence=[{employee:'w1',inAt:'2026-09-24T06:00:00Z',outAt:'2026-09-24T14:00:00Z'}];
  Object.defineProperty(evidence,'0',{get(){return {employee:'w1'};}});
  assert.throws(()=>reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:evidence}}));
});
test('a ready projection requires explicit schedule and attendance arrays',()=>{
  assert.throws(()=>reconcileScheduleToAttendance({plan:{...plan,assignments:undefined},payrollProjection:{payrollReady:true,attendanceInputs:[]}}));
  assert.throws(()=>reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:undefined}}));
});
test('inherited numeric setters cannot erase internal assignment arrays',()=>{
  const script=`
    const {reconcileScheduleToAttendance}=require(${JSON.stringify(require.resolve('./schedule-attendance-reconciliation.cjs'))});
    const plan=${JSON.stringify(plan)};
    Object.defineProperty(Array.prototype,'0',{configurable:true,set(value){if(this.length>0)Object.defineProperty(this,'0',{value,writable:true,enumerable:true,configurable:true});}});
    let result;
    try{result=reconcileScheduleToAttendance({plan,payrollProjection:{payrollReady:true,attendanceInputs:[]}})}finally{delete Array.prototype[0]}
    process.stdout.write(JSON.stringify({ready:result.ready,scheduledAssignments:result.quality.scheduledAssignments,status:result.rows[0]?.status}));
  `;
  const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{ready:false,scheduledAssignments:1,status:'MISSING_VERIFIED_ATTENDANCE'});
});
test('array proxies cannot hide declared assignments',()=>{
  const hidden=new Proxy([plan.assignments[0]],{get(target,key,receiver){return key==='length'?0:Reflect.get(target,key,receiver);},ownKeys(){return ['length'];}});
  assert.throws(()=>reconcileScheduleToAttendance({plan:{...plan,assignments:hidden},payrollProjection:{payrollReady:true,attendanceInputs:[]}}));
});
