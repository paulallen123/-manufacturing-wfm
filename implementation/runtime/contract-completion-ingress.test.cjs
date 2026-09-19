'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { createContractCompletionIngress, verifyContractCompletionReceipt } = require('./contract-completion-ingress.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const PROVIDER_KEY = 'provider-test-key-0123456789abcdef0123456789abcdef';

function makeStore(seed) {
  const data = new Map(seed ? seed.map(([k, v]) => [k, structuredClone(v)]) : []);
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const working = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
      const tx = {
        get(key) { return working.has(key) ? structuredClone(working.get(key)) : null; },
        insert(key, value) { if (working.has(key)) throw new Error('duplicate'); working.set(key, structuredClone(value)); }
      };
      const result = fn(tx);
      data.clear();
      for (const [k, v] of working) data.set(k, structuredClone(v));
      return result;
    },
    snapshot() { return [...data].map(([k, v]) => [k, structuredClone(v)]); }
  };
}

function body(overrides = {}) {
  const { contract: contractOverrides = {}, ...rootOverrides } = overrides;
  return JSON.stringify({
    type: 'contract.completed',
    ...rootOverrides,
    contract: {
      contractId: 'ctr-1001',
      contractVersion: '7',
      tenantId: 'tenant-a',
      completedAt: '2026-09-19T09:30:00Z',
      status: 'completed',
      ...contractOverrides
    }
  });
}

function signature(eventId, attemptTimestamp, rawBody) {
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return createHmac('sha256', PROVIDER_KEY).update(String(eventId)).update('\n').update(String(attemptTimestamp)).update('\n').update(bytes).digest('hex');
}

function verifier({ eventId, attemptTimestamp, rawBody, headers }) {
  const actual = String(headers['x-contract-signature'] || '');
  const expected = signature(eventId, attemptTimestamp, rawBody);
  const authenticated = /^[a-f0-9]{64}$/i.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  return {
    authenticated,
    binding: { eventId: true, attemptTimestamp: true, rawBody: true },
    keyId: 'test-provider-key-v1',
    event: authenticated ? JSON.parse(rawBody.toString('utf8')) : null
  };
}

function ingress(store, now = Date.parse('2026-09-19T09:42:00Z')) {
  return createContractCompletionIngress(store, {
    now: () => now,
    receiptKey: RECEIPT_KEY,
    providerVerifiers: { 'contract-provider': verifier }
  });
}

function delivery(rawBody = body(), overrides = {}) {
  const attemptTimestamp = overrides.attemptTimestamp || '2026-09-19T09:41:00Z';
  const eventId = overrides.eventId || 'evt-100';
  return {
    provider: 'contract-provider',
    eventId,
    attemptTimestamp,
    rawBody,
    headers: { 'x-contract-signature': signature(eventId, attemptTimestamp, rawBody) }
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('authenticates the exact delivery, stores one durable receipt and returns a launch-safe contract', () => {
  const store = makeStore();
  const accepted = ingress(store).receive(delivery());
  assert.equal(accepted.duplicate, false);
  assert.equal(accepted.contract.authenticated, true);
  assert.equal(accepted.contract.status, 'completed');
  assert.match(accepted.contract.verificationReceipt.mac, /^[a-f0-9]{64}$/);
  assert.equal(verifyContractCompletionReceipt(accepted.contract, RECEIPT_KEY).ok, true);
  assert.equal(store.snapshot().length, 1);
});

test('valid provider retry is acknowledged once without creating a second receipt', () => {
  const store = makeStore();
  const first = ingress(store).receive(delivery());
  const duplicate = ingress(store).receive(delivery());
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.contract.verificationReceipt, first.contract.verificationReceipt);
  assert.equal(store.snapshot().length, 1);
});

test('same authenticated event id with a changed body is rejected as identity drift', () => {
  const store = makeStore();
  ingress(store).receive(delivery());
  const changed = body({ contract: { tenantId: 'tenant-b' } });
  expectCode(() => ingress(store).receive(delivery(changed)), 'WFM_CONTRACT_EVENT_ID_DRIFT');
});

test('stale, future, invalid-signature and incomplete-binding deliveries fail closed', () => {
  const store = makeStore();
  expectCode(() => ingress(store).receive(delivery(body(), { attemptTimestamp: '2026-09-19T09:30:00Z' })), 'WFM_CONTRACT_EVENT_STALE');
  expectCode(() => ingress(store).receive(delivery(body(), { attemptTimestamp: '2026-09-19T09:44:00Z' })), 'WFM_CONTRACT_EVENT_FROM_FUTURE');

  const invalid = delivery();
  invalid.headers['x-contract-signature'] = '0'.repeat(64);
  expectCode(() => ingress(store).receive(invalid), 'WFM_CONTRACT_EVENT_UNAUTHENTICATED');

  const weakBinding = createContractCompletionIngress(store, {
    now: () => Date.parse('2026-09-19T09:42:00Z'),
    receiptKey: RECEIPT_KEY,
    providerVerifiers: {
      'contract-provider': () => ({ authenticated: true, binding: { eventId: true, rawBody: true }, keyId: 'bad-adapter', event: JSON.parse(body()) })
    }
  });
  expectCode(() => weakBinding.receive(delivery()), 'WFM_CONTRACT_EVENT_SIGNATURE_BINDING_INCOMPLETE');
});

test('a bare authenticated flag or a tampered receipt cannot satisfy provisioning trust', () => {
  const bare = {
    authenticated: true,
    provider: 'contract-provider',
    eventId: 'evt-100',
    contractId: 'ctr-1001',
    contractVersion: '7',
    tenantId: 'tenant-a',
    completedAt: '2026-09-19T09:30:00Z',
    status: 'completed'
  };
  expectCode(() => verifyContractCompletionReceipt(bare, RECEIPT_KEY), 'WFM_CONTRACT_RECEIPT_REQUIRED');

  const accepted = ingress(makeStore()).receive(delivery()).contract;
  accepted.tenantId = 'tenant-b';
  expectCode(() => verifyContractCompletionReceipt(accepted, RECEIPT_KEY), 'WFM_CONTRACT_RECEIPT_SUBJECT_MISMATCH');

  const accepted2 = ingress(makeStore()).receive(delivery()).contract;
  accepted2.verificationReceipt.mac = 'f'.repeat(64);
  expectCode(() => verifyContractCompletionReceipt(accepted2, RECEIPT_KEY), 'WFM_CONTRACT_RECEIPT_INVALID');
});

test('non-completed contract events cannot produce a receipt', () => {
  const store = makeStore();
  const notCompleted = body({ type: 'contract.sent', contract: { status: 'sent' } });
  expectCode(() => ingress(store).receive(delivery(notCompleted)), 'WFM_CONTRACT_EVENT_TYPE_UNSUPPORTED');
});
