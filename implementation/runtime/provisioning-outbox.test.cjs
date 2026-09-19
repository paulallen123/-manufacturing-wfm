'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createProvisioningOutbox: createProvisioningOutboxBase } = require('./provisioning-outbox.cjs');
const { stable } = require('./contract-completion-ingress.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';

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

function createProvisioningOutbox(store, options = {}) {
  return createProvisioningOutboxBase(store, { ...options, contractReceiptKey: RECEIPT_KEY });
}

function makeEvidence(eventId = 'evt-1') {
  const core = {
    schemaVersion: 1,
    provider: 'contract-provider',
    eventId,
    contractId: 'ctr-1',
    contractVersion: '1',
    tenantId: 'tenant-a',
    completedAt: '2026-09-19T04:00:00Z',
    attemptTimestamp: Date.parse('2026-09-19T04:01:00Z'),
    payloadSha256: 'f'.repeat(64),
    verifierKeyId: 'test-provider-key-v1',
    receivedAt: Date.parse('2026-09-19T04:01:01Z')
  };
  const mac = createHmac('sha256', Buffer.from(RECEIPT_KEY, 'utf8')).update(stable(core)).digest('hex');
  const verificationReceipt = { ...core, mac };
  const receiptSha256 = createHash('sha256').update(stable(verificationReceipt)).digest('hex');
  return { authenticated: true, eventId, receiptSha256, verificationReceipt };
}

function intent(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: { provider: 'contract-provider', contractId: 'ctr-1', contractVersion: '1', tenantId: 'tenant-a', completedAt: '2026-09-19T04:00:00Z' },
    scope: { graphVersion: '2026-09-19.1', graphFingerprint: 'd'.repeat(64), revision: 'scope-a', purchasedScope: ['time'], operationsDigest: 'b'.repeat(64) },
    build: { sourceRevision: 'abc', artifactSha256: 'c'.repeat(64), approvalId: 'approved-1' },
    plan: { provider: 'railway', region: 'eu-west', creationMode: 'fresh-provider-create', isolated: true, networkPolicy: 'private-until-ready', secretsPolicy: 'server-managed-per-tenant' },
    completionEvidence: makeEvidence(),
    intentDigest: 'a'.repeat(64),
    queueKey: 'wfm-provision:v1:queue-1',
    ...overrides
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

function allChecks(overrides = {}) {
  return { health: true, security: true, isolation: true, approvedBuild: true, secrets: true, network: true, readiness: true, ...overrides };
}

function verifiedSubject(record) {
  return structuredClone(record.verificationSubject);
}

test('requires durable transactional storage and a trusted contract receipt key', () => {
  assert.throws(() => createProvisioningOutboxBase({ transaction() {} }, { contractReceiptKey: RECEIPT_KEY }), /durable transactional store/);
  assert.throws(() => createProvisioningOutboxBase(makeStore()), /trusted contract receipt verification key/);
});

test('duplicate authenticated completed-contract deliveries create one durable queue item', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  const first = outbox.enqueue(intent());
  const duplicate = outbox.enqueue(intent({ completionEvidence: makeEvidence('evt-redelivery') }));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.snapshot().length, 1);
});

test('tampered or detached completion evidence is rejected before durable queue admission', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  const tampered = intent();
  tampered.completionEvidence.verificationReceipt.mac = '0'.repeat(64);
  expectCode(() => outbox.enqueue(tampered), 'WFM_CONTRACT_RECEIPT_INVALID');
  assert.equal(store.snapshot().length, 0);

  const detached = intent();
  detached.completionEvidence.eventId = 'evt-other';
  expectCode(() => outbox.enqueue(detached), 'WFM_CONTRACT_RECEIPT_SUBJECT_MISMATCH');
  assert.equal(store.snapshot().length, 0);
});

test('same business queue identity cannot be reused for a changed sealed intent', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  expectCode(() => outbox.enqueue(intent({ intentDigest: 'e'.repeat(64) })), 'WFM_OUTBOX_IDENTITY_DRIFT');
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
  assert.equal(started.record.mutationWorkerId, 'worker-a');

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

test('confirmed fresh creation seals an exact verification subject before readiness checks', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const created = outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });
  assert.equal(created.state, 'VERIFY_REQUIRED');
  assert.equal(created.verificationSubject.queueKey, intent().queueKey);
  assert.equal(created.verificationSubject.intentDigest, intent().intentDigest);
  assert.equal(created.verificationSubject.providerResourceId, 'project-123');
  assert.equal(created.verificationSubject.artifactSha256, intent().build.artifactSha256);
  assert.equal(created.verificationSubject.graphFingerprint, intent().scope.graphFingerprint);
  assert.match(created.verificationSubjectDigest, /^[a-f0-9]{64}$/);

  const ready = outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    subject: verifiedSubject(created),
    checks: allChecks()
  });
  assert.equal(ready.state, 'COMPLETED');
});

test('the cloud mutation worker cannot self-verify readiness', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const created = outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });

  expectCode(() => outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'worker-a',
    subject: verifiedSubject(created),
    checks: allChecks()
  }), 'WFM_OUTBOX_VERIFIER_NOT_INDEPENDENT');
});

test('stale or wrong-environment verification evidence is rejected', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const created = outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });
  const wrongSubject = verifiedSubject(created);
  wrongSubject.providerResourceId = 'project-old';

  expectCode(() => outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    subject: wrongSubject,
    checks: allChecks()
  }), 'WFM_OUTBOX_VERIFICATION_SUBJECT_MISMATCH');
});

test('reconciled creation uses the found environment as the only verifiable subject', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  outbox.recordProviderOutcome(claim.token, { result: 'AMBIGUOUS' });
  const reconciled = outbox.recordReconciliation(intent().queueKey, { status: 'FOUND', providerResourceId: 'project-recovered' });
  assert.equal(reconciled.state, 'VERIFY_REQUIRED');
  assert.equal(reconciled.verificationSubject.providerResourceId, 'project-recovered');

  const ready = outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    subject: verifiedSubject(reconciled),
    checks: allChecks()
  });
  assert.equal(ready.state, 'COMPLETED');
});

test('failed readiness check quarantines rather than launching', () => {
  const store = makeStore();
  const outbox = createProvisioningOutbox(store, { now: () => 1000 });
  outbox.enqueue(intent());
  const claim = outbox.claim(intent().queueKey, 'worker-a');
  outbox.beginMutation(claim.token);
  const created = outbox.recordProviderOutcome(claim.token, { result: 'CONFIRMED_CREATED', providerResourceId: 'project-123' });
  const result = outbox.recordIndependentVerification(intent().queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    subject: verifiedSubject(created),
    checks: allChecks({ network: false })
  });
  assert.equal(result.state, 'QUARANTINED');
});
