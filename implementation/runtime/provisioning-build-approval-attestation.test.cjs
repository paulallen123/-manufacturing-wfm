'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { compileGraph, evaluateGraph } = require('./adaptive-scoping-graph.cjs');
const { createScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');
const { createScopeFinalizationReceipt, normaliseFinalScope } = require('./adaptive-scoping-finalization-receipt.cjs');
const { stable: contractStable } = require('./contract-completion-ingress.cjs');
const { createContractScopeBinding } = require('./provisioning-contract-scope-binding.cjs');
const {
  createBuildApprovalReceipt,
  verifyBuildApprovalReceipt,
  createBuildAttestedLaunchIntent,
  createBuildAttestedProvisioningOutbox,
  sha256
} = require('./provisioning-build-approval-attestation.cjs');

const CONTRACT_RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const SCOPE_PROOF_KEY = 'scope-proof-key-0123456789abcdef0123456789abcdef';
const CONTRACT_SCOPE_BINDING_KEY = 'contract-scope-binding-key-0123456789abcdef0123456789abcdef';
const BUILD_APPROVAL_KEY = 'build-approval-key-0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-09-20T04:50:00Z');

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

function finalizedScope() {
  const compiled = compileGraph({
    version: '2026-09-20.3',
    questions: [{
      id: 'time-enabled',
      prompt: 'Enable time and attendance?',
      scope: ['time'],
      options: [
        { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
        { value: false, effects: [{ type: 'NO_OP', key: 'time.disabled', reason: 'Not enabled for launch' }] }
      ]
    }]
  });
  const evaluation = evaluateGraph(compiled, {
    purchasedScope: ['time'],
    answers: { 'time-enabled': true },
    nowMs: NOW
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

function completedContract() {
  const core = {
    schemaVersion: 1,
    provider: 'contract-provider',
    eventId: 'evt-build-attested',
    contractId: 'ctr-build-attested',
    contractVersion: '1',
    tenantId: 'tenant-build-attested',
    completedAt: '2026-09-20T04:40:00Z',
    attemptTimestamp: Date.parse('2026-09-20T04:40:05Z'),
    payloadSha256: 'f'.repeat(64),
    verifierKeyId: 'test-provider-key-v1',
    receivedAt: Date.parse('2026-09-20T04:40:06Z')
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

function fixture() {
  const finalized = finalizedScope();
  const contract = completedContract();
  const build = {
    approved: true,
    sourceRevision: 'approved-source-revision-r35',
    artifactSha256: 'c'.repeat(64),
    approvalId: 'release-approval-r35'
  };
  const receipt = createBuildApprovalReceipt(build, {
    approvalKey: BUILD_APPROVAL_KEY,
    issuerKeyId: 'release-control-plane-key-v1',
    policyId: 'wfm-release-policy-v1',
    approvedAt: NOW - 60_000,
    expiresAt: NOW + 3_600_000
  });
  const contractScopeBindingEvidence = createContractScopeBinding(finalized.evidence, contract, CONTRACT_SCOPE_BINDING_KEY);
  return {
    input: {
      scope: finalized.scope,
      contract,
      build,
      plan: {
        provider: 'railway',
        region: 'eu-west',
        creationMode: 'fresh-provider-create',
        isolated: true,
        networkPolicy: 'private-until-ready',
        secretsPolicy: 'server-managed-per-tenant'
      },
      scopeFinalizationEvidence: finalized.evidence,
      contractScopeBindingEvidence,
      buildApprovalEvidence: {
        receiptSha256: sha256(receipt),
        verificationReceipt: structuredClone(receipt)
      }
    },
    receipt
  };
}

function trust() {
  return {
    contractReceiptKey: CONTRACT_RECEIPT_KEY,
    scopeProofKey: SCOPE_PROOF_KEY,
    contractScopeBindingKey: CONTRACT_SCOPE_BINDING_KEY,
    buildApprovalKey: BUILD_APPROVAL_KEY,
    buildApprovalVerification: { now: () => NOW, trustedPolicyId: 'wfm-release-policy-v1' }
  };
}

function stubOutboxFactory() {
  const records = new Map();
  return function createStubOutbox() {
    return {
      enqueue(intent) {
        if (records.has(intent.queueKey)) return { duplicate: true, record: structuredClone(records.get(intent.queueKey)) };
        const record = { queueKey: intent.queueKey, payload: structuredClone(intent), state: 'QUEUED' };
        records.set(intent.queueKey, record);
        return { duplicate: false, record: structuredClone(record) };
      },
      get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
      claim(key, workerId) { return { queueKey: key, workerId }; },
      beginMutation(token) { return { ...token, mutationStarted: true }; },
      recordProviderOutcome(token, outcome) { return { ...token, outcome }; },
      recordReconciliation(key, result) { return { queueKey: key, result }; },
      recordIndependentVerification(key, verification) { return { queueKey: key, verification }; }
    };
  };
}

test('trusted approval is bound to the exact source revision and artifact digest', () => {
  const f = fixture();
  const verified = verifyBuildApprovalReceipt(f.receipt, f.input.build, BUILD_APPROVAL_KEY, { now: () => NOW });
  assert.equal(verified.ok, true);
  assert.equal(verified.artifactSha256, f.input.build.artifactSha256);
  assert.match(verified.receiptSha256, /^[a-f0-9]{64}$/);

  expectCode(
    () => verifyBuildApprovalReceipt(f.receipt, { ...f.input.build, artifactSha256: 'd'.repeat(64) }, BUILD_APPROVAL_KEY, { now: () => NOW }),
    'WFM_BUILD_APPROVAL_SUBJECT_MISMATCH'
  );
});

test('expired, future-dated or tampered approval cannot authorize provisioning', () => {
  const f = fixture();
  expectCode(
    () => verifyBuildApprovalReceipt(f.receipt, f.input.build, BUILD_APPROVAL_KEY, { now: () => NOW + 4_000_000 }),
    'WFM_BUILD_APPROVAL_EXPIRED'
  );

  const future = createBuildApprovalReceipt(f.input.build, {
    approvalKey: BUILD_APPROVAL_KEY,
    issuerKeyId: 'release-control-plane-key-v1',
    approvedAt: NOW + 120_000,
    expiresAt: NOW + 3_600_000
  });
  expectCode(
    () => verifyBuildApprovalReceipt(future, f.input.build, BUILD_APPROVAL_KEY, { now: () => NOW, maxFutureSkewMs: 60_000 }),
    'WFM_BUILD_APPROVAL_FROM_FUTURE'
  );

  const tampered = { ...f.receipt, sourceRevision: 'other-revision' };
  expectCode(
    () => verifyBuildApprovalReceipt(tampered, { ...f.input.build, sourceRevision: 'other-revision' }, BUILD_APPROVAL_KEY, { now: () => NOW }),
    'WFM_BUILD_APPROVAL_INVALID'
  );
});

test('launch identity is sealed to the trusted approval receipt, not an approved boolean alone', () => {
  const f = fixture();
  const intent = createBuildAttestedLaunchIntent(f.input, trust());
  assert.equal(intent.build.artifactSha256, f.input.build.artifactSha256);
  assert.equal(intent.buildApprovalEvidence.receiptSha256, sha256(f.receipt));
  assert.match(intent.buildAttestedIntentDigest, /^[a-f0-9]{64}$/);

  const bare = fixture();
  delete bare.input.buildApprovalEvidence;
  expectCode(() => createBuildAttestedLaunchIntent(bare.input, trust()), 'WFM_BUILD_APPROVAL_RECEIPT_REQUIRED');

  const drifted = fixture();
  drifted.input.build.artifactSha256 = 'd'.repeat(64);
  expectCode(() => createBuildAttestedLaunchIntent(drifted.input, trust()), 'WFM_BUILD_APPROVAL_SUBJECT_MISMATCH');
});

test('queue transitions recheck approval and readiness must observe the exact approved artifact', () => {
  const f = fixture();
  const intent = createBuildAttestedLaunchIntent(f.input, trust());
  const outbox = createBuildAttestedProvisioningOutbox({}, {
    ...trust(),
    baseOutboxFactory: stubOutboxFactory()
  });
  const queued = outbox.enqueue(intent);
  assert.equal(queued.duplicate, false);
  assert.equal(queued.approvedArtifactSha256, f.input.build.artifactSha256);
  assert.equal(outbox.claim(intent.queueKey, 'worker-1').workerId, 'worker-1');

  expectCode(
    () => outbox.recordIndependentVerification(intent.queueKey, {
      buildApprovalReceiptSha256: intent.buildApprovalEvidence.receiptSha256,
      observedArtifactSha256: 'd'.repeat(64),
      checks: { health: true, security: true, readiness: true }
    }),
    'WFM_BUILD_ARTIFACT_MISMATCH'
  );

  const verified = outbox.recordIndependentVerification(intent.queueKey, {
    buildApprovalReceiptSha256: intent.buildApprovalEvidence.receiptSha256,
    observedArtifactSha256: f.input.build.artifactSha256,
    checks: { health: true, security: true, readiness: true }
  });
  assert.equal(verified.verification.checks.buildApprovalVerified, true);
  assert.equal(verified.verification.checks.observedArtifactSha256, f.input.build.artifactSha256);
});
