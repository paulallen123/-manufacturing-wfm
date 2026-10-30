'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const target = process.env.V085_TEST_ROOT;
assert.ok(target, 'V085_TEST_ROOT must identify the immutable review target');
const { reviewConnection, approvalFor, evaluateRuntimeHealth } = require(path.join(target, 'integration/runtime/connection-proof-gate.cjs'));
const { createProviderProofLease } = require(path.join(target, 'integration/runtime/provider-proof-lifecycle.cjs'));
const { summarizeConnectionHealth } = require(path.join(target, 'integration/runtime/connection-health-summary.cjs'));

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const iso = (offset) => new Date(NOW + offset).toISOString();
const SECRET = 'V085_HELDOUT_SECRET_NOT_FOR_OUTPUT';
const CONFIG = {
  connectionId: 'heldout-v085-source', tenantId: 'heldout-tenant',
  providerKey: 'heldout-provider', transport: 'api', targetIdentity: 'heldout-sandbox',
  environment: 'sandbox', auth: { method: 'oauth2', credentialRef: 'vault://heldout/provider' },
  mapping: { version: 7, digest: 'a'.repeat(64) },
  authority: [{ capability: 'worker.profile', sourceId: 'heldout-v085-source' }],
  monitoring: { maxFreshnessSeconds: 600, maxLatencyMs: 2000 }
};
const review = reviewConnection(CONFIG);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
freeze(review);

function activationEvidence() {
  const evidence = {
    connectionTest: {
      status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true,
      measuredLatencyMs: 23, observedAt: iso(-120000),
      targetProof: {
        providerKey: review.providerKey, targetIdentity: review.targetIdentity,
        environment: review.environment, method: 'provider-account-identity',
        observedAt: iso(-120000), boundedMetadataOnly: true, containsSensitiveData: false
      }
    },
    mappingReview: { status: 'APPROVED', reviewedDigest: review.reviewedDigest, mappingVersion: 7, observedAt: iso(-110000) },
    reconciliation: { status: 'PASS', reviewedDigest: review.reviewedDigest, mappingVersion: 7, observedAt: iso(-100000) }
  };
  evidence.approval = approvalFor(review, { approvedBy: 'heldout-local-test-actor', role: 'integration-owner' }, evidence, NOW - 90000);
  evidence.rawProviderResponse = SECRET;
  return evidence;
}

function runtime(overrides = {}) {
  return {
    reviewedDigest: review.reviewedDigest,
    lastSyncAt: iso(-60000), lastReconciliationAt: iso(-59000), measuredLatencyMs: 100,
    authorityConflict: false, retryExhausted: false, quarantined: 0, pendingRetries: 0,
    rawEmployeeRecord: SECRET, credentialValue: SECRET, ...overrides
  };
}

