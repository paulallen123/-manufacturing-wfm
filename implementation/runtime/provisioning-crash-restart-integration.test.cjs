'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createProvisioningOutbox, sha256 } = require('./provisioning-outbox.cjs');
const { stable } = require('./contract-completion-ingress.cjs');
const { createFreshCreateProof } = require('./provisioning-fresh-create-proof.cjs');
const { createReadOnlyProvisioningReconciler } = require('./provisioning-readonly-reconciler.cjs');
const { createRailwayReadOnlyEnvironmentAdapter } = require('./railway-readonly-environment-adapter.cjs');
const { deriveProvisioningEnvironmentBinding } = require('./provisioning-environment-binding.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const PROOF_KEY = 'fresh-create-proof-key-0123456789abcdef0123456789abcdef';

function makeStore(seed) {
  const data = new Map(seed ? seed.map(([key, value]) => [key, structuredClone(value)]) : []);
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const working = new Map([...data].map(([key, value]) => [key, structuredClone(value)]));
      const tx = {
        get(key) { return working.has(key) ? structuredClone(working.get(key)) : null; },
        insert(key, value) { if (working.has(key)) throw new Error('duplicate'); working.set(key, structuredClone(value)); },
        replace(key, value) { if (!working.has(key)) throw new Error('missing'); working.set(key, structuredClone(value)); }
      };
      const result = fn(tx);
      data.clear();
      for (const [key, value] of working) data.set(key, structuredClone(value));
      return result;
    },
    snapshot() { return [...data].map(([key, value]) => [key, structuredClone(value)]); }
  };
}

function completionEvidence() {
  const core = {
    schemaVersion: 1,
    provider: 'contract-provider',
    eventId: 'evt-crash-restart-1',
    contractId: 'ctr-crash-restart',
    contractVersion: '1',
    tenantId: 'tenant-a',
    completedAt: '2026-09-19T16:00:00Z',
    attemptTimestamp: Date.parse('2026-09-19T16:00:05Z'),
    payloadSha256: 'f'.repeat(64),
    verifierKeyId: 'test-provider-key-v1',
    receivedAt: Date.parse('2026-09-19T16:00:06Z')
  };
  const mac = createHmac('sha256', Buffer.from(RECEIPT_KEY, 'utf8')).update(stable(core)).digest('hex');
  const verificationReceipt = { ...core, mac };
  const receiptSha256 = createHash('sha256').update(stable(verificationReceipt)).digest('hex');
  return { authenticated: true, eventId: core.eventId, receiptSha256, verificationReceipt };
}

function launchIntent() {
  const value = {
    schemaVersion: 1,
    contract: {
      provider: 'contract-provider',
      contractId: 'ctr-crash-restart',
      contractVersion: '1',
      tenantId: 'tenant-a',
      completedAt: '2026-09-19T16:00:00Z'
    },
    scope: {
      graphVersion: '2026-09-19.1',
      graphFingerprint: 'd'.repeat(64),
      revision: 'scope-crash-restart',
      purchasedScope: ['time'],
      operationsDigest: 'b'.repeat(64)
    },
    build: {
      sourceRevision: 'approved-source-revision',
      artifactSha256: 'c'.repeat(64),
      approvalId: 'approved-build-1'
    },
    plan: {
      provider: 'railway',
      region: 'eu-west',
      creationMode: 'fresh-provider-create',
      isolated: true,
      networkPolicy: 'private-until-ready',
      secretsPolicy: 'server-managed-per-tenant'
    },
    completionEvidence: completionEvidence()
  };
  value.intentDigest = sha256({
    schemaVersion: value.schemaVersion,
    contract: value.contract,
    scope: value.scope,
    build: value.build,
    plan: value.plan
  });
  value.queueKey = 'wfm-provision:v1:' + sha256({
    provider: value.contract.provider,
    contractId: value.contract.contractId,
    contractVersion: value.contract.contractVersion,
    tenantId: value.contract.tenantId
  });
  return value;
}

function allChecks() {
  return {
    health: true,
    security: true,
    isolation: true,
    approvedBuild: true,
    secrets: true,
    network: true,
    readiness: true
  };
}

test('crash after cloud create is recovered by read-only Railway reconciliation with no second create', async () => {
  let now = 1_000_000;
  const store = makeStore();
  let outbox = createProvisioningOutbox(store, {
    now: () => now,
    leaseMs: 1000,
    contractReceiptKey: RECEIPT_KEY
  });
  const intent = launchIntent();
  outbox.enqueue(intent);

  const claim = outbox.claim(intent.queueKey, 'mutation-worker');
  const started = outbox.beginMutation(claim.token);
  const originalRequestId = started.providerRequestId;
  const binding = deriveProvisioningEnvironmentBinding(started.record);
  const creationProof = createFreshCreateProof(started.record, PROOF_KEY, { issuedAt: now });

  // Simulate process loss after Railway accepted the create but before its response was durably recorded.
  const durableSnapshot = store.snapshot();
  now = 1_000_500;
  const restartedStore = makeStore(durableSnapshot);
  outbox = createProvisioningOutbox(restartedStore, {
    now: () => now,
    leaseMs: 1000,
    contractReceiptKey: RECEIPT_KEY
  });

  const recovered = outbox.claim(intent.queueKey, 'replacement-worker');
  assert.equal(recovered.action, 'RECONCILE_ONLY');
  assert.equal(recovered.record.providerRequestId, originalRequestId);
  assert.equal(deriveProvisioningEnvironmentBinding(recovered.record).environmentName, binding.environmentName);

  let providerReads = 0;
  const adapter = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'railway-project-test',
    now: () => now,
    creationProofForLookup: async lookup => {
      assert.equal(lookup.providerRequestId, originalRequestId);
      assert.equal(lookup.environmentName, binding.environmentName);
      return creationProof;
    },
    executeGraphQL: async request => {
      providerReads += 1;
      assert.match(request.query, /^query\s+/);
      assert.doesNotMatch(request.query, /\bmutation\b/i);
      return {
        data: {
          environments: {
            edges: [{
              node: {
                id: 'railway-env-1',
                name: binding.environmentName,
                createdAt: new Date(1_000_100).toISOString()
              }
            }]
          }
        }
      };
    }
  });

  const reconciler = createReadOnlyProvisioningReconciler({
    outbox,
    providerAdapters: { railway: adapter },
    proofKey: PROOF_KEY,
    now: () => now
  });

  const reconciled = await reconciler.reconcile(intent.queueKey);
  assert.equal(providerReads, 1);
  assert.equal(reconciled.state, 'VERIFY_REQUIRED');
  assert.equal(reconciled.providerResourceId, 'railway-env-1');
  assert.equal(outbox.claim(intent.queueKey, 'replacement-worker').action, 'VERIFY_ONLY');

  const ready = outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'independent-readiness-verifier',
    subject: structuredClone(reconciled.verificationSubject),
    checks: allChecks()
  });
  assert.equal(ready.state, 'COMPLETED');
  assert.equal(ready.lastDecision, 'INDEPENDENTLY_VERIFIED_READY');
});
