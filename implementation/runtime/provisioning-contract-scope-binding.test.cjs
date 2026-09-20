'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { compileGraph, evaluateGraph } = require('./adaptive-scoping-graph.cjs');
const { createScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');
const {
  createScopeFinalizationReceipt,
  normaliseFinalScope
} = require('./adaptive-scoping-finalization-receipt.cjs');
const { stable: contractStable } = require('./contract-completion-ingress.cjs');
const { createFreshCreateProof } = require('./provisioning-fresh-create-proof.cjs');
const { createReadOnlyProvisioningReconciler } = require('./provisioning-readonly-reconciler.cjs');
const { createRailwayReadOnlyEnvironmentAdapter } = require('./railway-readonly-environment-adapter.cjs');
const { deriveProvisioningEnvironmentBinding } = require('./provisioning-environment-binding.cjs');
const {
  createContractScopeBinding,
  verifyContractScopeBinding,
  createContractScopeBoundLaunchIntent,
  createContractScopeBoundProvisioningOutbox,
  sha256
} = require('./provisioning-contract-scope-binding.cjs');

const CONTRACT_RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const SCOPE_PROOF_KEY = 'scope-proof-key-0123456789abcdef0123456789abcdef';
const CONTRACT_SCOPE_BINDING_KEY = 'contract-scope-binding-key-0123456789abcdef0123456789abcdef';
const FRESH_CREATE_PROOF_KEY = 'fresh-create-proof-key-0123456789abcdef0123456789abcdef';

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

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
    snapshot() { return [...data].map(([key, value]) => [key, structuredClone(value)]); },
    tamper(key, mutate) {
      const value = structuredClone(data.get(key));
      mutate(value);
      data.set(key, value);
    }
  };
}

