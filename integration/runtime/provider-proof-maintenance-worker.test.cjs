'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createProviderProofLease } = require('./provider-proof-lifecycle.cjs');
const {
  executeProviderProofClaim,
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