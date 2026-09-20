'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const {
  executeProviderProofClaim,
  reconcileDurableCompletion,
  processNextProviderProofMaintenance
} = require('./provider-proof-maintenance-worker.cjs');

const NOW = Date.parse('2026-09-19T22:45:00.000Z');
const BODY = Buffer.from('<?xml version="1.0"?><edmx:Edmx xmlns:edmx="urn:test"><edmx:DataServices /></edmx:Edmx>');
const METADATA_DIGEST = createHash('sha256').update(BODY).digest('hex');

function review() {
  return {
    reviewedDigest: 'b'.repeat(64),
    connectionId: 'conn-sap-sandbox',
    providerKey: 'sap-successfactors',
    transport: 'api',
    targetIdentity: 'ACME-SBX',
    environment: 'non-production',
    auth: { method: 'service-account', credentialRef: 'secret://sap/sandbox-proof' }
  };
}

function task(overrides = {}) {
  return {
    action: 'RUN_SAFE_PROVIDER_PROOF',
    taskKey: 'a'.repeat(64),
    reviewedDigest: 'b'.repeat(64),
    connectionId: 'conn-sap-sandbox',
    providerKey: 'sap-successfactors',
    targetIdentity: 'ACME-SBX',
    environment: 'non-production',
    proofMode: 'BOUNDED_METADATA_ONLY',
    nonMutating: true,
    writeAllowed: false,
    businessApplyAllowed: false,
    payrollDataAllowed: false,
    workforcePayloadAllowed: false,
    responseBodyRetentionAllowed: false,
    mappingMutationAllowed: false,
    recoveryProbe: false,
    reconciliationRequired: false,
    refreshProviderProof: true,
    mayResumeBusinessTrafficAfterSuccess: true,
    ...overrides
  };
}

function claim(overrides = {}) {
  const safeTask = task(overrides);
  return { taskKey: safeTask.taskKey, claimToken: 'lease-token', task: safeTask };
}

function target() {
  return { apiServer: 'api12.successfactors.eu', companyId: 'ACME-SBX' };
}

function response(observedAt = '2026-09-19T22:44:59.000Z') {
  return {
    status: 200,
    finalUrl: 'https://api12.successfactors.eu/odata/v2/User/$metadata',
    observedAt,
    elapsedMs: 118,
    headers: { 'content-type': 'application/xml', 'company-id': 'ACME-SBX' },
    body: BODY
  };
}

function priorLease() {
  const r = review();
  return createProviderProofLease(r, {
    status: 'PASS',
    providerKey: r.providerKey,
    reviewedDigest: r.reviewedDigest,
    targetIdentity: r.targetIdentity,
    environment: r.environment,
    observedAt: '2026-09-19T22:20:00.000Z',
    metadataDigest: METADATA_DIGEST,
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false
  }, { maxAgeSeconds: 3600, renewWindowSeconds: 600 }, NOW - 25 * 60 * 1000);
}

test('routine metadata re-proof preserves approval and can resume only through runtime gates', async () => {
  let seenPlan;
  const result = await executeProviderProofClaim({
    claim: claim(),
    review: review(),
    target: target(),
    priorLease: priorLease(),
    executeProof: async (plan) => {
      seenPlan = plan;
      return response();
    }
  }, NOW);

  assert.equal(seenPlan.nonMutating, true);
  assert.equal(seenPlan.containsSensitiveData, false);
  assert.equal(seenPlan.activationAllowedFromThisProofAlone, false);
  assert.equal(seenPlan.credentialRef, 'secret://sap/sandbox-proof');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.result.approvalDisposition, 'PRESERVE_EXISTING_APPROVAL');
  assert.equal(result.result.mappingReviewRequired, false);
  assert.equal(result.result.businessTrafficDisposition, 'ELIGIBLE_AFTER_RUNTIME_GATES');
  assert.equal(result.result.automaticResumeAllowed, true);
  assert.match(result.outcomeDigest, /^[a-f0-9]{64}$/);
});

test('recovery proof requires bounded control-plane reconciliation and never auto-resumes directly', async () => {
  const recoveryClaim = claim({
    action: 'RUN_SAFE_RECOVERY_PROBE',
    recoveryProbe: true,
    reconciliationRequired: true,
    mayResumeBusinessTrafficAfterSuccess: false
  });

  const result = await executeProviderProofClaim({
    claim: recoveryClaim,
    review: review(),
    target: target(),
    priorLease: priorLease(),
    executeProof: async () => response(),
    reconcileControlPlane: async ({ review: boundReview }) => ({
      status: 'PASS',
      reviewedDigest: boundReview.reviewedDigest,
      scope: 'CONTROL_PLANE_ONLY',
      containsSensitiveData: false,
      writePerformed: false,
      businessRecordsRead: false,
      observedAt: '2026-09-19T22:45:00.000Z',
      evidenceDigest: 'c'.repeat(64)
    })
  }, NOW);

  assert.equal(result.result.reconciliationDigest, 'c'.repeat(64));
  assert.equal(result.result.automaticResumeAllowed, false);
});

test('unsafe recovery reconciliation is rejected before durable success', async () => {
  await assert.rejects(() => executeProviderProofClaim({
    claim: claim({
      action: 'RUN_SAFE_RECOVERY_PROBE',
      recoveryProbe: true,
      reconciliationRequired: true,
      mayResumeBusinessTrafficAfterSuccess: false
    }),
    review: review(),
    target: target(),
    priorLease: priorLease(),
    executeProof: async () => response(),
    reconcileControlPlane: async () => ({
      status: 'PASS',
      reviewedDigest: 'b'.repeat(64),
      scope: 'BUSINESS_RECORDS',
      containsSensitiveData: false,
      writePerformed: false,
      businessRecordsRead: true,
      observedAt: '2026-09-19T22:45:00.000Z',
      evidenceDigest: 'd'.repeat(64)
    })
  }, NOW), /control-plane boundary/);
});

