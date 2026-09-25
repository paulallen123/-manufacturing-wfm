import test from 'node:test';
import assert from 'node:assert/strict';

import {
  provisionAgencyTempClockingProfile,
  revokeAgencyTempClockingProfile,
  evaluateAgencyTempClockAction,
} from '../../src/frontier/agency-temp-clocking-profile.mjs';

const base=()=>({
  tenantId:'tenant-1',
  siteId:'site-1',
  agencyId:'agency-1',
  workerId:'worker-1',
  requestId:'REQ-1',
  confirmation:{
    confirmed:true,
    action:'confirm_preferred_worker',
    requestId:'REQ-1',
    agencyId:'agency-1',
    workerId:'worker-1',
  },
  readiness:{
    workStartReady:true,
    requestId:'REQ-1',
    siteId:'site-1',
    agencyId:'agency-1',
    workerId:'worker-1',
  },
  placement:{
    placementId:'P-1',
    workerId:'worker-1',
    agencyId:'agency-1',
    siteId:'site-1',
    assignmentId:'SHIFT-1',
    status:'confirmed',
    startAt:'2026-09-25T13:00:00.000Z',
    endAt:'2026-09-25T21:00:00.000Z',
  },
  policy:{
    siteTempClockingEnabled:true,
    credentialMode:'one_time_qr',
    clockInEarlyWindowMinutes:60,
    clockOutGraceMinutes:120,
  },
});

test('final confirmation plus readiness automatically provisions one time-limited temp clocking profile',()=>{
  const result=provisionAgencyTempClockingProfile(base());
  assert.equal(result.status,'provisioned');
  assert.equal(result.automation.managerDayOfShiftSetupRequired,false);
  assert.equal(result.automation.workerExperience,'arrive_identify_clock_in_clock_out_leave');
  assert.equal(result.clockingProfile.profileType,'temporary_agency_worker');
  assert.equal(result.clockingProfile.clockingSource,'agency_temp_kiosk');
  assert.equal(result.clockingProfile.clockingWriteAuthorized,true);
  assert.equal(result.clockingProfile.payrollWriteAuthorized,false);
  assert.equal(result.clockingProfile.workerMasterWriteAuthorized,false);
  assert.equal(result.clockingProfile.validFrom,'2026-09-25T12:00:00.000Z');
  assert.equal(result.clockingProfile.validUntil,'2026-09-25T23:00:00.000Z');
});

test('identical confirmation retries are deterministic and do not require a duplicate identity',()=>{
  const a=provisionAgencyTempClockingProfile(base());
  const b=provisionAgencyTempClockingProfile(structuredClone(base()));
  assert.equal(a.clockingProfile.principalId,b.clockingProfile.principalId);
  assert.equal(a.clockingProfile.entitlementId,b.clockingProfile.entitlementId);
  assert.equal(a.provisioningFingerprint,b.provisioningFingerprint);
});

test('rebooking known worker reuses stable principal but creates a new placement entitlement',()=>{
  const first=provisionAgencyTempClockingProfile(base()).clockingProfile;
  const secondInput=base();
  secondInput.requestId='REQ-2';
  secondInput.confirmation.requestId='REQ-2';
  secondInput.placement={...secondInput.placement,placementId:'P-2',assignmentId:'SHIFT-2'};
  secondInput.readiness.requestId='REQ-2';
  const second=provisionAgencyTempClockingProfile(secondInput).clockingProfile;
  assert.equal(first.principalId,second.principalId);
  assert.notEqual(first.entitlementId,second.entitlementId);
});

test('nomination without final confirmation or work-start readiness cannot create active clocking access',()=>{
  const notConfirmed=base();
  notConfirmed.confirmation.confirmed=false;
  assert.equal(provisionAgencyTempClockingProfile(notConfirmed).status,'blocked');

  const notReady=base();
  notReady.readiness.workStartReady=false;
  const held=provisionAgencyTempClockingProfile(notReady);
  assert.equal(held.status,'blocked');
  assert.equal(held.clockingWriteAuthorized,false);
});

test('tenant site agency and worker scope must match the confirmed placement',()=>{
  const wrong=base();
  wrong.placement.siteId='site-2';
  const result=provisionAgencyTempClockingProfile(wrong);
  assert.equal(result.status,'blocked');
  assert.equal(result.reason,'temp_clocking_placement_scope_mismatch');
});

test('worker can clock in and out through the registered-kiosk entitlement and events stay placement-linked',()=>{
  const profile=provisionAgencyTempClockingProfile(base()).clockingProfile;
  const enter=evaluateAgencyTempClockAction(profile,{action:'clock_in',at:'2026-09-25T12:45:00.000Z'});
  assert.equal(enter.allowed,true);
  assert.equal(enter.captureContract.source,'agency_temp_kiosk');
  assert.equal(enter.captureContract.placementId,'P-1');
  assert.equal(enter.captureContract.assignmentId,'SHIFT-1');
  assert.equal(enter.captureContract.requiresAttendanceReview,true);
  assert.equal(enter.captureContract.payrollAuthority,false);

  const leave=evaluateAgencyTempClockAction(profile,{action:'clock_out',at:'2026-09-25T21:05:00.000Z'});
  assert.equal(leave.allowed,true);
});

test('expired or revoked profile blocks new clock in but an already-open session can always close safely',()=>{
  const profile=provisionAgencyTempClockingProfile(base()).clockingProfile;
  const expired=evaluateAgencyTempClockAction(profile,{action:'clock_in',at:'2026-09-26T00:00:00.000Z'});
  assert.equal(expired.allowed,false);
  assert.equal(expired.reason,'temp_clocking_outside_entitlement_window');

  const revoked=revokeAgencyTempClockingProfile(profile,'worker_replaced','2026-09-25T15:00:00.000Z');
  const newStart=evaluateAgencyTempClockAction(revoked,{action:'clock_in',at:'2026-09-25T15:05:00.000Z'});
  assert.equal(newStart.allowed,false);

  const safeClose=evaluateAgencyTempClockAction(revoked,{
    action:'clock_out',
    at:'2026-09-25T15:05:00.000Z',
    openSession:{entitlementId:profile.entitlementId,status:'open'},
  });
  assert.equal(safeClose.allowed,true);
  assert.equal(safeClose.safeCloseOnly,true);
});

test('clocking profile does not carry sensitive identity or raw compliance evidence',()=>{
  const result=provisionAgencyTempClockingProfile({...base(),dateOfBirth:'1990-01-01',rightToWorkDocument:'secret'});
  const serialised=JSON.stringify(result);
  assert.ok(!serialised.includes('1990-01-01'));
  assert.ok(!serialised.includes('secret'));
  assert.equal(result.clockingProfile.credential.plaintextStored,false);
});
