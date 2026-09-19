'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewConnection, approvalFor } = require('./connection-proof-gate.cjs');
const { seedAuthorityFence } = require('./source-authority-fence.cjs');
const { makeDurableStageReceipt, validateDurableStageReceipt, gateMappedObservation } = require('./runtime-ingestion-gate.cjs');

const NOW = Date.parse('2026-09-19T13:44:00.000Z');

function config(overrides = {}) {
  return {
    connectionId: 'netsuite-sandbox-a',
    tenantId: 'tenant-a',
    providerKey: 'oracle-netsuite',
    transport: 'api',
    targetIdentity: '1234567-sb1',
    environment: 'sandbox',
    auth: { method: 'oauth2', credentialRef: 'vault://integration/netsuite-sandbox-a' },
    mapping: { version: 2, digest: 'a'.repeat(64) },
    authority: [{ capability: 'worker.profile', sourceId: 'netsuite-sandbox-a' }],
    monitoring: { maxFreshnessSeconds: 900, maxLatencyMs: 5000 },
    ...overrides
  };
}

function evidence(review) {
  const base = {
    connectionTest: {
      status: 'PASS',
      reviewedDigest: review.reviewedDigest,
      nonMutating: true,
      measuredLatencyMs: 120,
      observedAt: '2026-09-19T13:40:00.000Z',
      targetProof: {
        providerKey: review.providerKey,
        targetIdentity: review.targetIdentity,
        environment: review.environment,
        method: 'provider-metadata',
        observedAt: '2026-09-19T13:40:00.000Z',
        boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: {
      status: 'APPROVED',
      reviewedDigest: review.reviewedDigest,
      mappingVersion: review.mapping.version,
      observedAt: '2026-09-19T13:41:00.000Z'
    },
    reconciliation: {
      status: 'PASS',
      reviewedDigest: review.reviewedDigest,
      mappingVersion: review.mapping.version,
      observedAt: '2026-09-19T13:42:00.000Z'
    }
  };
  return {
    ...base,
    approval: approvalFor(review, { approvedBy: 'integration-owner-a', role: 'integration-owner' }, base, Date.parse('2026-09-19T13:43:00.000Z'))
  };
}

function observation(review, overrides = {}) {
  return {
    capability: 'worker.profile',
    sourceId: review.connectionId,
    reviewedDigest: review.reviewedDigest,
    mappingVersion: review.mapping.version,
    sourceEpoch: 'suiteql-watermark-v1',
    sourceOrdinal: '10',
    evidenceDigest: 'b'.repeat(64),
    observedAt: '2026-09-19T13:43:20.000Z',
    ...overrides
  };
}

function closedCircuit(review) {
  return { reviewedDigest: review.reviewedDigest, status: 'CLOSED', failureCount: 0, windowStartedAt: null, openedAt: null, lastFailureAt: null, lastSuccessAt: NOW - 1000 };
}

function readyInput(review, cfg, first, next) {
  const fence = seedAuthorityFence(review, first);
  const stageReceipt = makeDurableStageReceipt(review, next, {
    operationKey: 'netsuite-worker-profile-11',
    stagedAt: '2026-09-19T13:43:31.000Z',
    durable: true
  }, NOW);
  return {
    currentConfig: cfg,
    activationEvidence: evidence(review),
    circuitState: closedCircuit(review),
    fence,
    observation: next,
    stageReceipt
  };
}

test('approved closed-circuit observation is ready only after durable staging', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const first = observation(review);
  const next = observation(review, { sourceOrdinal: '11', evidenceDigest: 'c'.repeat(64), observedAt: '2026-09-19T13:43:30.000Z' });
  const result = gateMappedObservation(review, readyInput(review, cfg, first, next), NOW);
  assert.equal(result.action, 'READY_TO_APPLY');
  assert.equal(result.nextFence.sourceOrdinal, '11');
});

test('missing or tampered durable stage proof blocks apply', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const first = observation(review);
  const next = observation(review, { sourceOrdinal: '11', evidenceDigest: 'c'.repeat(64), observedAt: '2026-09-19T13:43:30.000Z' });
  const input = readyInput(review, cfg, first, next);
  assert.equal(gateMappedObservation(review, { ...input, stageReceipt: null }, NOW).reason, 'durable-stage-proof-invalid');
  const tampered = { ...input.stageReceipt, sourceOrdinal: '999' };
  const check = validateDurableStageReceipt(review, next, tampered, NOW);
  assert.equal(check.valid, false);
  assert.ok(check.blockers.some((x) => x.includes('source position')));
});

test('changed current configuration invalidates historic activation before data admission', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const first = observation(review);
  const next = observation(review, { sourceOrdinal: '11', evidenceDigest: 'c'.repeat(64), observedAt: '2026-09-19T13:43:30.000Z' });
  const input = readyInput(review, cfg, first, next);
  const changed = config({ targetIdentity: 'different-sandbox' });
  const result = gateMappedObservation(review, { ...input, currentConfig: changed }, NOW);
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.reason, 'activation-not-current');
});

test('open provider circuit pauses business ingestion and half-open permits safe probes only', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const first = observation(review);
  const next = observation(review, { sourceOrdinal: '11', evidenceDigest: 'c'.repeat(64), observedAt: '2026-09-19T13:43:30.000Z' });
  const input = readyInput(review, cfg, first, next);
  const openedAt = NOW - 1000;
  const open = { reviewedDigest: review.reviewedDigest, status: 'OPEN', failureCount: 4, windowStartedAt: openedAt - 1000, openedAt, lastFailureAt: openedAt, lastSuccessAt: NOW - 60000 };
  const paused = gateMappedObservation(review, { ...input, circuitState: open }, NOW);
  assert.equal(paused.action, 'PAUSE');
  const probeOnly = gateMappedObservation(review, { ...input, circuitState: { ...open, openedAt: NOW - 60000 } }, NOW);
  assert.equal(probeOnly.action, 'SAFE_PROBE_ONLY');
});

test('duplicate, stale and generation-reset observations preserve authority decisions', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const first = observation(review);
  const base = readyInput(review, cfg, first, observation(review, { sourceOrdinal: '11', evidenceDigest: 'c'.repeat(64), observedAt: '2026-09-19T13:43:30.000Z' }));

  const duplicate = gateMappedObservation(review, { ...base, observation: first, stageReceipt: null }, NOW);
  assert.equal(duplicate.action, 'NOOP');

  const stale = observation(review, { sourceOrdinal: '9', evidenceDigest: 'd'.repeat(64) });
  assert.equal(gateMappedObservation(review, { ...base, observation: stale, stageReceipt: null }, NOW).action, 'QUARANTINE');

  const reset = observation(review, { sourceEpoch: 'suiteql-watermark-v2', sourceOrdinal: '1', evidenceDigest: 'e'.repeat(64) });
  assert.equal(gateMappedObservation(review, { ...base, observation: reset, stageReceipt: null }, NOW).action, 'RECONCILE_BEFORE_APPLY');
});

test('future-dated observation cannot mint a durable apply receipt', () => {
  const cfg = config();
  const review = reviewConnection(cfg);
  const future = observation(review, { observedAt: '2026-09-19T13:45:00.000Z' });
  assert.throws(() => makeDurableStageReceipt(review, future, {
    operationKey: 'netsuite-worker-profile-future',
    stagedAt: '2026-09-19T13:43:59.000Z',
    durable: true
  }, NOW), /future/);
});
