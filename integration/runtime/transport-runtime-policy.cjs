'use strict';

const { createHash } = require('node:crypto');

const TRANSPORT_POLICY = Object.freeze({
  api: Object.freeze({
    setupFields: ['targetBaseUrl', 'credentialRef'],
    defaults: { mode: 'read-only', pollSeconds: 60 },
    retry: { maxAttempts: 5, maxElapsedMs: 300000, baseDelayMs: 250, maxDelayMs: 15000 },
    duplicateSensitive: false
  }),
  webhook: Object.freeze({
    setupFields: ['sourceWebhookId', 'credentialRef'],
    defaults: { direction: 'inbound', acknowledgement: 'after-durable-stage' },
    retry: { maxAttempts: 8, maxElapsedMs: 600000, baseDelayMs: 250, maxDelayMs: 30000 },
    duplicateSensitive: true
  }),
  'queue-stream': Object.freeze({
    setupFields: ['endpoint', 'streamOrQueue', 'consumerGroup', 'credentialRef'],
    defaults: { acknowledgement: 'after-durable-stage', ordering: 'source-defined' },
    retry: { maxAttempts: 10, maxElapsedMs: 900000, baseDelayMs: 250, maxDelayMs: 30000 },
    duplicateSensitive: true
  }),
  'secure-file': Object.freeze({
    setupFields: ['endpoint', 'remotePath', 'credentialRef'],
    defaults: { mode: 'pull-read-only', fileCompleteness: 'stable-size-and-digest' },
    retry: { maxAttempts: 6, maxElapsedMs: 900000, baseDelayMs: 1000, maxDelayMs: 60000 },
    duplicateSensitive: true
  }),
  'read-only-db': Object.freeze({
    setupFields: ['endpoint', 'database', 'allowedObjects', 'credentialRef'],
    defaults: { mode: 'read-only', consistency: 'snapshot', queryTimeoutMs: 15000 },
    retry: { maxAttempts: 4, maxElapsedMs: 180000, baseDelayMs: 500, maxDelayMs: 10000 },
    duplicateSensitive: false
  }),
  identity: Object.freeze({
    setupFields: ['issuerOrDirectoryId', 'credentialRef'],
    defaults: { mode: 'read-only-directory-metadata' },
    retry: { maxAttempts: 4, maxElapsedMs: 180000, baseDelayMs: 500, maxDelayMs: 10000 },
    duplicateSensitive: false
  }),
  'on-prem-agent': Object.freeze({
    setupFields: ['agentId', 'credentialRef'],
    defaults: { networkDirection: 'outbound-only', commandMode: 'read-only-connectors' },
    retry: { maxAttempts: 10, maxElapsedMs: 1800000, baseDelayMs: 1000, maxDelayMs: 60000 },
    duplicateSensitive: true
  }),
  ipaas: Object.freeze({
    setupFields: ['workspaceOrFlowId', 'credentialRef'],
    defaults: { mode: 'read-only-source', activation: 'explicit' },
    retry: { maxAttempts: 8, maxElapsedMs: 900000, baseDelayMs: 500, maxDelayMs: 30000 },
    duplicateSensitive: true
  })
});

const RETRYABLE_CODES = new Set([
  'timeout', 'connection-reset', 'temporarily-unavailable', 'rate-limited',
  'provider-busy', 'network-unreachable', 'dns-temporary', 'tls-temporary'
]);
const TERMINAL_CODES = new Set([
  'wrong-target', 'permission-denied', 'invalid-scope', 'schema-mismatch',
  'bad-request', 'write-attempt', 'credential-missing', 'unsupported-operation'
]);
const REAUTHORIZE_CODES = new Set(['auth-expired', 'auth-revoked', 'invalid-credential']);
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const TERMINAL_HTTP = new Set([400, 403, 404, 405, 409, 410, 422]);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function positiveInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function reviewTransport(review) {
  const transport = String(review?.transport || '').trim().toLowerCase();
  const policy = TRANSPORT_POLICY[transport];
  if (!policy) throw new Error('Unsupported enterprise transport runtime policy.');
  if (!review?.reviewedDigest) throw new Error('Reviewed connection digest is required.');
  return { transport, policy };
}

