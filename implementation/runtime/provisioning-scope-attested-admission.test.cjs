'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { compileGraph, evaluateGraph } = require('./adaptive-scoping-graph.cjs');
const { createScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');
const {
  createScopeFinalizationReceipt,
  normaliseFinalScope
} = require('./adaptive-scoping-finalization-receipt.cjs');
const { createScopeAttestedLaunchIntent } = require('./provisioning-launch-intent.cjs');
const {
  createScopeAttestedProvisioningOutbox,
  sha256: admissionSha256
} = require('./provisioning-scope-attested-admission.cjs');
const { sha256: outboxSha256 } = require('./provisioning-outbox.cjs');
const { stable: contractStable } = require('./contract-completion-ingress.cjs');

const CONTRACT_RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const SCOPE_PROOF_KEY = 'scope-proof-key-0123456789abcdef0123456789abcdef';

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
    version: '2026-09-20.1',
    questions: [
      {
        id: 'time-enabled',
        prompt: 'Enable time and attendance?',
        scope: ['time'],
        options: [
          { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
          { value: false, effects: [{ type: 'NO_OP', key: 'time.disabled', reason: 'Not purchased for launch' }] }
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
    nowMs: Date.parse('2026-09-20T00:10:00Z')
  });
  const releaseReceipt = createScopeReleaseReceipt(compiled, { proofKey: SCOPE_PROOF_KEY });
  const finalizationReceipt = createScopeFinalizationReceipt(compiled, evaluation, releaseReceipt, { proofKey: SCOPE_PROOF_KEY });
  const normalised = normaliseFinalScope(evaluation);
  return {
    scopeInput: {
      graphVersion: normalised.graphVersion,
      graphFingerprint: normalised.graphFingerprint,
      revision: normalised.revision,
      purchasedScope: normalised.purchasedScope,
      questions: [],
      operations: structuredClone(normalised.operations)
    },
    evidence: {
      finalizationDigest: finalizationReceipt.finalizationDigest,
      receiptSha256: admissionSha256(finalizationReceipt),
      verificationReceipt: structuredClone(finalizationReceipt)
    }
  };
}

function completionEvidence() {
  const core = {
    schemaVersion: 1,
    provider: 'contract-provider',
    eventId: 'evt-scope-admission-1',
    contractId: 'ctr-scope-admission',
    contractVersion: '1',
    tenantId: 'tenant-a',
    completedAt: '2026-09-20T00:00:00Z',
    attemptTimestamp: Date.parse('2026-09-20T00:00:05Z'),
    payloadSha256: 'f'.repeat(64),
    verifierKeyId: 'test-provider-key-v1',
    receivedAt: Date.parse('2026-09-20T00:00:06Z')
  };
  const mac = createHmac('sha256', Buffer.from(CONTRACT_RECEIPT_KEY, 'utf8')).update(contractStable(core)).digest('hex');
  const verificationReceipt = { ...core, mac };
  const receiptSha256 = createHash('sha256').update(contractStable(verificationReceipt)).digest('hex');
  return { authenticated: true, eventId: core.eventId, receiptSha256, verificationReceipt };
}

function completedContract() {
  const completion = completionEvidence();
  const receipt = completion.verificationReceipt;
  return {
    authenticated: true,
    status: 'completed',
    provider: receipt.provider,
    eventId: receipt.eventId,
    contractId: receipt.contractId,
    contractVersion: receipt.contractVersion,
    tenantId: receipt.tenantId,
    completedAt: receipt.completedAt,
    verificationReceipt: structuredClone(receipt)
  };
}

function launchIntent() {
  const finalized = finalizedScope();
  return createScopeAttestedLaunchIntent({
    scope: finalized.scopeInput,
    contract: completedContract(),
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
    scopeFinalizationEvidence: finalized.evidence
  }, {
    contractReceiptKey: CONTRACT_RECEIPT_KEY,
    scopeProofKey: SCOPE_PROOF_KEY
  });
}

function createOutbox(store, options = {}) {
  return createScopeAttestedProvisioningOutbox(store, {
    ...options,
    contractReceiptKey: CONTRACT_RECEIPT_KEY,
    scopeProofKey: SCOPE_PROOF_KEY
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

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('scope-attested launch binds the exact final-scope receipt to the sealed launch subject', () => {
  const intent = launchIntent();
  assert.match(intent.scopeProofBinding.finalizationDigest, /^[a-f0-9]{64}$/);
  assert.match(intent.scopeProofBinding.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(intent.scopeProofBinding.subjectDigest, admissionSha256({
    launchIntentDigest: intent.intentDigest,
    finalizationDigest: intent.scopeProofBinding.finalizationDigest,
    receiptSha256: intent.scopeProofBinding.receiptSha256
  }));
});

test('durable queue admission rejects missing, tampered or detached final-scope proof before enqueue', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });

  const missing = launchIntent();
  delete missing.scopeFinalizationEvidence;
  expectCode(() => outbox.enqueue(missing), 'WFM_SCOPE_FINALIZATION_PROOF_REQUIRED');
  assert.equal(store.snapshot().length, 0);

  const tampered = launchIntent();
  tampered.scopeFinalizationEvidence.verificationReceipt.mac = '0'.repeat(64);
  expectCode(() => outbox.enqueue(tampered), 'WFM_SCOPE_FINALIZATION_PROOF_INVALID');
  assert.equal(store.snapshot().length, 0);

  const unbound = launchIntent();
  delete unbound.scopeProofBinding;
  expectCode(() => outbox.enqueue(unbound), 'WFM_SCOPE_FINALIZATION_BINDING_REQUIRED');
  assert.equal(store.snapshot().length, 0);

  const detached = launchIntent();
  detached.scopeProofBinding.receiptSha256 = '0'.repeat(64);
  detached.scopeProofBinding.subjectDigest = admissionSha256({
    launchIntentDigest: detached.intentDigest,
    finalizationDigest: detached.scopeProofBinding.finalizationDigest,
    receiptSha256: detached.scopeProofBinding.receiptSha256
  });
  expectCode(() => outbox.enqueue(detached), 'WFM_SCOPE_FINALIZATION_BINDING_MISMATCH');
  assert.equal(store.snapshot().length, 0);
});

test('the exact finalized scope is admitted and its proof identity is returned with the queue record', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  const admitted = outbox.enqueue(intent);

  assert.equal(admitted.duplicate, false);
  assert.equal(admitted.scopeFinalizationDigest, intent.scopeFinalizationEvidence.finalizationDigest);
  assert.equal(admitted.scopeFinalizationReceiptSha256, intent.scopeFinalizationEvidence.receiptSha256);
  assert.equal(admitted.scopeProofSubjectDigest, intent.scopeProofBinding.subjectDigest);
  assert.equal(store.snapshot().length, 1);
});

test('scope proof and launch binding are rechecked immediately before provider mutation so stored drift fails closed', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);
  const claimed = outbox.claim(intent.queueKey, 'worker-a');

  store.tamper(intent.queueKey, record => {
    record.payload.scopeFinalizationEvidence.verificationReceipt.mac = '0'.repeat(64);
  });

  expectCode(() => outbox.beginMutation(claimed.token), 'WFM_SCOPE_FINALIZATION_PROOF_INVALID');
  assert.equal(outbox.get(intent.queueKey).state, 'CLAIMED');
});

