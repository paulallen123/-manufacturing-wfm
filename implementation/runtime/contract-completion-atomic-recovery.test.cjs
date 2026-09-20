'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticContractCompletionIngress } = require('./contract-completion-semantic-idempotency.cjs');
const { verifyContractCompletionReceipt } = require('./contract-completion-ingress.cjs');
const { createProvisioningOutbox, sha256 } = require('./provisioning-outbox.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-09-20T07:40:05Z');
const ATTEMPT = Date.parse('2026-09-20T07:40:00Z');

function makeStore() {
  const data = new Map();
  let crashPending = true;
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const working = new Map([...data].map(([key, value]) => [key, structuredClone(value)]));
      const tx = {
        get(key) { return working.has(key) ? structuredClone(working.get(key)) : null; },
        insert(key, value) {
          if (crashPending && key.startsWith('wfm-contract-subject:')) {
            crashPending = false;
            const error = new Error('simulated process crash before atomic commit');
            error.code = 'SIMULATED_CRASH';
            throw error;
          }
          if (working.has(key)) throw new Error('duplicate insert');
          working.set(key, structuredClone(value));
        },
        replace(key, value) {
          if (!working.has(key)) throw new Error('replace missing');
          working.set(key, structuredClone(value));
        }
      };
      const result = fn(tx);
      data.clear();
      for (const [key, value] of working) data.set(key, structuredClone(value));
      return result;
    },
    snapshot() { return [...data].map(([key, value]) => [key, structuredClone(value)]); }
  };
}

function verifier({ eventId, rawBody }) {
  const event = JSON.parse(rawBody.toString('utf8'));
  return {
    authenticated: true,
    binding: { eventId: true, attemptTimestamp: true, rawBody: true },
    keyId: 'provider-key-v1',
    event: { ...event, providerEventId: eventId }
  };
}

function delivery() {
  const body = JSON.stringify({
    type: 'contract.completed',
    contract: {
      contractId: 'ctr-atomic-1001',
      contractVersion: '4',
      tenantId: 'tenant-atomic-a',
      completedAt: '2026-09-20T07:39:30Z',
      status: 'completed'
    }
  });
  return {
    provider: 'contract-provider',
    eventId: 'evt-atomic-1',
    attemptTimestamp: ATTEMPT,
    rawBody: body,
    headers: { signature: 'verified-by-test-adapter' }
  };
}

function ingress(store) {
  return createSemanticContractCompletionIngress(store, {
    now: () => NOW,
    receiptKey: RECEIPT_KEY,
    providerVerifiers: { 'contract-provider': verifier }
  });
}

function intentFor(contract) {
  const contractSubject = {
    provider: contract.provider,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    tenantId: contract.tenantId,
    completedAt: contract.completedAt
  };
  const scope = { graphVersion: 'adaptive-scope-v1', graphFingerprint: 'a'.repeat(64) };
  const build = { artifactSha256: 'b'.repeat(64) };
  const plan = { creationMode: 'fresh-provider-create', isolated: true };
  const schemaVersion = 1;
  const verified = verifyContractCompletionReceipt(contract, RECEIPT_KEY);
  return {
    schemaVersion,
    queueKey: 'wfm-provision:v1:' + sha256({
      provider: contract.provider,
      contractId: contract.contractId,
      contractVersion: contract.contractVersion,
      tenantId: contract.tenantId
    }),
    intentDigest: sha256({ schemaVersion, contract: contractSubject, scope, build, plan }),
    contract: contractSubject,
    scope,
    build,
    plan,
    completionEvidence: {
      authenticated: true,
      eventId: contract.eventId,
      receiptSha256: verified.receiptSha256,
      verificationReceipt: structuredClone(contract.verificationReceipt)
    }
  };
}

test('crash then restart cannot leave a partial receipt or create a second provisioning job', () => {
  const store = makeStore();

  assert.throws(
    () => ingress(store).receive(delivery()),
    error => error && error.code === 'SIMULATED_CRASH'
  );
  assert.equal(store.snapshot().length, 0);

  const accepted = ingress(store).receive(delivery());
  assert.equal(accepted.semanticDuplicate, false);

  const duplicate = ingress(store).receive(delivery());
  assert.equal(duplicate.semanticDuplicate, true);

  const intent = intentFor(accepted.contract);
  const firstQueue = createProvisioningOutbox(store, { now: () => NOW, contractReceiptKey: RECEIPT_KEY }).enqueue(intent);
  const afterRestart = createProvisioningOutbox(store, { now: () => NOW + 1000, contractReceiptKey: RECEIPT_KEY }).enqueue(intent);

  assert.equal(firstQueue.duplicate, false);
  assert.equal(afterRestart.duplicate, true);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-event:')).length, 1);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-contract-subject:')).length, 1);
  assert.equal(store.snapshot().filter(([key]) => key.startsWith('wfm-provision:')).length, 1);
});