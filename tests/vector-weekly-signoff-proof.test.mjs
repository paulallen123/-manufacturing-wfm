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
  payrollReleaseStillBlocked: true
};

test('attendance proof rejects a correction-only journey without a completed weekly sign-off', () => {
  const result = roleProofResult({ status: 'BOUND' }, leaveJourney, attendanceJourney);
  assert.equal(result.scopedAttendanceJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('weekly-sign-off-business-action'));
});

test('attendance proof rejects a sign-off whose request, signature and audit revisions do not match', () => {
  const result = roleProofResult(
    { status: 'BOUND' },
    leaveJourney,
    {
      ...attendanceJourney,
      weeklySignOffCompleted: true,
      weeklySignOffEvidence: {
        submittedRevision: 27,
        signatureRevision: 28,
        auditRevision: 28,
        refreshedStatus: 'signed'
      }
    }
  );
  assert.equal(result.scopedAttendanceJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('weekly-sign-off-version-binding'));
});

test('attendance proof accepts a source-reviewed weekly sign-off business action', () => {
  const result = roleProofResult(
    { status: 'BOUND' },
    leaveJourney,
    {
      ...attendanceJourney,
      weeklySignOffCompleted: true,
      weeklySignOffEvidence: {
        submittedRevision: 27,
        signatureRevision: 27,
        auditRevision: 27,
        refreshedStatus: 'signed'
      }
    }
  );
  assert.equal(result.scopedAttendanceJourneyVerified, true);
  assert.equal(result.missingEvidence.includes('weekly-sign-off-business-action'), false);
});
