'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FRESH_CREATE_PROOF_SCHEMA_VERSION,
  createFreshCreateProof,
  verifyFreshCreateReadback,
  recordFreshCreateReconciliation
} = require('./provisioning-fresh-create-proof.cjs');
const { deriveProvisioningEnvironmentBinding } = require('./provisioning-environment-binding.cjs');

const KEY = '0123456789abcdef0123456789abcdef';

function record() {
  return {
    state: 'RECONCILE_REQUIRED',
    queueKey: 'wfm-provision:v1:abc',
    intentDigest: 'a'.repeat(64),
    providerRequestId: 'wfm-create-123',
    generation: 3,
    payload: {
      contract: { tenantId: 'tenant-42' },
      plan: { provider: 'railway', region: 'eu-west' }
    }
  };
}

function validEvidence(rec) {
  const creationProof = createFreshCreateProof(rec, KEY, { issuedAt: 1_000_000 });
  const binding = deriveProvisioningEnvironmentBinding(rec);
  return {
    status: 'FOUND',
    readOnly: true,
    providerResourceId: 'env-123',
    providerRequestId: rec.providerRequestId,
    provider: 'railway',
    region: 'eu-west',
    tenantId: 'tenant-42',
    environmentName: binding.environmentName,
    bindingVersion: binding.bindingVersion,
    bindingDigest: binding.bindingDigest,
    createdAt: 1_000_500,
    creationProof
  };
}

test('fresh-create proof seals the exact deterministic environment binding', () => {
  const rec = record();
  const proof = createFreshCreateProof(rec, KEY, { issuedAt: 1_000_000 });
  assert.equal(proof.schemaVersion, FRESH_CREATE_PROOF_SCHEMA_VERSION);
  assert.equal(proof.schemaVersion, 2);
  assert.deepEqual(proof.environmentBinding, deriveProvisioningEnvironmentBinding(rec));
});

test('accepts only a found environment bound to the exact autonomous create proof', () => {
  const rec = record();
  const result = verifyFreshCreateReadback(rec, validEvidence(rec), KEY, { now: () => 1_001_000 });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.providerResourceId, 'env-123');
  assert.equal(result.environmentName, deriveProvisioningEnvironmentBinding(rec).environmentName);
  assert.match(result.bindingDigest, /^[a-f0-9]{64}$/);
  assert.match(result.proofDigest, /^[a-f0-9]{64}$/);
});

test('a manually pre-created environment without the fresh-create proof is rejected', () => {
  const rec = record();
  const evidence = validEvidence(rec);
  delete evidence.creationProof;
  assert.throws(
    () => verifyFreshCreateReadback(rec, evidence, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_PROOF_REQUIRED' && error.statusCode === 403
  );
});

test('an environment created before the proof cannot count as autonomous fresh provisioning', () => {
  const rec = record();
  const evidence = validEvidence(rec);
  evidence.createdAt = 800_000;
  assert.throws(
    () => verifyFreshCreateReadback(rec, evidence, KEY, { now: () => 1_001_000, maxClockSkewMs: 10_000 }),
    error => error.code === 'WFM_FRESH_CREATE_PREEXISTING_RESOURCE'
  );
});

test('request, tenant, provider or region drift fails closed', () => {
  const rec = record();
  const requestDrift = validEvidence(rec);
  requestDrift.providerRequestId = 'manual-create';
  assert.throws(
    () => verifyFreshCreateReadback(rec, requestDrift, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_REQUEST_MISMATCH'
  );

  const tenantDrift = validEvidence(rec);
  tenantDrift.tenantId = 'tenant-other';
  assert.throws(
    () => verifyFreshCreateReadback(rec, tenantDrift, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_ENVIRONMENT_MISMATCH'
  );
});

test('environment name or binding drift fails closed even when the provider request id is unchanged', () => {
  const rec = record();
  const nameDrift = validEvidence(rec);
  nameDrift.environmentName = 'wfm-manually-selected';
  assert.throws(
    () => verifyFreshCreateReadback(rec, nameDrift, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_ENVIRONMENT_BINDING_MISMATCH'
  );

  const digestDrift = validEvidence(rec);
  digestDrift.bindingDigest = 'f'.repeat(64);
  assert.throws(
    () => verifyFreshCreateReadback(rec, digestDrift, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_ENVIRONMENT_BINDING_MISMATCH'
  );
});

test('tampering with the proof is detected', () => {
  const rec = record();
  const evidence = validEvidence(rec);
  evidence.creationProof = {
    ...evidence.creationProof,
    environmentBinding: {
      ...evidence.creationProof.environmentBinding,
      environmentName: 'wfm-manual-environment'
    }
  };
  assert.throws(
    () => verifyFreshCreateReadback(rec, evidence, KEY, { now: () => 1_001_000 }),
    error => error.code === 'WFM_FRESH_CREATE_PROOF_INVALID'
  );
});

test('wrapper allows only verified FOUND to reach the existing outbox and keeps NOT_FOUND fail-closed', async () => {
  const rec = record();
  const calls = [];
  const outbox = {
    async get(key) {
      assert.equal(key, rec.queueKey);
      return rec;
    },
    async recordReconciliation(key, result) {
      calls.push({ key, result });
      return result;
    }
  };

  const found = await recordFreshCreateReconciliation(outbox, rec.queueKey, validEvidence(rec), KEY, { now: () => 1_001_000 });
  assert.deepEqual(found, { status: 'FOUND', providerResourceId: 'env-123' });

  const notFound = await recordFreshCreateReconciliation(outbox, rec.queueKey, { status: 'NOT_FOUND', readOnly: true }, KEY, { now: () => 1_001_000 });
  assert.deepEqual(notFound, { status: 'NOT_FOUND' });
  assert.equal(calls.length, 2);
});
