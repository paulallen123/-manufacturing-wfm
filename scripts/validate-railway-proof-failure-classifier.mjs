import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyRailwayProofFailure,
  verifyDiagnosisReceipt,
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
assert.equal(hostileText.executionAuthorityGranted, false);
assert.equal(hostileText.modelAuthorityGranted, false);
assert.equal(verifyDiagnosisReceipt(hostileText), true);

const tampered = structuredClone(snapshot);
tampered.releaseClaimAllowed = true;
assert.equal(verifyDiagnosisReceipt(tampered), false);

assert.throws(
  () => classifyRailwayProofFailure({ deploymentStatus: 'SUCCESS', buildLogs: [], deployLogs: [] }),
  /FAILED or CRASHED/,
);

console.log(JSON.stringify({
  validator: 'railway-proof-failure-classifier',
  result: 'PASS',
  cases: 7,
  classifications: [
    snapshot.classification,
    auth.classification,
    host.classification,
    unknown.classification,
  ],
  authority: {
    automaticRedeployAllowed: false,
    releaseClaimAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
  },
}, null, 2));
