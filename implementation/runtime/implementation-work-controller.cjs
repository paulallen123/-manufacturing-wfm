'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TERMINAL = new Set(['SATISFIED', 'FAILED_CLOSED', 'EXHAUSTED']);
const ACTIVE = new Set(['PENDING', 'RUNNING', 'AWAITING_EVIDENCE', 'RETRY_WAIT', 'WAITING_DEPENDENCY', 'BLOCKED_RESUMABLE']);
const DEPENDENCY_INDEPENDENT_BLOCKERS = new Set(['CUSTOMER_POLICY_AUTHORITY_REQUIRED']);

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function createImplementationWorkController(options = {}) {
  if (!options.db && !options.dbPath) throw new Error('Implementation work controller requires db or dbPath.');
  const ownsDb = !options.db;
  const db = options.db || new DatabaseSync(options.dbPath);
  const clock = options.clock || (() => Date.now());
  const leaseMs = Math.max(1_000, Number(options.leaseMs || 60_000));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 5_000));
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const requirements = Array.isArray(options.requirements) ? options.requirements.map(item => ({
    key: text(item.key, 100),
    dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(dep => text(dep, 100)).filter(Boolean) : []
  })).filter(item => item.key) : [];
  const order = new Map(requirements.map((item, index) => [item.key, index]));

  db.exec(
    'PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS implementation_work_jobs(' +
      'id TEXT PRIMARY KEY,run_id TEXT NOT NULL,tenant TEXT NOT NULL,requirement_key TEXT NOT NULL,' +
      'intent_digest TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,' +
      'lease_until_ms INTEGER NOT NULL DEFAULT 0,next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,' +
      'blocked_reason TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,' +
      'UNIQUE(run_id,tenant,requirement_key));' +
    'CREATE TABLE IF NOT EXISTS implementation_work_receipts(' +
      'id TEXT PRIMARY KEY,job_id TEXT NOT NULL,run_id TEXT NOT NULL,tenant TEXT NOT NULL,' +
      'requirement_key TEXT NOT NULL,intent_digest TEXT NOT NULL,outcome TEXT NOT NULL,' +
      'outcome_digest TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'UNIQUE(job_id,intent_digest,outcome_digest));' +
    'CREATE INDEX IF NOT EXISTS idx_implementation_work_runnable ON implementation_work_jobs(run_id,tenant,status,next_attempt_at_ms,lease_until_ms);'
  );

  const jobByRequirement = db.prepare(
    'SELECT * FROM implementation_work_jobs WHERE run_id=? AND tenant=? AND requirement_key=?'
  );
  const jobsForRun = db.prepare(
    'SELECT * FROM implementation_work_jobs WHERE run_id=? AND tenant=?'
  );
  const insertJob = db.prepare(
    'INSERT INTO implementation_work_jobs(id,run_id,tenant,requirement_key,intent_digest,status,attempts,lease_until_ms,next_attempt_at_ms,blocked_reason,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const resetJob = db.prepare(
    'UPDATE implementation_work_jobs SET intent_digest=?,status=?,attempts=0,lease_until_ms=0,next_attempt_at_ms=0,blocked_reason=?,last_error=NULL,updated_at=? WHERE id=?'
  );
  const updateState = db.prepare(
    'UPDATE implementation_work_jobs SET status=?,lease_until_ms=?,next_attempt_at_ms=?,blocked_reason=?,last_error=?,updated_at=? WHERE id=?'
  );
  const claimJob = db.prepare(
    "UPDATE implementation_work_jobs SET status='RUNNING',attempts=attempts+1,lease_until_ms=?,updated_at=? WHERE id=? AND status='PENDING'"
  );
  const receiptByDigest = db.prepare(
    'SELECT * FROM implementation_work_receipts WHERE job_id=? AND intent_digest=? AND outcome_digest=?'
  );
  const insertReceipt = db.prepare(
    'INSERT INTO implementation_work_receipts(id,job_id,run_id,tenant,requirement_key,intent_digest,outcome,outcome_digest,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  );

  function publicJob(row) {
    return {
      id: row.id,
      runId: row.run_id,
      tenant: row.tenant,
      requirementKey: row.requirement_key,
      intentDigest: row.intent_digest,
      status: row.status,
      attempts: Number(row.attempts || 0),
      leaseUntilMs: Number(row.lease_until_ms || 0),
      nextAttemptAtMs: Number(row.next_attempt_at_ms || 0),
      blockedReason: row.blocked_reason || null,
      lastError: row.last_error || null,
      updatedAt: row.updated_at
    };
  }

  function blockerDefault(item) {
    if (!item || item.satisfied) return null;
    switch (item.key) {
      case 'configuration-scope':
        return 'CUSTOMER_SCOPE_REQUIRED';
      case 'identity-access':
        return 'IDENTITY_AUTHORITY_OR_CONFIGURATION_REQUIRED';
      case 'source-systems':
        return 'SOURCE_AUTHORIZATION_OR_VALIDATION_REQUIRED';
      case 'time-policies':
      case 'absence-policies':
        return 'CUSTOMER_POLICY_AUTHORITY_REQUIRED';
      case 'payroll-mapping':
        return 'PAYROLL_MAPPING_OR_AUTHORITY_REQUIRED';
      case 'privileged-competency':
      case 'frontline-readiness':
        return 'CUSTOMER_COMPETENCY_EVIDENCE_REQUIRED';
      default:
        return null;
    }
  }

  function intentFor(item, byKey) {
    return digest({
      key: item.key,
      source: item.source || null,
      detail: item.detail || null,
      ...(item.evidenceBinding ? { evidenceBinding: item.evidenceBinding } : {}),
      dependencies: (item.dependsOn || []).map(key => {
        const dep = byKey.get(key);
        return { key, satisfied: dep?.satisfied === true, source: dep?.source || null, detail: dep?.detail || null,
          ...(dep?.evidenceBinding ? { evidenceBinding: dep.evidenceBinding } : {}) };
      })
    });
  }

  function reconcile({ runId, tenant, readiness, blockerFor = blockerDefault }) {
    runId = text(runId, 100);
    tenant = text(tenant, 120);
    if (!runId || !tenant || !readiness || !Array.isArray(readiness.requirements)) {
      throw new Error('runId, tenant and readiness requirements are required.');
    }
    const byKey = new Map(readiness.requirements.map(item => [item.key, item]));
    const nowMs = Number(clock());
    const stamp = new Date(nowMs).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const spec of requirements) {
        const item = byKey.get(spec.key) || { key: spec.key, dependsOn: spec.dependsOn, satisfied: false, source: null, detail: null };
        item.dependsOn = spec.dependsOn;
        const intentDigest = intentFor(item, byKey);
        const existing = jobByRequirement.get(runId, tenant, spec.key);
        const dependenciesSatisfied = spec.dependsOn.every(key => byKey.get(key)?.satisfied === true);
        const blockReason = item.satisfied ? null : blockerFor(item, readiness);

        let desired;
        if (item.satisfied) desired = 'SATISFIED';
        else if (blockReason && DEPENDENCY_INDEPENDENT_BLOCKERS.has(blockReason)) desired = 'BLOCKED_RESUMABLE';
        else if (!dependenciesSatisfied) desired = 'WAITING_DEPENDENCY';
        else if (blockReason) desired = 'BLOCKED_RESUMABLE';
        else desired = 'PENDING';

        if (!existing) {
          insertJob.run(
            randomUUID(), runId, tenant, spec.key, intentDigest, desired, 0, 0, 0,
            blockReason || null, null, stamp, stamp
          );
          continue;
        }

        const intentChanged = existing.intent_digest !== intentDigest;
        if (intentChanged) {
          resetJob.run(intentDigest, desired, blockReason || null, stamp, existing.id);
          continue;
        }

        if (item.satisfied && existing.status !== 'SATISFIED') {
          updateState.run('SATISFIED', 0, 0, null, null, stamp, existing.id);
          continue;
        }
        if (existing.status === 'RUNNING' && Number(existing.lease_until_ms || 0) <= nowMs) {
          updateState.run('PENDING', 0, 0, null, 'LEASE_EXPIRED', stamp, existing.id);
          continue;
        }
        if (existing.status === 'RETRY_WAIT' && Number(existing.next_attempt_at_ms || 0) <= nowMs) {
          updateState.run('PENDING', 0, 0, null, existing.last_error || null, stamp, existing.id);
          continue;
        }
        if (existing.status === 'BLOCKED_RESUMABLE' && !blockReason && dependenciesSatisfied) {
          updateState.run('PENDING', 0, 0, null, null, stamp, existing.id);
          continue;
        }
        if (existing.status === 'WAITING_DEPENDENCY' && blockReason && DEPENDENCY_INDEPENDENT_BLOCKERS.has(blockReason)) {
          updateState.run('BLOCKED_RESUMABLE', 0, 0, blockReason, null, stamp, existing.id);
          continue;
        }
        if (existing.status === 'WAITING_DEPENDENCY' && dependenciesSatisfied) {
          updateState.run(blockReason ? 'BLOCKED_RESUMABLE' : 'PENDING', 0, 0, blockReason || null, null, stamp, existing.id);
          continue;
        }
        if (!TERMINAL.has(existing.status) && !ACTIVE.has(existing.status)) {
          updateState.run(desired, 0, 0, blockReason || null, existing.last_error || null, stamp, existing.id);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return plan(runId, tenant);
  }

  function plan(runId, tenant) {
    const rows = jobsForRun.all(text(runId, 100), text(tenant, 120));
    rows.sort((a, b) => (order.get(a.requirement_key) ?? 999) - (order.get(b.requirement_key) ?? 999));
    const jobs = rows.map(publicJob);
    const counts = {};
    for (const job of jobs) counts[job.status] = (counts[job.status] || 0) + 1;
    return {
      jobs,
      counts,
      runnable: jobs.filter(job => job.status === 'PENDING').map(job => job.requirementKey),
      blocked: jobs.filter(job => job.status === 'BLOCKED_RESUMABLE').map(job => ({
        requirementKey: job.requirementKey,
        reason: job.blockedReason
      })),
      failedClosed: jobs.filter(job => job.status === 'FAILED_CLOSED').map(job => job.requirementKey)
    };
  }

  function claim({ runId, tenant, requirementKey = null }) {
    const p = plan(runId, tenant);
    const candidates = p.jobs.filter(job => job.status === 'PENDING' && (!requirementKey || job.requirementKey === requirementKey));
    const nowMs = Number(clock());
    const stamp = new Date(nowMs).toISOString();
    for (const candidate of candidates) {
      const result = claimJob.run(nowMs + leaseMs, stamp, candidate.id);
      if (Number(result.changes) === 1) return publicJob(jobByRequirement.get(runId, tenant, candidate.requirementKey));
    }
    return null;
  }

  function complete({ jobId, runId, tenant, intentDigest, outcome = 'EFFECT_RECORDED', detail = {} }) {
    const rows = jobsForRun.all(text(runId, 100), text(tenant, 120));
    const row = rows.find(item => item.id === jobId);
    if (!row) throw new Error('Implementation work job not found.');
    if (row.intent_digest !== intentDigest) throw new Error('Implementation work intent changed; stale result rejected.');
    const outcomeDigest = digest({ outcome, detail });
    const prior = receiptByDigest.get(row.id, row.intent_digest, outcomeDigest);
    if (prior) return { replayed: true, job: publicJob(row), receiptId: prior.id };

    const stamp = new Date(Number(clock())).toISOString();
    insertReceipt.run(
      randomUUID(), row.id, row.run_id, row.tenant, row.requirement_key,
      row.intent_digest, text(outcome, 80) || 'EFFECT_RECORDED', outcomeDigest, JSON.stringify(detail || {}), stamp
    );
    updateState.run('AWAITING_EVIDENCE', 0, 0, null, null, stamp, row.id);
    return { replayed: false, job: publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key)) };
  }

  function block({ jobId, runId, tenant, intentDigest, reason }) {
    const rows = jobsForRun.all(text(runId, 100), text(tenant, 120));
    const row = rows.find(item => item.id === jobId);
    if (!row) throw new Error('Implementation work job not found.');
    if (row.intent_digest !== intentDigest) throw new Error('Implementation work intent changed; stale block rejected.');
    const stamp = new Date(Number(clock())).toISOString();
    updateState.run('BLOCKED_RESUMABLE', 0, 0, text(reason, 160) || 'AUTHORITY_OR_CONFIGURATION_REQUIRED', null, stamp, row.id);
    return publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key));
  }

  function fail({ jobId, runId, tenant, intentDigest, error, retryable = false }) {
    const rows = jobsForRun.all(text(runId, 100), text(tenant, 120));
    const row = rows.find(item => item.id === jobId);
    if (!row) throw new Error('Implementation work job not found.');
    if (row.intent_digest !== intentDigest) throw new Error('Implementation work intent changed; stale failure rejected.');
    const attempts = Number(row.attempts || 0);
    const stampMs = Number(clock());
    const stamp = new Date(stampMs).toISOString();
    let status = 'FAILED_CLOSED';
    let nextAttemptAt = 0;
    if (retryable && attempts < maxAttempts) {
      status = 'RETRY_WAIT';
      nextAttemptAt = stampMs + retryDelayMs;
    } else if (retryable && attempts >= maxAttempts) {
      status = 'EXHAUSTED';
    }
    updateState.run(status, 0, nextAttemptAt, null, text(error, 300) || null, stamp, row.id);
    return publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key));
  }

  return {
    reconcile,
    plan,
    claim,
    complete,
    block,
    fail,
    close() { if (ownsDb) try { db.close(); } catch {} }
  };
}

module.exports = { createImplementationWorkController, TERMINAL, ACTIVE, stable, digest };
