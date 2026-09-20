'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TASK_KEY = /^[a-f0-9]{64}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const ERROR_CLASS = /^[A-Za-z0-9._:-]{1,120}$/;
const SAFE_ACTIONS = new Set(['RUN_SAFE_PROVIDER_PROOF', 'RUN_SAFE_RECOVERY_PROBE']);
const DEFAULT_CLAIM_MS = 60_000;
const MIN_CLAIM_MS = 5_000;
const MAX_CLAIM_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

function asText(value) {
  return String(value ?? '').trim();
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function boundedPositiveInt(value, fallback, min, max, label) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} is outside its safe bounds.`);
  return n;
}

function normalizeSafeTask(review, maintenance = {}) {
  const task = maintenance?.task;
  if (!review?.reviewedDigest || !review?.connectionId || !review?.providerKey || !review?.targetIdentity) {
    throw new Error('Exact reviewed connection is required for provider proof scheduling.');
  }
  if (!task || typeof task !== 'object') throw new Error('Provider proof maintenance task is missing.');
  if (!SAFE_ACTIONS.has(String(task.action || '')) || task.action !== maintenance.action) {
    throw new Error('Provider proof maintenance action is not approved for automatic scheduling.');
  }
  if (!TASK_KEY.test(String(task.taskKey || ''))) throw new Error('Provider proof maintenance task key is invalid.');
  if (task.reviewedDigest !== review.reviewedDigest) throw new Error('Provider proof maintenance task belongs to a different review.');
  if (task.connectionId !== review.connectionId) throw new Error('Provider proof maintenance task belongs to a different connection.');
  if (asLower(task.providerKey) !== asLower(review.providerKey)) throw new Error('Provider proof maintenance task belongs to a different provider.');
  if (asText(task.targetIdentity) !== asText(review.targetIdentity)) throw new Error('Provider proof maintenance task belongs to a different target identity.');
  if (asLower(task.environment || 'non-production') !== asLower(review.environment || 'non-production')) {
    throw new Error('Provider proof maintenance task belongs to a different environment.');
  }
  if (task.proofMode !== 'BOUNDED_METADATA_ONLY' || task.nonMutating !== true || task.writeAllowed !== false ||
      task.businessApplyAllowed !== false || task.payrollDataAllowed !== false || task.workforcePayloadAllowed !== false ||
      task.responseBodyRetentionAllowed !== false || task.mappingMutationAllowed !== false) {
    throw new Error('Provider proof maintenance task exceeds the approved metadata-only safety boundary.');
  }
  if (task.action === 'RUN_SAFE_RECOVERY_PROBE' && (task.recoveryProbe !== true || task.reconciliationRequired !== true)) {
    throw new Error('Recovery proof task must require a bounded recovery probe and reconciliation.');
  }
  if (task.action === 'RUN_SAFE_PROVIDER_PROOF' && task.recoveryProbe === true) {
    throw new Error('Routine provider re-proof cannot masquerade as a recovery probe.');
  }

  const safe = {
    action: task.action,
    taskKey: String(task.taskKey).toLowerCase(),
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    providerKey: asLower(review.providerKey),
    targetIdentity: asText(review.targetIdentity),
    environment: asLower(review.environment || 'non-production'),
    proofMode: 'BOUNDED_METADATA_ONLY',
    nonMutating: true,
    writeAllowed: false,
    businessApplyAllowed: false,
    payrollDataAllowed: false,
    workforcePayloadAllowed: false,
    responseBodyRetentionAllowed: false,
    mappingMutationAllowed: false,
    recoveryProbe: task.recoveryProbe === true,
    reconciliationRequired: task.reconciliationRequired === true,
    refreshProviderProof: task.refreshProviderProof === true,
    mayResumeBusinessTrafficAfterSuccess: task.mayResumeBusinessTrafficAfterSuccess === true
  };
  return Object.freeze({ task: Object.freeze(safe), taskDigest: digest(safe) });
}

function verifyStoredRow(row) {
  const blockers = [];
  let task;
  try {
    task = JSON.parse(String(row?.safe_task_json || ''));
  } catch {
    return { valid: false, blockers: ['Stored provider proof maintenance task is not valid JSON.'], task: null };
  }
  if (!task || typeof task !== 'object') blockers.push('Stored provider proof maintenance task is invalid.');
  if (task?.taskKey !== row.task_key) blockers.push('Stored task key does not match its durable row.');
  if (task?.reviewedDigest !== row.reviewed_digest) blockers.push('Stored review digest does not match its durable row.');
  if (task?.connectionId !== row.connection_id) blockers.push('Stored connection does not match its durable row.');
  if (asLower(task?.providerKey) !== asLower(row.provider_key)) blockers.push('Stored provider does not match its durable row.');
  if (asText(task?.targetIdentity) !== asText(row.target_identity)) blockers.push('Stored target identity does not match its durable row.');
  if (asLower(task?.environment) !== asLower(row.environment)) blockers.push('Stored environment does not match its durable row.');
  if (task?.action !== row.action || !SAFE_ACTIONS.has(String(task?.action || ''))) blockers.push('Stored maintenance action is not approved.');
  if (task?.proofMode !== 'BOUNDED_METADATA_ONLY' || task?.nonMutating !== true || task?.writeAllowed !== false ||
      task?.businessApplyAllowed !== false || task?.payrollDataAllowed !== false || task?.workforcePayloadAllowed !== false ||
      task?.responseBodyRetentionAllowed !== false || task?.mappingMutationAllowed !== false) {
    blockers.push('Stored maintenance task exceeds the metadata-only safety boundary.');
  }
  if (task?.action === 'RUN_SAFE_RECOVERY_PROBE' && (task?.recoveryProbe !== true || task?.reconciliationRequired !== true)) {
    blockers.push('Stored recovery task no longer requires reconciliation.');
  }
  if (!DIGEST.test(String(row?.task_digest || '')) || digest(task) !== row.task_digest) {
    blockers.push('Stored provider proof maintenance task integrity verification failed.');
  }
  return { valid: blockers.length === 0, blockers, task };
}

function createProviderProofMaintenanceLedger(options = {}) {
  const db = options.db || new DatabaseSync(options.dbPath || ':memory:');
  const ownsDb = !options.db;
  const maxAttempts = boundedPositiveInt(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 50, 'Provider proof maintenance retry count');

  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;' +
    'CREATE TABLE IF NOT EXISTS provider_proof_maintenance_tasks(' +
      'task_key TEXT PRIMARY KEY,' +
      'reviewed_digest TEXT NOT NULL,' +
      'connection_id TEXT NOT NULL,' +
      'provider_key TEXT NOT NULL,' +
      'target_identity TEXT NOT NULL,' +
      'environment TEXT NOT NULL,' +
      'action TEXT NOT NULL,' +
      'task_digest TEXT NOT NULL,' +
      'safe_task_json TEXT NOT NULL,' +
      'status TEXT NOT NULL,' +
      'not_before_ms INTEGER NOT NULL,' +
      'next_attempt_ms INTEGER,' +
      'first_failure_ms INTEGER,' +
      'attempt_count INTEGER NOT NULL DEFAULT 0,' +
      'claimed_by TEXT,' +
      'claim_token_digest TEXT,' +
      'claim_expires_ms INTEGER,' +
      'outcome_digest TEXT,' +
      'last_error_class TEXT,' +
      'created_at_ms INTEGER NOT NULL,' +
      'updated_at_ms INTEGER NOT NULL' +
    ');' +
    'CREATE INDEX IF NOT EXISTS provider_proof_maintenance_ready_idx ON provider_proof_maintenance_tasks(status,not_before_ms,next_attempt_ms,created_at_ms);'
  );

  const columns = db.prepare('PRAGMA table_info(provider_proof_maintenance_tasks)').all();
  if (!columns.some((column) => String(column.name) === 'first_failure_ms')) {
    db.exec('ALTER TABLE provider_proof_maintenance_tasks ADD COLUMN first_failure_ms INTEGER;');
  }

  const insertTask = db.prepare(
    'INSERT OR IGNORE INTO provider_proof_maintenance_tasks(' +
      'task_key,reviewed_digest,connection_id,provider_key,target_identity,environment,action,task_digest,safe_task_json,status,not_before_ms,created_at_ms,updated_at_ms' +
    ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const taskByKey = db.prepare('SELECT * FROM provider_proof_maintenance_tasks WHERE task_key=?');
  const expireClaims = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='PENDING',claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,updated_at_ms=? " +
    "WHERE status='CLAIMED' AND claim_expires_ms IS NOT NULL AND claim_expires_ms<=?"
  );
  const blockExhausted = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='BLOCKED',last_error_class='retry-budget-exhausted',claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,updated_at_ms=? " +
    "WHERE status='PENDING' AND attempt_count>=?"
  );
  const nextReady = db.prepare(
    "SELECT * FROM provider_proof_maintenance_tasks WHERE status='PENDING' AND attempt_count<? AND not_before_ms<=? " +
    'AND (next_attempt_ms IS NULL OR next_attempt_ms<=?) ORDER BY not_before_ms ASC, created_at_ms ASC, task_key ASC LIMIT 1'
  );
  const claimTask = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='CLAIMED',attempt_count=attempt_count+1,claimed_by=?,claim_token_digest=?,claim_expires_ms=?,updated_at_ms=? " +
    "WHERE task_key=? AND status='PENDING' AND attempt_count<?"
  );
  const succeedTask = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='SUCCEEDED',outcome_digest=?,last_error_class=NULL,claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,next_attempt_ms=NULL,updated_at_ms=? " +
    "WHERE task_key=? AND status='CLAIMED' AND claim_token_digest=?"
  );
  const retryTask = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='PENDING',last_error_class=?,first_failure_ms=COALESCE(first_failure_ms,?),next_attempt_ms=?,claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,updated_at_ms=? " +
    "WHERE task_key=? AND status='CLAIMED' AND claim_token_digest=?"
  );
  const blockTask = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='BLOCKED',last_error_class=?,claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,next_attempt_ms=NULL,updated_at_ms=? " +
    "WHERE task_key=? AND status='CLAIMED' AND claim_token_digest=?"
  );
  const blockPendingIntegrity = db.prepare(
    "UPDATE provider_proof_maintenance_tasks SET status='BLOCKED',last_error_class='ledger-integrity-failed',claimed_by=NULL,claim_token_digest=NULL,claim_expires_ms=NULL,next_attempt_ms=NULL,updated_at_ms=? " +
    "WHERE task_key=? AND status='PENDING'"
  );

  function schedule(review, maintenance, now = Date.now()) {
    const normalized = normalizeSafeTask(review, maintenance);
    const executeNotBeforeMs = maintenance.executeNotBefore ? Date.parse(String(maintenance.executeNotBefore)) : now;
    if (!Number.isFinite(executeNotBeforeMs)) throw new Error('Provider proof maintenance execution time is invalid.');
    const notBeforeMs = Math.max(now, executeNotBeforeMs);
    const safeJson = JSON.stringify(normalized.task);
    const inserted = insertTask.run(
      normalized.task.taskKey,
      normalized.task.reviewedDigest,
      normalized.task.connectionId,
      normalized.task.providerKey,
      normalized.task.targetIdentity,
      normalized.task.environment,
      normalized.task.action,
      normalized.taskDigest,
      safeJson,
      'PENDING',
      notBeforeMs,
      now,
      now
    );
    const row = taskByKey.get(normalized.task.taskKey);
    if (!row) throw new Error('Provider proof maintenance task could not be durably scheduled.');
    if (row.task_digest !== normalized.taskDigest || row.safe_task_json !== safeJson) {
      throw new Error('Provider proof maintenance task key collision or task mutation detected.');
    }
    return Object.freeze({
      taskKey: row.task_key,
      status: row.status,
      action: row.action,
      scheduled: Number(inserted.changes || 0) === 1,
      attemptCount: Number(row.attempt_count),
      notBefore: new Date(Number(row.not_before_ms)).toISOString()
    });
  }

  function claimNext(workerId, claimOptions = {}, now = Date.now()) {
    const worker = asText(workerId);
    if (!WORKER_ID.test(worker)) throw new Error('Provider proof maintenance worker identity is invalid.');
    const leaseMs = boundedPositiveInt(claimOptions.leaseMs, DEFAULT_CLAIM_MS, MIN_CLAIM_MS, MAX_CLAIM_MS, 'Provider proof maintenance claim lease');

    db.exec('BEGIN IMMEDIATE');
    try {
      expireClaims.run(now, now);
      blockExhausted.run(now, maxAttempts);
      for (let scanned = 0; scanned < 25; scanned += 1) {
        const row = nextReady.get(maxAttempts, now, now);
        if (!row) {
          db.exec('COMMIT');
          return null;
        }
        const integrity = verifyStoredRow(row);
        if (!integrity.valid) {
          blockPendingIntegrity.run(now, row.task_key);
          continue;
        }
        const claimToken = randomUUID();
        const claimExpiresMs = now + leaseMs;
        const claimTokenDigest = sha256(claimToken);
        const result = claimTask.run(worker, claimTokenDigest, claimExpiresMs, now, row.task_key, maxAttempts);
        if (Number(result.changes || 0) !== 1) throw new Error('Provider proof maintenance task could not be claimed atomically.');
        const claimed = taskByKey.get(row.task_key);
        db.exec('COMMIT');
        return Object.freeze({
          taskKey: claimed.task_key,
          claimToken,
          claimedBy: worker,
          claimExpiresAt: new Date(claimExpiresMs).toISOString(),
          attemptCount: Number(claimed.attempt_count),
          task: Object.freeze(integrity.task)
        });
      }
      db.exec('COMMIT');
      return null;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function complete(taskKey, claimToken, outcome = {}, now = Date.now()) {
    const key = String(taskKey || '').toLowerCase();
    if (!TASK_KEY.test(key)) throw new Error('Provider proof maintenance task key is invalid.');
    const token = asText(claimToken);
    if (!token) throw new Error('Provider proof maintenance claim token is required.');
    const row = taskByKey.get(key);
    if (!row || row.status !== 'CLAIMED' || row.claim_token_digest !== sha256(token)) {
      throw new Error('Provider proof maintenance claim is no longer current.');
    }
    const integrity = verifyStoredRow(row);
    if (!integrity.valid) {
      blockTask.run('ledger-integrity-failed', now, key, sha256(token));
      throw new Error('Provider proof maintenance ledger integrity verification failed.');
    }
    if (!Number.isFinite(Number(row.claim_expires_ms)) || Number(row.claim_expires_ms) <= now) {
      throw new Error('Provider proof maintenance claim has expired; the stale worker cannot complete it.');
    }

    const status = asText(outcome.status).toUpperCase();
    if (status === 'SUCCESS') {
      const outcomeDigest = asText(outcome.outcomeDigest).toLowerCase();
      if (!DIGEST.test(outcomeDigest)) throw new Error('Successful provider proof maintenance requires a bounded outcome digest.');
      const result = succeedTask.run(outcomeDigest, now, key, sha256(token));
      if (Number(result.changes || 0) !== 1) throw new Error('Provider proof maintenance success could not be recorded.');
      return Object.freeze({ taskKey: key, status: 'SUCCEEDED', outcomeDigest });
    }

    const errorClass = asText(outcome.errorClass);
    if (!ERROR_CLASS.test(errorClass)) throw new Error('Provider proof maintenance failure requires a bounded error class.');
    if (status === 'BLOCK') {
      const result = blockTask.run(errorClass, now, key, sha256(token));
      if (Number(result.changes || 0) !== 1) throw new Error('Provider proof maintenance block could not be recorded.');
      return Object.freeze({ taskKey: key, status: 'BLOCKED', errorClass });
    }
    if (status !== 'RETRY') throw new Error('Unsupported provider proof maintenance outcome.');

    if (Number(row.attempt_count) >= maxAttempts) {
      const result = blockTask.run('retry-budget-exhausted', now, key, sha256(token));
      if (Number(result.changes || 0) !== 1) throw new Error('Provider proof maintenance retry exhaustion could not be recorded.');
      return Object.freeze({ taskKey: key, status: 'BLOCKED', errorClass: 'retry-budget-exhausted' });
    }
    const retryAfterMs = boundedPositiveInt(outcome.retryAfterMs, 1_000, 1, MAX_RETRY_DELAY_MS, 'Provider proof maintenance retry delay');
    const nextAttemptMs = now + retryAfterMs;
    const result = retryTask.run(errorClass, now, nextAttemptMs, now, key, sha256(token));
    if (Number(result.changes || 0) !== 1) throw new Error('Provider proof maintenance retry could not be recorded.');
    return Object.freeze({
      taskKey: key,
      status: 'PENDING',
      errorClass,
      nextAttemptAt: new Date(nextAttemptMs).toISOString()
    });
  }

  function getTask(taskKey) {
    const key = String(taskKey || '').toLowerCase();
    if (!TASK_KEY.test(key)) return null;
    const row = taskByKey.get(key);
    if (!row) return null;
    return Object.freeze({
      taskKey: row.task_key,
      reviewedDigest: row.reviewed_digest,
      connectionId: row.connection_id,
      providerKey: row.provider_key,
      targetIdentity: row.target_identity,
      environment: row.environment,
      action: row.action,
      status: row.status,
      attemptCount: Number(row.attempt_count),
      notBefore: new Date(Number(row.not_before_ms)).toISOString(),
      nextAttemptAt: row.next_attempt_ms == null ? null : new Date(Number(row.next_attempt_ms)).toISOString(),
      firstFailureAt: row.first_failure_ms == null ? null : new Date(Number(row.first_failure_ms)).toISOString(),
      claimExpiresAt: row.claim_expires_ms == null ? null : new Date(Number(row.claim_expires_ms)).toISOString(),
      outcomeDigest: row.outcome_digest || null,
      lastErrorClass: row.last_error_class || null
    });
  }

  function close() {
    if (ownsDb) db.close();
  }

  return Object.freeze({ schedule, claimNext, complete, getTask, close });
}

module.exports = {
  normalizeSafeTask,
  createProviderProofMaintenanceLedger
};