function buildSetupDescriptor(review) {
  const { transport, policy } = reviewTransport(review);
  return Object.freeze({
    transport,
    providerKey: String(review.providerKey || ''),
    targetIdentity: String(review.targetIdentity || ''),
    environment: String(review.environment || ''),
    customerInputs: policy.setupFields.map((key) => ({
      key,
      secretValueAccepted: false,
      protectedReferenceRequired: key === 'credentialRef'
    })),
    safeDefaults: policy.defaults,
    mappingConfiguredSeparately: true,
    businessRulesConfiguredSeparately: true,
    explicitActivationApprovalRequired: true,
    connectionTest: 'metadata-and-non-sensitive-sample-only'
  });
}

function classifyFailure(input = {}) {
  const code = String(input.code || input.failureClass || '').trim().toLowerCase();
  const status = Number(input.status || input.statusCode || input.httpStatus || 0);
  if (REAUTHORIZE_CODES.has(code) || status === 401) {
    return Object.freeze({ disposition: 'REAUTHORIZE', code: code || 'http-401', retryable: false });
  }
  if (TERMINAL_CODES.has(code) || TERMINAL_HTTP.has(status)) {
    return Object.freeze({ disposition: 'BLOCK', code: code || `http-${status}`, retryable: false });
  }
  if (RETRYABLE_CODES.has(code) || RETRYABLE_HTTP.has(status)) {
    return Object.freeze({ disposition: 'RETRY', code: code || `http-${status}`, retryable: true });
  }
  return Object.freeze({ disposition: 'BLOCK', code: code || 'unclassified', retryable: false });
}

