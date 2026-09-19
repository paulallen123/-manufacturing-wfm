'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconciliationCheckpoint } = require('./transport-runtime-policy.cjs');
const {
  validateFence,
  seedAuthorityFence,
  evaluateAuthorityObservation,
  rebaseAuthorityFence
} = require('./source-authority-fence.cjs');

function review() {
  return {
    connectionId: 'sf-sandbox-a',
    transport: 'queue-stream',
    providerKey: 'sap-successfactors',
    targetIdentity: 'sandbox-a',
    environment: 'sandbox',
    reviewedDigest: 'a'.repeat(64),
    mapping: { version: 4 },
    authority: [
      { capability: 'worker.profile', sourceId: 'sf-sandbox-a' },
      { capability: 'worker.employment', sourceId: 'sf-sandbox-a' }
    ]
  };
}

function observation(overrides = {}) {
  return {
    capability: 'worker.profile',
    sourceId: 'sf-sandbox-a',
    reviewedDigest: 'a'.repeat(64),
    mappingVersion: 4,
    sourceEpoch: 'tenant-stream-v1',
    sourceOrdinal: '100',
    evidenceDigest: 'b'.repeat(64),
    observedAt: '2026-09-19T12:40:00.000Z',
    ...overrides
  };
}

test('newer source evidence advances the deterministic authority fence', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation());
  const result = evaluateAuthorityObservation(r, fence, observation({
    sourceOrdinal: '101',
    evidenceDigest: 'c'.repeat(64),
    observedAt: '2026-09-19T12:41:00.000Z'
  }));
  assert.equal(result.action, 'ACCEPT');
  assert.equal(result.nextFence.sourceOrdinal, '101');
  assert.equal(validateFence(r, result.nextFence).valid, true);
});

test('an exact replay is a no-op rather than a second apply', () => {
  const r = review();
  const first = observation();
  const fence = seedAuthorityFence(r, first);
  const result = evaluateAuthorityObservation(r, fence, first);
  assert.equal(result.action, 'DUPLICATE_NOOP');
  assert.equal(result.nextFence.fenceDigest, fence.fenceDigest);
});

test('late source evidence is quarantined instead of overwriting newer truth', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation({ sourceOrdinal: '500' }));
  const result = evaluateAuthorityObservation(r, fence, observation({ sourceOrdinal: '499', evidenceDigest: 'c'.repeat(64) }));
  assert.equal(result.action, 'QUARANTINE');
  assert.equal(result.reason, 'stale-source-observation');
});

test('different evidence at the same source position fails closed', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation());
  const result = evaluateAuthorityObservation(r, fence, observation({ evidenceDigest: 'd'.repeat(64) }));
  assert.equal(result.action, 'QUARANTINE');
  assert.equal(result.reason, 'same-position-conflict');
});

test('source generation changes require reconciliation before apply', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation());
  const result = evaluateAuthorityObservation(r, fence, observation({
    sourceEpoch: 'tenant-stream-v2',
    sourceOrdinal: '1',
    evidenceDigest: 'e'.repeat(64)
  }));
  assert.equal(result.action, 'RECONCILE_BEFORE_APPLY');
  assert.equal(result.nextFence, null);
});

test('wrong authority, stale mapping or changed review cannot enter the fence', () => {
  const r = review();
  assert.throws(() => seedAuthorityFence(r, observation({ sourceId: 'other-connection' })), /authoritative source/);
  assert.throws(() => seedAuthorityFence(r, observation({ mappingVersion: 3 })), /stale or unreviewed/);
  assert.throws(() => seedAuthorityFence(r, observation({ reviewedDigest: 'f'.repeat(64) })), /exact reviewed connection/);
});

test('tampering with an accepted fence is detected before later data can apply', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation());
  const tampered = { ...fence, sourceOrdinal: '999' };
  const result = evaluateAuthorityObservation(r, tampered, observation({ sourceOrdinal: '1000', evidenceDigest: 'c'.repeat(64) }));
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.reason, 'invalid-authority-fence');
  assert.ok(result.blockers.some((item) => item.includes('integrity')));
});

test('generation rebase requires exact reconciliation and explicit approval', () => {
  const r = review();
  const fence = seedAuthorityFence(r, observation());
  const checkpoint = reconciliationCheckpoint(r, {
    mappingVersion: 4,
    sourceCursor: 'tenant-stream-v2:1',
    sourceDigest: '9'.repeat(64),
    stagedDigest: '9'.repeat(64),
    operationKey: 'rebase-worker-profile'
  });
  const nextObservation = observation({
    sourceEpoch: 'tenant-stream-v2',
    sourceOrdinal: '1',
    evidenceDigest: '9'.repeat(64),
    observedAt: '2026-09-19T12:42:00.000Z'
  });

  assert.throws(() => rebaseAuthorityFence(r, fence, {
    observation: nextObservation,
    reconciliationCheckpoint: checkpoint,
    approval: { decision: 'APPROVED', reviewedDigest: r.reviewedDigest },
    explicitRebaseApproval: false
  }), /explicit approval/);

  const rebased = rebaseAuthorityFence(r, fence, {
    observation: nextObservation,
    reconciliationCheckpoint: checkpoint,
    approval: { decision: 'APPROVED', reviewedDigest: r.reviewedDigest },
    explicitRebaseApproval: true
  });
  assert.equal(rebased.sourceEpoch, 'tenant-stream-v2');
  assert.equal(rebased.sourceOrdinal, '1');
  assert.equal(validateFence(r, rebased).valid, true);
});
