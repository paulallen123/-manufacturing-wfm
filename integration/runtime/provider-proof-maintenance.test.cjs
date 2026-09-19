'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const {
  planProviderProofMaintenance,
  completeProviderProofMaintenance
} = require('./provider-proof-maintenance.cjs');

const NOW = Date.parse('2026-09-19T20:45:00.000Z');
const review = {
  reviewedDigest: 'a'.repeat(64),
  connectionId: 'netsuite-sandbox-a',
  providerKey: 'oracle-netsuite',
  targetIdentity: '1234567-sb1',
  environment: 'sandbox',
  transport: 'api'
};

function verifiedProof(overrides = {}) {
  return {
    status: 'PASS',
    reviewedDigest: review.reviewedDigest,
    providerKey: review.providerKey,
    targetIdentity: review.targetIdentity,
    environment: review.environment,
    observedAt: '2026-09-19T20:40:00.000Z',
    metadataDigest: 'b'.repeat(64),
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false,
    ...overrides
  };
}

function lease(proofOverrides = {}, options = {}) {
  return createProviderProofLease(review, verifiedProof(proofOverrides), {
    maxAgeSeconds: 3600,
    renewWindowSeconds: 600,
    ...options
  }, NOW);
}

function closedCircuit() {
  return {
    reviewedDigest: review.reviewedDigest,
    status: 'CLOSED',
    failureCount: 0,
    lastSuccessAt: NOW - 1000
  };
}

test('current proof and closed provider circuit require no maintenance', () => {
  const result = planProviderProofMaintenance(review, {
    providerProofLease: lease(),
    circuitState: closedCircuit()
  }, NOW);

  assert.equal(result.action, 'NONE');
  assert.equal(result.canUseForBusinessTraffic, true);
});

test('proof due soon schedules a safe refresh without pausing business traffic', () => {
  const dueLease = lease(
    { observedAt: '2026-09-19T20:35:00.000Z' },
    { maxAgeSeconds: 1200, renewWindowSeconds: 900 }
  );
  const result = planProviderProofMaintenance(review, {
    providerProofLease: dueLease,
    circuitState: closedCircuit()
  }, NOW);

  assert.equal(result.state, 'REPROOF_SCHEDULED');
  assert.equal(result.action, 'RUN_SAFE_PROVIDER_PROOF');
  assert.equal(result.canUseForBusinessTraffic, true);
  assert.equal(result.task.nonMutating, true);
  assert.equal(result.task.writeAllowed, false);
  assert.equal(result.task.workforcePayloadAllowed, false);
});

test('expired proof pauses business traffic and schedules only bounded re-proof', () => {
  const expiredLease = lease(
    { observedAt: '2026-09-19T20:30:00.000Z' },
    { maxAgeSeconds: 300, renewWindowSeconds: 60 }
  );
  const result = planProviderProofMaintenance(review, {
    providerProofLease: expiredLease,
    circuitState: closedCircuit()
  }, NOW);

  assert.equal(result.state, 'REPROOF_REQUIRED');
  assert.equal(result.canUseForBusinessTraffic, false);
  assert.equal(result.task.proofMode, 'BOUNDED_METADATA_ONLY');
  assert.equal(result.task.businessApplyAllowed, false);
  assert.equal(result.task.responseBodyRetentionAllowed, false);
});

test('open provider circuit waits for the recovery window instead of hammering the provider', () => {
  const result = planProviderProofMaintenance(review, {
    providerProofLease: lease(),
    circuitState: {
      reviewedDigest: review.reviewedDigest,
      status: 'OPEN',
      failureCount: 4,
      windowStartedAt: NOW - 1000,
      openedAt: NOW - 1000,
      lastFailureAt: NOW - 1000
    }
  }, NOW);

  assert.equal(result.action, 'WAIT_FOR_RECOVERY_WINDOW');
  assert.equal(result.canUseForBusinessTraffic, false);
  assert.ok(result.executeNotBefore);
});

test('half-open provider state runs one recovery probe and can combine overdue identity refresh', () => {
  const expiredLease = lease(
    { observedAt: '2026-09-19T20:30:00.000Z' },
    { maxAgeSeconds: 300, renewWindowSeconds: 60 }
  );
  const result = planProviderProofMaintenance(review, {
    providerProofLease: expiredLease,
    circuitState: {
      reviewedDigest: review.reviewedDigest,
      status: 'OPEN',
      failureCount: 4,
      windowStartedAt: NOW - 60000,
      openedAt: NOW - 60000,
      lastFailureAt: NOW - 60000
    }
  }, NOW);

  assert.equal(result.action, 'RUN_SAFE_RECOVERY_PROBE');
  assert.equal(result.task.reconciliationRequired, true);
  assert.equal(result.task.refreshProviderProof, true);
  assert.equal(result.task.mayResumeBusinessTrafficAfterSuccess, false);
});

test('maintenance task key is deterministic for the same exact provider state', () => {
  const dueLease = lease(
    { observedAt: '2026-09-19T20:35:00.000Z' },
    { maxAgeSeconds: 1200, renewWindowSeconds: 900 }
  );
  const input = { providerProofLease: dueLease, circuitState: closedCircuit() };
  const first = planProviderProofMaintenance(review, input, NOW);
  const second = planProviderProofMaintenance(review, input, NOW + 1000);

  assert.equal(first.task.taskKey, second.task.taskKey);
});

test('same-metadata maintenance preserves approval while changed metadata blocks for review', () => {
  const currentLease = lease();
  const same = completeProviderProofMaintenance(
    review,
    currentLease,
    verifiedProof({ observedAt: '2026-09-19T20:44:00.000Z' }),
    {},
    NOW
  );
  assert.equal(same.approvalDisposition, 'PRESERVE_EXISTING_APPROVAL');
  assert.equal(same.businessTrafficDisposition, 'ELIGIBLE_AFTER_RUNTIME_GATES');

  const changed = completeProviderProofMaintenance(
    review,
    currentLease,
    verifiedProof({ observedAt: '2026-09-19T20:44:00.000Z', metadataDigest: 'c'.repeat(64) }),
    {},
    NOW
  );
  assert.equal(changed.approvalDisposition, 'REVIEW_REQUIRED');
  assert.equal(changed.businessTrafficDisposition, 'BLOCK_FOR_REVIEW');
});

test('invalid prior proof anchor cannot silently preserve customer approval', () => {
  const currentLease = lease();
  const tampered = { ...currentLease, metadataDigest: 'd'.repeat(64) };
  const result = completeProviderProofMaintenance(
    review,
    tampered,
    verifiedProof({ observedAt: '2026-09-19T20:44:00.000Z' }),
    {},
    NOW
  );

  assert.equal(result.approvalDisposition, 'REVIEW_REQUIRED');
  assert.equal(result.mappingReviewRequired, true);
  assert.equal(result.businessTrafficDisposition, 'BLOCK_FOR_REVIEW');
});

test('maintenance output never echoes arbitrary credentials or provider payloads', () => {
  const dueLease = lease(
    { observedAt: '2026-09-19T20:35:00.000Z' },
    { maxAgeSeconds: 1200, renewWindowSeconds: 900 }
  );
  const result = planProviderProofMaintenance(review, {
    providerProofLease: dueLease,
    circuitState: closedCircuit(),
    credential: 'do-not-echo',
    rawPayload: { employee: 'do-not-echo' }
  }, NOW);
  const rendered = JSON.stringify(result);

  assert.equal(rendered.includes('do-not-echo'), false);
});
