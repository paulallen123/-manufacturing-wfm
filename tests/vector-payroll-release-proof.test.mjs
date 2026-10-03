import assert from 'node:assert/strict';
import test from 'node:test';

import { roleProofResult } from '../scripts/vector-proof-result.mjs';

const leaveJourney = {
  employeeUiSubmitted: true,
  pendingStateReadBack: true,
  overlapRefusedInUi: true,
  refreshedUiRetainedPending: true,
  managerUiDecided: true,
  managerStateReadBack: true,
  requestAuditLinked: true,
  freshEmployeeLoginSawDecision: true,
  freshBalanceReconciled: true,
  requestId: 'leave-2026-10-05-e0',
  approvedDate: '2026-10-05',
  approvedMinutes: 450
};

const attendanceJourney = {
  managerUiApproved: true,
  exactCorrectionReadBack: true,
  rawPunchesPreserved: true,
  domainAuditReadBack: true,
  refreshedUiRetainedCorrection: true,
  weeklySignStillBlocked: true,
  weeklySignOffCompleted: true,
  payrollReleaseStillBlocked: true,
  weeklySignOffEvidence: {
    submittedRevision: 27,
    signatureRevision: 27,
    auditRevision: 27,
    refreshedStatus: 'signed'
  }
};

const checksum = 'a'.repeat(64);
const completePayrollJourney = {
  leaveTrace: {
    requestId: 'leave-2026-10-05-e0',
    date: '2026-10-05',
    weeklyEmployeeHolidayMinutes: 450,
    payrollHolidayMinutes: 450,
    payrollLineMinutes: 450,
    payrollCode: 'HOLIDAY',
    freshPayrollReadBack: true
  },
  expectedTeamIds: ['s1', 's2', 's3', 's4'],
  teamSignOffs: [
    { teamId: 's1', submittedRevision: 27, signatureRevision: 27, auditRevision: 27, refreshedStatus: 'signed' },
    { teamId: 's2', submittedRevision: 19, signatureRevision: 19, auditRevision: 19, refreshedStatus: 'signed' },
    { teamId: 's3', submittedRevision: 18, signatureRevision: 18, auditRevision: 18, refreshedStatus: 'signed' },
    { teamId: 's4', submittedRevision: 18, signatureRevision: 18, auditRevision: 18, refreshedStatus: 'signed' }
  ],
  release: {
    responseStatus: 200,
    batchId: 'payroll-2026-09-07-001',
    persistedBatchId: 'payroll-2026-09-07-001',
    auditBatchId: 'payroll-2026-09-07-001',
    freshLoginBatchId: 'payroll-2026-09-07-001',
    status: 'released',
    rowCount: 172,
    checksumHeader: checksum,
    computedChecksum: checksum,
    reconciliationOk: true
  }
};


test('payroll proof rejects a release when approved leave is not causally traced into weekly and payroll evidence', () => {
  const { leaveTrace, ...withoutLeaveTrace } = completePayrollJourney;
  const result = roleProofResult(
    { status: 'BOUND' },
    leaveJourney,
    attendanceJourney,
    withoutLeaveTrace
  );

  assert.equal(result.leaveToPayrollBound, false);
  assert.equal(result.scopedPayrollJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('approved-leave-to-payroll-trace'));
});

test('payroll proof rejects a release when any expected team lacks exact sign-off evidence', () => {
  const result = roleProofResult(
    { status: 'BOUND' },
    leaveJourney,
    attendanceJourney,
    {
      ...completePayrollJourney,
      teamSignOffs: completePayrollJourney.teamSignOffs.slice(0, 3)
    }
  );

  assert.equal(result.scopedPayrollJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('all-team-weekly-sign-off'));
  assert.ok(result.missingEvidence.includes('payroll-reconciliation-business-action'));
});

test('payroll proof accepts exact all-team sign-offs and one checksum-bound persisted release', () => {
  const result = roleProofResult(
    { status: 'BOUND' },
    leaveJourney,
    attendanceJourney,
    completePayrollJourney
  );

  assert.equal(result.leaveToPayrollBound, true);
  assert.equal(result.scopedPayrollJourneyVerified, true);
  assert.equal(result.missingEvidence.includes('approved-leave-to-payroll-trace'), false);
  assert.equal(result.missingEvidence.includes('all-team-weekly-sign-off'), false);
  assert.equal(result.missingEvidence.includes('payroll-reconciliation-business-action'), false);
});
