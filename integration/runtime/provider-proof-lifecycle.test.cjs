'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderProofLease, evaluateProviderProofLease, renewProviderProofLease } = require('./provider-proof-lifecycle.cjs');

const NOW = Date.parse('2026-09-19T19:43:00.000Z');
const review = {
  reviewedDigest: 'a'.repeat(64),
  connectionId: 'netsuite-sandbox-a',
  providerKey: 'oracle-netsuite',
  targetIdentity: '1234567-sb1',
  environment: 'sandbox'
};

function proof(overrides = {}) {
  return {
    status: 'PASS',
    reviewedDigest: review.reviewedDigest,
    providerKey: review.providerKey,
    targetIdentity: review.targetIdentity,
    environment: review.environment,
    observedAt: '2026-09-19T19:40:00.000Z',
    metadataDigest: 'b'.repeat(64),
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false,
    ...overrides
  };
}

test('current proof lease permits business traffic and becomes due before expiry', () => {
  const lease = createProviderProofLease(review, proof(), { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW);
  assert.equal(evaluateProviderProofLease(review, lease, NOW).state, 'CURRENT');
  assert.equal(evaluateProviderProofLease(review, lease, Date.parse('2026-09-19T20:31:00.000Z')).state, 'REPROOF_DUE');
});

test('expired proof fails closed for new business traffic', () => {
  const lease = createProviderProofLease(review, proof(), { maxAgeSeconds: 300, renewWindowSeconds: 60 }, NOW);
  const result = evaluateProviderProofLease(review, lease, Date.parse('2026-09-19T19:46:00.000Z'));
  assert.equal(result.state, 'REPROOF_REQUIRED');
  assert.equal(result.canUseForBusinessTraffic, false);
});

test('tampering or cross-target lease reuse is blocked', () => {
  const lease = createProviderProofLease(review, proof(), { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW);
  assert.equal(evaluateProviderProofLease(review, { ...lease, metadataDigest: 'c'.repeat(64) }, NOW).state, 'BLOCKED');
  assert.equal(evaluateProviderProofLease({ ...review, targetIdentity: 'different-account' }, lease, NOW).state, 'BLOCKED');
});

test('same-metadata re-proof preserves customer activation approval', () => {
  const lease = createProviderProofLease(review, proof(), { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW);
  const renewed = renewProviderProofLease(review, lease, proof({ observedAt: '2026-09-19T20:40:00.000Z' }), {}, Date.parse('2026-09-19T20:43:00.000Z'));
  assert.equal(renewed.approvalDisposition, 'PRESERVE_EXISTING_APPROVAL');
  assert.equal(renewed.mappingReviewRequired, false);
});

test('provider metadata change requires review instead of silently preserving approval', () => {
  const lease = createProviderProofLease(review, proof(), { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW);
  const renewed = renewProviderProofLease(review, lease, proof({ observedAt: '2026-09-19T20:40:00.000Z', metadataDigest: 'd'.repeat(64) }), {}, Date.parse('2026-09-19T20:43:00.000Z'));
  assert.equal(renewed.approvalDisposition, 'REVIEW_REQUIRED');
  assert.equal(renewed.mappingReviewRequired, true);
});

test('unsafe or future provider proof cannot mint a lease', () => {
  assert.throws(() => createProviderProofLease(review, proof({ containsSensitiveData: true }), {}, NOW), /bounded metadata/);
  assert.throws(() => createProviderProofLease(review, proof({ observedAt: '2026-09-19T20:00:00.000Z' }), {}, NOW), /future/);
});
