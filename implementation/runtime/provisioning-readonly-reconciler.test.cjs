'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createReadOnlyProvisioningReconciler,
  assertReadOnlyAdapter,
  buildLookup,
  normalizeEvidence
} = require('./provisioning-readonly-reconciler.cjs');

function record(overrides = {}) {
  return {
    state: 'RECONCILE_REQUIRED',
    queueKey: 'wfm-provision:v1:abc',
    intentDigest: 'a'.repeat(64),
    providerRequestId: 'wfm-create-123',
    payload: {
      contract: { tenantId: 'tenant-42' },
      plan: { provider: 'railway', region: 'eu-west' }
    },
    ...overrides
  };
}

function readOnlyAdapter(handler) {
  return {
    capabilities: {
      readOnly: true,
      createsResources: false,
      updatesResources: false,
      deletesResources: false
    },
    lookupEnvironment: handler
  };
}

test('passes only the exact frozen sealed request to provider lookup and then to fresh-create verification', async () => {
  const rec = record();
  let seenLookup;
  let seenEvidence;
  const outbox = {
    async get(key) {
      assert.equal(key, rec.queueKey);
      return rec;
    },
    async recordReconciliation() {
      throw new Error('injected verifier should intercept');
    }
  };
  const adapter = readOnlyAdapter(async lookup => {
    assert.equal(Object.isFrozen(lookup), true);
    seenLookup = lookup;
    return {
      status: 'FOUND',
      readOnly: true,
      observedAt: 1_000_000,
      providerResourceId: 'env-1',
      providerRequestId: 'wfm-create-123',
      provider: 'railway',
      region: 'eu-west',
      tenantId: 'tenant-42',
      createdAt: 999_900,
      creationProof: { placeholder: true }
    };
  });
  const freshReconcile = async (receivedOutbox, queueKey, evidence, proofKey, options) => {
    assert.equal(receivedOutbox, outbox);
    assert.equal(queueKey, rec.queueKey);
    assert.equal(proofKey, 'proof-key');
    assert.equal(options.now(), 1_000_000);
    seenEvidence = evidence;
    return { status: 'VERIFIED_FOR_TEST' };
  };
  const reconciler = createReadOnlyProvisioningReconciler({
    outbox,
    providerAdapters: { railway: adapter },
    proofKey: 'proof-key',
    now: () => 1_000_000,
    freshReconcile
  });
  const result = await reconciler.reconcile(rec.queueKey);
  assert.deepEqual(result, { status: 'VERIFIED_FOR_TEST' });
  assert.deepEqual(seenLookup, {
    queueKey: rec.queueKey,
    intentDigest: rec.intentDigest,
    providerRequestId: rec.providerRequestId,
    provider: 'railway',
    region: 'eu-west',
    tenantId: 'tenant-42'
  });
  assert.equal(seenEvidence.readOnly, true);
  assert.equal(seenEvidence.status, 'FOUND');
});

test('rejects a mutation-capable provider adapter before lookup runs', async () => {
  let called = false;
  const adapter = readOnlyAdapter(async () => {
    called = true;
    return {};
  });
  adapter.createEnvironment = async () => ({ id: 'env' });
  assert.throws(
    () => assertReadOnlyAdapter(adapter),
    error => error.code === 'WFM_RECONCILE_ADAPTER_MUTATION_METHOD_PRESENT'
  );
  assert.equal(called, false);
});

test('stale readback evidence is rejected before it can change queue state', () => {
  const rec = record();
  const lookup = buildLookup(rec);
  assert.throws(
    () => normalizeEvidence(rec, lookup, {
      status: 'NOT_FOUND',
      readOnly: true,
      observedAt: 700_000
    }, 1_000_000, { maxObservationAgeMs: 120_000, maxFutureSkewMs: 30_000 }),
    error => error.code === 'WFM_RECONCILE_OBSERVATION_STALE'
  );
});

test('future-dated readback evidence is rejected', () => {
  const rec = record();
  const lookup = buildLookup(rec);
  assert.throws(
    () => normalizeEvidence(rec, lookup, {
      status: 'AMBIGUOUS',
      readOnly: true,
      observedAt: 1_031_000
    }, 1_000_000, { maxObservationAgeMs: 120_000, maxFutureSkewMs: 30_000 }),
    error => error.code === 'WFM_RECONCILE_OBSERVATION_FROM_FUTURE'
  );
});

test('found evidence with a different provider request identity is rejected', () => {
  const rec = record();
  const lookup = buildLookup(rec);
  assert.throws(
    () => normalizeEvidence(rec, lookup, {
      status: 'FOUND',
      readOnly: true,
      observedAt: 1_000_000,
      providerResourceId: 'env-1',
      providerRequestId: 'different-request',
      provider: 'railway',
      region: 'eu-west',
      tenantId: 'tenant-42'
    }, 1_000_000, { maxObservationAgeMs: 120_000, maxFutureSkewMs: 30_000 }),
    error => error.code === 'WFM_RECONCILE_EVIDENCE_MISMATCH'
  );
});

test('wrong queue state is rejected before provider lookup can occur', () => {
  assert.throws(
    () => buildLookup(record({ state: 'PENDING' })),
    error => error.code === 'WFM_RECONCILE_STATE_INVALID'
  );
});

test('read-only capability contract must explicitly deny create, update and delete', () => {
  assert.throws(
    () => assertReadOnlyAdapter({
      capabilities: { readOnly: true, createsResources: false, updatesResources: false },
      lookupEnvironment() {}
    }),
    error => error.code === 'WFM_RECONCILE_ADAPTER_NOT_READ_ONLY'
  );
});
