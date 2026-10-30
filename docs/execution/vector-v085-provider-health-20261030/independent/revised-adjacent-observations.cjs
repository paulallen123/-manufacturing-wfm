'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const target = process.env.V085_TEST_ROOT;
assert.ok(target);
const { reviewConnection, approvalFor, evaluateRuntimeHealth } = require(path.join(target, 'integration/runtime/connection-proof-gate.cjs'));
const { createProviderProofLease } = require(path.join(target, 'integration/runtime/provider-proof-lifecycle.cjs'));
const { summarizeConnectionHealth } = require(path.join(target, 'integration/runtime/connection-health-summary.cjs'));
const now = Date.parse('2026-10-30T12:00:00.000Z');
const at = (offset) => new Date(now + offset).toISOString();
const config = {
  connectionId: 'adjacent-review-source', tenantId: 'adjacent-review-tenant', providerKey: 'test-provider',
  targetIdentity: 'test-sandbox', environment: 'sandbox', transport: 'api',
  auth: { method: 'oauth2', credentialRef: 'vault://review/test-provider' },
  mapping: { version: 1, digest: 'a'.repeat(64) },
  authority: [{ capability: 'worker.profile', sourceId: 'adjacent-review-source' }],
  monitoring: { maxFreshnessSeconds: 600, maxLatencyMs: 2000 }
};
const review = reviewConnection(config);
const evidence = {
  connectionTest: {
    status: 'PASS', reviewedDigest: review.reviewedDigest, nonMutating: true, measuredLatencyMs: 25, observedAt: at(-60000),
    targetProof: { providerKey: review.providerKey, targetIdentity: review.targetIdentity, environment: review.environment,
      method: 'provider-metadata', observedAt: at(-60000), boundedMetadataOnly: true, containsSensitiveData: false }
  },
  mappingReview: { status: 'APPROVED', reviewedDigest: review.reviewedDigest, mappingVersion: 1, observedAt: at(-59000) },
  reconciliation: { status: 'PASS', reviewedDigest: review.reviewedDigest, mappingVersion: 1, observedAt: at(-58000) }
};
evidence.approval = approvalFor(review, { approvedBy: 'local-test-review-actor', role: 'integration-owner' }, evidence, now - 57000);
const providerProofLease = createProviderProofLease(review, {
  status: 'PASS', reviewedDigest: review.reviewedDigest, providerKey: review.providerKey, targetIdentity: review.targetIdentity,
  environment: review.environment, observedAt: at(-56000), metadataDigest: 'b'.repeat(64),
  boundedMetadataOnly: true, containsSensitiveData: false, responseBodyRetained: false
}, { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, now);
const healthy = { reviewedDigest: review.reviewedDigest, lastSyncAt: at(-30000), lastReconciliationAt: at(-29000), measuredLatencyMs: 50 };
const inputs = (runtime, state) => ({
  currentConfig: config, activationEvidence: evidence, providerProofLease,
  circuitState: { reviewedDigest: review.reviewedDigest, status: 'CLOSED' },
  runtime, maintenanceExecution: { state }
});
const observations = [];
const freeze = (value) => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
for (const [name, extra] of [
  ['stale sync', { lastSyncAt: at(-601000), lastReconciliationAt: at(-600500) }],
  ['slow latency', { measuredLatencyMs: 2001 }],
  ['pending retry', { pendingRetries: 1 }]
]) {
  for (const state of ['IDLE', 'CLAIM_EXPIRED', 'COMPLETION_UNCERTAIN']) {
    const runtime = { ...healthy, ...extra };
    const direct = evaluateRuntimeHealth(review, runtime, now);
    const supplied = inputs(runtime, state);
    supplied.runtime.privatePayload = 'V085_REVISED_SECRET_SENTINEL';
    supplied.maintenanceExecution.claimToken = 'V085_REVISED_SECRET_SENTINEL';
    const before = structuredClone(supplied);
    freeze(supplied);
    const summary = summarizeConnectionHealth(review, supplied, now);
    assert.deepEqual(supplied, before);
    assert.equal(JSON.stringify(summary).includes('V085_REVISED_SECRET_SENTINEL'), false);
    observations.push({ case: name, maintenanceExecution: state, direct: direct.state, summary: summary.state, canSync: summary.canSync, runtimeSignal: summary.signals.runtime, customerMessage: summary.customerMessage, providerSignal: summary.signals.provider, maintenanceExecutionState: summary.maintenanceExecutionState });
  }
}
for (const [name, clock] of [['symbol', Symbol('invalid-clock')], ['bigint', BigInt(now)]]) {
  for (const [api, invoke] of [
    ['evaluateRuntimeHealth', () => evaluateRuntimeHealth(review, healthy, clock)],
    ['summarizeConnectionHealth', () => summarizeConnectionHealth(review, inputs(healthy, 'CLAIM_EXPIRED'), clock)]
  ]) {
    try {
      const result = invoke();
      observations.push({ case: name, api, result: result.state, canSync: result.canSync });
    } catch (error) {
      observations.push({ case: name, api, throws: error.name, message: error.message });
    }
  }
}
process.stdout.write(JSON.stringify({ target, node: process.version, observations }, null, 2) + '\n');
