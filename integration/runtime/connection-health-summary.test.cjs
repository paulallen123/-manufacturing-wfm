'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection, approvalFor } = require('./connection-proof-gate.cjs');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const { summarizeConnectionHealth } = require('./connection-health-summary.cjs');

const NOW = Date.parse('2026-09-19T15:40:00.000Z');

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
      status: 'PASS',
      reviewedDigest: review.reviewedDigest,
      nonMutating: true,
      measuredLatencyMs: 100,
      observedAt: '2026-09-19T15:30:00.000Z',
      targetProof: {
        providerKey: review.providerKey,
        targetIdentity: review.targetIdentity,
        environment: review.environment,
        method: 'provider-metadata',
        observedAt: '2026-09-19T15:30:00.000Z',
        boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: {
      status: 'APPROVED',
      reviewedDigest: review.reviewedDigest,
      mappingVersion: review.mapping.version,
      observedAt: '2026-09-19T15:31:00.000Z'
    },
    reconciliation: {
      status: 'PASS',
      reviewedDigest: review.reviewedDigest,
      mappingVersion: review.mapping.version,
      observedAt: '2026-09-19T15:32:00.000Z'
    },
    recoveryProof: {
      status: 'PASS',
      reviewedDigest: review.reviewedDigest,
      observedFailure: true,
      recovered: true,
      reconciliationStatus: 'PASS',
      observedAt: '2026-09-19T15:33:00.000Z'
    }
  };
  evidence.approval = approvalFor(review, {
    approvedBy: 'integration-owner',
    role: 'integration-owner'
  }, evidence, Date.parse('2026-09-19T15:34:00.000Z'));
  return evidence;
}

function providerProofLease(overrides = {}, options = {}) {
  return createProviderProofLease(review, {
    status: 'PASS',
    reviewedDigest: review.reviewedDigest,
    providerKey: review.providerKey,
    targetIdentity: review.targetIdentity,
    environment: review.environment,
    observedAt: '2026-09-19T15:35:00.000Z',
    metadataDigest: 'b'.repeat(64),
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false,
    ...overrides
  }, {
    maxAgeSeconds: 3600,
    renewWindowSeconds: 600,
    ...options
  }, NOW);
}

function healthyRuntime(overrides = {}) {
  return {
    reviewedDigest: review.reviewedDigest,
    authorityConflict: false,
    retryExhausted: false,
    quarantined: 0,
    lastSyncAt: '2026-09-19T15:39:00.000Z',
    lastReconciliationAt: '2026-09-19T15:39:10.000Z',
    measuredLatencyMs: 120,
    pendingRetries: 0,
    ...overrides
  };
}

function closedCircuit() {
  return {
    reviewedDigest: review.reviewedDigest,
    status: 'CLOSED',
    failureCount: 0,
    lastSuccessAt: NOW - 1000
  };
}

test('healthy connection produces a calm customer-safe summary', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: providerProofLease(),
    circuitState: closedCircuit(),
    runtime: healthyRuntime()
  }, NOW);

  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.canSync, true);
  assert.equal(result.nextAction, 'No action required.');
  assert.ok(result.setupProgress.every((step) => step.state === 'COMPLETE'));
});

test('setup remains fail closed and points to the first useful customer action', () => {
  const evidence = approvedEvidence();
  delete evidence.approval;
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: evidence,
    circuitState: closedCircuit(),
    runtime: healthyRuntime()
  }, NOW);

  assert.equal(result.state, 'SETUP_REQUIRED');
  assert.equal(result.canSync, false);
  assert.match(result.nextAction, /approve activation/i);
  assert.equal(result.signals.provider, 'NOT_EVALUATED');
});

test('expired provider proof pauses sync and asks only for safe re-proof', () => {
  const expired = providerProofLease({ observedAt: '2026-09-19T15:00:00.000Z' }, { maxAgeSeconds: 300, renewWindowSeconds: 60 });
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: expired,
    circuitState: closedCircuit(),
    runtime: healthyRuntime()
  }, NOW);

  assert.equal(result.state, 'RECOVERING');
  assert.equal(result.canSync, false);
  assert.equal(result.signals.provider, 'REPROOF_REQUIRED');
  assert.match(result.nextAction, /metadata proof/i);
});

test('proof due soon keeps sync running but is visible as degraded', () => {
  const due = providerProofLease({ observedAt: '2026-09-19T15:29:30.000Z' }, { maxAgeSeconds: 660, renewWindowSeconds: 600 });
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: due,
    circuitState: closedCircuit(),
    runtime: healthyRuntime()
  }, NOW);

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.canSync, true);
  assert.equal(result.signals.provider, 'REPROOF_DUE');
});

test('open provider circuit cannot be shown as healthy or syncing', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: providerProofLease(),
    circuitState: {
      reviewedDigest: review.reviewedDigest,
      status: 'OPEN',
      failureCount: 5,
      windowStartedAt: NOW - 10000,
      openedAt: NOW - 1000,
      lastFailureAt: NOW - 1000,
      lastSuccessAt: NOW - 2000
    },
    runtime: healthyRuntime()
  }, NOW);

  assert.equal(result.state, 'RECOVERING');
  assert.equal(result.canSync, false);
  assert.equal(result.signals.runtime, 'PAUSED');
});

test('unreconciled latest sync is attention-required even when provider is reachable', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: providerProofLease(),
    circuitState: closedCircuit(),
    runtime: healthyRuntime({ lastReconciliationAt: '2026-09-19T15:38:00.000Z' })
  }, NOW);

  assert.equal(result.state, 'ATTENTION_REQUIRED');
  assert.equal(result.canSync, false);
  assert.equal(result.signals.provider, 'AVAILABLE');
});

test('stale but reconciled data is degraded rather than falsely healthy', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: providerProofLease(),
    circuitState: closedCircuit(),
    runtime: healthyRuntime({
      lastSyncAt: '2026-09-19T15:20:00.000Z',
      lastReconciliationAt: '2026-09-19T15:20:10.000Z'
    })
  }, NOW);

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.canSync, true);
});

test('summary never echoes credentials, raw payloads or provider rows', () => {
  const result = summarizeConnectionHealth(review, {
    currentConfig: config,
    activationEvidence: approvedEvidence(),
    providerProofLease: providerProofLease(),
    circuitState: closedCircuit(),
    runtime: {
      ...healthyRuntime(),
      credential: 'do-not-echo',
      rawPayload: { employee: 'do-not-echo' },
      rows: [{ payroll: 'do-not-echo' }]
    }
  }, NOW);
  const rendered = JSON.stringify(result);

  assert.equal(rendered.includes('do-not-echo'), false);
  assert.equal(rendered.includes('vault://integration/provider-a'), false);
});
