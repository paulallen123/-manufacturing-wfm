'use strict';

const { nextRetryDecision } = require('./transport-runtime-policy.cjs');

const ERROR_CLASS = /^[A-Za-z0-9._:-]{1,120}$/;

function text(value) {
  return String(value ?? '').trim();
}

function safeErrorClass(error, fallback = 'provider-temporary-unavailable') {
  const candidate = text(error?.errorClass || error?.code || '')
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 120);
  return ERROR_CLASS.test(candidate) ? candidate : fallback;
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

function maintenanceRetryDecision(review, claim = {}, error = {}, now = Date.now()) {
  const errorClass = safeErrorClass(error);
  if (error?.retryable !== true) {
    return Object.freeze({
      action: 'BLOCK',
      retryable: false,
      errorClass
    });
  }

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

  let decision;
  try {
    decision = nextRetryDecision(review, {
      failureClass: 'temporarily-unavailable',
      ...hint
    }, {
      attempt: Math.max(0, attemptCount - 1),
      operationKey: taskKey
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
      errorClass: text(decision.reason) || 'retry-budget-exhausted',
      transportDisposition: decision.action
    });
  }

  return Object.freeze({
    action: 'RETRY',
    retryable: true,
    errorClass,
    retryAfterMs: decision.delayMs,
    nextAttemptAt: decision.nextAttemptAt,
    attempt: decision.attempt
  });
}

module.exports = {
  safeErrorClass,
  safeRetryHint,
  maintenanceRetryDecision
};
