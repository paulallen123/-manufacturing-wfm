import assert from 'node:assert/strict';
import test from 'node:test';
import { roleProofResult } from './vector-proof-result.mjs';

// Result-classification unit tests only; not deployed UI, payroll or durability proof.
const leave = Object.freeze({
  employeeUiSubmitted: true, pendingStateReadBack: true, overlapRefusedInUi: true,
  refreshedUiRetainedPending: true, managerUiDecided: true,
  managerStateReadBack: true, freshEmployeeLoginSawDecision: true
});
const attendance = Object.freeze({
  managerUiApproved: true, exactCorrectionReadBack: true, rawPunchesPreserved: true,
  domainAuditReadBack: true, refreshedUiRetainedCorrection: true,
  weeklySignStillBlocked: true, payrollReleaseStillBlocked: true
});

for (const [name, binding] of [
  ['missing', undefined], ['null', null], ['empty', {}],
  ['unbound', { status: 'UNBOUND' }], ['failed', { status: 'FAIL' }],
  ['wrong case', { status: 'bound' }], ['boolean', { status: true }]
]) {
  test(`complete action flags cannot verify journeys with ${name} asset identity`, () => {
    const result = roleProofResult(binding, leave, attendance);
    assert.equal(result.exactAssetsVerified, false);
    assert.equal(result.scopedLeaveJourneyVerified, false);
    assert.equal(result.scopedAttendanceJourneyVerified, false);
    assert.equal(result.proofScope, 'role-navigation-and-source-presentation');
    for (const gap of ['exact-deployed-asset-binding', 'UI-triggered-business-action',
      'persisted-state-readback', 'updated-UI-after-reload', 'attendance-correction-business-action']) {
      assert.ok(result.missingEvidence.includes(gap), gap);
    }
    assert.equal(result.endToEndVerified, false);
    assert.equal(result.productReady, false);
  });
}

test('bound complete journeys retain scoped results without whole-product readiness', () => {
  const result = roleProofResult({ status: 'BOUND' }, leave, attendance);
  assert.equal(result.exactAssetsVerified, true);
  assert.equal(result.scopedLeaveJourneyVerified, true);
  assert.equal(result.scopedAttendanceJourneyVerified, true);
  assert.equal(result.proofScope, 'role-bound-leave-and-attendance-ui-with-saved-state');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.endToEndVerified, false);
  assert.equal(result.productReady, false);
  for (const gap of ['server-audit-readback', 'exact-backend-binding',
    'weekly-sign-off-business-action', 'payroll-reconciliation-business-action', 'major-workflow-coverage']) {
    assert.ok(result.missingEvidence.includes(gap), gap);
  }
});

for (const key of Object.keys(leave)) {
  test(`bound leave proof still requires ${key}`, () => {
    for (const value of [false, undefined, null, 1, 'true']) {
      const result = roleProofResult({ status: 'BOUND' }, { ...leave, [key]: value }, attendance);
      assert.equal(result.scopedLeaveJourneyVerified, false);
      assert.equal(result.scopedAttendanceJourneyVerified, true);
      assert.equal(result.endToEndVerified, false);
    }
  });
}
for (const key of Object.keys(attendance)) {
  test(`bound attendance proof still requires ${key}`, () => {
    for (const value of [false, undefined, null, 1, 'true']) {
      const result = roleProofResult({ status: 'BOUND' }, leave, { ...attendance, [key]: value });
      assert.equal(result.scopedLeaveJourneyVerified, true);
      assert.equal(result.scopedAttendanceJourneyVerified, false);
      assert.equal(result.productReady, false);
    }
  });
}

test('bound navigation alone never becomes a business journey', () => {
  const result = roleProofResult({ status: 'BOUND' });
  assert.equal(result.scopedLeaveJourneyVerified, false);
  assert.equal(result.scopedAttendanceJourneyVerified, false);
  assert.equal(result.endToEndVerified, false);
  assert.equal(result.productReady, false);
});
