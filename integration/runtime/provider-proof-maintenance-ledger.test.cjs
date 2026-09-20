'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createProviderProofMaintenanceLedger
} = require('./provider-proof-maintenance-ledger.cjs');

const NOW = Date.parse('2026-09-19T21:45:00.000Z');
const review = {
  reviewedDigest: 'a'.repeat(64),
  connectionId: 'netsuite-sandbox-a',
  providerKey: 'oracle-netsuite',
  targetIdentity: '1234567-sb1',
  environment: 'sandbox'
};

function maintenance(overrides = {}) {
  const task = {
    action: 'RUN_SAFE_PROVIDER_PROOF',
    taskKey: 'b'.repeat(64),
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    providerKey: review.providerKey,
    targetIdentity: review.targetIdentity,
    environment: review.environment,
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
    ...overrides.task
  };
  return { action: task.action, state: 'REPROOF_SCHEDULED', canUseForBusinessTraffic: true, task, ...overrides, task };
}

test('scheduling is durable and exact duplicate scheduling stays single-copy across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfm-proof-ledger-'));
  const dbPath = join(dir, 'ledger.db');
  try {
    const first = createProviderProofMaintenanceLedger({ dbPath });
    const scheduled = first.schedule(review, maintenance(), NOW);
    assert.equal(scheduled.status, 'PENDING');
    first.close();

    const second = createProviderProofMaintenanceLedger({ dbPath });
    const duplicate = second.schedule(review, maintenance(), NOW + 1000);
    assert.equal(duplicate.taskKey, scheduled.taskKey);
    assert.equal(duplicate.attemptCount, 0);
    assert.equal(second.getTask(scheduled.taskKey).status, 'PENDING');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same task key with changed safe task body fails closed', () => {
  const ledger = createProviderProofMaintenanceLedger();
  try {
    ledger.schedule(review, maintenance(), NOW);
    assert.throws(() => ledger.schedule(review, maintenance({
      task: { mayResumeBusinessTrafficAfterSuccess: false }
    }), NOW + 1000), /collision|mutation/i);
  } finally {
    ledger.close();
  }
});

test('credentials and arbitrary provider payloads are never persisted in the safe task record', () => {
  const db = new DatabaseSync(':memory:');
  const ledger = createProviderProofMaintenanceLedger({ db });
  const value = maintenance();
  value.task.credential = 'do-not-store';
  value.task.rawProviderResponse = { employee: 'do-not-store' };
  ledger.schedule(review, value, NOW);
  const row = db.prepare('SELECT safe_task_json FROM provider_proof_maintenance_tasks WHERE task_key=?').get('b'.repeat(64));
  assert.equal(String(row.safe_task_json).includes('do-not-store'), false);
  db.close();
});

test('claim is exclusive until lease expiry, then safely reclaimable', () => {
  const ledger = createProviderProofMaintenanceLedger();
  try {
    ledger.schedule(review, maintenance(), NOW);
    const first = ledger.claimNext('worker-a', { leaseMs: 5000 }, NOW);
    assert.equal(first.attemptCount, 1);
    assert.equal(ledger.claimNext('worker-b', { leaseMs: 5000 }, NOW + 1000), null);
    const second = ledger.claimNext('worker-b', { leaseMs: 5000 }, NOW + 5001);
    assert.equal(second.attemptCount, 2);
    assert.notEqual(second.claimToken, first.claimToken);
    assert.throws(() => ledger.complete(first.taskKey, first.claimToken, {
      status: 'SUCCESS', outcomeDigest: 'c'.repeat(64)
    }, NOW + 5002), /no longer current|expired/i);
  } finally {
    ledger.close();
  }
});

test('successful completion is durable and the same scheduled task remains completed', () => {
  const ledger = createProviderProofMaintenanceLedger();
  try {
    ledger.schedule(review, maintenance(), NOW);
    const claim = ledger.claimNext('worker-a', {}, NOW);
    const result = ledger.complete(claim.taskKey, claim.claimToken, {
      status: 'SUCCESS', outcomeDigest: 'c'.repeat(64)
    }, NOW + 1000);
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(ledger.schedule(review, maintenance(), NOW + 2000).status, 'SUCCEEDED');
    assert.equal(ledger.claimNext('worker-b', {}, NOW + 2000), null);
  } finally {
    ledger.close();
  }
});

