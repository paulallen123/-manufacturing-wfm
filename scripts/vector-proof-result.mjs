// Whole-product readiness remains false until every required workflow and the
// server-side audit/backend identity are independently bound to the deployment.
export function roleProofResult(assetBinding, leaveJourney = null, attendanceJourney = null) {
  const leaveChecks = [
    'employeeUiSubmitted',
    'pendingStateReadBack',
    'overlapRefusedInUi',
    'refreshedUiRetainedPending',
    'managerUiDecided',
    'managerStateReadBack',
    'requestAuditLinked',
    'freshEmployeeLoginSawDecision',
    'freshBalanceReconciled'
  ];
  const attendanceChecks = [
    'managerUiApproved',
    'exactCorrectionReadBack',
    'rawPunchesPreserved',
    'domainAuditReadBack',
    'refreshedUiRetainedCorrection',
    'weeklySignStillBlocked',
    'weeklySignOffCompleted',
    'payrollReleaseStillBlocked'
  ];
  const signOffEvidence = attendanceJourney?.weeklySignOffEvidence;
  const weeklySignOffVersionBound = Number.isInteger(signOffEvidence?.submittedRevision)
    && signOffEvidence.submittedRevision === signOffEvidence.signatureRevision
    && signOffEvidence.submittedRevision === signOffEvidence.auditRevision
    && signOffEvidence.refreshedStatus === 'signed';
  const scopedLeaveJourneyVerified = leaveChecks.every(key => leaveJourney?.[key] === true);
  const scopedAttendanceJourneyVerified = attendanceChecks.every(key => attendanceJourney?.[key] === true)
    && weeklySignOffVersionBound;
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: scopedLeaveJourneyVerified && scopedAttendanceJourneyVerified ? 'role-bound-leave-and-attendance-ui-with-saved-state' : scopedLeaveJourneyVerified ? 'role-bound-leave-ui-and-saved-state' : 'role-navigation-and-source-presentation',
    scopedLeaveJourneyVerified,
    scopedAttendanceJourneyVerified,
    endToEndVerified: false,
    productReady: false,
    exactAssetsVerified: assetBinding?.status === 'BOUND',
    missingEvidence: [
      ...(assetBinding?.status === 'BOUND' ? [] : ['exact-deployed-asset-binding']),
      ...(scopedLeaveJourneyVerified ? [] : ['UI-triggered-business-action', 'persisted-state-readback', 'updated-UI-after-reload']),
      ...(leaveJourney?.freshBalanceReconciled === true ? [] : ['leave-balance-reconciliation']),
      ...(scopedAttendanceJourneyVerified ? [] : ['attendance-correction-business-action']),
      ...(attendanceJourney?.weeklySignOffCompleted === true ? [] : ['weekly-sign-off-business-action']),
      ...(weeklySignOffVersionBound ? [] : ['weekly-sign-off-version-binding']),
      'server-audit-readback',
      'exact-backend-binding',
      'payroll-reconciliation-business-action',
      'major-workflow-coverage'
    ]
  };
}
