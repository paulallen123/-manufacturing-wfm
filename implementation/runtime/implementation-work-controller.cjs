'use strict';

const { createHash, randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TERMINAL = new Set(['SATISFIED', 'FAILED_CLOSED', 'EXHAUSTED']);
const ACTIVE = new Set(['PENDING', 'RUNNING', 'AWAITING_EVIDENCE', 'RETRY_WAIT', 'WAITING_DEPENDENCY', 'BLOCKED_RESUMABLE']);
const DEPENDENCY_INDEPENDENT_BLOCKERS = new Set([
  'CUSTOMER_POLICY_AUTHORITY_REQUIRED',
  'SOURCE_AUTHORIZATION_OR_VALIDATION_REQUIRED',
  'CUSTOMER_COMPETENCY_EVIDENCE_REQUIRED'
]);

const EXTERNAL_AUTHORITY_BLOCKERS = new Set([
  'CUSTOMER_SCOPE_REQUIRED',
  'IDENTITY_AUTHORITY_OR_CONFIGURATION_REQUIRED',
  'SOURCE_AUTHORIZATION_OR_VALIDATION_REQUIRED',
  'CUSTOMER_POLICY_AUTHORITY_REQUIRED',
  'PAYROLL_MAPPING_OR_AUTHORITY_REQUIRED',
  'CUSTOMER_COMPETENCY_EVIDENCE_REQUIRED'
]);

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
  const candidateSha = String(options.candidateSha || '').trim();
  const deploymentId = String(options.deploymentId || '').trim();
  if (options.requireCandidateBinding === true &&
      (!/^[0-9a-f]{40}$/.test(candidateSha) || !deploymentId)) {
    if (ownsDb) db.close();
    throw new Error('Implementation work candidate binding is required.');
  }
  const bindingDigest = digest({ candidateSha: candidateSha || null, deploymentId: deploymentId || null });

  function atomic(fn) {
    const savepoint = db.isTransaction ? 'work_' + randomUUID().replace(/-/g, '') : null;
    db.exec(savepoint ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec(savepoint ? 'RELEASE ' + savepoint : 'COMMIT');
      return result;
    } catch (error) {
      try { db.exec(savepoint ? 'ROLLBACK TO ' + savepoint + '; RELEASE ' + savepoint : 'ROLLBACK'); } catch {}
      throw error;
    }
  }

  function refused(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }

  function requireOwner(value) {
    // The caller must derive this from a trusted worker identity, not model text.
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,128}$/.test(value)) {
      throw refused('Implementation work claim requires an explicit owner.');
    }
    return value;
  }


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

  // Additive migration: old unowned claims never acquire new authority implicitly.
  atomic(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(implementation_work_jobs)').all().map(x => x.name));
    for (const [name, definition] of [
      ['claim_owner', 'TEXT'],
      ['claim_fence', 'INTEGER NOT NULL DEFAULT 0'],
      ['claim_token_hash', 'TEXT'],
      ['claim_binding', 'TEXT']
    ]) {
      if (!columns.has(name)) db.exec('ALTER TABLE implementation_work_jobs ADD COLUMN ' + name + ' ' + definition);
    }
  });

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
    'UPDATE implementation_work_jobs SET intent_digest=?,status=?,attempts=0,lease_until_ms=0,next_attempt_at_ms=0,blocked_reason=?,last_error=NULL,claim_owner=NULL,claim_token_hash=NULL,claim_binding=NULL,updated_at=? WHERE id=?'
  );
  const updateState = db.prepare(
    'UPDATE implementation_work_jobs SET status=?,lease_until_ms=?,next_attempt_at_ms=?,blocked_reason=?,last_error=?,updated_at=? WHERE id=?'
  );
  const claimJob = db.prepare(
    "UPDATE implementation_work_jobs SET status='RUNNING',attempts=attempts+1,lease_until_ms=?,updated_at=?,claim_owner=?,claim_fence=claim_fence+1,claim_token_hash=?,claim_binding=? WHERE id=? AND status='PENDING' AND claim_fence<9007199254740991"
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
      ownerId: row.claim_owner || null,
      fence: Number(row.claim_fence || 0),
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

    atomic(() => {
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
        if (existing.status === 'RUNNING' && existing.claim_binding && existing.claim_binding !== bindingDigest) {
          resetJob.run(intentDigest, desired, blockReason || null, stamp, existing.id);
          continue;
        }
        // Revoked/missing authority outranks lease expiry and retry scheduling.
        if (['BLOCKED_RESUMABLE', 'WAITING_DEPENDENCY'].includes(desired) &&
            ['PENDING', 'RUNNING', 'RETRY_WAIT', 'AWAITING_EVIDENCE'].includes(existing.status)) {
          resetJob.run(intentDigest, desired, blockReason || null, stamp, existing.id);
          continue;
        }
        if (existing.status === 'RUNNING' && Number(existing.lease_until_ms || 0) <= nowMs) {
          updateState.run(desired, 0, 0, blockReason || null, 'LEASE_EXPIRED', stamp, existing.id);
          continue;
        }
        if (existing.status === 'RETRY_WAIT' && Number(existing.next_attempt_at_ms || 0) <= nowMs) {
          updateState.run(desired, 0, 0, blockReason || null, existing.last_error || null, stamp, existing.id);
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
    });
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
      awaitingExternalAuthority: jobs.filter(job =>
        job.status === 'BLOCKED_RESUMABLE' && EXTERNAL_AUTHORITY_BLOCKERS.has(job.blockedReason)
      ).map(job => ({
        requirementKey: job.requirementKey,
        reason: job.blockedReason
      })),
      autonomousWorkRemaining: jobs.some(job =>
        ['PENDING','RUNNING','AWAITING_EVIDENCE','RETRY_WAIT','WAITING_DEPENDENCY'].includes(job.status)
      ),
      failedClosed: jobs.filter(job => job.status === 'FAILED_CLOSED').map(job => job.requirementKey)
    };
  }

  function claim({ runId, tenant, requirementKey = null, ownerId }) {
    ownerId = requireOwner(ownerId);
    runId = text(runId, 100);
    tenant = text(tenant, 120);
    return atomic(() => {
      const candidates = plan(runId, tenant).jobs.filter(job =>
        job.status === 'PENDING' && (!requirementKey || job.requirementKey === requirementKey));
      const nowMs = Number(clock());
      const stamp = new Date(nowMs).toISOString();
      for (const candidate of candidates) {
        const leaseToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(leaseToken).digest('hex');
        const result = claimJob.run(nowMs + leaseMs, stamp, ownerId, tokenHash, bindingDigest, candidate.id);
        if (Number(result.changes) === 1) {
          // Only the successful claimant receives the token; plan/status never do.
          return { ...publicJob(jobByRequirement.get(runId, tenant, candidate.requirementKey)), leaseToken };
        }
      }
      return null;
    });
  }

  function ownedRow({ jobId, runId, tenant, intentDigest, ownerId, fence, leaseToken }) {
    const row = jobsForRun.all(text(runId, 100), text(tenant, 120)).find(item => item.id === jobId);
    if (!row) throw refused('Implementation work job not found.');
    if (row.intent_digest !== intentDigest) throw refused('Implementation work intent changed; stale result rejected.');
    if (requireOwner(ownerId) !== row.claim_owner || !Number.isSafeInteger(fence) || fence < 1 || fence !== row.claim_fence) {
      throw refused('Implementation work owner or fence is stale.');
    }
    if (typeof leaseToken !== 'string' || !/^[0-9a-f]{64}$/.test(leaseToken) ||
        !/^[0-9a-f]{64}$/.test(row.claim_token_hash || '')) {
      throw refused('Implementation work lease token is required.');
    }
    const observed = createHash('sha256').update(leaseToken).digest();
    if (!timingSafeEqual(observed, Buffer.from(row.claim_token_hash, 'hex'))) {
      throw refused('Implementation work claim token is stale.');
    }
    if (row.claim_binding !== bindingDigest) throw refused('Implementation work claim binding is stale.');
    return row;
  }

  function requireLiveLease(row) {
    if (row.status !== 'RUNNING' || Number(row.lease_until_ms) <= Number(clock())) {
      throw refused('Implementation work requires the current RUNNING lease.');
    }
  }

  function complete(args) {
    return atomic(() => completeOwned(args, ownedRow(args)));
  }

  function completeOwned(args, row) {
      const outcome = text(args.outcome || 'EFFECT_RECORDED', 80);
      const detail = args.detail || {};
      // Receipt identity also binds the attempt; older attempts cannot replay it.
      const outcomeDigest = digest({ outcome, detail, ownerId: row.claim_owner,
        fence: row.claim_fence, tokenHash: row.claim_token_hash, binding: row.claim_binding });
      const prior = receiptByDigest.get(row.id, row.intent_digest, outcomeDigest);
      // A confirmed exact replay is read-only, even after the original lease expired.
      if (prior) return { replayed: true, job: publicJob(row), receiptId: prior.id };
      requireLiveLease(row);
      const stamp = new Date(Number(clock())).toISOString();
      const receiptId = randomUUID();
      insertReceipt.run(receiptId, row.id, row.run_id, row.tenant, row.requirement_key,
        row.intent_digest, outcome, outcomeDigest, JSON.stringify(detail), stamp);
      updateState.run('AWAITING_EVIDENCE', 0, 0, null, null, stamp, row.id);
      return { replayed: false, receiptId,
        job: publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key)) };
  }

  // Only synchronous writes to this controller's SQLite connection belong in
  // this boundary. Network/provider effects require their own durable fencing.
  function executeLocalEffect(args, effect) {
    return atomic(() => {
      const row = ownedRow(args);
      requireLiveLease(row);
      const detail = effect();
      if (detail && typeof detail.then === 'function') throw refused('Local effect must be synchronous.');
      const current = ownedRow(args);
      requireLiveLease(current);
      return completeOwned({ ...args, outcome: 'EFFECT_RECORDED', detail }, current);
    });
  }

  function block(args) {
    return atomic(() => {
      const row = ownedRow(args);
      requireLiveLease(row);
      const stamp = new Date(Number(clock())).toISOString();
      updateState.run('BLOCKED_RESUMABLE', 0, 0,
        text(args.reason, 160) || 'AUTHORITY_OR_CONFIGURATION_REQUIRED', null, stamp, row.id);
      return publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key));
    });
  }

  function fail(args) {
    return atomic(() => {
      const row = ownedRow(args);
      requireLiveLease(row);
      const attempts = Number(row.attempts || 0);
      const stampMs = Number(clock());
      const stamp = new Date(stampMs).toISOString();
      let status = 'FAILED_CLOSED';
      let nextAttemptAt = 0;
      if (args.retryable === true && attempts < maxAttempts) {
        status = 'RETRY_WAIT';
        nextAttemptAt = stampMs + retryDelayMs;
      } else if (args.retryable === true && attempts >= maxAttempts) {
        status = 'EXHAUSTED';
      }
      updateState.run(status, 0, nextAttemptAt, null, text(args.error, 300) || null, stamp, row.id);
      return publicJob(jobByRequirement.get(row.run_id, row.tenant, row.requirement_key));
    });
  }

  return {
    reconcile,
    plan,
    claim,
    complete,
    executeLocalEffect,
    block,
    fail,
    close() { if (ownsDb) try { db.close(); } catch {} }
  };
}

module.exports = { createImplementationWorkController, TERMINAL, ACTIVE, stable, digest };
