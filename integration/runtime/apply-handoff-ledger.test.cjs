'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApplyIntent, markApplyOutcome, evaluateApplyHandoff } = require('./apply-handoff-ledger.cjs');

const NOW = Date.parse('2026-09-19T14:45:00.000Z');
const review = { reviewedDigest: 'a'.repeat(64), connectionId: 'netsuite-sandbox-a' };
const observation = {
  capability: 'worker.profile',
  sourceEpoch: 'suiteql-watermark-v1',
  sourceOrdinal: '11',
  evidenceDigest: 'b'.repeat(64)
};
const stageReceipt = {
  reviewedDigest: review.reviewedDigest,
  connectionId: review.connectionId,
  capability: observation.capability,
  sourceEpoch: observation.sourceEpoch,
  sourceOrdinal: observation.sourceOrdinal,
  evidenceDigest: observation.evidenceDigest,
  operationKey: 'netsuite-worker-profile-11',
  stageDigest: 'c'.repeat(64)
};

function intent() {
  return makeApplyIntent(review, observation, stageReceipt, {
    recordedAt: '2026-09-19T14:44:00.000Z',
    durable: true,
    idempotencyEnforced: true
  }, NOW);
}

test('missing durable intent blocks WFM apply', () => {
  const decision = evaluateApplyHandoff(review, observation, stageReceipt, null, NOW);
  assert.equal(decision.action, 'BLOCK');
  assert.equal(decision.reason, 'durable-apply-intent-required');
});

test('durable idempotent intent allows first apply or safe retry with same operation key', () => {
  const entry = intent();
  const decision = evaluateApplyHandoff(review, observation, stageReceipt, entry, NOW);
  assert.equal(decision.action, 'APPLY_OR_RETRY_SAFE');
  assert.equal(decision.operationKey, stageReceipt.operationKey);
});

test('applied outcome advances authority without reapplying business effect', () => {
  const entry = markApplyOutcome(intent(), {
    status: 'APPLIED',
    recordedAt: '2026-09-19T14:44:10.000Z',
    durable: true,
    effectDigest: 'd'.repeat(64)
  }, NOW);
  const decision = evaluateApplyHandoff(review, observation, stageReceipt, entry, NOW);
  assert.equal(decision.action, 'ADVANCE_FENCE_NO_APPLY');
});

test('ambiguous prior apply forces reconciliation before retry', () => {
  const entry = markApplyOutcome(intent(), {
    status: 'AMBIGUOUS',
    recordedAt: '2026-09-19T14:44:10.000Z',
    durable: true
  }, NOW);
  const decision = evaluateApplyHandoff(review, observation, stageReceipt, entry, NOW);
  assert.equal(decision.action, 'RECONCILE_BEFORE_APPLY');
});

test('tampered or cross-observation handoff fails closed', () => {
  const entry = intent();
  const tampered = { ...entry, operationKey: 'different-operation' };
  assert.equal(evaluateApplyHandoff(review, observation, stageReceipt, tampered, NOW).action, 'BLOCK');

  const other = { ...observation, sourceOrdinal: '12' };
  assert.equal(evaluateApplyHandoff(review, other, stageReceipt, entry, NOW).action, 'BLOCK');
});

test('automated apply intent refuses non-idempotent business application', () => {
  assert.throws(() => makeApplyIntent(review, observation, stageReceipt, {
    recordedAt: '2026-09-19T14:44:00.000Z',
    durable: true,
    idempotencyEnforced: false
  }, NOW), /idempotency/);
});
