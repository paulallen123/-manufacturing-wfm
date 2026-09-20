import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assessRailwayDeploymentConfigBinding,
  verifyRailwayDeploymentConfigBindingReceipt,
  digestDeploymentConfigSnapshot,
  digest,
} = require('../resilience/railway-deployment-config-binding.cjs');

const heldConfig = {
  source: { rootDirectory: '/__security_hold_mobile_proof__' },
  build: {
    builder: 'DOCKERFILE',
    dockerfilePath: '__security_manual_redeploy_hold__/Dockerfile',
    watchPatterns: ['/__security_hold_mobile_proof__/**'],
  },
};

const latestMobile = assessRailwayDeploymentConfigBinding({
  deploymentId: 'ed0b04f8-696c-4a0b-a598-3f12ea4d32ec',
  deploymentSnapshotId: 'f3e51162-3365-4ce9-ba56-43d9d5cdfe6b',
  deploymentCreatedAt: '2026-09-20T02:10:00.656Z',
  configObservedAt: '2026-09-20T02:26:36.000Z',
  configSnapshot: heldConfig,
  configEvidence: {
    source: 'live-service-config',
    bindingId: null,
    providerAttestedImmutable: false,
  },
});
assert.equal(latestMobile.classification, 'mutable-config-not-deployment-bound');
assert.equal(latestMobile.deploymentConfigEvidenceBound, false);
assert.equal(latestMobile.configPayloadDigestBound, false);
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
  configSnapshot: heldConfig,
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
  configSnapshot: heldConfig,
  configEvidence: {
    source: 'live-service-config',
    providerAttestedImmutable: false,
  },
});
assert.equal(sameInstantStillMutable.classification, 'mutable-config-not-deployment-bound');
assert.equal(sameInstantStillMutable.deploymentConfigEvidenceBound, false);

const boundConfig = {
  source: { rootDirectory: '/proof-bound' },
  build: {
    builder: 'DOCKERFILE',
    dockerfilePath: 'Dockerfile.proof-runner',
    watchPatterns: ['/proof-bound/**'],
  },
};
const boundDigest = digestDeploymentConfigSnapshot(boundConfig);
assert.match(boundDigest, /^[a-f0-9]{64}$/);

const bound = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-bound',
  deploymentSnapshotId: 'snapshot-immutable-1',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configSnapshot: boundConfig,
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-immutable-1',
    providerAttestedImmutable: true,
    attestedConfigDigest: boundDigest,
  },
});
assert.equal(bound.classification, 'deployment-config-evidence-bound');
assert.equal(bound.deploymentConfigEvidenceBound, true);
assert.equal(bound.configPayloadDigestBound, true);
assert.equal(bound.canElevateDiagnosisConfidence, true);
assert.equal(bound.securityHoldDiagnosisHighConfidenceAllowed, true);
assert.equal(bound.releaseClaimAllowed, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(bound), true);

const wrongSnapshot = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-wrong-snapshot',
  deploymentSnapshotId: 'snapshot-a',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configSnapshot: boundConfig,
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-b',
    providerAttestedImmutable: true,
    attestedConfigDigest: boundDigest,
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
  configSnapshot: boundConfig,
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-u',
    providerAttestedImmutable: false,
    attestedConfigDigest: boundDigest,
  },
});
assert.equal(unattested.classification, 'unattested-config-snapshot');
assert.equal(unattested.deploymentConfigEvidenceBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(unattested), true);

const missingPayload = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-payload-missing',
  deploymentSnapshotId: 'snapshot-payload-missing',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-payload-missing',
    providerAttestedImmutable: true,
  },
});
assert.equal(missingPayload.classification, 'config-payload-binding-incomplete');
assert.equal(missingPayload.deploymentConfigEvidenceBound, false);
assert.equal(missingPayload.configPayloadDigestBound, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(missingPayload), true);

const substitutedConfig = {
  source: { rootDirectory: '/__security_hold_substituted__' },
  build: {
    builder: 'DOCKERFILE',
    dockerfilePath: '__security_manual_redeploy_hold__/Dockerfile',
    watchPatterns: ['/__security_hold_substituted__/**'],
  },
};
const substituted = assessRailwayDeploymentConfigBinding({
  deploymentId: 'dep-bound',
  deploymentSnapshotId: 'snapshot-immutable-1',
  deploymentCreatedAt: '2026-09-20T02:00:00.000Z',
  configObservedAt: '2026-09-20T02:00:01.000Z',
  configSnapshot: substitutedConfig,
  configEvidence: {
    source: 'deployment-snapshot',
    bindingId: 'snapshot-immutable-1',
    providerAttestedImmutable: true,
    attestedConfigDigest: boundDigest,
  },
});
assert.equal(substituted.classification, 'config-payload-digest-mismatch');
assert.equal(substituted.deploymentConfigEvidenceBound, false);
assert.equal(substituted.configPayloadDigestBound, false);
assert.equal(substituted.canElevateDiagnosisConfidence, false);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(substituted), true);

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

const resealedPayloadSubstitution = structuredClone(bound);
resealedPayloadSubstitution.configSnapshotDigest = digestDeploymentConfigSnapshot(substitutedConfig);
resealedPayloadSubstitution.configPayloadDigestBound = true;
resealedPayloadSubstitution.deploymentConfigEvidenceBound = true;
resealedPayloadSubstitution.canElevateDiagnosisConfidence = true;
resealedPayloadSubstitution.securityHoldDiagnosisHighConfidenceAllowed = true;
const forgedPayloadCore = { ...resealedPayloadSubstitution };
delete forgedPayloadCore.receiptDigest;
resealedPayloadSubstitution.receiptDigest = digest(forgedPayloadCore);
assert.equal(verifyRailwayDeploymentConfigBindingReceipt(resealedPayloadSubstitution), false);

console.log(JSON.stringify({
  validator: 'railway-deployment-config-binding',
  result: 'PASS',
  cases: 13,
  latestRailwayEvidence: {
    deploymentId: latestMobile.deploymentId,
    deploymentSnapshotId: latestMobile.deploymentSnapshotId,
    classification: latestMobile.classification,
    deploymentConfigEvidenceBound: latestMobile.deploymentConfigEvidenceBound,
    configPayloadDigestBound: latestMobile.configPayloadDigestBound,
    canElevateDiagnosisConfidence: latestMobile.canElevateDiagnosisConfidence,
  },
  payloadBinding: {
    exactConfigDigestRequired: true,
    payloadSubstitutionDenied: true,
    missingPayloadDenied: true,
    resealedPayloadSubstitutionDenied: true,
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
