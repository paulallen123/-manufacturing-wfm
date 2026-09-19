'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reviewConnection,
  approvalFor,
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

function passEvidence(review, overrides = {}) {
  const t = new Date(Date.now() - 1000).toISOString();
  return {
    approval: approvalFor(review, { approvedBy: 'owner@example.test', role: 'integration-owner' }),
    connectionTest: { status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true, targetIdentityVerified: true, measuredLatencyMs: 120, observedAt: t },
    mappingReview: { status: 'APPROVED', reviewedDigest: review.reviewedDigest, mappingVersion: review.mapping.version },
    reconciliation: { status: 'PASS', reviewedDigest: review.reviewedDigest, mappingVersion: review.mapping.version, observedAt: new Date().toISOString() },
    ...overrides
  };
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

test('activation requires explicit approval, safe target proof, current mapping and reconciliation', () => {
  const review = reviewConnection(config());
  const result = evaluateActivation(review, passEvidence(review), config());
  assert.equal(result.canActivate, true);
  assert.equal(result.state, 'APPROVED_FOR_ACTIVATION');
});

test('any reviewed connection change invalidates stale activation approval', () => {
  const review = reviewConnection(config());
  const changed = config({ targetIdentity: 'sf-sandbox-beta' });
  const result = evaluateActivation(review, passEvidence(review), changed);
  assert.equal(result.canActivate, false);
  assert.match(result.blockers.join(' '), /changed after approval/);
});

test('queue transport requires observed failure recovery proof before activation', () => {
  const queueConfig = config({
    transport: 'queue-stream',
    auth: { method: 'managed-identity', credentialRef: 'managed://tenant-alpha/event-stream' }
  });
  const review = reviewConnection(queueConfig);
  const missing = evaluateActivation(review, passEvidence(review), queueConfig);
  assert.equal(missing.canActivate, false);
  assert.match(missing.blockers.join(' '), /Recovery proof is required/);

  const evidence = passEvidence(review, {
    recoveryProof: {
      status: 'PASS', reviewedDigest: review.reviewedDigest,
      observedFailure: true, recovered: true, reconciliationStatus: 'PASS'
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
});