test('worker records transient provider failure as retry without exposing response data', async () => {
  let completed;
  const fakeLedger = {
    claimNext() { return claim(); },
    complete(taskKey, claimToken, outcome) {
      completed = { taskKey, claimToken, outcome };
      return { taskKey, status: outcome.status === 'RETRY' ? 'PENDING' : outcome.status, errorClass: outcome.errorClass };
    }
  };
  const error = Object.assign(new Error('temporary outage with secret-looking details'), {
    retryable: true,
    retryAfterMs: 2500,
    errorClass: 'provider-timeout'
  });

  const result = await processNextProviderProofMaintenance({
    ledger: fakeLedger,
    workerId: 'proof-worker-1',
    loadContext: async () => ({ review: review(), target: target(), priorLease: priorLease() }),
    executeProof: async () => { throw error; }
  }, NOW);

  assert.equal(result.state, 'PENDING');
  assert.deepEqual(completed.outcome, { status: 'RETRY', errorClass: 'provider-timeout', retryAfterMs: 2500 });
  assert.equal(JSON.stringify(result).includes('secret-looking'), false);
});

test('provider response time is evaluated at observation completion rather than claim start', async () => {
  let wall = 1_000_000;
  const result = await executeProviderProofClaim({
    claim: claim(),
    review: review(),
    target: target(),
    priorLease: priorLease(),
    wallClock: () => wall,
    executeProof: async () => {
      wall += 10_000;
      return response(new Date(NOW + 9_000).toISOString());
    }
  }, NOW);

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.result.verifiedAt, new Date(NOW + 9_000).toISOString());
});

test('worker never records success after its durable claim lease expired', async () => {
  let wall = 2_000_000;
  let completionCalled = false;
  const leasedClaim = {
    ...claim(),
    claimExpiresAt: new Date(NOW + 1_000).toISOString()
  };
  const fakeLedger = {
    claimNext() { return leasedClaim; },
    complete() {
      completionCalled = true;
      throw new Error('stale worker must not complete');
    }
  };

  const result = await processNextProviderProofMaintenance({
    ledger: fakeLedger,
    workerId: 'proof-worker-1',
    wallClock: () => wall,
    loadContext: async () => ({ review: review(), target: target(), priorLease: priorLease() }),
    executeProof: async () => {
      wall += 2_000;
      return response(new Date(NOW + 1_500).toISOString());
    }
  }, NOW);

  assert.equal(result.state, 'CLAIM_EXPIRED');
  assert.equal(result.errorClass, 'maintenance-claim-expired');
  assert.equal(completionCalled, false);
});

test('lost success acknowledgement is reconciled from durable state without a second provider call', async () => {
  let durableTask = {
    taskKey: 'a'.repeat(64),
    status: 'CLAIMED',
    claimExpiresAt: new Date(NOW + 60_000).toISOString(),
    outcomeDigest: null,
    lastErrorClass: null
  };
  let providerCalls = 0;
  const fakeLedger = {
    claimNext() { return { ...claim(), claimExpiresAt: durableTask.claimExpiresAt }; },
    complete(taskKey, claimToken, outcome) {
      durableTask = {
        ...durableTask,
        taskKey,
        status: 'SUCCEEDED',
        claimExpiresAt: null,
        outcomeDigest: outcome.outcomeDigest
      };
      throw new Error('acknowledgement lost after durable commit');
    },
    getTask() { return { ...durableTask }; }
  };

  const result = await processNextProviderProofMaintenance({
    ledger: fakeLedger,
    workerId: 'proof-worker-1',
    loadContext: async () => ({ review: review(), target: target(), priorLease: priorLease() }),
    executeProof: async () => {
      providerCalls += 1;
      return response();
    }
  }, NOW);

  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(result.reconciled, true);
  assert.equal(result.retryAllowed, false);
  assert.equal(providerCalls, 1);
  assert.match(result.outcomeDigest, /^[a-f0-9]{64}$/);
});

test('uncertain completion cannot retry while the durable claim is still owned', () => {
  const result = reconcileDurableCompletion({
    getTask() {
      return {
        taskKey: 'a'.repeat(64),
        status: 'CLAIMED',
        claimExpiresAt: new Date(NOW + 30_000).toISOString(),
        outcomeDigest: null,
        lastErrorClass: null
      };
    }
  }, {
    taskKey: 'a'.repeat(64),
    intendedStatus: 'SUCCESS',
    outcomeDigest: 'c'.repeat(64)
  }, NOW);

  assert.equal(result.state, 'COMPLETION_UNCERTAIN');
  assert.equal(result.retryAllowed, false);
  assert.equal(result.retryNotBefore, new Date(NOW + 30_000).toISOString());
});

test('durable success with a different outcome digest fails closed', () => {
  const result = reconcileDurableCompletion({
    getTask() {
      return {
        taskKey: 'a'.repeat(64),
        status: 'SUCCEEDED',
        claimExpiresAt: null,
        outcomeDigest: 'd'.repeat(64),
        lastErrorClass: null
      };
    }
  }, {
    taskKey: 'a'.repeat(64),
    intendedStatus: 'SUCCESS',
    outcomeDigest: 'c'.repeat(64)
  }, NOW);

  assert.equal(result.state, 'ATTENTION_REQUIRED');
  assert.equal(result.retryAllowed, false);
  assert.equal(result.errorClass, 'maintenance-outcome-digest-mismatch');
});
