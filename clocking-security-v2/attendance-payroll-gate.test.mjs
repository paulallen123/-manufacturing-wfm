import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendancePayrollGate } from './attendance-payroll-gate.mjs';

const T=Date.parse('2026-09-18T14:00:00Z');
function harness({rows=[{employee:'e1',workerType:'employee',status:'complete',openAt:'2026-09-18T06:00:00.000Z',closeAt:'2026-09-18T14:00:00.000Z'}],sourceContinuityPeriod=true,unexpectedCount=0,unmappedSignalCount=0}={}){
  const coverage={evaluateShift(){return {rows,payrollReady:false,unexpectedCount,unmappedSignalCount};}};
  const certifier={certifyShift(){return {claimLevel:sourceContinuityPeriod?'VERIFIED_100_ONLY':'NOT_CERTIFIED',claim:null,certification:{sourceContinuityPeriod,verifiedPeriodCertified:sourceContinuityPeriod}};}};
  return new AttendancePayrollGate({coverage,certifier});
}

test('verified complete interval becomes payroll input but no pay calculation is performed',()=>{
  const g=harness(); const p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(p.payrollReady,true); assert.equal(p.attendanceInputs.length,1);
  assert.deepEqual(Object.keys(p.attendanceInputs[0]).sort(),['employee','inAt','outAt','provenance','shiftId','site','tenant','workerType'].sort());
  assert.equal('paidHours' in p.attendanceInputs[0],false);
});

test('missing OUT is excluded from payroll until explicitly reviewed',()=>{
  const g=harness({rows:[{employee:'e1',workerType:'employee',status:'missing_out',openAt:'2026-09-18T06:00:00.000Z'}]});
  let p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(p.payrollReady,false); assert.equal(p.attendanceInputs.length,0); assert.equal(p.reviewRequired[0].originalAttendanceStatus,'missing_out');
  g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r1',actorId:'mgr1',reasonCode:'CONFIRMED_EXIT',correctedInAt:'2026-09-18T06:00:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T});
  p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(p.payrollReady,true); assert.equal(p.manualReviewCount,1); assert.equal(p.attendanceInputs[0].provenance.basis,'manager_correction');
  assert.equal(p.certification.claimLevel,'VERIFIED_100_ONLY');
});

test('source continuity gap excludes otherwise complete automatic interval',()=>{
  const g=harness({sourceContinuityPeriod:false}); const p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(p.payrollReady,false); assert.equal(p.attendanceInputs.length,0); assert.equal(p.reviewRequired[0].provenance.basis,'source_continuity_not_verified');
});

test('approved absence is policy input only and never fabricated as worked time',()=>{
  const g=harness({rows:[{employee:'e1',workerType:'employee',status:'excused',reasonCode:'HOLIDAY'}]}); const p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(p.payrollReady,true); assert.equal(p.attendanceInputs.length,0); assert.equal(p.policyInputs.length,1); assert.equal(p.policyInputs[0].interval,null);
});

test('shift cannot close payroll before attendance window is closed',()=>{
  const g=harness(); const p=g.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:false});
  assert.equal(p.payrollReady,false);
});

test('unmapped or unexpected people block payroll even when scheduled rows are complete',()=>{
  const a=harness({unexpectedCount:1}).projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  const b=harness({unmappedSignalCount:1}).projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true});
  assert.equal(a.payrollReady,false); assert.equal(b.payrollReady,false);
});

test('correction cannot be written for an employee outside the scheduled shift',()=>{
  const g=harness();
  assert.throws(()=>g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e2',reviewId:'r1',actorId:'mgr1',reasonCode:'FIX',correctedInAt:'2026-09-18T06:00:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T}),/not assigned/);
});

test('review IDs are idempotent but content-changing replay fails closed',()=>{
  const g=harness({rows:[{employee:'e1',workerType:'employee',status:'missing_out'}]});
  const x={tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r1',actorId:'mgr1',reasonCode:'FIX',correctedInAt:'2026-09-18T06:00:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T};
  assert.equal(g.recordCorrection(x).replayed,false); assert.equal(g.recordCorrection(x).replayed,true);
  assert.throws(()=>g.recordCorrection({...x,correctedOutAt:'2026-09-18T14:01:00Z'}),/reused/);
});

test('correction revisions are append-only and must explicitly supersede latest review',()=>{
  const g=harness({rows:[{employee:'e1',workerType:'employee',status:'missing_out'}]});
  g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r1',actorId:'mgr1',reasonCode:'FIX',correctedInAt:'2026-09-18T06:00:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T});
  assert.throws(()=>g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r2',actorId:'mgr2',reasonCode:'REVISION',correctedInAt:'2026-09-18T06:01:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T+1}),/supersede/);
  g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r2',actorId:'mgr2',reasonCode:'REVISION',correctedInAt:'2026-09-18T06:01:00Z',correctedOutAt:'2026-09-18T14:00:00Z',reviewedAt:T+1,supersedesReviewId:'r1'});
  const trail=g.auditTrail({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1'});
  assert.equal(trail.length,2); assert.equal(trail[0].reviewId,'r1'); assert.equal(trail[1].supersedesReviewId,'r1'); assert.equal(g.verifyAuditChain(),true);
});

test('invalid or inverted manager interval fails closed',()=>{
  const g=harness({rows:[{employee:'e1',workerType:'employee',status:'missing_out'}]});
  assert.throws(()=>g.recordCorrection({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'r1',actorId:'mgr1',reasonCode:'FIX',correctedInAt:'2026-09-18T14:00:00Z',correctedOutAt:'2026-09-18T06:00:00Z',reviewedAt:T}),/after corrected IN/);
});
