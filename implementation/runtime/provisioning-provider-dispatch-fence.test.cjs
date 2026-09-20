'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderDispatchFence, sha256 } = require('./provisioning-provider-dispatch-fence.cjs');

function makeRecord(overrides = {}) {
  const payload = {
    contract: { provider: 'contract-provider', contractId: 'ctr-1', contractVersion: '1', tenantId: 'tenant-a' },
    build: { artifactSha256: 'c'.repeat(64), sourceRevision: 'approved-source' },
    plan: { provider: 'railway', creationMode: 'fresh-provider-create', isolated: true, networkPolicy: 'private-until-ready' }
  };
  const record = {
    queueKey: 'queue-1',
    intentDigest: 'd'.repeat(64),
    payload,
    payloadDigest: sha256(payload),
    state: 'MUTATION_STARTED',
    generation: 4,
    leaseOwner: 'worker-a',
    leaseUntil: 5000,
    mutationWorkerId: 'worker-a',
    providerRequestId: 'wfm-create-request-1',
    ...overrides
  };
  return record;
}

function makeOutbox(record) {
  return { get() { return structuredClone(record); } };
}

function makeProvider() {
  const resources = new Map();
  const attempts = [];
  return {
    supportsIdempotencyKey: true,
    attempts,
    resources,
    async createIsolatedEnvironment(request) {
      attempts.push(structuredClone(request));
      if (!resources.has(request.idempotencyKey)) {
        resources.set(request.idempotencyKey, { providerResourceId: 'env-' + resources.size, created: true });
      }
      return structuredClone(resources.get(request.idempotencyKey));
    }
  };
}

function token(overrides = {}) {
  return { queueKey: 'queue-1', intentDigest: 'd'.repeat(64), workerId: 'worker-a', generation: 4, ...overrides };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('checks live ownership immediately before provider create and forwards exact idempotency/build identity', async () => {
  const provider = makeProvider();
  const fence = createProviderDispatchFence({ outbox: makeOutbox(makeRecord()), provider, now: () => 4000 });
  const response = await fence.dispatch(token(), 'wfm-create-request-1');

  assert.equal(provider.attempts.length, 1);
  assert.equal(provider.attempts[0].idempotencyKey, 'wfm-create-request-1');
  assert.equal(provider.attempts[0].artifactSha256, 'c'.repeat(64));
  assert.equal(provider.attempts[0].plan.isolated, true);
  assert.equal(provider.attempts[0].plan.creationMode, 'fresh-provider-create');
  assert.equal(response.permit.generation, 4);
  assert.match(response.permit.dispatchDigest, /^[a-f0-9]{64}$/);
});

test('expired worker is fenced before provider side effects', async () => {
  const provider = makeProvider();
  const fence = createProviderDispatchFence({ outbox: makeOutbox(makeRecord()), provider, now: () => 5000 });
  await assert.rejects(() => fence.dispatch(token(), 'wfm-create-request-1'), error => error && error.code === 'WFM_PROVIDER_DISPATCH_LEASE_EXPIRED');
  assert.equal(provider.attempts.length, 0);
});

test('reclaimed generation or different worker is fenced before provider side effects', async () => {
  const provider = makeProvider();
  const record = makeRecord({ generation: 5, leaseOwner: 'worker-b', mutationWorkerId: 'worker-b' });
  const fence = createProviderDispatchFence({ outbox: makeOutbox(record), provider, now: () => 4000 });
  await assert.rejects(() => fence.dispatch(token(), 'wfm-create-request-1'), error => error && error.code === 'WFM_PROVIDER_DISPATCH_STALE_WORKER');
  assert.equal(provider.attempts.length, 0);
});

test('state transition to reconciliation fences a paused worker', async () => {
  const provider = makeProvider();
  const fence = createProviderDispatchFence({ outbox: makeOutbox(makeRecord({ state: 'RECONCILE_REQUIRED' })), provider, now: () => 4000 });
  await assert.rejects(() => fence.dispatch(token(), 'wfm-create-request-1'), error => error && error.code === 'WFM_PROVIDER_DISPATCH_STATE_CHANGED');
  assert.equal(provider.attempts.length, 0);
});

test('tampered sealed payload is rejected before provider side effects', async () => {
  const provider = makeProvider();
  const record = makeRecord();
  record.payload.plan.networkPolicy = 'public';
  const fence = createProviderDispatchFence({ outbox: makeOutbox(record), provider, now: () => 4000 });
  await assert.rejects(() => fence.dispatch(token(), 'wfm-create-request-1'), error => error && error.code === 'WFM_PROVIDER_DISPATCH_PAYLOAD_TAMPERED');
  assert.equal(provider.attempts.length, 0);
});

test('duplicate dispatch attempts reuse one downstream idempotency identity', async () => {
  const provider = makeProvider();
  const fence = createProviderDispatchFence({ outbox: makeOutbox(makeRecord()), provider, now: () => 4000 });
  const first = await fence.dispatch(token(), 'wfm-create-request-1');
  const second = await fence.dispatch(token(), 'wfm-create-request-1');

  assert.equal(provider.attempts.length, 2);
  assert.equal(provider.resources.size, 1);
  assert.equal(first.result.providerResourceId, second.result.providerResourceId);
});

test('provider adapters that cannot guarantee idempotency are refused', () => {
  assert.throws(() => createProviderDispatchFence({
    outbox: makeOutbox(makeRecord()),
    provider: { createIsolatedEnvironment() {} },
    now: () => 4000
  }), /idempotency-key handling/);
});

test('mismatched provider request id is fenced before provider side effects', () => {
  const provider = makeProvider();
  const fence = createProviderDispatchFence({ outbox: makeOutbox(makeRecord()), provider, now: () => 4000 });
  expectCode(() => fence.authorize(token(), 'wrong-request'), 'WFM_PROVIDER_DISPATCH_REQUEST_ID_MISMATCH');
  assert.equal(provider.attempts.length, 0);
});
