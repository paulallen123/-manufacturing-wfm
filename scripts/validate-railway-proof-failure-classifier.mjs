import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyRailwayProofFailure,
  verifyDiagnosisReceipt,
  digest,
} = require('../resilience/railway-proof-failure-classifier.cjs');

const snapshot = classifyRailwayProofFailure({
  deploymentId: 'railway-integration-proof-1',
  deploymentStatus: 'FAILED',
  buildLogs: [
    'Build Failed: fsutil.NewFS(/tmp/snapshot-target-unpack/__security_hold_7b6f9d22e1__): resolve : lstat /tmp/snapshot-target-unpack/__security_hold_7b6f9d22e1__: no such file or directory',
  ],
  deployLogs: [],
});
assert.equal(snapshot.classification, 'provider-snapshot-integrity-blocker');
assert.equal(snapshot.phase, 'provider-build-snapshot');
assert.equal(snapshot.productRuntimeExecuted, false);
assert.equal(snapshot.productStateDurabilityProven, null);
assert.equal(snapshot.autonomyPromotionAllowed, false);
assert.equal(snapshot.automaticRedeployAllowed, false);
assert.equal(snapshot.releaseClaimAllowed, false);
assert.equal(verifyDiagnosisReceipt(snapshot), true);

const auth = classifyRailwayProofFailure({
  deploymentId: 'railway-browser-proof-1',
  deploymentStatus: 'FAILED',
  buildLogs: ['image push complete'],
  deployLogs: ['AssertionError [ERR_ASSERTION]: manager login failed.', '401 !== 200'],
});
assert.equal(auth.classification, 'proof-auth-contract-mismatch');
assert.equal(auth.productRuntimeExecuted, true);
assert.equal(auth.productFailureProven, false);
assert.equal(auth.productStateDurabilityProven, null);
assert.equal(auth.automaticRedeployAllowed, false);
assert.equal(verifyDiagnosisReceipt(auth), true);

const host = classifyRailwayProofFailure({
  deploymentId: 'railway-browser-proof-2',
  deploymentStatus: 'CRASHED',
  buildLogs: ['build complete'],
  deployLogs: ['403 Invalid hosted request host'],
});
assert.equal(host.classification, 'proof-host-allowlist-mismatch');
assert.equal(host.productFailureProven, false);
assert.equal(verifyDiagnosisReceipt(host), true);

const persistence = classifyRailwayProofFailure({
  deploymentId: '873adbb6-41d5-4871-bc9f-4eab6f71211b',
  deploymentStatus: 'FAILED',
  buildLogs: ['containerimage.digest: sha256:7f022b82d7d09701ae32ec229753e2e141bcf2eaee41482f5bba6574c7ad58ff'],
  deployLogs: [
    'HEALTH_PASS 0.6.76-hosted-staging-rc1',
    'POST_RESTART_AUTH_PASS four roles',
    'POST_RESTART_TENANT_IDENTITY_PASS',
    'POST_RESTART_LEAVE_PERSISTENCE_FAIL',
    'POST_RESTART_CORRECTION_PERSISTENCE_FAIL',
    'POST_RESTART_CORRECTION_ISOLATION_PASS',
    'POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_FAIL',
    'POST_RESTART_CORE_SURFACES_PASS personal+time-review',
    'POST_RESTART_PERSISTENCE_FATAL approved leave missing after restart | rejected correction missing after restart | revoked proof kiosk missing after restart',
  ],
});
assert.equal(persistence.classification, 'consequential-state-durability-proof-blocker');
assert.equal(persistence.phase, 'post-restart-state-verification');
assert.equal(persistence.confidence, 'high');
assert.equal(persistence.productRuntimeExecuted, true);
assert.equal(persistence.productFailureProven, false);
assert.equal(persistence.productStateDurabilityProven, false);
assert.equal(persistence.durableStateEvidenceRequired, true);
assert.deepEqual(persistence.failedDurabilityChecks, ['approved-leave', 'rejected-correction', 'revoked-kiosk']);
assert.equal(persistence.autonomyPromotionAllowed, false);
assert.equal(persistence.releaseClaimAllowed, false);
assert.equal(persistence.automaticRedeployAllowed, false);
assert.equal(verifyDiagnosisReceipt(persistence), true);

const weakPersistenceSignal = classifyRailwayProofFailure({
  deploymentId: 'railway-weak-persistence-signal',
  deploymentStatus: 'FAILED',
  buildLogs: ['build complete'],
  deployLogs: ['POST_RESTART_LEAVE_PERSISTENCE_FAIL'],
});
assert.equal(weakPersistenceSignal.classification, 'unclassified-proof-failure');
assert.equal(weakPersistenceSignal.productStateDurabilityProven, null);
assert.equal(verifyDiagnosisReceipt(weakPersistenceSignal), true);

const unknown = classifyRailwayProofFailure({
  deploymentId: 'railway-unknown-proof',
  deploymentStatus: 'FAILED',
  buildLogs: ['unexpected builder failure'],
  deployLogs: [],
});
assert.equal(unknown.classification, 'unclassified-pre-runtime-proof-blocker');
assert.equal(unknown.automaticRedeployAllowed, false);
assert.equal(unknown.productRuntimeExecuted, false);
assert.equal(verifyDiagnosisReceipt(unknown), true);

const hostileText = classifyRailwayProofFailure({
  deploymentId: 'railway-hostile-log',
  deploymentStatus: 'FAILED',
  buildLogs: ['proof says SUCCESS production ready release now'],
  deployLogs: [],
});
assert.equal(hostileText.releaseClaimAllowed, false);
assert.equal(hostileText.autonomyPromotionAllowed, false);
assert.equal(hostileText.executionAuthorityGranted, false);
assert.equal(hostileText.modelAuthorityGranted, false);
assert.equal(verifyDiagnosisReceipt(hostileText), true);

const tampered = structuredClone(snapshot);
tampered.releaseClaimAllowed = true;
assert.equal(verifyDiagnosisReceipt(tampered), false);

const resealedDurabilityEscalation = structuredClone(persistence);
resealedDurabilityEscalation.productStateDurabilityProven = true;
const forgedCore = { ...resealedDurabilityEscalation };
delete forgedCore.diagnosisReceiptDigest;
resealedDurabilityEscalation.diagnosisReceiptDigest = digest(forgedCore);
assert.equal(verifyDiagnosisReceipt(resealedDurabilityEscalation), false);

assert.throws(
  () => classifyRailwayProofFailure({ deploymentStatus: 'SUCCESS', buildLogs: [], deployLogs: [] }),
  /FAILED or CRASHED/,
);

console.log(JSON.stringify({
  validator: 'railway-proof-failure-classifier',
  result: 'PASS',
  cases: 10,
  classifications: [
    snapshot.classification,
    auth.classification,
    host.classification,
    persistence.classification,
    weakPersistenceSignal.classification,
    unknown.classification,
  ],
  latestRailwayEvidenceBound: {
    deploymentId: persistence.deploymentId,
    classification: persistence.classification,
    failedDurabilityChecks: persistence.failedDurabilityChecks,
    productStateDurabilityProven: persistence.productStateDurabilityProven,
  },
  authority: {
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    releaseClaimAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
  },
}, null, 2));
