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
  freshBalanceReconciled: true
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
    exportDenials: [
      { role: 'employee', batchId: 'payroll-2026-09-07-001', status: 403, checksumHeader: null, contentDisposition: null },
      { role: 'manager', batchId: 'payroll-2026-09-07-001', status: 403, checksumHeader: null, contentDisposition: null }
    ],
    reconciliationOk: true
  }
};

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

  assert.equal(result.scopedPayrollJourneyVerified, true);
  assert.equal(result.missingEvidence.includes('all-team-weekly-sign-off'), false);
  assert.equal(result.missingEvidence.includes('payroll-reconciliation-business-action'), false);
});

test('payroll proof requires fresh employee and manager export denials for the released batch', () => {
  for (const exportDenials of [undefined, [], [completePayrollJourney.release.exportDenials[0]],
    [{ ...completePayrollJourney.release.exportDenials[0], status: 200, checksumHeader: checksum, contentDisposition: 'attachment' },
      completePayrollJourney.release.exportDenials[1]],
    [completePayrollJourney.release.exportDenials[0], { ...completePayrollJourney.release.exportDenials[1], batchId: 'other-batch' }]]) {
    const result = roleProofResult({ status: 'BOUND' }, leaveJourney, attendanceJourney, {
      ...completePayrollJourney, release: { ...completePayrollJourney.release, exportDenials }
    });
    assert.equal(result.scopedPayrollJourneyVerified, false);
    assert.ok(result.missingEvidence.includes('payroll-export-role-denial'));
  }
});