function parseRetryAfterMs(input = {}, now = Date.now()) {
  const direct = Number(input.retryAfterMs);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
  const value = input.retryAfter;
  if (value === undefined || value === null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function deterministicJitterMs(reviewedDigest, operationKey, attempt, spreadMs) {
  if (spreadMs <= 0) return 0;
  const sample = sha256(`${reviewedDigest}:${operationKey}:${attempt}`).slice(0, 8);
  return Number.parseInt(sample, 16) % (spreadMs + 1);
}

function nextRetryDecision(review, failure = {}, state = {}, now = Date.now()) {
  const { policy } = reviewTransport(review);
  const classified = classifyFailure(failure);
  if (classified.disposition !== 'RETRY') {
    return Object.freeze({
      action: classified.disposition,
      reason: classified.code,
      retryable: false,
      exhausted: classified.disposition === 'BLOCK'
    });
  }

  const attempt = positiveInt(state.attempt, 0) + 1;
  const firstFailureAt = Number.isFinite(Number(state.firstFailureAt)) ? Number(state.firstFailureAt) : now;
  const elapsedMs = Math.max(0, now - firstFailureAt);
  if (attempt > policy.retry.maxAttempts || elapsedMs > policy.retry.maxElapsedMs) {
    return Object.freeze({
      action: 'QUARANTINE',
      reason: 'retry-budget-exhausted',
      retryable: false,
      exhausted: true,
      attempt,
      firstFailureAt
    });
  }

  const operationKey = String(state.operationKey || '').trim();
  if (policy.duplicateSensitive && !operationKey) {
    return Object.freeze({
      action: 'BLOCK',
      reason: 'idempotency-key-required-before-retry',
      retryable: false,
      exhausted: true,
      attempt,
      firstFailureAt
    });
  }

  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(policy.retry.maxDelayMs, policy.retry.baseDelayMs * (2 ** exponent));
  const jitter = deterministicJitterMs(review.reviewedDigest, operationKey || 'read-only', attempt, Math.max(25, Math.floor(base / 5)));
  const providerDelay = parseRetryAfterMs(failure, now);
  const boundedProviderDelay = providerDelay === null ? 0 : Math.min(providerDelay, policy.retry.maxElapsedMs);
  const delayMs = Math.max(base + jitter, boundedProviderDelay);

  if (elapsedMs + delayMs > policy.retry.maxElapsedMs) {
    return Object.freeze({
      action: 'QUARANTINE',
      reason: 'retry-window-would-be-exceeded',
      retryable: false,
      exhausted: true,
      attempt,
      firstFailureAt
    });
  }

  return Object.freeze({
    action: 'RETRY',
    reason: classified.code,
    retryable: true,
    exhausted: false,
    attempt,
    firstFailureAt,
    delayMs,
    nextAttemptAt: new Date(now + delayMs).toISOString(),
    operationKey: operationKey || null
  });
}

function reconciliationCheckpoint(review, input = {}) {
  reviewTransport(review);
  const mappingVersion = positiveInt(input.mappingVersion);
  const sourceDigest = String(input.sourceDigest || '').trim().toLowerCase();
  const stagedDigest = String(input.stagedDigest || '').trim().toLowerCase();
  const sourceCursor = String(input.sourceCursor || '').trim();
  const operationKey = String(input.operationKey || '').trim();
  if (!mappingVersion) throw new Error('Reconciliation mapping version is required.');
  if (!/^[a-f0-9]{32,128}$/.test(sourceDigest) || !/^[a-f0-9]{32,128}$/.test(stagedDigest)) {
    throw new Error('Reconciliation requires bounded source and staged digests.');
  }
  if (!sourceCursor) throw new Error('Reconciliation source cursor/checkpoint is required.');
  const payload = {
    reviewedDigest: review.reviewedDigest,
    mappingVersion,
    sourceCursor,
    sourceDigest,
    stagedDigest,
    operationKey: operationKey || null,
    reconciled: sourceDigest === stagedDigest
  };
  return Object.freeze({ ...payload, checkpointDigest: sha256(JSON.stringify(payload)) });
}

function validateReconciliationCheckpoint(review, checkpoint = {}) {
  reviewTransport(review);
  const blockers = [];
  const payload = {
    reviewedDigest: checkpoint.reviewedDigest,
    mappingVersion: checkpoint.mappingVersion,
    sourceCursor: checkpoint.sourceCursor,
    sourceDigest: checkpoint.sourceDigest,
    stagedDigest: checkpoint.stagedDigest,
    operationKey: checkpoint.operationKey || null,
    reconciled: checkpoint.reconciled === true
  };
  if (checkpoint.reviewedDigest !== review.reviewedDigest) blockers.push('Recovery checkpoint does not match the exact reviewed connection.');
  if (!positiveInt(checkpoint.mappingVersion)) blockers.push('Recovery checkpoint mapping version is invalid.');
  if (!String(checkpoint.sourceCursor || '').trim()) blockers.push('Recovery checkpoint source cursor is missing.');
  if (!/^[a-f0-9]{32,128}$/.test(String(checkpoint.sourceDigest || '').trim().toLowerCase()) ||
      !/^[a-f0-9]{32,128}$/.test(String(checkpoint.stagedDigest || '').trim().toLowerCase())) {
    blockers.push('Recovery checkpoint reconciliation digests are invalid.');
  }
  if (!checkpoint.checkpointDigest || checkpoint.checkpointDigest !== sha256(JSON.stringify(payload))) {
    blockers.push('Recovery checkpoint integrity verification failed.');
  }
  if (checkpoint.reconciled !== true || checkpoint.sourceDigest !== checkpoint.stagedDigest) {
    blockers.push('Recovery checkpoint does not prove source and staged data reconciled.');
  }
  return Object.freeze({ valid: blockers.length === 0, blockers });
}

function evaluateRecoveryCompletion(review, input = {}) {
  reviewTransport(review);
  const blockers = [];
  const checkpoint = input.checkpoint;
  if (!checkpoint) {
    blockers.push('Recovery checkpoint is missing.');
  } else {
    blockers.push(...validateReconciliationCheckpoint(review, checkpoint).blockers);
  }
  if (input.observedFailure !== true) blockers.push('No real transient failure was observed.');
  if (input.recovered !== true) blockers.push('Recovery did not complete successfully.');
  if (String(input.reconciliationStatus || '') !== 'PASS') blockers.push('Recovery did not finish with reconciliation passing.');
  if (input.authorityConflict === true) blockers.push('Deterministic source authority is not satisfied.');
  if (Number(input.quarantined || 0) > 0) blockers.push('Quarantined integration work remains unresolved.');
  if (checkpoint?.operationKey && input.operationKey !== checkpoint.operationKey) blockers.push('Recovery operation key changed after the failure.');
  const observedAt = Date.parse(String(input.observedAt || ''));
  if (!Number.isFinite(observedAt)) blockers.push('Recovery completion time is invalid.');
  return Object.freeze({
    ready: blockers.length === 0,
    state: blockers.length === 0 ? 'RECOVERED_AND_RECONCILED' : 'BLOCKED',
    blockers
  });
}

module.exports = {
  TRANSPORT_POLICY,
  buildSetupDescriptor,
  classifyFailure,
  parseRetryAfterMs,
  nextRetryDecision,
  reconciliationCheckpoint,
  validateReconciliationCheckpoint,
  evaluateRecoveryCompletion
};
