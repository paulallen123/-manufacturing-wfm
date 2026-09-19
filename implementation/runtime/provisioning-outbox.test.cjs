'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProvisioningOutbox } = require('./provisioning-outbox.cjs');

function makeStore(seed) {
  const data = new Map(seed ? seed.map(([k, v]) => [k, structuredClone(v)]) : []);
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const working = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
      const tx = {
        get(key) { return working.has(key) ? structuredClone(working.get(key)) : null; },
        insert(key, value) { if (working.has(key)) throw new Error('duplicate'); working.set(key, structuredClone(value)); },
        replace(key, value) { if (!working.has(key)) throw new Error('missing'); working.set(key, structuredClone(value)); }
      };
      const result = fn(tx);
      data.clear();
      for (const [k, v] of working) data.set(k, structuredClone(v));
      return result;
    },
    snapshot() { return [...data].map(([k, v]) => [k, structuredClone(v)]); }
  };
}

function intent(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: { provider: 'contract-provider', contractId: 'ctr-1', contractVersion: '1', tenantId: 'tenant-a', completedAt: '2026-09-19T04:00:00Z' },
    scope: { graphVersion: '2026-09-19.1', revision: 'scope-a', purchasedScope: ['time'], operationsDigest: 'b'.repeat(64) },
    build: { sourceRevision: 'abc', artifactSha256: 'c'.repeat(64), approvalId: 'approved-1' },
    plan: { provider: 'railway', region: 'eu-west', creationMode: 'fresh-provider-create', isolated: true, networkPolicy: 'private-until-ready', secretsPolicy: 'server-managed-per-tenant' },
    completionEvidence: { authenticated: true, eventId: 'evt-1' },
    intentDigest: 'a'.repeat(64),
    queueKey: 'wfm-provision:v1:queue-1',
    ...overrides
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('requires durable transactional storage', () => {
  assert.throws(() => createProvisioningOutbox({ transaction() {} }), /durable transactional store/);
});

test('duplicate completed-contract deliveries create one durable queue item', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  const first = outbox.enqueue(intent());
  const duplicate = outbox.enqueue(intent({ completionEvidence: { authenticated: true, eventId: 'evt-redelivery' } }));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.snapshot().length, 1);
});

test('same business queue identity cannot be reused for a changed sealed intent', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  expectCode(() => outbox.enqueue(intent({ intentDigest: 'd'.repeat(64) })), 'WFM_OUTBOX_IDENTITY_DRIFT');
});

test('crash after claim but before mutation is recoverable with a higher generation', () => {
  let now = 1000;
  const store = makeStore();
  let outbox = createProvisioningOutbox(store, { now: () => now, leaseMs: 1000 });
  outbox.enqueue(intent());
  const first = outbox.claim(intent().queueKey, 'worker-a');
  assert.equal(first.action, 'DISPATCH_ALLOWED');

  const snapshot = store.snapshot();
  now = 2501;
  outbox = createProvisioningOutbox(makeStore(snapshot), { now: () => now, leaseMs: 1000 });
  const recovered = outbox.claim(intent().queueKey, 'worker-b');
  assert.equal(recovered.action, 'DISPATCH_ALLOWED');
  assert.equal(recovered.token.generation, first.token.generation + 1);
  expectCode(() => outbox.beginMutation(first.token), 'WFM_OUTBOX_STALE_WORKER');
});

test('provider mutation intent is committed before the cloud call and survives a crash as reconcile-only', () => {
  const store = makeStore();
  let outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  const started = outbox.beginMutation(claim.token);
  assert.match(started.providerRequestId, /^wfm-create-/);

  const restartedStore = makeStore(store.snapshot());
  outbox = createProvisioningOutbox(restartedStore, { now: () => 999999 });
  const afterCrash = outbox.claim(intent().queueKey, 'worker-b');
  assert.equal(afterCrash.action, 'RECONCILE_ONLY');
});

test('ambiguous create can never become a blind second create', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const ambiguous = outbox.recordProviderOutcome(claim.token, { result: 'AMBIGUOUS' });
  assert.equal(ambiguous.state, 'RECONCILE_REQUIRED');
  assert.equal(outbox.claim(intent().queueKey, 'worker-b').action, 'RECONCILE_ONLY');

  const notFound = outbox.recordReconciliation(intent().queueKey, { status: 'NOT_FOUND' });
  assert.equal(notFound.state, 'QUARANTINED');
  assert.equal(notFound.lastDecision, 'RECONCILED_NOT_FOUND_NO_BLIND_RETRY');
});

test('confirmed fresh creation still requires independent readiness verification', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const created = outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });
  assert.equal(created.state, 'VERIFY_REQUIRED');
  assert.equal(outbox.claim(intent().queueKey, 'worker-b').action, 'VERIFY_ONLY');

  const ready = outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    checks: { health: true, security: true, isolation: true, approvedBuild: true, secrets: true, network: true, readiness: true }
  });
  assert.equal(ready.state, 'COMPLETED');
});

test('failed readiness check quarantines rather than launching', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });
  const result = outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    checks: { health: true, security: true, isolation: true, approvedBuild: true, secrets: true, network: false, readiness: true }
  });
  assert.equal(result.state, 'QUARANTINED');
});
