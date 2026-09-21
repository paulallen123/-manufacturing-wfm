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
    'freshEmployeeLoginSawDecision'
  ];
  const attendanceChecks = [
    'managerUiApproved',
    'exactCorrectionReadBack',
    'rawPunchesPreserved',
    'domainAuditReadBack',
    'refreshedUiRetainedCorrection',
    'weeklySignStillBlocked',
    'payrollReleaseStillBlocked'
  ];
  // Action flags cannot certify a journey on an unidentified or retired UI.
  const exactAssetsVerified = assetBinding?.status === 'BOUND';
  const scopedLeaveJourneyVerified = exactAssetsVerified && leaveChecks.every(key => leaveJourney?.[key] === true);
  const scopedAttendanceJourneyVerified = exactAssetsVerified && attendanceChecks.every(key => attendanceJourney?.[key] === true);
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: scopedLeaveJourneyVerified && scopedAttendanceJourneyVerified ? 'role-bound-leave-and-attendance-ui-with-saved-state' : scopedLeaveJourneyVerified ? 'role-bound-leave-ui-and-saved-state' : 'role-navigation-and-source-presentation',
    scopedLeaveJourneyVerified,
    scopedAttendanceJourneyVerified,
    endToEndVerified: false,
    productReady: false,
    exactAssetsVerified,
    missingEvidence: [
      ...(exactAssetsVerified ? [] : ['exact-deployed-asset-binding']),
      ...(scopedLeaveJourneyVerified ? [] : ['UI-triggered-business-action', 'persisted-state-readback', 'updated-UI-after-reload']),
      ...(scopedAttendanceJourneyVerified ? [] : ['attendance-correction-business-action']),
      'server-audit-readback',
      'exact-backend-binding',
      'weekly-sign-off-business-action',
      'payroll-reconciliation-business-action',
      'major-workflow-coverage'
    ]
  };
}
