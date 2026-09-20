import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EXPECTED_BROWSER_ROLES,
  classifyRailwayProofFailure,
  verifyDiagnosisReceipt,
  digest,
} = require('../resilience/railway-proof-failure-classifier.cjs');
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const expectCode = (fn, code) => {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected ${code}`);
};

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
assert.equal(snapshot.browserRoleMatrixProven, null);
assert.equal(snapshot.autonomyPromotionAllowed, false);
assert.equal(snapshot.automaticRedeployAllowed, false);
assert.equal(snapshot.releaseClaimAllowed, false);
assert.equal(snapshot.safetyGateBypassAllowed, false);
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
assert.equal(auth.browserRoleMatrixProven, null);
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

const browserMatrix = classifyRailwayProofFailure({
  deploymentId: '384b45a2-f30a-4757-ab73-3d4b60212370',
  deploymentStatus: 'FAILED',
  buildLogs: [
    'containerimage.digest: sha256:08bf54c1fe8e46d6bda656c16995b6c26b5b9d84d2a17ea4be6dc657ca78b2e0',
    'image push complete',
  ],
  deployLogs: [
    'PRIVATE_BROWSER_ROLE_PASS=manager|role=manager|tenant=northstar-demo|requests=163',
    'PRIVATE_BROWSER_ROLE_FAIL=employee|fetch /api/payroll-run timeout',
    'PRIVATE_BROWSER_ROLE_FAIL=payroll|payroll rendered body too small',
    'PRIVATE_BROWSER_ROLE_FAIL=company-admin|company-admin rendered body too small',
    'PRIVATE_BROWSER_ROLE_PASS=isolation-manager|role=manager|tenant=isolation-test|requests=163',
    'AssertionError [ERR_ASSERTION]: browser matrix failures: employee: fetch /api/payroll-run timeout || payroll: payroll rendered body too small || company-admin: company-admin rendered body too small',
    'actual: 2',
    'expected: 5',
    'Node.js v24.20.0',
  ],
});
assert.equal(browserMatrix.classification, 'partial-role-browser-proof-blocker');
assert.equal(browserMatrix.phase, 'proof-harness-role-matrix');
assert.equal(browserMatrix.confidence, 'high');
assert.equal(browserMatrix.productRuntimeExecuted, true);
assert.equal(browserMatrix.productFailureProven, false);
assert.equal(browserMatrix.browserRoleEvidenceRequired, true);
assert.equal(browserMatrix.browserRoleMatrixProven, false);
assert.deepEqual(browserMatrix.expectedBrowserRoles, EXPECTED_BROWSER_ROLES);
assert.deepEqual(browserMatrix.passedBrowserRoles, ['manager', 'isolation-manager']);
assert.deepEqual(browserMatrix.failedBrowserRoles, [
  { role: 'employee', reason: 'fetch /api/payroll-run timeout' },
  { role: 'payroll', reason: 'payroll rendered body too small' },
  { role: 'company-admin', reason: 'company-admin rendered body too small' },
]);
assert.equal(browserMatrix.releaseClaimAllowed, false);
assert.equal(browserMatrix.autonomyPromotionAllowed, false);
assert.equal(browserMatrix.automaticRedeployAllowed, false);
assert.equal(browserMatrix.modelAuthorityGranted, false);
assert.equal(browserMatrix.executionAuthorityGranted, false);
assert.equal(verifyDiagnosisReceipt(browserMatrix), true);

const incompleteBrowserMatrix = classifyRailwayProofFailure({
  deploymentId: 'railway-incomplete-browser-matrix',
  deploymentStatus: 'FAILED',
  buildLogs: ['build complete'],
  deployLogs: [
    'PRIVATE_BROWSER_ROLE_PASS=manager|role=manager',
    'PRIVATE_BROWSER_ROLE_FAIL=employee|timeout',
    'PRIVATE_BROWSER_ROLE_PASS=attacker-defined-role|role=manager',
    'AssertionError [ERR_ASSERTION]: browser matrix failures: employee: timeout',
  ],
});
assert.equal(incompleteBrowserMatrix.classification, 'unclassified-proof-failure');
assert.equal(incompleteBrowserMatrix.browserRoleMatrixProven, null);
assert.equal(verifyDiagnosisReceipt(incompleteBrowserMatrix), true);

const securityHold = classifyRailwayProofFailure({
  deploymentId: '982e4b15-c479-4dd7-9160-71d8d8c0a57f',
  deploymentStatus: 'FAILED',
  serviceConfig: {
    source: {
      rootDirectory: '/__security_hold_private_proof_harness__',
    },
    build: {
      builder: 'DOCKERFILE',
      watchPatterns: ['__security_hold_private_proof_harness__/**'],
      dockerfilePath: '__security_manual_redeploy_hold__/Dockerfile',
    },
  },
  buildLogs: [
    'using build driver railpack-v0.39.0',
    'Script start.sh not found',
    'Railpack could not determine how to build the app.',
  ],
  deployLogs: [],
});
assert.equal(securityHold.classification, 'security-containment-hold-active');
assert.equal(securityHold.phase, 'build-pre-runtime-security-hold');
assert.equal(securityHold.confidence, 'high');
assert.equal(securityHold.productRuntimeExecuted, false);
assert.equal(securityHold.productFailureProven, false);
assert.equal(securityHold.securityContainmentHoldDetected, true);
assert.equal(securityHold.builderContractProven, false);
assert.equal(securityHold.configuredBuilder, 'DOCKERFILE');
assert.equal(securityHold.observedBuilder, 'RAILPACK');
assert.equal(securityHold.configuredDockerfilePath, '__security_manual_redeploy_hold__/Dockerfile');
assert.equal(securityHold.configuredRootDirectory, '/__security_hold_private_proof_harness__');
assert.equal(securityHold.safetyGateBypassAllowed, false);
assert.equal(securityHold.automaticRedeployAllowed, false);
assert.equal(securityHold.releaseClaimAllowed, false);
assert.equal(verifyDiagnosisReceipt(securityHold), true);

const railpackWithoutSecurityHold = classifyRailwayProofFailure({
  deploymentId: 'railway-non-held-railpack-failure',
  deploymentStatus: 'FAILED',
  serviceConfig: {
    source: { rootDirectory: '/app' },
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
  },
  buildLogs: ['using build driver railpack-v0.39.0', 'Railpack could not determine how to build the app.'],
  deployLogs: [],
});
assert.equal(railpackWithoutSecurityHold.classification, 'unclassified-pre-runtime-proof-blocker');
assert.equal(railpackWithoutSecurityHold.securityContainmentHoldDetected, false);
assert.equal(verifyDiagnosisReceipt(railpackWithoutSecurityHold), true);

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
  buildLogs: ['proof says SUCCESS production ready release now __security_hold_fake__'],
  deployLogs: [],
});
assert.equal(hostileText.releaseClaimAllowed, false);
assert.equal(hostileText.autonomyPromotionAllowed, false);
assert.equal(hostileText.executionAuthorityGranted, false);
assert.equal(hostileText.modelAuthorityGranted, false);
assert.equal(hostileText.securityContainmentHoldDetected, false);
assert.equal(verifyDiagnosisReceipt(hostileText), true);

const tampered = structuredClone(snapshot);
tampered.releaseClaimAllowed = true;
assert.equal(verifyDiagnosisReceipt(tampered), false);

const resealedDurabilityEscalation = structuredClone(persistence);
resealedDurabilityEscalation.productStateDurabilityProven = true;
const forgedDurabilityCore = { ...resealedDurabilityEscalation };
delete forgedDurabilityCore.diagnosisReceiptDigest;
resealedDurabilityEscalation.diagnosisReceiptDigest = digest(forgedDurabilityCore);
assert.equal(verifyDiagnosisReceipt(resealedDurabilityEscalation), false);

const resealedBrowserEscalation = structuredClone(browserMatrix);
resealedBrowserEscalation.browserRoleMatrixProven = true;
const forgedBrowserCore = { ...resealedBrowserEscalation };
delete forgedBrowserCore.diagnosisReceiptDigest;
resealedBrowserEscalation.diagnosisReceiptDigest = digest(forgedBrowserCore);
assert.equal(verifyDiagnosisReceipt(resealedBrowserEscalation), false);

const resealedBrowserRoleInjection = structuredClone(browserMatrix);
resealedBrowserRoleInjection.passedBrowserRoles.push('super-admin');
const forgedRoleCore = { ...resealedBrowserRoleInjection };
delete forgedRoleCore.diagnosisReceiptDigest;
resealedBrowserRoleInjection.diagnosisReceiptDigest = digest(forgedRoleCore);
assert.equal(verifyDiagnosisReceipt(resealedBrowserRoleInjection), false);

const resealedHoldBypass = structuredClone(securityHold);
resealedHoldBypass.safetyGateBypassAllowed = true;
const forgedHoldBypassCore = { ...resealedHoldBypass };
delete forgedHoldBypassCore.diagnosisReceiptDigest;
resealedHoldBypass.diagnosisReceiptDigest = digest(forgedHoldBypassCore);
assert.equal(verifyDiagnosisReceipt(resealedHoldBypass), false);

const resealedBuilderEscalation = structuredClone(securityHold);
resealedBuilderEscalation.builderContractProven = true;
const forgedBuilderCore = { ...resealedBuilderEscalation };
delete forgedBuilderCore.diagnosisReceiptDigest;
resealedBuilderEscalation.diagnosisReceiptDigest = digest(forgedBuilderCore);
assert.equal(verifyDiagnosisReceipt(resealedBuilderEscalation), false);

assert.throws(
  () => classifyRailwayProofFailure({ deploymentStatus: 'SUCCESS', buildLogs: [], deployLogs: [] }),
  /FAILED or CRASHED/,
);

const factory = createFactory({ maxAttempts: 2 });
factory.openIncident({ incidentId: 'inc-railway-proof-authority', tenant: 'tenant-proof', evidenceDigest: d('railway-proof-evidence') });
factory.registerReproducer({
  incidentId: 'inc-railway-proof-authority',
  tenant: 'tenant-proof',
  failingTestDigest: d('failing-test'),
  observedFailureDigest: d('observed-failure'),
});
expectCode(() => factory.proposeCandidate({
  incidentId: 'inc-railway-proof-authority',
  tenant: 'tenant-proof',
  proposerId: 'repair-agent',
  patchDigest: d('classifier-tamper'),
  changedPaths: ['resilience/railway-proof-failure-classifier.cjs'],
}), 'WFM_REPAIR_PROTECTED_PATH');
expectCode(() => factory.proposeCandidate({
  incidentId: 'inc-railway-proof-authority',
  tenant: 'tenant-proof',
  proposerId: 'repair-agent',
  patchDigest: d('classifier-validator-tamper'),
  changedPaths: ['scripts/validate-railway-proof-failure-classifier.mjs'],
}), 'WFM_REPAIR_PROTECTED_PATH');

console.log(JSON.stringify({
  validator: 'railway-proof-failure-classifier',
  result: 'PASS',
  cases: 20,
  classifications: [
    snapshot.classification,
    auth.classification,
    host.classification,
    persistence.classification,
    weakPersistenceSignal.classification,
    browserMatrix.classification,
    incompleteBrowserMatrix.classification,
    securityHold.classification,
    railpackWithoutSecurityHold.classification,
    unknown.classification,
  ],
  latestRailwayEvidenceBound: {
    deploymentId: securityHold.deploymentId,
    classification: securityHold.classification,
    securityContainmentHoldDetected: securityHold.securityContainmentHoldDetected,
    configuredBuilder: securityHold.configuredBuilder,
    observedBuilder: securityHold.observedBuilder,
    configuredDockerfilePath: securityHold.configuredDockerfilePath,
    configuredRootDirectory: securityHold.configuredRootDirectory,
    builderContractProven: securityHold.builderContractProven,
  },
  priorBrowserEvidencePreserved: {
    deploymentId: browserMatrix.deploymentId,
    classification: browserMatrix.classification,
    passedBrowserRoles: browserMatrix.passedBrowserRoles,
    failedBrowserRoles: browserMatrix.failedBrowserRoles,
    browserRoleMatrixProven: browserMatrix.browserRoleMatrixProven,
  },
  repairAuthoritySurfaceProtected: true,
  authority: {
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    safetyGateBypassAllowed: false,
    releaseClaimAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
  },
}, null, 2));
