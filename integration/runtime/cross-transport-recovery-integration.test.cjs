'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection, approvalFor } = require('./connection-proof-gate.cjs');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const { summarizeConnectionHealth } = require('./connection-health-summary.cjs');
const { maintenanceRetryDecision } = require('./provider-proof-retry-policy.cjs');

const NOW = Date.parse('2026-09-20T10:45:00.000Z');
const TRANSPORTS = ['queue-stream', 'secure-file', 'on-prem-agent', 'ipaas'];

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
      measuredLatencyMs: 100, observedAt: '2026-09-20T10:30:00.000Z',
      targetProof: {
        providerKey: review.providerKey, targetIdentity: review.targetIdentity,
        environment: review.environment, method: 'provider-metadata',
        observedAt: '2026-09-20T10:30:00.000Z', boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: {
      status: 'APPROVED', reviewedDigest: review.reviewedDigest,
      mappingVersion: 3, observedAt: '2026-09-20T10:31:00.000Z'
    },
    reconciliation: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      mappingVersion: 3, observedAt: '2026-09-20T10:32:00.000Z'
    },
    recoveryProof: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      observedFailure: true, recovered: true, reconciliationStatus: 'PASS',
      observedAt: '2026-09-20T10:33:00.000Z'
    }
  };
  evidence.approval = approvalFor(
    review,
    { approvedBy: 'integration-owner', role: 'integration-owner' },
    evidence,
    Date.parse('2026-09-20T10:34:00.000Z')
  );

  const runtime = {
    reviewedDigest: review.reviewedDigest,
    authorityConflict: false,
    retryExhausted: false,
    quarantined: 0,
    lastSyncAt: '2026-09-20T10:44:00.000Z',
    lastReconciliationAt: '2026-09-20T10:44:10.000Z',
    measuredLatencyMs: 120,
    pendingRetries: 0
  };
  const circuitState = {
    reviewedDigest: review.reviewedDigest,
    status: 'CLOSED',
    failureCount: 0,
    lastSuccessAt: NOW - 1000
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
  test(`${transport}: transient provider failure is governed by transport policy`, () => {
    const { review } = scenario(transport);
    const decision = maintenanceRetryDecision(review, {
      attemptCount: 1,
      taskKey: 'c'.repeat(64)
    }, {
      code: 'provider-timeout',
      retryable: true
    }, NOW);

    assert.equal(decision.action, 'RETRY');
    assert.equal(decision.retryable, true);
    assert.ok(Number.isFinite(decision.retryAfterMs));
    assert.ok(decision.retryAfterMs >= 0);
  });

  test(`${transport}: duplicate-sensitive retry is blocked without a durable operation key`, () => {
    const { review } = scenario(transport);
    const decision = maintenanceRetryDecision(review, {
      attemptCount: 1
    }, {
      code: 'provider-timeout',
      retryable: true
    }, NOW);

    assert.equal(decision.action, 'BLOCK');
    assert.equal(decision.retryable, false);
    assert.equal(decision.errorClass, 'idempotency-key-required-before-retry');
  });

  test(`${transport}: exhausted recovery may continue only while current proof remains trusted`, () => {
    const { config, review, evidence, runtime, circuitState, proofLease } = scenario(transport);
    const result = summarizeConnectionHealth(review, {
      currentConfig: config,
      activationEvidence: evidence,
      providerProofLease: proofLease('2026-09-20T10:35:00.000Z'),
      circuitState,
      runtime,
      maintenanceExecution: {
        state: 'BLOCKED',
        errorClass: 'retry-budget-exhausted',
        rawProviderResponse: 'must-not-echo',
        credential: 'must-not-echo'
      }
    }, NOW);

    assert.equal(result.state, 'DEGRADED');
    assert.equal(result.canSync, true);
    assert.equal(result.retryExhausted, true);
    assert.equal(result.signals.provider, 'RETRY_EXHAUSTED');
    assert.equal(result.reconciliationRequiredBeforeResume, false);
    assert.equal(JSON.stringify(result).includes('must-not-echo'), false);
  });

  test(`${transport}: exhausted recovery fails closed after proof expiry`, () => {
    const { config, review, evidence, runtime, circuitState, proofLease } = scenario(transport);
    const result = summarizeConnectionHealth(review, {
      currentConfig: config,
      activationEvidence: evidence,
      providerProofLease: proofLease('2026-09-20T10:00:00.000Z', {
        maxAgeSeconds: 300,
        renewWindowSeconds: 60
      }),
      circuitState,
      runtime,
      maintenanceExecution: {
        state: 'BLOCKED',
        errorClass: 'retry-window-would-be-exceeded'
      }
    }, NOW);

    assert.equal(result.state, 'ATTENTION_REQUIRED');
    assert.equal(result.canSync, false);
    assert.equal(result.retryExhausted, true);
    assert.equal(result.signals.runtime, 'PAUSED');
    assert.equal(result.reconciliationRequiredBeforeResume, true);
    assert.match(result.nextAction, /reconcile/i);
  });
}
