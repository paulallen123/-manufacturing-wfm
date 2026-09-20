// This runner exercises roles, navigation and source-action presentation only.
// It never commits a customer workflow and cannot attest whole-product readiness.
export function roleProofResult(assetBinding) {
  return {
    status: 'PARTIAL',
    roleChecks: 'PASS',
    proofScope: 'role-navigation-and-source-presentation',
    endToEndVerified: false,
    productReady: false,
    exactAssetsVerified: assetBinding?.status === 'BOUND',
    missingEvidence: [
      ...(assetBinding?.status === 'BOUND' ? [] : ['exact-deployed-asset-binding']),
      'UI-triggered-business-action',
      'persisted-state-readback',
      'updated-UI-after-reload',
      'major-workflow-coverage'
    ]
  };
}