function graph() {
  return compileGraph({
    version: '2026-09-20.2',
    questions: [
      {
        id: 'time-enabled',
        prompt: 'Enable time and attendance?',
        scope: ['time'],
        options: [
          { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
          { value: false, effects: [{ type: 'NO_OP', key: 'time.disabled', reason: 'Not enabled for launch' }] }
        ]
      }
    ]
  });
}

function finalizedScope() {
  const compiled = graph();
  const evaluation = evaluateGraph(compiled, {
    purchasedScope: ['time'],
    answers: { 'time-enabled': true },
    nowMs: Date.parse('2026-09-20T01:55:00Z')
  });
  const release = createScopeReleaseReceipt(compiled, { proofKey: SCOPE_PROOF_KEY });
  const finalization = createScopeFinalizationReceipt(compiled, evaluation, release, { proofKey: SCOPE_PROOF_KEY });
  const normalised = normaliseFinalScope(evaluation);
  return {
    scope: {
      graphVersion: normalised.graphVersion,
      graphFingerprint: normalised.graphFingerprint,
      revision: normalised.revision,
      purchasedScope: normalised.purchasedScope,
      questions: [],
      operations: structuredClone(normalised.operations)
    },
    evidence: {
      finalizationDigest: finalization.finalizationDigest,
      receiptSha256: sha256(finalization),
      verificationReceipt: structuredClone(finalization)
    }
  };
}

function completedContract({ tenantId = 'tenant-a', contractId = 'ctr-contract-bound', contractVersion = '1' } = {}) {
  const core = {
    schemaVersion: 1,
    provider: 'contract-provider',
    eventId: `evt-${contractId}-${tenantId}`,
    contractId,
    contractVersion,
    tenantId,
    completedAt: '2026-09-20T01:50:00Z',
    attemptTimestamp: Date.parse('2026-09-20T01:50:05Z'),
    payloadSha256: 'f'.repeat(64),
    verifierKeyId: 'test-provider-key-v1',
    receivedAt: Date.parse('2026-09-20T01:50:06Z')
  };
  const mac = createHmac('sha256', Buffer.from(CONTRACT_RECEIPT_KEY, 'utf8')).update(contractStable(core)).digest('hex');
  return {
    authenticated: true,
    status: 'completed',
    provider: core.provider,
    eventId: core.eventId,
    contractId: core.contractId,
    contractVersion: core.contractVersion,
    tenantId: core.tenantId,
    completedAt: core.completedAt,
    verificationReceipt: { ...core, mac }
  };
}

function fixture(contractOverrides = {}) {
  const finalized = finalizedScope();
  const contract = completedContract(contractOverrides);
  const binding = createContractScopeBinding(finalized.evidence, contract, CONTRACT_SCOPE_BINDING_KEY);
  return {
    input: {
      scope: finalized.scope,
      contract,
      build: {
        approved: true,
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
      scopeFinalizationEvidence: finalized.evidence,
      contractScopeBindingEvidence: binding
    },
    finalized,
    contract,
    binding
  };
}

function launchIntent() {
  return createContractScopeBoundLaunchIntent(fixture().input, {
    contractReceiptKey: CONTRACT_RECEIPT_KEY,
    scopeProofKey: SCOPE_PROOF_KEY,
    contractScopeBindingKey: CONTRACT_SCOPE_BINDING_KEY
  });
}

function createOutbox(store, options = {}) {
  return createContractScopeBoundProvisioningOutbox(store, {
    ...options,
    contractReceiptKey: CONTRACT_RECEIPT_KEY,
    scopeProofKey: SCOPE_PROOF_KEY,
    contractScopeBindingKey: CONTRACT_SCOPE_BINDING_KEY
  });
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

test('final scope binding is cryptographically tied to the exact contract and customer tenant', () => {
  const f = fixture();
  const verified = verifyContractScopeBinding(f.binding, f.finalized.evidence, f.contract, CONTRACT_SCOPE_BINDING_KEY);
  assert.equal(verified.ok, true);
  assert.match(verified.bindingDigest, /^[a-f0-9]{64}$/);

  expectCode(
    () => verifyContractScopeBinding(
      f.binding,
      f.finalized.evidence,
      { ...f.contract, tenantId: 'tenant-b' },
      CONTRACT_SCOPE_BINDING_KEY
    ),
    'WFM_CONTRACT_SCOPE_BINDING_CONTRACT_MISMATCH'
  );
});

test('a valid scope proof cannot be reused for a different authenticated contract subject', () => {
  const first = fixture();
  const differentContract = completedContract({ tenantId: 'tenant-b', contractId: 'ctr-other-customer' });
  const reused = {
    ...first.input,
    contract: differentContract,
    contractScopeBindingEvidence: first.binding
  };

  expectCode(
    () => createContractScopeBoundLaunchIntent(reused, {
      contractReceiptKey: CONTRACT_RECEIPT_KEY,
      scopeProofKey: SCOPE_PROOF_KEY,
      contractScopeBindingKey: CONTRACT_SCOPE_BINDING_KEY
    }),
    'WFM_CONTRACT_SCOPE_BINDING_CONTRACT_MISMATCH'
  );
});

test('contract-bound scope is rechecked at queue admission and immediately before provider mutation', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  const admitted = outbox.enqueue(intent);
  assert.equal(admitted.contractScopeBindingDigest, intent.contractScopeBindingDigest);

  const claimed = outbox.claim(intent.queueKey, 'worker-a');
  store.tamper(intent.queueKey, record => {
    record.payload.contractScopeBindingEvidence.mac = '0'.repeat(64);
  });
  expectCode(() => outbox.beginMutation(claimed.token), 'WFM_CONTRACT_SCOPE_BINDING_INVALID');
  assert.equal(outbox.get(intent.queueKey).state, 'CLAIMED');
});

test('provider outcome cannot advance after the sealed scope proof is altered', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);
  const claimed = outbox.claim(intent.queueKey, 'worker-a');
  outbox.beginMutation(claimed.token);

  store.tamper(intent.queueKey, record => {
    record.payload.scopeProofBinding.subjectDigest = '0'.repeat(64);
  });

  expectCode(() => outbox.recordProviderOutcome(claimed.token, {
    result: 'CONFIRMED_CREATED',
    providerResourceId: 'railway-env-tamper-test'
  }), 'WFM_SCOPE_FINALIZATION_BINDING_MISMATCH');
  assert.equal(outbox.get(intent.queueKey).state, 'MUTATION_STARTED');
});

