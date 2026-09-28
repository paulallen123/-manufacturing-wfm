// Whole-product readiness remains false until every required workflow and the
// server-side audit/backend identity are independently bound to the deployment.
export function roleProofResult(assetBinding, leaveJourney = null, attendanceJourney = null, payrollJourney = null) {
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
  const expectedTeamIds = Array.isArray(payrollJourney?.expectedTeamIds) ? payrollJourney.expectedTeamIds : [];
  const teamSignOffs = Array.isArray(payrollJourney?.teamSignOffs) ? payrollJourney.teamSignOffs : [];
  const expectedTeamSet = new Set(expectedTeamIds);
  const signedTeamSet = new Set(teamSignOffs.map(item => item?.teamId));
  const allTeamWeeklySignOffBound = expectedTeamIds.length > 0
    && expectedTeamSet.size === expectedTeamIds.length
    && signedTeamSet.size === teamSignOffs.length
    && signedTeamSet.size === expectedTeamSet.size
    && [...expectedTeamSet].every(teamId => signedTeamSet.has(teamId))
    && teamSignOffs.every(item => Number.isInteger(item?.submittedRevision)
      && item.submittedRevision === item.signatureRevision
      && item.submittedRevision === item.auditRevision
      && item.refreshedStatus === 'signed');
  const release = payrollJourney?.release;
  const checksum = typeof release?.computedChecksum === 'string' ? release.computedChecksum : '';
  const authoritativeChecksum = typeof release?.authoritativeCsvChecksum === 'string'
    ? release.authoritativeCsvChecksum
    : '';
  const payrollExportContentBound = /^[0-9a-f]{64}$/.test(authoritativeChecksum)
    && authoritativeChecksum === checksum;
  const payrollReleaseBound = release?.responseStatus === 200
    && typeof release.batchId === 'string' && release.batchId.length > 0
    && release.status === 'released'
    && Number.isInteger(release.rowCount) && release.rowCount > 0
    && /^[0-9a-f]{64}$/.test(checksum)
    && release.checksumHeader === checksum
    && release.persistedBatchId === release.batchId
    && release.auditBatchId === release.batchId
    && release.freshLoginBatchId === release.batchId
    && release.reconciliationOk === true
    && payrollExportContentBound;
  const scopedPayrollJourneyVerified = allTeamWeeklySignOffBound && payrollReleaseBound;
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: scopedLeaveJourneyVerified && scopedAttendanceJourneyVerified ? 'role-bound-leave-and-attendance-ui-with-saved-state' : scopedLeaveJourneyVerified ? 'role-bound-leave-ui-and-saved-state' : 'role-navigation-and-source-presentation',
    scopedLeaveJourneyVerified,
    scopedAttendanceJourneyVerified,
    scopedPayrollJourneyVerified,
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
      ...(allTeamWeeklySignOffBound ? [] : ['all-team-weekly-sign-off']),
      'server-audit-readback',
      'exact-backend-binding',
      ...(payrollExportContentBound ? [] : ['payroll-export-content-reconciliation']),
      ...(scopedPayrollJourneyVerified ? [] : ['payroll-reconciliation-business-action']),
      'major-workflow-coverage'
    ]
  };
}
