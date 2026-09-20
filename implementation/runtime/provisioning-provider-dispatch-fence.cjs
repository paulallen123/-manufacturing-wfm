'use strict';

const { createHash } = require('node:crypto');
const { createFreshCreateProof } = require('./provisioning-fresh-create-proof.cjs');

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

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function assertLiveMutationAuthority(record, token, expectedProviderRequestId, nowMs) {
  if (!record || typeof record !== 'object') fail('WFM_PROVIDER_DISPATCH_NOT_FOUND', 'Provisioning queue item was not found.', 404);
  if (!token || typeof token !== 'object') fail('WFM_PROVIDER_DISPATCH_TOKEN_REQUIRED', 'A provisioning worker token is required.', 400);
  if (record.state !== 'MUTATION_STARTED') {
    fail('WFM_PROVIDER_DISPATCH_STATE_CHANGED', 'Provider creation is no longer authorised from the current provisioning state.');
  }
  if (
    record.queueKey !== token.queueKey ||
    record.intentDigest !== token.intentDigest ||
    record.leaseOwner !== token.workerId ||
    Number(record.generation) !== Number(token.generation) ||
    record.mutationWorkerId !== token.workerId
  ) {
    fail('WFM_PROVIDER_DISPATCH_STALE_WORKER', 'Provisioning worker no longer owns this provider mutation.');
  }
  if (!Number.isFinite(Number(record.leaseUntil)) || Number(record.leaseUntil) <= nowMs) {
    fail('WFM_PROVIDER_DISPATCH_LEASE_EXPIRED', 'Provisioning worker lease expired before the provider create call.');
  }

  const requestId = requireString(expectedProviderRequestId, 'WFM_PROVIDER_DISPATCH_REQUEST_ID_REQUIRED', 'Provider request identity is required.');
  if (record.providerRequestId !== requestId) {
    fail('WFM_PROVIDER_DISPATCH_REQUEST_ID_MISMATCH', 'Provider request identity changed before environment creation.');
  }
  if (sha256(record.payload) !== record.payloadDigest) {
    fail('WFM_PROVIDER_DISPATCH_PAYLOAD_TAMPERED', 'Sealed provisioning payload changed before provider environment creation.');
  }

  const plan = record.payload && record.payload.plan;
  if (!plan || plan.creationMode !== 'fresh-provider-create' || plan.isolated !== true) {
    fail('WFM_PROVIDER_DISPATCH_UNSAFE_PLAN', 'Provider creation requires the sealed fresh isolated environment plan.', 400);
  }
  const artifactSha256 = requireString(
    record.payload && record.payload.build && record.payload.build.artifactSha256,
    'WFM_PROVIDER_DISPATCH_BUILD_DIGEST_REQUIRED',
    'Provider creation requires the exact approved build digest.'
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) {
    fail('WFM_PROVIDER_DISPATCH_BUILD_DIGEST_INVALID', 'Approved build digest must be SHA-256.', 400);
  }

  return {
    schemaVersion: 1,
    queueKey: record.queueKey,
    intentDigest: record.intentDigest,
    workerId: token.workerId,
    generation: Number(token.generation),
    leaseUntil: Number(record.leaseUntil),
    providerRequestId: requestId,
    artifactSha256,
    contract: clone(record.payload.contract),
    plan: clone(plan)
  };
}

function proofRecordFromPermit(permit) {
  return {
    state: 'MUTATION_STARTED',
    queueKey: permit.queueKey,
    intentDigest: permit.intentDigest,
    providerRequestId: permit.providerRequestId,
    generation: permit.generation,
    payload: {
      contract: clone(permit.contract),
      plan: clone(permit.plan)
    }
  };
}

function createProviderDispatchFence({ outbox, provider, proofKey, now = Date.now } = {}) {
  if (!outbox || typeof outbox.get !== 'function') {
    throw new Error('Provider dispatch fence requires the existing provisioning outbox.');
  }
  if (!provider || typeof provider.createIsolatedEnvironment !== 'function') {
    throw new Error('Provider dispatch fence requires a provider create adapter.');
  }
  if (provider.supportsIdempotencyKey !== true) {
    throw new Error('Provider create adapter must guarantee idempotency-key handling.');
  }
  if (provider.supportsCreationProofPersistence !== true) {
    throw new Error('Provider create adapter must persist the autonomous creation proof on the created environment for later provider readback.');
  }
  if (!proofKey) throw new Error('Provider dispatch fence requires the fresh-create proof key.');

  function authorize(token, providerRequestId, nowMs = Number(now())) {
    if (!Number.isFinite(nowMs)) fail('WFM_PROVIDER_DISPATCH_CLOCK_INVALID', 'Provisioning dispatch clock is invalid.', 500);
    const queueKey = requireString(token && token.queueKey, 'WFM_PROVIDER_DISPATCH_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
    const record = outbox.get(queueKey);
    const permit = assertLiveMutationAuthority(record, token, providerRequestId, nowMs);
    return Object.freeze({
      ...permit,
      dispatchDigest: sha256({
        queueKey: permit.queueKey,
        intentDigest: permit.intentDigest,
        workerId: permit.workerId,
        generation: permit.generation,
        providerRequestId: permit.providerRequestId,
        artifactSha256: permit.artifactSha256,
        plan: permit.plan
      })
    });
  }

  async function dispatch(token, providerRequestId) {
    const nowMs = Number(now());
    // Deliberately no await or other work between the final authority check and
    // constructing the signed proof that the provider must persist with the new environment.
    const permit = authorize(token, providerRequestId, nowMs);
    const creationProof = createFreshCreateProof(proofRecordFromPermit(permit), proofKey, { issuedAt: nowMs });
    const result = await provider.createIsolatedEnvironment({
      idempotencyKey: permit.providerRequestId,
      fencingToken: `${permit.queueKey}:${permit.generation}`,
      queueKey: permit.queueKey,
      intentDigest: permit.intentDigest,
      workerId: permit.workerId,
      generation: permit.generation,
      artifactSha256: permit.artifactSha256,
      contract: clone(permit.contract),
      plan: clone(permit.plan),
      environmentBinding: clone(creationProof.environmentBinding),
      creationProof: clone(creationProof),
      dispatchDigest: permit.dispatchDigest
    });
    return { permit, creationProof, result };
  }

  return { authorize, dispatch };
}

module.exports = {
  createProviderDispatchFence,
  assertLiveMutationAuthority,
  proofRecordFromPermit,
  sha256,
  canonical
};
