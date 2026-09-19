'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function proofKey(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'utf8');
  if (key.length < 32) fail('WFM_FRESH_CREATE_PROOF_KEY_WEAK', 'Fresh-create proof key must contain at least 32 bytes.', 500);
  return key;
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || '')) || !/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  return timingSafeEqual(Buffer.from(String(actual).toLowerCase(), 'hex'), Buffer.from(String(expected).toLowerCase(), 'hex'));
}

function proofSubject(record, issuedAt) {
  if (!record || typeof record !== 'object') fail('WFM_FRESH_CREATE_RECORD_REQUIRED', 'Provisioning queue record is required.', 400);
  if (!['MUTATION_STARTED', 'RECONCILE_REQUIRED'].includes(record.state)) {
    fail('WFM_FRESH_CREATE_STATE_INVALID', 'Fresh-create proof is valid only after provider mutation has started.');
  }
  const plan = record.payload && record.payload.plan;
  const contract = record.payload && record.payload.contract;
  return {
    schemaVersion: 1,
    queueKey: requireString(record.queueKey, 'WFM_FRESH_CREATE_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.'),
    intentDigest: requireString(record.intentDigest, 'WFM_FRESH_CREATE_INTENT_REQUIRED', 'Provisioning intent digest is required.').toLowerCase(),
    providerRequestId: requireString(record.providerRequestId, 'WFM_FRESH_CREATE_REQUEST_REQUIRED', 'Provider request identity is required.'),
    provider: requireString(plan && plan.provider, 'WFM_FRESH_CREATE_PROVIDER_REQUIRED', 'Cloud provider is required.'),
    region: requireString(plan && plan.region, 'WFM_FRESH_CREATE_REGION_REQUIRED', 'Cloud region is required.'),
    tenantId: requireString(contract && contract.tenantId, 'WFM_FRESH_CREATE_TENANT_REQUIRED', 'Tenant identity is required.'),
    generation: Number(record.generation),
    issuedAt: Number(issuedAt)
  };
}

function createFreshCreateProof(record, key, { issuedAt = Date.now() } = {}) {
  const subject = proofSubject(record, issuedAt);
  if (!Number.isInteger(subject.generation) || subject.generation < 1) {
    fail('WFM_FRESH_CREATE_GENERATION_INVALID', 'Provisioning generation must be a positive integer.', 400);
  }
  if (!Number.isFinite(subject.issuedAt) || subject.issuedAt <= 0) {
    fail('WFM_FRESH_CREATE_TIME_INVALID', 'Fresh-create proof time is invalid.', 400);
  }
  const mac = createHmac('sha256', proofKey(key)).update(canonical(subject)).digest('hex');
  return Object.freeze({ ...subject, mac });
}

function verifyFreshCreateReadback(record, evidence = {}, key, {
  now = Date.now,
  maxClockSkewMs = 2 * 60 * 1000,
  maxFutureMs = 60 * 1000
} = {}) {
  if (evidence.readOnly !== true) {
    fail('WFM_FRESH_CREATE_READBACK_NOT_READ_ONLY', 'Provider reconciliation must be read-only.', 403);
  }
  const status = String(evidence.status || '').toUpperCase();
  if (status === 'NOT_FOUND' || status === 'AMBIGUOUS') return { status };
  if (status !== 'FOUND') fail('WFM_FRESH_CREATE_STATUS_INVALID', 'Reconciliation status must be found, not-found or ambiguous.', 400);

  const providerResourceId = requireString(evidence.providerResourceId, 'WFM_FRESH_CREATE_RESOURCE_REQUIRED', 'Fresh-create evidence requires a provider resource identity.');
  const providerRequestId = requireString(evidence.providerRequestId, 'WFM_FRESH_CREATE_REQUEST_REQUIRED', 'Fresh-create evidence requires the provider request identity.');
  const createdAt = Number(evidence.createdAt);
  if (!Number.isFinite(createdAt)) fail('WFM_FRESH_CREATE_CREATED_AT_REQUIRED', 'Provider-reported creation time is required.', 400);

  const proof = evidence.creationProof;
  if (!proof || typeof proof !== 'object') {
    fail('WFM_FRESH_CREATE_PROOF_REQUIRED', 'A found environment must carry the autonomous fresh-create proof; pre-created environments do not qualify.', 403);
  }
  const { mac, ...subject } = proof;
  const expectedMac = createHmac('sha256', proofKey(key)).update(canonical(subject)).digest('hex');
  if (!safeEqualHex(mac, expectedMac)) fail('WFM_FRESH_CREATE_PROOF_INVALID', 'Fresh-create proof failed integrity verification.', 403);

  const expected = proofSubject(record, subject.issuedAt);
  if (canonical(subject) !== canonical(expected)) {
    fail('WFM_FRESH_CREATE_SUBJECT_MISMATCH', 'Fresh-create proof does not match the exact queue item, request, tenant or cloud plan.');
  }
  if (providerRequestId !== expected.providerRequestId) {
    fail('WFM_FRESH_CREATE_REQUEST_MISMATCH', 'Found environment was not created by the sealed provider request.');
  }
  if (String(evidence.provider || '') !== expected.provider || String(evidence.region || '') !== expected.region || String(evidence.tenantId || '') !== expected.tenantId) {
    fail('WFM_FRESH_CREATE_ENVIRONMENT_MISMATCH', 'Found environment does not match the sealed provider, region and tenant.');
  }

  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) fail('WFM_FRESH_CREATE_CLOCK_INVALID', 'Fresh-create verifier clock is invalid.', 500);
  if (subject.issuedAt > nowMs + maxFutureMs || createdAt > nowMs + maxFutureMs) {
    fail('WFM_FRESH_CREATE_TIME_FROM_FUTURE', 'Fresh-create evidence is implausibly in the future.', 403);
  }
  if (createdAt < subject.issuedAt - maxClockSkewMs) {
    fail('WFM_FRESH_CREATE_PREEXISTING_RESOURCE', 'Provider resource predates the autonomous create proof and cannot count as fresh provisioning.', 403);
  }

  return {
    status: 'FOUND',
    providerResourceId,
    providerRequestId,
    proofDigest: sha256(proof)
  };
}

async function recordFreshCreateReconciliation(outbox, queueKey, evidence, key, options = {}) {
  if (!outbox || typeof outbox.get !== 'function' || typeof outbox.recordReconciliation !== 'function') {
    throw new Error('Fresh-create reconciliation requires the existing provisioning outbox.');
  }
  const record = await outbox.get(queueKey);
  if (!record) fail('WFM_FRESH_CREATE_RECORD_NOT_FOUND', 'Provisioning queue item was not found.', 404);
  const verified = verifyFreshCreateReadback(record, evidence, key, options);
  if (verified.status === 'FOUND') {
    return outbox.recordReconciliation(queueKey, { status: 'FOUND', providerResourceId: verified.providerResourceId });
  }
  return outbox.recordReconciliation(queueKey, { status: verified.status });
}

module.exports = {
  createFreshCreateProof,
  verifyFreshCreateReadback,
  recordFreshCreateReconciliation,
  sha256,
  canonical
};
