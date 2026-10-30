'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reviewConnection,
  approvalFor,
  activationEvidenceDigest,
  evaluateActivation,
  evaluateRuntimeHealth,
  buildSafeConnectionTestPlan
} = require('./connection-proof-gate.cjs');

function config(overrides = {}) {
  return {
    connectionId: 'conn-1',
    tenantId: 'tenant-alpha',
    providerKey: 'sap-successfactors',
    transport: 'api',
    targetIdentity: 'sf-sandbox-alpha',
    environment: 'sandbox',
    auth: { method: 'oauth2', credentialRef: 'vault://tenant-alpha/sf/oauth' },
    mapping: { version: 3, digest: 'a'.repeat(64) },
    authority: [{ capability: 'people', sourceId: 'conn-1' }],
    monitoring: { maxFreshnessSeconds: 600, maxLatencyMs: 1500 },
    ...overrides
  };
}

function proofEvidence(review, overrides = {}) {
  const t = new Date(Date.now() - 2000).toISOString();
  const t2 = new Date(Date.now() - 1000).toISOString();
  return {
    connectionTest: {
      status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true,
      measuredLatencyMs: 120, observedAt: t,
      targetProof: {
        providerKey: review.providerKey,
        targetIdentity: review.targetIdentity,
        environment: review.environment,
        method: 'provider-metadata',
        observedAt: t,
        boundedMetadataOnly: true,
        containsSensitiveData: false
      }
    },
    mappingReview: { status: 'APPROVED', reviewedDigest: review.reviewedDigest, mappingVersion: review.mapping.version, observedAt: t },
    reconciliation: { status: 'PASS', reviewedDigest: review.reviewedDigest, mappingVersion: review.mapping.version, observedAt: t2 },
    ...overrides
  };
}

function passEvidence(review, overrides = {}) {
  const evidence = proofEvidence(review, overrides);
  evidence.approval = approvalFor(review, { approvedBy: 'owner@example.test', role: 'integration-owner' }, evidence);
  return evidence;
}

test('raw credentials are rejected and protected references are accepted', () => {
  assert.throws(() => reviewConnection(config({ auth: { method: 'oauth2', credentialRef: 'plain-secret-value' } })), /protected credential reference/);
  assert.equal(reviewConnection(config()).auth.credentialRef, 'vault://tenant-alpha/sf/oauth');
});

test('read-only database transport fails closed unless both read-only controls are explicit', () => {
  assert.throws(() => reviewConnection(config({ transport: 'read-only-db', auth: { method: 'managed-identity', credentialRef: 'managed://tenant-alpha/db' } })), /explicitly read-only/);
  const reviewed = reviewConnection(config({
    transport: 'read-only-db',
    auth: { method: 'managed-identity', credentialRef: 'managed://tenant-alpha/db' },
    transportOptions: { readOnly: true, queryMode: 'read-only' }
  }));
  assert.equal(reviewed.transportOptions.readOnly, true);
});

test('activation requires explicit approval, exact target proof, current mapping and reconciliation', () => {
  const review = reviewConnection(config());
  const result = evaluateActivation(review, passEvidence(review), config());
  assert.equal(result.canActivate, true);
  assert.equal(result.state, 'APPROVED_FOR_ACTIVATION');
});

test('approval is bound to the exact proof bundle and must follow the latest evidence', () => {
  const review = reviewConnection(config());
  const evidence = passEvidence(review);
  assert.equal(evidence.approval.evidenceDigest, activationEvidenceDigest(review, evidence));

  const replaced = {
    ...evidence,
    reconciliation: { ...evidence.reconciliation, observedAt: new Date(Date.now() + 10_000).toISOString() }
  };
  const result = evaluateActivation(review, replaced, config());
  assert.equal(result.canActivate, false);
  assert.match(result.blockers.join(' '), /does not match the exact evidence|predates the latest proof/i);
});

test('approval cannot be minted from incomplete or failing evidence', () => {
  const review = reviewConnection(config());
  const evidence = proofEvidence(review);
  delete evidence.mappingReview.observedAt;
  assert.throws(
    () => approvalFor(review, { approvedBy: 'owner@example.test', role: 'integration-owner' }, evidence),
    /not ready for approval|timestamps are incomplete/i
  );
});

test('boolean-only or mismatched target identity proof cannot activate a connection', () => {
  const review = reviewConnection(config());
  const booleanOnlyProof = proofEvidence(review, {
    connectionTest: {
      status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true,
      targetIdentityVerified: true, measuredLatencyMs: 120, observedAt: new Date().toISOString()
    }
  });
  const booleanOnly = { ...booleanOnlyProof, approval: { decision: 'APPROVED', reviewedDigest: review.reviewedDigest, approvedAt: new Date().toISOString(), evidenceDigest: activationEvidenceDigest(review, booleanOnlyProof) } };
  const missing = evaluateActivation(review, booleanOnly, config());
  assert.equal(missing.canActivate, false);
  assert.match(missing.blockers.join(' '), /target-system evidence is missing/i);

  const mismatchedProof = proofEvidence(review);
  mismatchedProof.connectionTest.targetProof = { ...mismatchedProof.connectionTest.targetProof, targetIdentity: 'sf-sandbox-beta' };
  const mismatched = { ...mismatchedProof, approval: { decision: 'APPROVED', reviewedDigest: review.reviewedDigest, approvedAt: new Date().toISOString(), evidenceDigest: activationEvidenceDigest(review, mismatchedProof) } };
  const wrongTarget = evaluateActivation(review, mismatched, config());
  assert.equal(wrongTarget.canActivate, false);
  assert.match(wrongTarget.blockers.join(' '), /does not match the reviewed target/i);
});

