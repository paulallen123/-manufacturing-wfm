// Whole-product readiness remains false until every required workflow and the
// server-side audit/backend identity are independently bound to the deployment.
export function roleProofResult(assetBinding, leaveJourney = null, attendanceJourney = null, payrollJourney = null) {
  const leaveActionChecks = [
    'employeeUiSubmitted',
    'pendingStateReadBack',
    'overlapRefusedInUi',
    'refreshedUiRetainedPending',
    'managerUiDecided',
    'managerStateReadBack',
    'freshEmployeeLoginSawDecision'
  ];
  const attendanceCorrectionChecks = [
    'managerUiApproved',
    'exactCorrectionReadBack',
    'rawPunchesPreserved',
    'domainAuditReadBack',
    'refreshedUiRetainedCorrection',
    'weeklySignStillBlocked',
    'payrollReleaseStillBlocked'
  ];
  const signOffEvidence = attendanceJourney?.weeklySignOffEvidence;
  const weeklySignOffVersionBound = Number.isSafeInteger(signOffEvidence?.submittedRevision)
    && signOffEvidence.submittedRevision >= 0
    && signOffEvidence.submittedRevision === signOffEvidence.signatureRevision
    && signOffEvidence.submittedRevision === signOffEvidence.auditRevision
    && signOffEvidence.refreshedStatus === 'signed';
  const scopedLeaveActionVerified = leaveActionChecks.every(key => leaveJourney?.[key] === true);
  const scopedLeaveJourneyVerified = scopedLeaveActionVerified
    && leaveJourney?.requestAuditLinked === true
    && leaveJourney?.freshBalanceReconciled === true;
  const scopedAttendanceCorrectionVerified = attendanceCorrectionChecks.every(key => attendanceJourney?.[key] === true);
  const scopedAttendanceJourneyVerified = scopedAttendanceCorrectionVerified
    && attendanceJourney?.weeklySignOffCompleted === true
    && weeklySignOffVersionBound;
  const expectedTeamIds = Array.isArray(payrollJourney?.expectedTeamIds) ? payrollJourney.expectedTeamIds : [];
  const teamSignOffs = Array.isArray(payrollJourney?.teamSignOffs) ? payrollJourney.teamSignOffs : [];
  const expectedTeamSet = new Set(expectedTeamIds);
  const signedTeamSet = new Set(teamSignOffs.map(item => item?.teamId));
  const allTeamWeeklySignOffBound = expectedTeamIds.length > 0
    && expectedTeamSet.size === expectedTeamIds.length
    && signedTeamSet.size === teamSignOffs.length
    && signedTeamSet.size === expectedTeamSet.size
    && [...expectedTeamSet].every(teamId => signedTeamSet.has(teamId))
    && teamSignOffs.every(item => Number.isSafeInteger(item?.submittedRevision)
      && item.submittedRevision >= 0
      && item.submittedRevision === item.signatureRevision
      && item.submittedRevision === item.auditRevision
      && item.refreshedStatus === 'signed');
  const release = payrollJourney?.release;
  const checksum = typeof release?.computedChecksum === 'string' ? release.computedChecksum : '';
  const payrollReleaseBound = release?.responseStatus === 200
    && typeof release.batchId === 'string' && release.batchId.length > 0
    && release.status === 'released'
    && Number.isInteger(release.rowCount) && release.rowCount > 0
    && /^[0-9a-f]{64}$/.test(checksum)
    && release.checksumHeader === checksum
    && release.persistedBatchId === release.batchId
    && release.auditBatchId === release.batchId
    && release.freshLoginBatchId === release.batchId
    && release.reconciliationOk === true;
  const scopedPayrollJourneyVerified = allTeamWeeklySignOffBound && payrollReleaseBound;
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: scopedLeaveJourneyVerified && scopedAttendanceJourneyVerified
      ? 'role-bound-leave-and-attendance-ui-with-saved-state'
      : scopedLeaveActionVerified && scopedAttendanceCorrectionVerified
        ? 'role-bound-leave-action-and-attendance-correction-with-saved-state'
        : scopedLeaveActionVerified
          ? 'role-bound-leave-ui-and-saved-state'
          : 'role-navigation-and-source-presentation',
    scopedLeaveActionVerified,
    scopedLeaveJourneyVerified,
    scopedAttendanceCorrectionVerified,
    scopedAttendanceJourneyVerified,
    scopedPayrollJourneyVerified,
    endToEndVerified: false,
    productReady: false,
    exactAssetsVerified: assetBinding?.status === 'BOUND',
    missingEvidence: [
      ...(assetBinding?.status === 'BOUND' ? [] : ['exact-deployed-asset-binding']),
      ...(scopedLeaveActionVerified ? [] : ['UI-triggered-business-action', 'persisted-state-readback', 'updated-UI-after-reload']),
      ...(leaveJourney?.requestAuditLinked === true ? [] : ['leave-request-audit-link']),
      ...(leaveJourney?.freshBalanceReconciled === true ? [] : ['leave-balance-reconciliation']),
      ...(scopedAttendanceCorrectionVerified ? [] : ['attendance-correction-business-action']),
      ...(attendanceJourney?.weeklySignOffCompleted === true ? [] : ['weekly-sign-off-business-action']),
      ...(weeklySignOffVersionBound ? [] : ['weekly-sign-off-version-binding']),
      ...(allTeamWeeklySignOffBound ? [] : ['all-team-weekly-sign-off']),
      'server-audit-readback',
      'exact-backend-binding',
      ...(scopedPayrollJourneyVerified ? [] : ['payroll-reconciliation-business-action']),
      'major-workflow-coverage'
    ]
  };
}
