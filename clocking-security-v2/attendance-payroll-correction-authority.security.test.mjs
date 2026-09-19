import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendancePayrollGate } from './attendance-payroll-gate.mjs';

const T=Date.parse('2026-09-19T16:30:00Z');
const IN='2026-09-19T06:00:00.000Z';
const OUT='2026-09-19T14:00:00.000Z';

function setup(){
  const rows=[{employee:'e1',workerType:'employee',status:'missing_out',openAt:IN,evidenceCount:2}];
  const coverage={evaluateShift(){return {rows,payrollReady:false,unexpectedCount:0,unmappedSignalCount:0};}};
  const certifier={certifyShift(){return {claimLevel:'NOT_CERTIFIED',claim:null,certification:{sourceContinuityPeriod:true,verifiedPeriodCertified:false}};}};
  const payroll=new AttendancePayrollGate({coverage,certifier});
  payroll.recordCorrection({
    tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'review-1',actorId:'manager-1',reasonCode:'CONFIRMED_EXIT',
    correctedInAt:IN,correctedOutAt:OUT,reviewedAt:T
  });
  return {payroll,coverage,certifier};
}

function project(payroll){
  return payroll.projectShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T,shiftWindowClosed:true,expectedSourceIds:[],sourceHealth:[]});
}

test('post-hoc mutation of the public correction audit mirror cannot silently change payroll authority',()=>{
  const {payroll}=setup();
  const before=project(payroll);
  assert.equal(before.payrollReady,true);
  assert.equal(before.attendanceInputs.length,1);
  assert.equal(before.attendanceInputs[0].outAt,OUT);
  assert.equal(payroll.verifyAuditChain(),true);

  // Model compromised/in-process code rewriting the previously public correction object.
  // The mirror can be damaged for detection purposes, but it is no longer the source
  // of payroll authority and any mismatch must fail the export closed.
  payroll.reviews[0].outMs=Date.parse('2026-09-19T18:00:00Z');
  payroll.reviews[0].reasonCode='TAMPERED';

  assert.equal(payroll.verifyAuditChain(),false);
  const after=project(payroll);
  assert.equal(after.payrollReady,false);
  assert.equal(after.attendanceInputs.length,0);
  assert.equal(after.reviewRequired.length,1);
  assert.equal(after.reviewRequired[0].provenance.basis,'manager_correction_audit_invalid');

  const authoritative=payroll.auditTrail({tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1'});
  assert.equal(authoritative.length,1);
  assert.equal(authoritative[0].outMs,Date.parse(OUT));
  assert.equal(authoritative[0].reasonCode,'CONFIRMED_EXIT');
});

test('caller cannot replace correction authority maps or swap dependency decision methods after construction',()=>{
  const {payroll,coverage,certifier}=setup();
  assert.equal(Object.isExtensible(payroll),false);
  assert.throws(()=>{ payroll.coverage={evaluateShift(){return {rows:[],payrollReady:true};}}; },TypeError);
  assert.throws(()=>{ payroll.certifier={certifyShift(){return {certification:{sourceContinuityPeriod:true}};}}; },TypeError);
  assert.throws(()=>{ payroll.reviews=[]; },TypeError);
  assert.throws(()=>{ payroll.reviewById=new Map(); },TypeError);
  assert.throws(()=>{ payroll.latestByWorkerShift=new Map(); },TypeError);

  // Even mutating the retained dependency objects cannot swap out the exact decision
  // functions the payroll gate bound at construction time.
  coverage.evaluateShift=()=>({rows:[],payrollReady:true,unexpectedCount:0,unmappedSignalCount:0});
  certifier.certifyShift=()=>({claimLevel:'FORGED',claim:'forged',certification:{sourceContinuityPeriod:false,verifiedPeriodCertified:false}});

  const p=project(payroll);
  assert.equal(p.payrollReady,true);
  assert.equal(p.attendanceInputs.length,1);
  assert.equal(p.attendanceInputs[0].outAt,OUT);
  assert.equal(p.attendanceInputs[0].provenance.reviewId,'review-1');
  assert.equal(p.certification.claimLevel,'NOT_CERTIFIED');
});

test('an invalidated audit mirror cannot be extended with a new manager correction to regain payroll authority',()=>{
  const {payroll}=setup();
  payroll.reviews[0].actorId='forged-manager';
  assert.equal(payroll.verifyAuditChain(),false);

  assert.throws(()=>payroll.recordCorrection({
    tenant:'acme',site:'s1',shiftId:'shift1',employee:'e1',reviewId:'review-2',actorId:'manager-2',reasonCode:'RECONFIRMED',
    correctedInAt:IN,correctedOutAt:OUT,reviewedAt:T+1,supersedesReviewId:'review-1'
  }),/audit chain is invalid/);

  const p=project(payroll);
  assert.equal(p.payrollReady,false);
  assert.equal(p.attendanceInputs.length,0);
});