test('target proof must be metadata-only and explicitly free of employee/payroll data', () => {
  const review = reviewConnection(config());
  const proof = proofEvidence(review);
  proof.connectionTest.targetProof = {
    ...proof.connectionTest.targetProof,
    boundedMetadataOnly: false,
    containsSensitiveData: true
  };
  const evidence = { ...proof, approval: { decision: 'APPROVED', reviewedDigest: review.reviewedDigest, approvedAt: new Date().toISOString(), evidenceDigest: activationEvidenceDigest(review, proof) } };
  const result = evaluateActivation(review, evidence, config());
  assert.equal(result.canActivate, false);
  assert.match(result.blockers.join(' '), /bounded metadata only/i);
  assert.match(result.blockers.join(' '), /no employee or payroll data/i);
});

test('any reviewed connection change invalidates stale activation approval', () => {
  const review = reviewConnection(config());
  const changed = config({ targetIdentity: 'sf-sandbox-beta' });
  const result = evaluateActivation(review, passEvidence(review), changed);
  assert.equal(result.canActivate, false);
  assert.match(result.blockers.join(' '), /changed after approval/);
});

test('queue transport requires observed failure recovery proof before approval and activation', () => {
  const queueConfig = config({
    transport: 'queue-stream',
    auth: { method: 'managed-identity', credentialRef: 'managed://tenant-alpha/event-stream' }
  });
  const review = reviewConnection(queueConfig);
  const missingProof = proofEvidence(review);
  assert.throws(
    () => approvalFor(review, { approvedBy: 'owner@example.test', role: 'integration-owner' }, missingProof),
    /Recovery proof is required/
  );

  const observedAt = new Date(Date.now() - 500).toISOString();
  const evidence = passEvidence(review, {
    recoveryProof: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      observedFailure: true, recovered: true, reconciliationStatus: 'PASS', observedAt
    }
  });
  const passed = evaluateActivation(review, evidence, queueConfig);
  assert.equal(passed.canActivate, true);
});

test('runtime health blocks unreconciled or conflicting authority and degrades stale data', () => {
  const review = reviewConnection(config());
  const now = Date.now();
  const blocked = evaluateRuntimeHealth(review, {
    reviewedDigest: review.reviewedDigest,
    lastSyncAt: new Date(now - 60_000).toISOString(),
    lastReconciliationAt: new Date(now - 120_000).toISOString(),
    measuredLatencyMs: 100,
    authorityConflict: true
  }, now);
  assert.equal(blocked.state, 'BLOCKED');

  const degraded = evaluateRuntimeHealth(review, {
    reviewedDigest: review.reviewedDigest,
    lastSyncAt: new Date(now - 700_000).toISOString(),
    lastReconciliationAt: new Date(now - 690_000).toISOString(),
    measuredLatencyMs: 100
  }, now);
  assert.equal(degraded.state, 'DEGRADED');
});

test('runtime health refuses sync or reconciliation evidence beyond the existing clock-skew allowance', () => {
  const review = reviewConnection(config());
  const now = Date.parse('2026-10-30T17:00:00.000Z');
  const runtime = {
    reviewedDigest: review.reviewedDigest,
    lastSyncAt: new Date(now - 1000).toISOString(),
    lastReconciliationAt: new Date(now).toISOString(),
    measuredLatencyMs: 100
  };
  for (const offset of [5001, 60_000, 86_400_000]) {
    const future = new Date(now + offset).toISOString();
    for (const values of [{lastReconciliationAt: future}, {lastSyncAt: future, lastReconciliationAt: future}]) {
      const input = {...runtime, ...values}, before = structuredClone(input);
      const result = evaluateRuntimeHealth(review, input, now);
      assert.equal(result.state, 'BLOCKED');
      assert.match(result.blockers.join(' '), /future/i);
      assert.deepEqual(input, before);
    }
  }
  for (const offset of [0, 5000]) {
    const timestamp = new Date(now + offset).toISOString();
    assert.equal(evaluateRuntimeHealth(review, {...runtime, lastSyncAt: timestamp, lastReconciliationAt: timestamp}, now).state, 'HEALTHY');
  }
});

test('runtime health fails closed when its evaluation clock is not finite', () => {
  const review = reviewConnection(config());
  const runtime = {reviewedDigest: review.reviewedDigest, lastSyncAt:'2026-10-30T17:00:00.000Z', lastReconciliationAt:'2026-10-30T17:00:01.000Z', measuredLatencyMs:100};
  for (const now of [NaN, Infinity, -Infinity, null, '2026-10-30T17:00:02.000Z']) {
    assert.equal(evaluateRuntimeHealth(review, runtime, now).state, 'BLOCKED');
  }
});

test('safe test plan is non-mutating and adds transport-specific recovery/read-only checks', () => {
  const review = reviewConnection(config({
    transport: 'read-only-db',
    auth: { method: 'managed-identity', credentialRef: 'managed://tenant-alpha/db' },
    transportOptions: { readOnly: true, queryMode: 'read-only' }
  }));
  const plan = buildSafeConnectionTestPlan(review);
  assert.equal(plan.nonMutating, true);
  assert.equal(plan.requiresExplicitActivationApproval, true);
  assert.ok(plan.steps.some(x => x.includes('read-only database session')));
  assert.ok(plan.steps.some(x => x.includes('controlled transient failure')));
  assert.ok(plan.steps.some(x => x.includes('provider-reported metadata')));
});
