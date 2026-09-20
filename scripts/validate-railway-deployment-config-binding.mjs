import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assessRailwayDeploymentConfigBinding,
  verifyRailwayDeploymentConfigBindingReceipt,
  digest,
} = require('../resilience/railway-deployment-config-binding.cjs');

const latestMobile = assessRailwayDeploymentConfigBinding({
  deploymentId: 'ed0b04f8-696c-4a0b-a598-3f12ea4d32ec',
  deploymentSnapshotId: 'f3e51162-3365-4ce9-ba56-43d9d5cdfe6b',
  deploymentCreatedAt: '2026-09-20T02:10:00.656Z',
  configObservedAt: '2026-09-20T02:26:36.000Z',
  configEvidence: {
    source: 'live-service-config',
    bindingId: null,
    providerAttestedImmutable: false,
  },
});
assert.equal(latestMobile.classification, 'mutable-config-not-deployment-bound');
assert.equal(latestMobile.deploymentConfigEvidenceBound, false);
assert.equal(latestMobile.canElevateDiagnosisConfidence, false);
assert.equal(latestMobile.securityHoldDiagnosisHighConfidenceAllowed, false);
assert.equal(latestMobile.releaseClaimAllowed, false);
assert.equal(latestMobile.automaticRedeployAllowed, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(latestMobile), true);

const historicalHold = assessRailwayDeploymentConfigBinding({
  deploymentId: '982e4b15-c479-4dd7-9160-71d8d8c0a57f',
  deploymentSnapshotId: 'historical-snapshot-id',
  deploymentCreatedAt: '2026-09-20T01:09:23.392Z',
  configObservedAt: '2026-09-20T02:26:36.000Z',
  configEvidence: {
    source: 'live-service-config',
    providerAttestedImmutable: false,
  },
});
assert.equal(historicalHold.classification, 'mutable-config-not-deployment-bound');
assert.equal(historicalHold.deploymentConfigEvidenceBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(historicalHold), true);

const sameInstantStillMutable = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-same-instant',
  deploymentSnapshotId: 'snap-same-instant',
  deploymentCreatedAt: '2026-09-20T02:10:00.000Z',
  configObservedAt: '2026-09-20T02:10:00.000Z',
  configEvidence: {
    source: 'live-service-config',
    providerAttestedImmutable: false,
  },
});
assert.equal(sameInstantStillMutable.classification, 'mutable-config-not-deployment-bound');
assert.equal(sameInstantStillMutable.deploymentConfigEvidenceBound, false);

const bound = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-bound',
  deploymentSnapshotId: 'snapshot-immutable-1',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-immutable-1',
    providerAttestedImmutable: true,
  },
});
assert.equal(bound.classification, 'deployment-config-evidence-bound');
assert.equal(bound.deploymentConfigEvidenceBound, true);
assert.equal(bound.canElevateDiagnosisConfidence, true);
assert.equal(bound.securityHoldDiagnosisHighConfidenceAllowed, true);
assert.equal(bound.releaseClaimAllowed, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(bound), true);

const wrongSnapshot = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-wrong-snapshot',
  deploymentSnapshotId: 'snapshot-a',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-b',
    providerAttestedImmutable: true,
  },
});
assert.equal(wrongSnapshot.classification, 'config-snapshot-binding-mismatch');
assert.equal(wrongSnapshot.deploymentConfigEvidenceBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(wrongSnapshot), true);

const unattested = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-unattested',
  deploymentSnapshotId: 'snapshot-u',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-u',
    providerAttestedImmutable: false,
  },
});
assert.equal(unattested.classification, 'unattested-config-snapshot');
assert.equal(unattested.deploymentConfigEvidenceBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(unattested), true);

const missing = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-missing',
  deploymentStatus: 'FAILED',
  configEvidence: {},
});
assert.equal(missing.classification, 'invalid-or-missing-config-binding');
assert.equal(missing.deploymentConfigEvidenceBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(missing), true);

const tampered = structuredClone(latestMobile);
tampered.releaseClaimAllowed = true;
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(tampered), false);

const resealedEscalation = structuredClone(latestMobile);
resealedEscalation.canElevateDiagnosisConfidence = true;
const forgedCore = { ...resealedEscalation };
delete forgedCore.receiptDigest;
resealedEscalation.receiptDigest = digest(forgedCore);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(resealedEscalation), false);

const resealedHoldEscalation = structuredClone(latestMobile);
resealedHoldEscalation.securityHoldDiagnosisHighConfidenceAllowed = true;
const forgedHoldCore = { ...resealedHoldEscalation };
delete forgedHoldCore.receiptDigest;
resealedHoldEscalation.receiptDigest = digest(forgedHoldCore);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(resealedHoldEscalation), false);

console.log(JSON.stringify({
  validator: 'railway-deployment-config-binding',
  result: 'PASS',
  cases: 10,
  latestRailwayEvidence: {
    deploymentId: latestMobile.deploymentId,
    deploymentSnapshotId: latestMobile.deploymentSnapshotId,
    classification: latestMobile.classification,
    deploymentConfigEvidenceBound: latestMobile.deploymentConfigEvidenceBound,
    canElevateDiagnosisConfidence: latestMobile.canElevateDiagnosisConfidence,
  },
  authority: {
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    safetyGateBypassAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
  },
}, null, 2));
