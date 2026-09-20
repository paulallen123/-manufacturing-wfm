'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection, approvalFor } = require('./connection-proof-gate.cjs');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const { summarizeConnectionHealth } = require('./connection-health-summary.cjs');
const { maintenanceRetryDecision } = require('./provider-proof-retry-policy.cjs');

const NOW = Date.parse('2026-09-20T11:45:00.000Z');
const TRANSPORTS = ['read-only-db', 'identity'];

function scenario(transport) {
  const config = {
    connectionId: `enterprise-${transport}-sandbox`,
    tenantId: 'tenant-a',
    providerKey: 'provider-a',
    transport,
    targetIdentity: `sandbox-${transport}`,
    environment: 'sandbox',
    auth: { method: 'oauth2', credentialRef: `vault://integration/${transport}` },
    mapping: { version: 3, digest: 'a'.repeat(64) },
    authority: [{ capability: 'worker.profile', sourceId: `enterprise-${transport}-sandbox` }],
    monitoring: { maxFreshnessSeconds: 300, maxLatencyMs: 2000 }
  };
  const review = reviewConnection(config);
  const evidence = {
    connectionTest: {
      status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true,
      measuredLatencyMs: 100, observedAt: '2026-09-20T11:30:00.000Z',
      targetProof: {
        providerKey: review.providerKey, targetIdentity: review.targetIdentity,
        environment: review.environment, method: 'provider-metadata',
        observedAt: '2026-09-20T11:30:00.000Z', boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: {
      status: 'APPROVED', reviewedDigest: review.reviewedDigest,
      mappingVersion: 3, observedAt: '2026-09-20T11:31:00.000Z'
    },
    reconciliation: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      mappingVersion: 3, observedAt: '2026-09-20T11:32:00.000Z'
    },
    recoveryProof: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      observedFailure: true, recovered: true, reconciliationStatus: 'PASS',
      observedAt: '2026-09-20T11:33:00.000Z'
    }
  };
  evidence.approval = approvalFor(
    review,
    { approvedBy: 'integration-owner', role: 'integration-owner' },
    evidence,
    Date.parse('2026-09-20T11:34:00.000Z')
  );
  const runtime = {
    reviewedDigest: review.reviewedDigest,
    authorityConflict: false,
    retryExhausted: false,
    quarantined: 0,
    lastSyncAt: '2026-09-20T11:44:00.000Z',
    lastReconciliationAt: '2026-09-20T11:44:10.000Z',
    measuredLatencyMs: 120,
    pendingRetries: 0
  };
  const circuitState = {
    reviewedDigest: review.reviewedDigest,
    status: 'CLOSED', failureCount: 0, lastSuccessAt: NOW - 1000
  };
  function proofLease(observedAt, options = {}) {
    return createProviderProofLease(review, {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      providerKey: review.providerKey, targetIdentity: review.targetIdentity,
      environment: review.environment, observedAt,
      metadataDigest: 'b'.repeat(64), boundedMetadataOnly: true,
      containsSensitiveData: false, responseBodyRetained: false
    }, { maxAgeSeconds: 3600, renewWindowSeconds: 600, ...options }, NOW);
  }
  return { config, review, evidence, runtime, circuitState, proofLease };
}

for (const transport of TRANSPORTS) {
  test(`${transport}: transient provider failure retries without requiring a mutation operation key`, () => {
    const { review } = scenario(transport);
    const decision = maintenanceRetryDecision(review, { attemptCount: 1 }, {
      code: 'provider-timeout', retryable: true
    }, NOW);
    assert.equal(decision.action, 'RETRY');
    assert.equal(decision.retryable, true);
    assert.ok(Number.isFinite(decision.retryAfterMs));
  });

  test(`${transport}: exhausted recovery may continue only while proof remains trusted`, () => {
    const { config, review, evidence, runtime, circuitState, proofLease } = scenario(transport);
    const result = summarizeConnectionHealth(review, {
      currentConfig: config,
      activationEvidence: evidence,
      providerProofLease: proofLease('2026-09-20T11:35:00.000Z'),
      circuitState,
      runtime,
      maintenanceExecution: { state: 'BLOCKED', errorClass: 'retry-budget-exhausted' }
    }, NOW);
    assert.equal(result.state, 'DEGRADED');
    assert.equal(result.canSync, true);
    assert.equal(result.retryExhausted, true);
    assert.equal(result.reconciliationRequiredBeforeResume, false);
  });

  test(`${transport}: proof expiry after exhausted recovery pauses and requires reconciliation`, () => {
    const { config, review, evidence, runtime, circuitState, proofLease } = scenario(transport);
    const result = summarizeConnectionHealth(review, {
      currentConfig: config,
      activationEvidence: evidence,
      providerProofLease: proofLease('2026-09-20T11:00:00.000Z', { maxAgeSeconds: 300, renewWindowSeconds: 60 }),
      circuitState,
      runtime,
      maintenanceExecution: { state: 'BLOCKED', errorClass: 'retry-window-would-be-exceeded' }
    }, NOW);
    assert.equal(result.state, 'ATTENTION_REQUIRED');
    assert.equal(result.canSync, false);
    assert.equal(result.reconciliationRequiredBeforeResume, true);
  });
}

test('identity authentication expiry requires re-authorisation rather than blind retry', () => {
  const { review } = scenario('identity');
  const decision = maintenanceRetryDecision(review, { attemptCount: 1 }, {
    code: 'auth-expired', retryable: true
  }, NOW);
  assert.notEqual(decision.action, 'RETRY');
  assert.equal(decision.retryable, false);
});

test('read-only database write attempts fail closed', () => {
  const { review } = scenario('read-only-db');
  const decision = maintenanceRetryDecision(review, { attemptCount: 1 }, {
    code: 'write-attempt', retryable: true
  }, NOW);
  assert.equal(decision.action, 'BLOCK');
  assert.equal(decision.retryable, false);
});
