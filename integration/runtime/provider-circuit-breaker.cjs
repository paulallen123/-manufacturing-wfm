'use strict';

const { classifyFailure } = require('./transport-runtime-policy.cjs');

const CIRCUIT_POLICY = Object.freeze({
  api: Object.freeze({ failureThreshold: 4, windowMs: 60000, cooldownMs: 30000 }),
  webhook: Object.freeze({ failureThreshold: 5, windowMs: 60000, cooldownMs: 30000 }),
  'queue-stream': Object.freeze({ failureThreshold: 5, windowMs: 60000, cooldownMs: 30000 }),
  'secure-file': Object.freeze({ failureThreshold: 4, windowMs: 300000, cooldownMs: 60000 }),
  'read-only-db': Object.freeze({ failureThreshold: 3, windowMs: 60000, cooldownMs: 30000 }),
  identity: Object.freeze({ failureThreshold: 3, windowMs: 60000, cooldownMs: 30000 }),
  'on-prem-agent': Object.freeze({ failureThreshold: 5, windowMs: 300000, cooldownMs: 60000 }),
  ipaas: Object.freeze({ failureThreshold: 4, windowMs: 60000, cooldownMs: 30000 })
});

function assertReview(review) {
  const transport = String(review?.transport || '').trim().toLowerCase();
  if (!review?.reviewedDigest) throw new Error('Reviewed connection digest is required for circuit control.');
  if (!CIRCUIT_POLICY[transport]) throw new Error('Unsupported enterprise transport for circuit control.');
  return { transport, policy: CIRCUIT_POLICY[transport] };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeState(review, state = {}) {
  assertReview(review);
  if (state.reviewedDigest && state.reviewedDigest !== review.reviewedDigest) {
    throw new Error('Circuit state does not match the exact reviewed connection.');
  }
  const status = String(state.status || 'CLOSED').trim().toUpperCase();
  if (!['CLOSED', 'OPEN', 'HALF_OPEN'].includes(status)) throw new Error('Circuit state is invalid.');
  return {
    reviewedDigest: review.reviewedDigest,
    status,
    failureCount: Math.max(0, Number.isInteger(Number(state.failureCount)) ? Number(state.failureCount) : 0),
    windowStartedAt: numberOrNull(state.windowStartedAt),
    openedAt: numberOrNull(state.openedAt),
    lastFailureAt: numberOrNull(state.lastFailureAt),
    lastSuccessAt: numberOrNull(state.lastSuccessAt)
  };
}

function gateCircuit(review, state = {}, now = Date.now()) {
  const { policy } = assertReview(review);
  let current;
  try {
    current = normalizeState(review, state);
  } catch (error) {
    return Object.freeze({ action: 'BLOCK', reason: error.message });
  }

  if (current.status === 'CLOSED') {
    return Object.freeze({ action: 'ALLOW', reason: 'circuit-closed', state: current });
  }

  if (!Number.isFinite(current.openedAt)) {
    return Object.freeze({ action: 'BLOCK', reason: 'open-circuit-has-no-valid-open-time', state: current });
  }

  const nextProbeAtMs = current.openedAt + policy.cooldownMs;
  if (current.status === 'OPEN' && now < nextProbeAtMs) {
    return Object.freeze({
      action: 'PAUSE',
      reason: 'provider-circuit-open',
      nextProbeAt: new Date(nextProbeAtMs).toISOString(),
      state: current
    });
  }

  return Object.freeze({
    action: 'SAFE_PROBE_ONLY',
    reason: 'provider-recovery-probe-required',
    probeRequirements: Object.freeze({ metadataOnly: true, nonMutating: true, reconciliationRequired: true }),
    state: Object.freeze({ ...current, status: 'HALF_OPEN' })
  });
}

function closedState(review, now) {
  return Object.freeze({
    reviewedDigest: review.reviewedDigest,
    status: 'CLOSED',
    failureCount: 0,
    windowStartedAt: null,
    openedAt: null,
    lastFailureAt: null,
    lastSuccessAt: now
  });
}

function recordCircuitObservation(review, state = {}, observation = {}, now = Date.now()) {
  const { policy } = assertReview(review);
  let current;
  try {
    current = normalizeState(review, state);
  } catch (error) {
    return Object.freeze({ action: 'BLOCK', reason: error.message });
  }

  const outcome = String(observation.outcome || '').trim().toUpperCase();
  if (outcome === 'SUCCESS') {
    if (current.status !== 'CLOSED') {
      const safeProbe = observation.safeProbe === true;
      const nonMutating = observation.nonMutating === true;
      const reconciled = observation.reconciled === true;
      if (!safeProbe || !nonMutating || !reconciled) {
        return Object.freeze({
          action: 'KEEP_OPEN',
          reason: 'recovery-success-lacks-safe-probe-and-reconciliation-proof',
          state: Object.freeze({ ...current, status: 'OPEN' })
        });
      }
    }
    return Object.freeze({ action: 'CLOSE', reason: 'provider-recovered-and-reconciled', state: closedState(review, now) });
  }

  if (outcome !== 'FAILURE') {
    return Object.freeze({ action: 'BLOCK', reason: 'circuit-observation-outcome-is-invalid', state: current });
  }

  const classified = classifyFailure(observation.failure || {});
  if (classified.disposition !== 'RETRY') {
    return Object.freeze({
      action: classified.disposition,
      reason: classified.code,
      state: current
    });
  }

  if (current.status !== 'CLOSED') {
    const reopened = Object.freeze({
      ...current,
      status: 'OPEN',
      openedAt: now,
      lastFailureAt: now,
      failureCount: Math.max(current.failureCount, policy.failureThreshold)
    });
    return Object.freeze({
      action: 'OPEN',
      reason: 'safe-recovery-probe-failed',
      nextProbeAt: new Date(now + policy.cooldownMs).toISOString(),
      state: reopened
    });
  }

  const withinWindow = Number.isFinite(current.windowStartedAt) && now >= current.windowStartedAt && (now - current.windowStartedAt) <= policy.windowMs;
  const windowStartedAt = withinWindow ? current.windowStartedAt : now;
  const failureCount = (withinWindow ? current.failureCount : 0) + 1;

  if (failureCount >= policy.failureThreshold) {
    const opened = Object.freeze({
      reviewedDigest: review.reviewedDigest,
      status: 'OPEN',
      failureCount,
      windowStartedAt,
      openedAt: now,
      lastFailureAt: now,
      lastSuccessAt: current.lastSuccessAt
    });
    return Object.freeze({
      action: 'OPEN',
      reason: 'transient-failure-threshold-reached',
      nextProbeAt: new Date(now + policy.cooldownMs).toISOString(),
      state: opened
    });
  }

  return Object.freeze({
    action: 'RETRY_ALLOWED',
    reason: classified.code,
    state: Object.freeze({
      ...current,
      failureCount,
      windowStartedAt,
      lastFailureAt: now
    })
  });
}

module.exports = {
  CIRCUIT_POLICY,
  gateCircuit,
  recordCircuitObservation
};
