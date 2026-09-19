'use strict';

const { recordFreshCreateReconciliation } = require('./provisioning-fresh-create-proof.cjs');

const RECONCILE_STATES = new Set(['MUTATION_STARTED', 'RECONCILE_REQUIRED']);
const MUTATION_METHOD_NAMES = ['createEnvironment', 'updateEnvironment', 'deleteEnvironment', 'create', 'update', 'delete', 'mutate'];

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

function assertReadOnlyAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || typeof adapter.lookupEnvironment !== 'function') {
    fail('WFM_RECONCILE_ADAPTER_INVALID', 'Provisioning reconciliation requires a read-only provider lookup adapter.', 500);
  }
  const caps = adapter.capabilities || {};
  if (caps.readOnly !== true || caps.createsResources !== false || caps.updatesResources !== false || caps.deletesResources !== false) {
    fail('WFM_RECONCILE_ADAPTER_NOT_READ_ONLY', 'Provider reconciliation adapter must explicitly deny create, update and delete capability.', 403);
  }
  for (const method of MUTATION_METHOD_NAMES) {
    if (typeof adapter[method] === 'function') {
      fail('WFM_RECONCILE_ADAPTER_MUTATION_METHOD_PRESENT', 'Read-only provider reconciliation adapter exposes a mutation method.', 403);
    }
  }
  return adapter;
}

function buildLookup(record) {
  if (!record || typeof record !== 'object') fail('WFM_RECONCILE_RECORD_REQUIRED', 'Provisioning queue record is required.', 400);
  if (!RECONCILE_STATES.has(record.state)) {
    fail('WFM_RECONCILE_STATE_INVALID', 'Provider readback is allowed only after a create attempt has started.', 409);
  }
  const plan = record.payload && record.payload.plan;
  const contract = record.payload && record.payload.contract;
  const lookup = {
    queueKey: requireString(record.queueKey, 'WFM_RECONCILE_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.'),
    intentDigest: requireString(record.intentDigest, 'WFM_RECONCILE_INTENT_REQUIRED', 'Provisioning intent digest is required.').toLowerCase(),
    providerRequestId: requireString(record.providerRequestId, 'WFM_RECONCILE_REQUEST_ID_REQUIRED', 'Provider request identity is required.'),
    provider: requireString(plan && plan.provider, 'WFM_RECONCILE_PROVIDER_REQUIRED', 'Cloud provider is required.'),
    region: requireString(plan && plan.region, 'WFM_RECONCILE_REGION_REQUIRED', 'Cloud region is required.'),
    tenantId: requireString(contract && contract.tenantId, 'WFM_RECONCILE_TENANT_REQUIRED', 'Tenant identity is required.')
  };
  return Object.freeze(lookup);
}

function normalizeEvidence(record, lookup, evidence, nowMs, { maxObservationAgeMs, maxFutureSkewMs }) {
  if (!evidence || typeof evidence !== 'object') {
    fail('WFM_RECONCILE_EVIDENCE_REQUIRED', 'Provider readback returned no evidence.', 502);
  }
  if (evidence.readOnly !== true) {
    fail('WFM_RECONCILE_EVIDENCE_NOT_READ_ONLY', 'Provider readback evidence must explicitly confirm a read-only lookup.', 403);
  }

  const observedAt = Number(evidence.observedAt);
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    fail('WFM_RECONCILE_OBSERVED_AT_REQUIRED', 'Provider readback must include its observation time.', 502);
  }
  if (observedAt > nowMs + maxFutureSkewMs) {
    fail('WFM_RECONCILE_OBSERVATION_FROM_FUTURE', 'Provider readback observation time is implausibly in the future.', 403);
  }
  if (nowMs - observedAt > maxObservationAgeMs) {
    fail('WFM_RECONCILE_OBSERVATION_STALE', 'Provider readback evidence is too old to drive a provisioning decision.', 409);
  }

  const status = String(evidence.status || '').toUpperCase();
  if (!['FOUND', 'NOT_FOUND', 'AMBIGUOUS'].includes(status)) {
    fail('WFM_RECONCILE_STATUS_INVALID', 'Provider readback status must be found, not-found or ambiguous.', 502);
  }

  if (status === 'FOUND') {
    const provider = requireString(evidence.provider, 'WFM_RECONCILE_PROVIDER_EVIDENCE_REQUIRED', 'Found environment evidence must include provider.');
    const region = requireString(evidence.region, 'WFM_RECONCILE_REGION_EVIDENCE_REQUIRED', 'Found environment evidence must include region.');
    const tenantId = requireString(evidence.tenantId, 'WFM_RECONCILE_TENANT_EVIDENCE_REQUIRED', 'Found environment evidence must include tenant.');
    const requestId = requireString(evidence.providerRequestId, 'WFM_RECONCILE_REQUEST_EVIDENCE_REQUIRED', 'Found environment evidence must include provider request id.');
    if (provider !== lookup.provider || region !== lookup.region || tenantId !== lookup.tenantId || requestId !== lookup.providerRequestId) {
      fail('WFM_RECONCILE_EVIDENCE_MISMATCH', 'Provider readback does not match the exact sealed create request.', 409);
    }
  }

  return Object.freeze({ ...evidence, status, readOnly: true, observedAt });
}

function createReadOnlyProvisioningReconciler({
  outbox,
  providerAdapters,
  proofKey,
  now = Date.now,
  maxObservationAgeMs = 2 * 60 * 1000,
  maxFutureSkewMs = 30 * 1000,
  freshReconcile = recordFreshCreateReconciliation
} = {}) {
  if (!outbox || typeof outbox.get !== 'function' || typeof outbox.recordReconciliation !== 'function') {
    throw new Error('Read-only provisioning reconciler requires the existing provisioning outbox.');
  }
  if (!providerAdapters || typeof providerAdapters !== 'object') {
    throw new Error('Read-only provisioning reconciler requires provider adapters.');
  }
  if (!proofKey) throw new Error('Read-only provisioning reconciler requires the fresh-create proof key.');
  if (!(Number(maxObservationAgeMs) > 0) || !(Number(maxFutureSkewMs) >= 0)) {
    throw new Error('Read-only provisioning reconciliation freshness limits are invalid.');
  }

  async function reconcile(queueKey) {
    const record = await outbox.get(queueKey);
    if (!record) fail('WFM_RECONCILE_RECORD_NOT_FOUND', 'Provisioning queue item was not found.', 404);
    const lookup = buildLookup(record);
    const adapter = assertReadOnlyAdapter(providerAdapters[lookup.provider]);
    const evidence = await adapter.lookupEnvironment(lookup);
    const nowMs = Number(now());
    if (!Number.isFinite(nowMs)) fail('WFM_RECONCILE_CLOCK_INVALID', 'Provisioning reconciliation clock is invalid.', 500);
    const normalized = normalizeEvidence(record, lookup, evidence, nowMs, {
      maxObservationAgeMs: Number(maxObservationAgeMs),
      maxFutureSkewMs: Number(maxFutureSkewMs)
    });
    return freshReconcile(outbox, lookup.queueKey, normalized, proofKey, { now: () => nowMs });
  }

  return { reconcile };
}

module.exports = {
  createReadOnlyProvisioningReconciler,
  assertReadOnlyAdapter,
  buildLookup,
  normalizeEvidence
};
