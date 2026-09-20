'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection, approvalFor } = require('./connection-proof-gate.cjs');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const { summarizeConnectionHealth } = require('./connection-health-summary.cjs');

const NOW = Date.parse('2026-09-20T09:45:00.000Z');
const config = {
  connectionId: 'enterprise-source-sandbox-a',
  tenantId: 'tenant-a',
  providerKey: 'provider-a',
  transport: 'queue-stream',
  targetIdentity: 'sandbox-a',
  environment: 'sandbox',
  auth: { method: 'oauth2', credentialRef: 'vault://integration/provider-a' },
  mapping: { version: 3, digest: 'a'.repeat(64) },
  authority: [{ capability: 'worker.profile', sourceId: 'enterprise-source-sandbox-a' }],
  monitoring: { maxFreshnessSeconds: 300, maxLatencyMs: 2000 }
};
const review = reviewConnection(config);

function approvedEvidence() {
  const evidence = {
    connectionTest: {
      status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true,
      measuredLatencyMs: 100, observedAt: '2026-09-20T09:30:00.000Z',
      targetProof: {
        providerKey: review.providerKey, targetIdentity: review.targetIdentity,
        environment: review.environment, method: 'provider-metadata',
        observedAt: '2026-09-20T09:30:00.000Z', boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: { status: 'APPROVED', reviewedDigest: review.reviewedDigest, mappingVersion: 3, observedAt: '2026-09-20T09:31:00.000Z' },
    reconciliation: { status: 'PASS', reviewedDigest: review.reviewedDigest, mappingVersion: 3, observedAt: '2026-09-20T09:32:00.000Z' },
    recoveryProof: { status: 'PASS', reviewedDigest: review.reviewedDigest, observedFailure: true, recovered: true, reconciliationStatus: 'PASS', observedAt: '2026-09-20T09:33:00.000Z' }
  };
  evidence.approval = approvalFor(review, { approvedBy: 'integration-owner', role: 'integration-owner' }, evidence, Date.parse('2026-09-20T09:34:00.000Z'));
  return evidence;
}

function proofLease(observedAt, options = {}) {
  return createProviderProofLease(review, {
    status: 'PASS', reviewedDigest: review.reviewedDigest, providerKey: review.providerKey,
    targetIdentity: review.targetIdentity, environment: review.environment, observedAt,
    metadataDigest: 'b'.repeat(64), boundedMetadataOnly: true, containsSensitiveData: false,
    responseBodyRetained: false
  }, { maxAgeSeconds: 3600, renewWindowSeconds: 600, ...options }, NOW);
}

function runtime() {
  return {
    reviewedDigest: review.reviewedDigest, authorityConflict: false, retryExhausted: false,
    quarantined: 0, lastSyncAt: '2026-09-20T09:44:00.000Z',
    lastReconciliationAt: '2026-09-20T09:44:10.000Z', measuredLatencyMs: 120, pendingRetries: 0
  };
}

function circuit() {
  return { reviewedDigest: review.reviewedDigest, status: 'CLOSED', failureCount: 0, lastSuccessAt: NOW - 1000 };
}

test('retry exhaustion keeps syncing only while an exact provider proof remains trusted', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: proofLease('2026-09-20T09:35:00.000Z'),
    circuitState: circuit(), runtime: runtime(),
    maintenanceExecution: {
      state: 'BLOCKED', errorClass: 'retry-budget-exhausted',
      rawProviderResponse: 'must-not-echo', credential: 'must-not-echo'
    }
  }, NOW);

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.canSync, true);
  assert.equal(result.retryExhausted, true);
  assert.equal(result.signals.provider, 'RETRY_EXHAUSTED');
  assert.equal(result.signals.runtime, 'HEALTHY');
  assert.equal(result.reconciliationRequiredBeforeResume, false);
  assert.equal(JSON.stringify(result).includes('must-not-echo'), false);
});

test('retry exhaustion pauses and requires reconciliation when the provider proof is expired', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: proofLease('2026-09-20T09:00:00.000Z', { maxAgeSeconds: 300, renewWindowSeconds: 60 }),
    circuitState: circuit(), runtime: runtime(),
    maintenanceExecution: { state: 'BLOCKED', errorClass: 'retry-window-would-be-exceeded' }
  }, NOW);

  assert.equal(result.state, 'ATTENTION_REQUIRED');
  assert.equal(result.canSync, false);
  assert.equal(result.retryExhausted, true);
  assert.equal(result.signals.provider, 'RETRY_EXHAUSTED');
  assert.equal(result.signals.runtime, 'PAUSED');
  assert.equal(result.reconciliationRequiredBeforeResume, true);
  assert.match(result.nextAction, /reconcile/i);
});