test('contract-bound crash restart uses read-only Railway recovery and the same proof through readiness', async () => {
  let now = 2_000_000;
  const store = makeStore();
  let outbox = createOutbox(store, { now: () => now, leaseMs: 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);

  const claimed = outbox.claim(intent.queueKey, 'mutation-worker');
  const started = outbox.beginMutation(claimed.token);
  const originalRequestId = started.providerRequestId;
  const binding = deriveProvisioningEnvironmentBinding(started.record);
  const creationProof = createFreshCreateProof(started.record, FRESH_CREATE_PROOF_KEY, { issuedAt: now });

  const durableSnapshot = store.snapshot();
  now += 500;
  const restartedStore = makeStore(durableSnapshot);
  outbox = createOutbox(restartedStore, { now: () => now, leaseMs: 1000 });

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
                id: 'railway-env-contract-crash-test',
                name: binding.environmentName,
                createdAt: new Date(2_000_100).toISOString()
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
    proofKey: FRESH_CREATE_PROOF_KEY,
    now: () => now
  });

  const reconciled = await reconciler.reconcile(intent.queueKey);
  assert.equal(providerReads, 1);
  assert.equal(reconciled.state, 'VERIFY_REQUIRED');
  assert.equal(reconciled.providerResourceId, 'railway-env-contract-crash-test');
  assert.equal(reconciled.contractScopeBindingDigest, intent.contractScopeBindingDigest);
  assert.equal(reconciled.scopeFinalizationDigest, intent.scopeFinalizationEvidence.finalizationDigest);

  const ready = outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'independent-readiness-verifier',
    scopeFinalizationDigest: intent.scopeFinalizationEvidence.finalizationDigest,
    contractScopeBindingDigest: intent.contractScopeBindingDigest,
    subject: structuredClone(reconciled.verificationSubject),
    checks: allChecks()
  });
  assert.equal(ready.state, 'COMPLETED');
  assert.equal(ready.contractScopeBindingDigest, intent.contractScopeBindingDigest);
  assert.equal(ready.scopeFinalizationDigest, intent.scopeFinalizationEvidence.finalizationDigest);
});

test('recovery cannot advance if contract-scope proof changes after provider readback starts', async () => {
  let now = 3_000_000;
  const store = makeStore();
  let outbox = createOutbox(store, { now: () => now, leaseMs: 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);
  const claimed = outbox.claim(intent.queueKey, 'mutation-worker');
  const started = outbox.beginMutation(claimed.token);
  const binding = deriveProvisioningEnvironmentBinding(started.record);
  const creationProof = createFreshCreateProof(started.record, FRESH_CREATE_PROOF_KEY, { issuedAt: now });

  const durableSnapshot = store.snapshot();
  now += 500;
  const restartedStore = makeStore(durableSnapshot);
  outbox = createOutbox(restartedStore, { now: () => now, leaseMs: 1000 });

  const adapter = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'railway-project-test',
    now: () => now,
    creationProofForLookup: async () => {
      restartedStore.tamper(intent.queueKey, record => {
        record.payload.contractScopeBindingEvidence.mac = '0'.repeat(64);
      });
      return creationProof;
    },
    executeGraphQL: async request => {
      assert.match(request.query, /^query\s+/);
      assert.doesNotMatch(request.query, /\bmutation\b/i);
      return {
        data: {
          environments: {
            edges: [{
              node: {
                id: 'railway-env-contract-tamper-test',
                name: binding.environmentName,
                createdAt: new Date(3_000_100).toISOString()
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
    proofKey: FRESH_CREATE_PROOF_KEY,
    now: () => now
  });

  await assert.rejects(
    () => reconciler.reconcile(intent.queueKey),
    error => error && error.code === 'WFM_CONTRACT_SCOPE_BINDING_INVALID'
  );
  assert.equal(outbox.get(intent.queueKey).state, 'MUTATION_STARTED');
});

test('independent readiness must identify the same contract-bound scope proof', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);
  const claimed = outbox.claim(intent.queueKey, 'worker-a');
  outbox.beginMutation(claimed.token);
  const created = outbox.recordProviderOutcome(claimed.token, {
    result: 'CONFIRMED_CREATED',
    providerResourceId: 'railway-env-contract-bound-test'
  });

  expectCode(() => outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'independent-readiness-verifier',
    scopeFinalizationDigest: intent.scopeFinalizationEvidence.finalizationDigest,
    contractScopeBindingDigest: '0'.repeat(64),
    subject: structuredClone(created.verificationSubject),
    checks: allChecks()
  }), 'WFM_CONTRACT_SCOPE_VERIFICATION_MISMATCH');

  const ready = outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'independent-readiness-verifier',
    scopeFinalizationDigest: intent.scopeFinalizationEvidence.finalizationDigest,
    contractScopeBindingDigest: intent.contractScopeBindingDigest,
    subject: structuredClone(created.verificationSubject),
    checks: allChecks()
  });
  assert.equal(ready.state, 'COMPLETED');
  assert.equal(ready.contractScopeBindingDigest, intent.contractScopeBindingDigest);
});
