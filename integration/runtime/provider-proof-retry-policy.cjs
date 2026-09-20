'use strict';

const { nextRetryDecision } = require('./transport-runtime-policy.cjs');

const ERROR_CLASS = /^[A-Za-z0-9._:-]{1,120}$/;
const FAILURE_ALIASES = Object.freeze({
  'provider-timeout': 'timeout',
  'provider-unavailable': 'temporarily-unavailable',
  'provider-temporary-unavailable': 'temporarily-unavailable',
  'provider-rate-limited': 'rate-limited',
  'provider-network-unreachable': 'network-unreachable'
});

function text(value) {
  return String(value ?? '').trim();
}

function safeErrorClass(error, fallback = 'provider-temporary-unavailable') {
  const candidate = text(error?.errorClass || error?.code || '')
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 120);
  return ERROR_CLASS.test(candidate) ? candidate : fallback;
}

function canonicalFailureClass(error = {}) {
  const fallback = error?.retryable === true ? 'temporarily-unavailable' : 'unclassified';
  const safe = safeErrorClass(error, fallback).toLowerCase();
  return FAILURE_ALIASES[safe] || safe;
}

function safeFailureStatus(error = {}) {
  for (const value of [error.status, error.statusCode, error.httpStatus]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return 0;
}

function safeRetryHint(error = {}) {
  const retryAfterMs = Number(error.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Object.freeze({ retryAfterMs: Math.floor(retryAfterMs) });
  }

  const value = error.retryAfter;
  if (value === undefined || value === null || value === '') return Object.freeze({});
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Object.freeze({ retryAfter: value });
  }

  const candidate = text(value);
  if (candidate && candidate.length <= 80) return Object.freeze({ retryAfter: candidate });
  return Object.freeze({});
}

function safeFirstFailureAt(claim = {}, now = Date.now()) {
  const direct = Number(claim.firstFailureAt);
  if (Number.isFinite(direct) && direct > 0 && direct <= Number(now)) return direct;

  const parsed = Date.parse(text(claim.firstFailureAt));
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= Number(now)) return parsed;
  return null;
}

function maintenanceRetryDecision(review, claim = {}, error = {}, now = Date.now()) {
  const errorClass = safeErrorClass(
    error,
    error?.retryable === true ? 'provider-temporary-unavailable' : 'provider-proof-execution-blocked'
  );

  if (!review?.reviewedDigest || !text(review.transport)) {
    return Object.freeze({
      action: 'BLOCK',
      retryable: false,
      errorClass: 'transport-retry-policy-invalid'
    });
  }

  const attemptCount = Number.isInteger(Number(claim?.attemptCount)) && Number(claim.attemptCount) > 0
    ? Number(claim.attemptCount)
    : 1;
  const taskKey = text(claim?.taskKey);
  const hint = safeRetryHint(error);
  const firstFailureAt = safeFirstFailureAt(claim, now);

  let decision;
  try {
    decision = nextRetryDecision(review, {
      failureClass: canonicalFailureClass(error),
      status: safeFailureStatus(error),
      ...hint
    }, {
      attempt: Math.max(0, attemptCount - 1),
      operationKey: taskKey,
      ...(firstFailureAt === null ? {} : { firstFailureAt })
    }, now);
  } catch {
    return Object.freeze({
      action: 'BLOCK',
      retryable: false,
      errorClass: 'transport-retry-policy-invalid'
    });
  }

  if (decision.action !== 'RETRY') {
    return Object.freeze({
      action: 'BLOCK',
      retryable: false,
      errorClass: text(decision.reason) || errorClass || 'retry-budget-exhausted',
      transportDisposition: decision.action
    });
  }

  return Object.freeze({
    action: 'RETRY',
    retryable: true,
    errorClass,
    retryAfterMs: decision.delayMs,
    nextAttemptAt: decision.nextAttemptAt,
    attempt: decision.attempt,
    firstFailureAt: decision.firstFailureAt
  });
}

module.exports = {
  safeErrorClass,
  canonicalFailureClass,
  safeFailureStatus,
  safeRetryHint,
  safeFirstFailureAt,
  maintenanceRetryDecision
};
