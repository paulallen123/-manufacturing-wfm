'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSetupDescriptor,
  classifyFailure,
  nextRetryDecision,
  reconciliationCheckpoint,
  validateReconciliationCheckpoint,
  evaluateRecoveryCompletion
} = require('./transport-runtime-policy.cjs');

function review(transport = 'api') {
  return {
    transport,
    providerKey: 'sap-successfactors',
    targetIdentity: 'sandbox-a',
    environment: 'sandbox',
    reviewedDigest: 'a'.repeat(64)
  };
}

test('customer setup is metadata driven and never requests a raw secret value', () => {
  const setup = buildSetupDescriptor(review('secure-file'));
  assert.equal(setup.mappingConfiguredSeparately, true);
  assert.equal(setup.businessRulesConfiguredSeparately, true);
  assert.equal(setup.explicitActivationApprovalRequired, true);
  assert.ok(setup.customerInputs.some(x => x.key === 'credentialRef' && x.protectedReferenceRequired));
  assert.ok(setup.customerInputs.every(x => x.secretValueAccepted === false));
  assert.equal(setup.safeDefaults.mode, 'pull-read-only');
});

test('unsafe or ambiguous failures fail closed while transient provider failures retry', () => {
  assert.equal(classifyFailure({ status: 503 }).disposition, 'RETRY');
  assert.equal(classifyFailure({ status: 401 }).disposition, 'REAUTHORIZE');
  assert.equal(classifyFailure({ code: 'write-attempt' }).disposition, 'BLOCK');
  assert.equal(classifyFailure({ code: 'mystery-error' }).disposition, 'BLOCK');
});

test('duplicate-sensitive transports require an operation key before retry', () => {
  const decision = nextRetryDecision(review('queue-stream'), { status: 503 }, { attempt: 0 }, 1000);
  assert.equal(decision.action, 'BLOCK');
  assert.equal(decision.reason, 'idempotency-key-required-before-retry');
});

test('retry schedule is deterministic, bounded and honours provider retry-after', () => {
  const state = { attempt: 1, firstFailureAt: 1000, operationKey: 'evt-42' };
  const one = nextRetryDecision(review('queue-stream'), { status: 429, retryAfter: 2 }, state, 2000);
  const two = nextRetryDecision(review('queue-stream'), { status: 429, retryAfter: 2 }, state, 2000);
  assert.equal(one.action, 'RETRY');
  assert.equal(one.delayMs, two.delayMs);
  assert.ok(one.delayMs >= 2000);
});

test('exhausted retries quarantine instead of looping forever', () => {
  const decision = nextRetryDecision(
    review('api'),
    { status: 503 },
    { attempt: 5, firstFailureAt: 1000, operationKey: 'read-42' },
    2000
  );
  assert.equal(decision.action, 'QUARANTINE');
  assert.equal(decision.exhausted, true);
});

test('reconciliation checkpoint is integrity bound and proves canonical source/staged equality', () => {
  const r = review('webhook');
  const checkpoint = reconciliationCheckpoint(r, {
    mappingVersion: 3,
    sourceCursor: 'cursor-9',
    sourceDigest: 'b'.repeat(64),
    stagedDigest: 'b'.repeat(64),
    operationKey: 'event-9'
  });
  assert.equal(validateReconciliationCheckpoint(r, checkpoint).valid, true);

  const tampered = { ...checkpoint, sourceCursor: 'cursor-tampered' };
  const tamperedValidation = validateReconciliationCheckpoint(r, tampered);
  assert.equal(tamperedValidation.valid, false);
  assert.ok(tamperedValidation.blockers.some(x => x.includes('integrity')));

  const mismatched = reconciliationCheckpoint(r, {
    mappingVersion: 3,
    sourceCursor: 'cursor-10',
    sourceDigest: 'b'.repeat(64),
    stagedDigest: 'c'.repeat(64),
    operationKey: 'event-10'
  });
  assert.equal(validateReconciliationCheckpoint(r, mismatched).valid, false);
});

test('recovery completion is bound to reviewed connection, same operation and verified reconciliation', () => {
  const r = review('webhook');
  const checkpoint = reconciliationCheckpoint(r, {
    mappingVersion: 3,
    sourceCursor: 'cursor-9',
    sourceDigest: 'b'.repeat(64),
    stagedDigest: 'b'.repeat(64),
    operationKey: 'event-9'
  });
  const passed = evaluateRecoveryCompletion(r, {
    checkpoint,
    observedFailure: true,
    recovered: true,
    reconciliationStatus: 'PASS',
    authorityConflict: false,
    quarantined: 0,
    operationKey: 'event-9',
    observedAt: new Date().toISOString()
  });
  assert.equal(passed.ready, true);

  const replayedAsDifferentOperation = evaluateRecoveryCompletion(r, {
    checkpoint,
    observedFailure: true,
    recovered: true,
    reconciliationStatus: 'PASS',
    operationKey: 'event-10',
    observedAt: new Date().toISOString()
  });
  assert.equal(replayedAsDifferentOperation.ready, false);

  const mismatchedCheckpoint = reconciliationCheckpoint(r, {
    mappingVersion: 3,
    sourceCursor: 'cursor-11',
    sourceDigest: 'd'.repeat(64),
    stagedDigest: 'e'.repeat(64),
    operationKey: 'event-11'
  });
  const falsePass = evaluateRecoveryCompletion(r, {
    checkpoint: mismatchedCheckpoint,
    observedFailure: true,
    recovered: true,
    reconciliationStatus: 'PASS',
    authorityConflict: false,
    quarantined: 0,
    operationKey: 'event-11',
    observedAt: new Date().toISOString()
  });
  assert.equal(falsePass.ready, false);
  assert.ok(falsePass.blockers.some(x => x.includes('reconciled')));
});
