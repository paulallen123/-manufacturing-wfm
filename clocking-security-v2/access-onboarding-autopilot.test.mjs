import test from 'node:test';
import assert from 'node:assert/strict';
import {matchAccessIdentities,planAccessPoints,buildAccessOnboardingPlan} from './access-onboarding-autopilot.mjs';

test('exact employee number automatically maps a cardholder',()=>{
  const r=matchAccessIdentities({employees:[{employeeId:'e1',employeeNumber:'EMP-7'}],cardholders:[{cardholderId:'c1',employeeNumber:'emp-7'}]});
  assert.equal(r.mapped.length,1); assert.equal(r.mapped[0].cardholderId,'c1');
});

test('name-only similarity never auto-maps identity',()=>{
  const r=matchAccessIdentities({employees:[{employeeId:'e1',name:'Alex Smith'}],cardholders:[{cardholderId:'c1',name:'Alex Smith'}]});
  assert.equal(r.mapped.length,0); assert.equal(r.unmatched.length,1);
});

test('conflicting exact identifiers are review-required',()=>{
  const r=matchAccessIdentities({employees:[{employeeId:'e1',employeeNumber:'7',email:'x@example.com'}],cardholders:[{cardholderId:'c1',employeeNumber:'7'},{cardholderId:'c2',email:'x@example.com'}]});
  assert.equal(r.review.length,1); assert.deepEqual(r.review[0].candidateCardholderIds.sort(),['c1','c2']);
});

test('provider-declared perimeter direction can auto-configure',()=>{
  const r=planAccessPoints({accessPoints:[{id:'d1',name:'North Gate',direction:'entry',isPerimeter:true,zoneId:'site'}]});
  assert.equal(r.ready.length,1); assert.equal(r.review.length,0); assert.equal(r.ready[0].attendanceEligible,true);
});

test('door-name heuristic only suggests and still requires confirmation',()=>{
  const r=planAccessPoints({accessPoints:[{id:'d1',name:'Staff Entrance'}]});
  assert.equal(r.ready.length,0); assert.equal(r.review.length,1); assert.equal(r.review[0].suggestedDirection,'entry');
});

test('onboarding plan reduces customer work to unresolved exceptions',()=>{
  const r=buildAccessOnboardingPlan({
    employees:[{employeeId:'e1',employeeNumber:'1'},{employeeId:'e2',employeeNumber:'2'}],
    cardholders:[{cardholderId:'c1',employeeNumber:'1'},{cardholderId:'c2',employeeNumber:'2'}],
    accessPoints:[{id:'in',direction:'entry',isPerimeter:true},{id:'out',direction:'exit',isPerimeter:true}],
  });
  assert.equal(r.summary.reviewItems,0); assert.equal(r.customerTasks.length,0); assert.equal(r.canEnableAutomaticAttendance,true);
});
