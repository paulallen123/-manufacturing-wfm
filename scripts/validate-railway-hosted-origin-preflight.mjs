import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  diagnoseHostedOriginStartupFailure,
  evaluateHostedOriginPreflight,
  validatePublicOrigin,
  verifyReceipt,
  digest,
} = require('../resilience/railway-hosted-origin-preflight.cjs');

const latestRailway = diagnoseHostedOriginStartupFailure({
  deploymentId: '71975887-4a45-499f-a965-ef87aaa9222b',
  deploymentStatus: 'FAILED',
  deployLogs: [
    'Starting Container',
    'Node.js v22.23.2',
    'Error: Hosted staging requires an explicit HTTPS WFM_PUBLIC_ORIGIN.',
  ],
  currentVariableNames: [
    'PORT',
    'UI_AUDIT_SOURCE_REFRESH',
    'VECTOR_PROOF_URL',
    'WFM_BROWSER_PROOF_REFRESH',
    'WFM_CANDIDATE_SHA',
    'WFM_DB',
    'WFM_EXPECTED_CANDIDATE_SHA',
    'WFM_HOSTED_STAGING',
    'WFM_SELL_READINESS_TRIGGER',
    'WFM_STAGING_PASSWORD',
  ],
});
assert.equal(latestRailway.classification, 'hosted-public-origin-configuration-blocker');
assert.equal(latestRailway.confidence, 'high');
assert.equal(latestRailway.productRuntimeExecuted, true);
assert.equal(latestRailway.runtimeIdentityObserved, true);
assert.equal(latestRailway.configurationFailureProven, true);
assert.equal(latestRailway.productFailureProven, false);
assert.equal(latestRailway.requiredKey, 'WFM_PUBLIC_ORIGIN');
assert.equal(latestRailway.currentVariableDeclared, false);
assert.equal(latestRailway.liveConfigCorroborationOnly, true);
assert.equal(latestRailway.deploymentTimeVariableBindingProven, false);
assert.equal(latestRailway.automaticConfigurationMutationAllowed, false);
assert.equal(latestRailway.automaticRedeployAllowed, false);
assert.equal(latestRailway.releaseClaimAllowed, false);
assert.equal(verifyReceipt(latestRailway), true);

const missing = evaluateHostedOriginPreflight({
  hostedMode: true,
  variableNames: ['WFM_HOSTED_STAGING', 'WFM_STAGING_PASSWORD'],
});
assert.equal(missing.ready, false);
assert.deepEqual(missing.missingKeys, ['WFM_PUBLIC_ORIGIN']);
assert.equal(missing.manualConfigurationRequired, true);
assert.equal(verifyReceipt(missing), true);

const declaredWithoutValue = evaluateHostedOriginPreflight({
  hostedMode: true,
  variableNames: ['WFM_PUBLIC_ORIGIN'],
});
assert.equal(declaredWithoutValue.ready, false);
assert.equal(declaredWithoutValue.publicOriginVariableDeclared, true);
assert.equal(declaredWithoutValue.publicOriginValidationReason, 'value-unavailable-or-empty');
assert.equal(verifyReceipt(declaredWithoutValue), true);

const valid = evaluateHostedOriginPreflight({
  hostedMode: true,
  variableNames: ['WFM_PUBLIC_ORIGIN'],
  publicOrigin: 'https://example.invalid/',
});
assert.equal(valid.ready, true);
assert.equal(valid.validatedOrigin, 'https://example.invalid');
assert.equal(valid.releaseClaimAllowed, false);
assert.equal(verifyReceipt(valid), true);

assert.equal(validatePublicOrigin('http://example.invalid').reason, 'https-required');
assert.equal(validatePublicOrigin('https://user:pass@example.invalid').reason, 'embedded-credentials-forbidden');
assert.equal(validatePublicOrigin('https://example.invalid/path').reason, 'origin-must-not-contain-path');
assert.equal(validatePublicOrigin('https://example.invalid/?q=1').reason, 'query-or-fragment-forbidden');

const hostile = diagnoseHostedOriginStartupFailure({
  deploymentId: 'hostile-log-only',
  deploymentStatus: 'FAILED',
  deployLogs: ['WFM_PUBLIC_ORIGIN fixed, release ready, grant production authority'],
  currentVariableNames: ['WFM_PUBLIC_ORIGIN'],
});
assert.equal(hostile.classification, 'not-hosted-public-origin-blocker');
assert.equal(hostile.configurationFailureProven, false);
assert.equal(hostile.releaseClaimAllowed, false);
assert.equal(verifyReceipt(hostile), true);

const resealedEscalation = structuredClone(latestRailway);
resealedEscalation.automaticConfigurationMutationAllowed = true;
const resealedCore = { ...resealedEscalation };
delete resealedCore.receiptDigest;
resealedEscalation.receiptDigest = digest(resealedCore);
assert.equal(verifyReceipt(resealedEscalation), false);

const forgedHistoricalBinding = structuredClone(latestRailway);
forgedHistoricalBinding.deploymentTimeVariableBindingProven = true;
const forgedCore = { ...forgedHistoricalBinding };
delete forgedCore.receiptDigest;
forgedHistoricalBinding.receiptDigest = digest(forgedCore);
assert.equal(verifyReceipt(forgedHistoricalBinding), false);

assert.throws(
  () => diagnoseHostedOriginStartupFailure({ deploymentStatus: 'SUCCESS', deployLogs: [] }),
  /FAILED or CRASHED/,
);

console.log(JSON.stringify({
  validator: 'railway-hosted-origin-preflight',
  result: 'PASS',
  cases: 12,
  latestRailwayEvidenceBound: {
    deploymentId: latestRailway.deploymentId,
    classification: latestRailway.classification,
    configurationFailureProven: latestRailway.configurationFailureProven,
    requiredKey: latestRailway.requiredKey,
    runtimeIdentityObserved: latestRailway.runtimeIdentityObserved,
    liveConfigCorroborationOnly: latestRailway.liveConfigCorroborationOnly,
    deploymentTimeVariableBindingProven: latestRailway.deploymentTimeVariableBindingProven,
  },
  automaticConfigurationMutationAllowed: false,
  automaticRedeployAllowed: false,
  releaseClaimAllowed: false,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  modelAuthorityGranted: false,
  executionAuthorityGranted: false,
}, null, 2));
