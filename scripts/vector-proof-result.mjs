// Whole-product readiness remains false until every required workflow and the
// server-side audit/backend identity are independently bound to the deployment.
export function roleProofResult(assetBinding, leaveJourney = null) {
  const leaveChecks = [
    'employeeUiSubmitted',
    'pendingStateReadBack',
    'overlapRefusedInUi',
    'refreshedUiRetainedPending',
    'managerUiDecided',
    'managerStateReadBack',
    'freshEmployeeLoginSawDecision'
  ];
  const scopedLeaveJourneyVerified = leaveChecks.every(key => leaveJourney?.[key] === true);
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: scopedLeaveJourneyVerified ? 'role-bound-leave-ui-and-saved-state' : 'role-navigation-and-source-presentation',
    scopedLeaveJourneyVerified,
    endToEndVerified: false,
    productReady: false,
    exactAssetsVerified: assetBinding?.status === 'BOUND',
    missingEvidence: [
      ...(assetBinding?.status === 'BOUND' ? [] : ['exact-deployed-asset-binding']),
      ...(scopedLeaveJourneyVerified ? [] : ['UI-triggered-business-action', 'persisted-state-readback', 'updated-UI-after-reload']),
      'server-audit-readback',
      'exact-backend-binding',
      'major-workflow-coverage'
    ]
  };
}
