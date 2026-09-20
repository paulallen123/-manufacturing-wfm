'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createSemanticContractCompletionIngress } = require('./contract-completion-semantic-idempotency.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function receiptMac(core) {
  return createHmac('sha256', Buffer.from(RECEIPT_KEY, 'utf8')).update(stable(core)).digest('hex');
}

function contract(eventId, overrides = {}) {
  const base = {
    authenticated: true,
    provider: 'contract-provider',
    eventId,
    contractId: 'ctr-1001',
    contractVersion: '7',
    tenantId: 'tenant-a',
    completedAt: '2026-09-20T06:30:00Z',
    status: 'completed'
  };
  const value = { ...base, ...overrides };
  const core = {
    schemaVersion: 1,
    provider: value.provider,
    eventId: value.eventId,
    contractId: value.contractId,
    contractVersion: value.contractVersion,
    tenantId: value.tenantId,
    completedAt: value.completedAt,
    attemptTimestamp: Date.parse('2026-09-20T06:31:00Z'),
    payloadSha256: overrides.payloadSha256 || 'a'.repeat(64),
    verifierKeyId: 'provider-key-v1',
    receivedAt: Date.parse('2026-09-20T06:31:05Z')
  };
  value.verificationReceipt = { ...core, mac: receiptMac(core) };
  return value;
}

function makeStore({ crashOnceOnInsertPrefix = null } = {}) {
  const data = new Map();
  let crashPending = Boolean(crashOnceOnInsertPrefix);
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const working = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
      const tx = {
        get(key) { return working.has(key) ? structuredClone(working.get(key)) : null; },
        insert(key, value) {
          if (crashPending && key.startsWith(crashOnceOnInsertPrefix)) {
            crashPending = false;
            const error = new Error('simulated crash before commit');
            error.code = 'SIMULATED_CRASH';
            throw error;
          }
          if (working.has(key)) throw new Error('duplicate');
          working.set(key, structuredClone(value));
        }
      };
      const result = fn(tx);
      data.clear();
      for (const [k, v] of working) data.set(k, structuredClone(v));
      return result;
    },
    snapshot() { return [...data].map(([k, v]) => [k, structuredClone(v)]); }
  };
}

function baseIngressFactory() {
  return {
    receiveWithinTransaction(tx, delivery) {
      const key = 'event:' + delivery.contract.eventId;
      const existing = tx.get(key);
      if (existing) return { duplicate: true, key, contract: structuredClone(existing.contract) };
      const record = { contract: structuredClone(delivery.contract) };
      tx.insert(key, record);
      return { duplicate: false, key, contract: structuredClone(record.contract) };
    }
  };
}

function ingress(store) {
  return createSemanticContractCompletionIngress(store, { receiptKey: RECEIPT_KEY, baseIngressFactory });
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('different provider event ids for the same exact completed contract collapse to one semantic launch', () => {
  const store = makeStore();
  const first = ingress(store).receive({ contract: contract('evt-100') });
  const second = ingress(store).receive({ contract: contract('evt-101') });
  assert.equal(first.semanticDuplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.semanticDuplicate, true);
  assert.equal(second.contract.eventId, 'evt-100');
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-subject:')).length, 1);
});

test('same contract version with a different authenticated payload fails closed', () => {
  const store = makeStore();
  ingress(store).receive({ contract: contract('evt-100') });
  expectCode(
    () => ingress(store).receive({ contract: contract('evt-101', { payloadSha256: 'b'.repeat(64) }) }),
    'WFM_CONTRACT_VERSION_DRIFT'
  );
  assert.equal(store.snapshot().filter(([key]) => key === 'event:evt-101').length, 0);
});

test('tenant drift on the same contract version is rejected even when the event id changes', () => {
  const store = makeStore();
  ingress(store).receive({ contract: contract('evt-100') });
  expectCode(
    () => ingress(store).receive({ contract: contract('evt-101', { tenantId: 'tenant-b' }) }),
    'WFM_CONTRACT_VERSION_DRIFT'
  );
  assert.equal(store.snapshot().filter(([key]) => key === 'event:evt-101').length, 0);
});

test('a genuinely new contract version remains independently admissible', () => {
  const store = makeStore();
  const first = ingress(store).receive({ contract: contract('evt-100') });
  const next = ingress(store).receive({ contract: contract('evt-200', { contractVersion: '8', payloadSha256: 'c'.repeat(64) }) });
  assert.equal(first.semanticDuplicate, false);
  assert.equal(next.semanticDuplicate, false);
  assert.notEqual(first.semanticKey, next.semanticKey);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-subject:')).length, 2);
});

test('crash between authenticated event receipt and semantic dedupe rolls back both before retry', () => {
  const store = makeStore({ crashOnceOnInsertPrefix: 'wfm-contract-subject:' });
  expectCode(() => ingress(store).receive({ contract: contract('evt-100') }), 'SIMULATED_CRASH');
  assert.equal(store.snapshot().length, 0);

  const retry = ingress(store).receive({ contract: contract('evt-100') });
  assert.equal(retry.semanticDuplicate, false);
  assert.equal(store.snapshot().filter(([key]) => key === 'event:evt-100').length, 1);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-subject:')).length, 1);

  const duplicate = ingress(store).receive({ contract: contract('evt-100') });
  assert.equal(duplicate.semanticDuplicate, true);
  assert.equal(store.snapshot().filter(([key]) => key === 'event:evt-100').length, 1);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-subject:')).length, 1);
});