test('independent readiness must name the same final-scope proof and carries the launch-proof binding', () => {
  const store = makeStore();
  const outbox = createOutbox(store, { now: () => 1000 });
  const intent = launchIntent();
  outbox.enqueue(intent);
  const claimed = outbox.claim(intent.queueKey, 'mutation-worker');
  outbox.beginMutation(claimed.token);
  const created = outbox.recordProviderOutcome(claimed.token, {
    result: 'CONFIRMED_CREATED',
    providerResourceId: 'railway-env-scope-proof'
  });

  expectCode(() => outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    scopeFinalizationDigest: '0'.repeat(64),
    subject: structuredClone(created.verificationSubject),
    checks: allChecks()
  }), 'WFM_SCOPE_FINALIZATION_VERIFICATION_MISMATCH');
  assert.equal(outbox.get(intent.queueKey).state, 'VERIFY_REQUIRED');

  const checks = {
    ...allChecks(),
    scopeFinalizationVerified: true,
    scopeFinalizationDigest: intent.scopeFinalizationEvidence.finalizationDigest,
    scopeFinalizationReceiptSha256: intent.scopeFinalizationEvidence.receiptSha256,
    scopeProofSubjectDigest: intent.scopeProofBinding.subjectDigest
  };
  const ready = outbox.recordIndependentVerification(intent.queueKey, {
    independent: true,
    verifierId: 'readiness-verifier',
    scopeFinalizationDigest: intent.scopeFinalizationEvidence.finalizationDigest,
    subject: structuredClone(created.verificationSubject),
    checks: allChecks()
  });

  assert.equal(ready.state, 'COMPLETED');
  assert.equal(ready.scopeFinalizationDigest, intent.scopeFinalizationEvidence.finalizationDigest);
  assert.equal(ready.scopeProofSubjectDigest, intent.scopeProofBinding.subjectDigest);
  assert.equal(ready.verificationDigest, outboxSha256({
    subject: created.verificationSubject,
    verifierId: 'readiness-verifier',
    checks
  }));
});
