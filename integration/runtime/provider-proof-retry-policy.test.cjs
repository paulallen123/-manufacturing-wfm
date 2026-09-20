'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maintenanceRetryDecision,
  safeRetryHint,
  canonicalFailureClass,
  safeFailureStatus
} = require('./provider-proof-retry-policy.cjs');

const NOW = Date.parse('2026-09-20T03:45:00.000Z');

function review(transport = 'api') {
  return {
    reviewedDigest: 'a'.repeat(64),
    providerKey: 'oracle-netsuite',
    transport
  };
}

function claim(overrides = {}) {
  return {
    taskKey: 'b'.repeat(64),
    attemptCount: 1,
    ...overrides
  };
}

test('provider retry guidance is treated as a minimum delay', () => {
  const result = maintenanceRetryDecision(review(), claim(), {
    retryable: true,
    retryAfterMs: 5000,
    errorClass: 'provider-busy'
  }, NOW);

  assert.equal(result.action, 'RETRY');
  assert.equal(result.errorClass, 'provider-busy');
  assert.equal(result.retryAfterMs, 5000);
  assert.equal(result.nextAttemptAt, new Date(NOW + 5000).toISOString());
});

test('retry timing grows deterministically across attempts without provider guidance', () => {
  const first = maintenanceRetryDecision(review(), claim({ attemptCount: 1 }), {
    retryable: true,
    errorClass: 'provider-timeout'
  }, NOW);
  const again = maintenanceRetryDecision(review(), claim({ attemptCount: 1 }), {
    retryable: true,
    errorClass: 'provider-timeout'
  }, NOW);
  const second = maintenanceRetryDecision(review(), claim({ attemptCount: 2 }), {
    retryable: true,
    errorClass: 'provider-timeout'
  }, NOW);

  assert.equal(first.action, 'RETRY');
  assert.equal(first.retryAfterMs, again.retryAfterMs);
  assert.ok(second.retryAfterMs > first.retryAfterMs);
});

test('shared transport policy overrides a bad adapter retry flag for terminal failures', () => {
  const result = maintenanceRetryDecision(review(), claim(), {
    retryable: true,
    errorClass: 'permission-denied'
  }, NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.retryable, false);
  assert.equal(result.errorClass, 'permission-denied');
  assert.equal(result.transportDisposition, 'BLOCK');
});

test('shared transport policy retries standard rate limits even when adapter omitted retryable flag', () => {
  const result = maintenanceRetryDecision(review(), claim(), {
    retryable: false,
    statusCode: 429,
    errorClass: 'provider-rate-limited',
    retryAfterMs: 3000
  }, NOW);

  assert.equal(result.action, 'RETRY');
  assert.equal(result.errorClass, 'provider-rate-limited');
  assert.equal(result.retryAfterMs, 3000);
});

test('expired authentication is routed to reauthorization instead of retrying provider calls', () => {
  const result = maintenanceRetryDecision(review(), claim(), {
    retryable: true,
    status: 401,
    errorClass: 'auth-expired'
  }, NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.errorClass, 'auth-expired');
  assert.equal(result.transportDisposition, 'REAUTHORIZE');
});

test('secure-file maintenance uses the transport-specific slower retry floor', () => {
  const result = maintenanceRetryDecision(review('secure-file'), claim(), {
    errorClass: 'provider-timeout',
    retryable: true
  }, NOW);

  assert.equal(result.action, 'RETRY');
  assert.ok(result.retryAfterMs >= 1000);
});

test('duplicate-sensitive transports fail closed without a stable task key', () => {
  const result = maintenanceRetryDecision(review('webhook'), claim({ taskKey: '' }), {
    retryable: true,
    errorClass: 'temporarily-unavailable'
  }, NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.errorClass, 'idempotency-key-required-before-retry');
});

test('transport retry budget blocks further calls instead of hot-looping', () => {
  const result = maintenanceRetryDecision(review(), claim({ attemptCount: 6 }), {
    retryable: true,
    errorClass: 'provider-busy'
  }, NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.retryable, false);
  assert.equal(result.errorClass, 'retry-budget-exhausted');
});

test('unsupported transport fails closed', () => {
  const result = maintenanceRetryDecision(review('unsupported-transport'), claim(), {
    retryable: true,
    errorClass: 'provider-busy'
  }, NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.errorClass, 'transport-retry-policy-invalid');
});

test('non-retryable failures remain blocked and secret-like messages are never returned', () => {
  const result = maintenanceRetryDecision(review(), claim(), Object.assign(
    new Error('secret-token-should-never-appear'),
    { retryable: false, errorClass: 'permission-denied' }
  ), NOW);

  assert.equal(result.action, 'BLOCK');
  assert.equal(result.errorClass, 'permission-denied');
  assert.equal(JSON.stringify(result).includes('secret-token-should-never-appear'), false);
});

test('failure aliases and statuses are normalized without provider payload leakage', () => {
  assert.equal(canonicalFailureClass({ retryable: true, errorClass: 'provider-timeout' }), 'timeout');
  assert.equal(canonicalFailureClass({ retryable: true, errorClass: 'provider-rate-limited' }), 'rate-limited');
  assert.equal(safeFailureStatus({ statusCode: 503 }), 503);
  assert.equal(safeFailureStatus({ statusCode: 'not-a-status' }), 0);
});

test('oversized retry hint text is discarded before reaching shared retry policy', () => {
  const hint = safeRetryHint({ retryAfter: 'x'.repeat(1000) });
  assert.deepEqual(hint, {});
});
