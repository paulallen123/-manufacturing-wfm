'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  processNextProviderProofMaintenanceWithTransportPolicy
} = require('./provider-proof-maintenance-runner.cjs');

const NOW = Date.parse('2026-09-20T03:45:00.000Z');

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

function claim(attemptCount = 1) {
  return {
    taskKey: 'a'.repeat(64),
    claimToken: 'lease-token',
    claimExpiresAt: new Date(NOW + 60_000).toISOString(),
    attemptCount,
    task: {
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
      mayResumeBusinessTrafficAfterSuccess: true
    }
  };
}

function target() {
  return { apiServer: 'api12.successfactors.eu', companyId: 'ACME-SBX' };
}

test('maintenance runner replaces fixed retry timing with shared transport policy', async () => {
  let completed;
  const ledger = {
    claimNext() { return claim(1); },
    complete(taskKey, claimToken, outcome) {
      completed = { taskKey, claimToken, outcome };
      return { taskKey, status: outcome.status === 'RETRY' ? 'PENDING' : 'BLOCKED', errorClass: outcome.errorClass };
    },
    getTask() { return null; }
  };
  const providerError = Object.assign(new Error('provider body must not escape'), {
    retryable: true,
    errorClass: 'provider-timeout'
  });

  const result = await processNextProviderProofMaintenanceWithTransportPolicy({
    ledger,
    workerId: 'proof-worker-1',
    retryClock: () => NOW,
    loadContext: async () => ({ review: review(), target: target(), priorLease: {} }),
    executeProof: async () => { throw providerError; }
  }, NOW);

  assert.equal(result.state, 'PENDING');
  assert.equal(completed.outcome.status, 'RETRY');
  assert.equal(completed.outcome.errorClass, 'provider-timeout');
  assert.ok(completed.outcome.retryAfterMs >= 250);
  assert.ok(completed.outcome.retryAfterMs < 5000);
  assert.equal(JSON.stringify(result).includes('provider body must not escape'), false);
});

test('maintenance runner blocks provider calls once shared transport retry budget is exhausted', async () => {
  let completed;
  const ledger = {
    claimNext() { return claim(6); },
    complete(taskKey, claimToken, outcome) {
      completed = { taskKey, claimToken, outcome };
      return { taskKey, status: outcome.status === 'BLOCK' ? 'BLOCKED' : 'PENDING', errorClass: outcome.errorClass };
    },
    getTask() { return null; }
  };

  const result = await processNextProviderProofMaintenanceWithTransportPolicy({
    ledger,
    workerId: 'proof-worker-1',
    retryClock: () => NOW,
    loadContext: async () => ({ review: review(), target: target(), priorLease: {} }),
    executeProof: async () => {
      throw Object.assign(new Error('still down'), { retryable: true, errorClass: 'provider-timeout' });
    }
  }, NOW);

  assert.equal(result.state, 'BLOCKED');
  assert.equal(completed.outcome.status, 'BLOCK');
  assert.equal(completed.outcome.errorClass, 'retry-budget-exhausted');
});