function lease(kind) {
  const observedAt = kind === 'due' ? iso(-3300000) : kind === 'expired' ? iso(-3700000) : iso(-60000);
  return createProviderProofLease(review, {
    status: 'PASS', reviewedDigest: review.reviewedDigest, providerKey: review.providerKey,
    targetIdentity: review.targetIdentity, environment: review.environment,
    observedAt, metadataDigest: 'b'.repeat(64), boundedMetadataOnly: true,
    containsSensitiveData: false, responseBodyRetained: false
  }, { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW);
}

function input(overrides = {}, state = 'IDLE', proof = 'current') {
  return {
    currentConfig: structuredClone(CONFIG), activationEvidence: activationEvidence(),
    providerProofLease: lease(proof),
    circuitState: { reviewedDigest: review.reviewedDigest, status: 'CLOSED', failureCount: 0, lastSuccessAt: NOW - 1000, authorization: SECRET },
    runtime: runtime(overrides),
    maintenanceExecution: { state, claimToken: SECRET, rawProviderResponse: SECRET, errorDetails: SECRET },
    accessToken: SECRET
  };
}

function checkedSummary(candidate, now = NOW) {
  const before = structuredClone(candidate);
  freeze(candidate);
  const result = summarizeConnectionHealth(review, candidate, now);
  assert.deepEqual(candidate, before, 'health summary mutated supplied input');
  assert.equal(JSON.stringify(result).includes(SECRET), false, 'sensitive unknown fields escaped into output');
  return result;
}

for (const offset of [0, 4999, 5000, 5001, 10000, 86400000]) {
  for (const shape of ['reconciliation-only', 'both']) {
    test(`runtime ${shape} clock offset ${offset}ms has independently expected trust state`, () => {
      const future = iso(offset);
      const supplied = runtime(shape === 'both' ? { lastSyncAt: future, lastReconciliationAt: future } : { lastReconciliationAt: future });
      const before = structuredClone(supplied);
      freeze(supplied);
      const result = evaluateRuntimeHealth(review, supplied, NOW);
      assert.equal(result.state, offset <= 5000 ? 'HEALTHY' : 'BLOCKED');
      if (offset > 5000) assert.match(result.blockers.join(' '), /reconciliation.*future/i);
      assert.deepEqual(supplied, before);
      assert.equal(JSON.stringify(result).includes(SECRET), false);
    });
  }
}

test('future sync alone is rejected independently of the separate unreconciled-sync blocker', () => {
  const result = evaluateRuntimeHealth(review, runtime({ lastSyncAt: iso(5001) }), NOW);
  assert.equal(result.state, 'BLOCKED');
  assert.match(result.blockers.join(' '), /sync.*future/i);
  assert.match(result.blockers.join(' '), /not been reconciled/i);
});

const blockers = [
  ['future reconciliation', { lastReconciliationAt: iso(5001) }],
  ['future sync and reconciliation', { lastSyncAt: iso(5001), lastReconciliationAt: iso(5001) }],
  ['authority conflict', { authorityConflict: true }],
  ['review digest drift', { reviewedDigest: 'c'.repeat(64) }],
  ['unreconciled sync', { lastReconciliationAt: iso(-61000) }],
  ['missing sync evidence', { lastSyncAt: null }],
  ['malformed reconciliation', { lastReconciliationAt: 'not-a-date' }],
  ['recovery exhausted', { retryExhausted: true }],
  ['quarantined payload', { quarantined: 1 }],
  ['missing measured latency', { measuredLatencyMs: undefined }]
];
const executionStates = ['IDLE', 'SUCCESS', 'SUCCEEDED', 'CLAIM_EXPIRED', 'COMPLETION_UNCERTAIN', ' claim_expired ', ' completion_uncertain '];
for (const proof of ['current', 'due']) {
  for (const state of executionStates) {
    for (const [name, values] of blockers) {
      test(`${proof} proof / ${JSON.stringify(state)} cannot bypass ${name}`, () => {
        const result = checkedSummary(input(values, state, proof));
        assert.equal(result.canSync, false);
        assert.equal(result.state, 'ATTENTION_REQUIRED');
        assert.equal(result.signals.runtime, 'BLOCKED');
      });
    }
  }
}

for (const proof of ['current', 'due']) {
  for (const state of executionStates) {
    test(`${proof} proof / ${JSON.stringify(state)} preserves permitted sync at the +5000ms boundary`, () => {
      const result = checkedSummary(input({ lastSyncAt: iso(5000), lastReconciliationAt: iso(5000) }, state, proof));
      assert.equal(result.canSync, true);
      assert.notEqual(result.signals.runtime, 'BLOCKED');
    });
  }
}

const invalidClocks = [
  ['NaN', NaN], ['positive infinity', Infinity], ['negative infinity', -Infinity],
  ['null', null], ['empty string', ''], ['numeric string', String(NOW)],
  ['ISO string', iso(0)], ['boolean', false], ['empty object', {}], ['array', []],
  ['Date object', new Date(NOW)]
];
for (const [name, now] of invalidClocks) {
  test(`runtime explicitly rejects invalid clock ${name}`, () => {
    const result = evaluateRuntimeHealth(review, freeze(runtime()), now);
    assert.equal(result.state, 'BLOCKED');
    assert.match(result.blockers.join(' '), /clock.*invalid/i);
  });
  for (const state of ['IDLE', 'CLAIM_EXPIRED', 'COMPLETION_UNCERTAIN']) {
    test(`summary invalid clock ${name} cannot continue with ${state}`, () => {
      const result = checkedSummary(input({}, state), now);
      assert.equal(result.canSync, false);
    });
  }
}

for (const state of ['CLAIM_EXPIRED', 'COMPLETION_UNCERTAIN']) {
  test(`expired proof / ${state} remains paused when runtime also has a blocker`, () => {
    const result = checkedSummary(input({ authorityConflict: true }, state, 'expired'));
    assert.equal(result.canSync, false);
  });
  test(`setup approval remains mandatory for ${state}`, () => {
    const supplied = input({}, state);
    delete supplied.activationEvidence.approval;
    const result = checkedSummary(supplied);
    assert.equal(result.state, 'SETUP_REQUIRED');
    assert.equal(result.canSync, false);
  });
  test(`invalid circuit remains blocked for ${state}`, () => {
    const supplied = input({}, state);
    supplied.circuitState.status = 'INVALID';
    const result = checkedSummary(supplied);
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.canSync, false);
  });
}