test('retry delay prevents hot-looping and preserves the same deterministic task', () => {
  const ledger = createProviderProofMaintenanceLedger();
  try {
    ledger.schedule(review, maintenance(), NOW);
    const first = ledger.claimNext('worker-a', {}, NOW);
    const retry = ledger.complete(first.taskKey, first.claimToken, {
      status: 'RETRY', errorClass: 'temporarily-unavailable', retryAfterMs: 10_000
    }, NOW + 1000);
    assert.equal(retry.status, 'PENDING');
    assert.equal(ledger.claimNext('worker-b', {}, NOW + 5000), null);
    const second = ledger.claimNext('worker-b', {}, NOW + 11_001);
    assert.equal(second.taskKey, first.taskKey);
    assert.equal(second.attemptCount, 2);
  } finally {
    ledger.close();
  }
});

test('retry budget fails closed instead of looping forever', () => {
  const ledger = createProviderProofMaintenanceLedger({ maxAttempts: 2 });
  try {
    ledger.schedule(review, maintenance(), NOW);
    const first = ledger.claimNext('worker-a', {}, NOW);
    ledger.complete(first.taskKey, first.claimToken, {
      status: 'RETRY', errorClass: 'timeout', retryAfterMs: 1
    }, NOW + 1000);
    const second = ledger.claimNext('worker-a', {}, NOW + 1002);
    const exhausted = ledger.complete(second.taskKey, second.claimToken, {
      status: 'RETRY', errorClass: 'timeout', retryAfterMs: 1
    }, NOW + 1003);
    assert.equal(exhausted.status, 'BLOCKED');
    assert.equal(ledger.getTask(second.taskKey).lastErrorClass, 'retry-budget-exhausted');
    assert.equal(ledger.claimNext('worker-b', {}, NOW + 2000), null);
  } finally {
    ledger.close();
  }
});

test('recovery tasks must remain metadata-only and require reconciliation', () => {
  const ledger = createProviderProofMaintenanceLedger();
  try {
    const good = maintenance({
      action: 'RUN_SAFE_RECOVERY_PROBE',
      task: {
        action: 'RUN_SAFE_RECOVERY_PROBE',
        recoveryProbe: true,
        reconciliationRequired: true,
        mayResumeBusinessTrafficAfterSuccess: false
      }
    });
    assert.equal(ledger.schedule(review, good, NOW).status, 'PENDING');

    const bad = maintenance({
      task: {
        taskKey: 'd'.repeat(64),
        action: 'RUN_SAFE_RECOVERY_PROBE',
        recoveryProbe: true,
        reconciliationRequired: false
      },
      action: 'RUN_SAFE_RECOVERY_PROBE'
    });
    assert.throws(() => ledger.schedule(review, bad, NOW), /reconciliation/i);
  } finally {
    ledger.close();
  }
});

test('tampered durable task is blocked before any worker can execute it', () => {
  const db = new DatabaseSync(':memory:');
  const ledger = createProviderProofMaintenanceLedger({ db });
  ledger.schedule(review, maintenance(), NOW);
  db.prepare('UPDATE provider_proof_maintenance_tasks SET safe_task_json=? WHERE task_key=?').run(
    JSON.stringify({ action: 'RUN_SAFE_PROVIDER_PROOF', taskKey: 'b'.repeat(64), writeAllowed: true }),
    'b'.repeat(64)
  );
  assert.equal(ledger.claimNext('worker-a', {}, NOW), null);
  const row = db.prepare('SELECT status,last_error_class FROM provider_proof_maintenance_tasks WHERE task_key=?').get('b'.repeat(64));
  assert.equal(row.status, 'BLOCKED');
  assert.equal(row.last_error_class, 'ledger-integrity-failed');
  db.close();
});
