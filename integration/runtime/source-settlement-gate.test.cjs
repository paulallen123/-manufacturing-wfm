'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection } = require('./connection-proof-gate.cjs');
const { makeDurableStageReceipt } = require('./runtime-ingestion-gate.cjs');
const { evaluateSourceSettlement } = require('./source-settlement-gate.cjs');

const NOW = Date.parse('2026-09-19T15:50:00.000Z');

function makeReview(transport, authMethod) {
  return reviewConnection({
    connectionId: `${transport}-sandbox-a`,
    tenantId: 'tenant-a',
    providerKey: 'provider-a',
    transport,
    targetIdentity: 'sandbox-a',
    environment: 'sandbox',
    auth: { method: authMethod, credentialRef: 'vault://integration/provider-a' },
    mapping: { version: 1, digest: 'a'.repeat(64) },
    authority: [{ capability: 'worker.profile', sourceId: `${transport}-sandbox-a` }],
    monitoring: { maxFreshnessSeconds: 300, maxLatencyMs: 2000 },
    transportOptions: transport === 'read-only-db' ? { readOnly: true, queryMode: 'read-only' } : undefined
  });
}

function observation(digest = 'b'.repeat(64)) {
  return {
    capability: 'worker.profile',
    sourceEpoch: 'source-v1',
    sourceOrdinal: '42',
    evidenceDigest: digest,
    observedAt: '2026-09-19T15:49:00.000Z'
  };
}

function staged(review, item = observation()) {
  return makeDurableStageReceipt(review, item, {
    operationKey: `${review.transport}-worker-profile-42`,
    stagedAt: '2026-09-19T15:49:01.000Z',
    durable: true
  }, NOW);
}

test('queue acknowledgement is blocked until the exact observation is durably staged', () => {
  const review = makeReview('queue-stream', 'oauth2');
  const item = observation();

  const blocked = evaluateSourceSettlement(review, item, null, {}, NOW);
  assert.equal(blocked.action, 'BLOCK');
  assert.equal(blocked.safe, false);

  const allowed = evaluateSourceSettlement(review, item, staged(review, item), {}, NOW);
  assert.equal(allowed.action, 'ACKNOWLEDGE_OR_COMMIT');
  assert.equal(allowed.safe, true);
});

test('tampered durable stage proof cannot acknowledge the source', () => {
  const review = makeReview('webhook', 'oauth2');
  const item = observation();
  const receipt = { ...staged(review, item), sourceOrdinal: '43' };

  const result = evaluateSourceSettlement(review, item, receipt, {}, NOW);
  assert.equal(result.action, 'BLOCK');
  assert.match(result.reason, /durable-stage/);
});

test('secure file cannot be marked processed without completeness and exact digest proof', () => {
  const review = makeReview('secure-file', 'sftp-key-ref');
  const item = observation('c'.repeat(64));
  const receipt = staged(review, item);

  const incomplete = evaluateSourceSettlement(review, item, receipt, {
    fileCompletenessVerified: false,
    sourceArtifactDigest: item.evidenceDigest
  }, NOW);
  assert.equal(incomplete.action, 'BLOCK');

  const wrongDigest = evaluateSourceSettlement(review, item, receipt, {
    fileCompletenessVerified: true,
    sourceArtifactDigest: 'd'.repeat(64)
  }, NOW);
  assert.equal(wrongDigest.action, 'BLOCK');

  const allowed = evaluateSourceSettlement(review, item, receipt, {
    fileCompletenessVerified: true,
    sourceArtifactDigest: item.evidenceDigest
  }, NOW);
  assert.equal(allowed.action, 'MARK_PROCESSED');
  assert.equal(allowed.safe, true);
});

test('polling transports do not invent an external acknowledgement step', () => {
  const review = makeReview('api', 'oauth2');
  const result = evaluateSourceSettlement(review, observation(), null, {}, NOW);

  assert.equal(result.action, 'NO_EXTERNAL_SETTLEMENT');
  assert.equal(result.safe, true);
});
