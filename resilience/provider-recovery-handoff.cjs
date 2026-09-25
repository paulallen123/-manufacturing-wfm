'use strict';

const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function deny(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function unb64(value) {
  return Buffer.from(value, 'base64url').toString();
}

function createProviderRecoveryHandoffStore(db, { key, now = Date.now, maxTtlMs = 120000 } = {}) {
  if (!db) throw new Error('Provider recovery handoff requires durable storage.');
  const secret = Buffer.from(String(key || ''));
  if (secret.length < 32) throw new Error('Provider recovery handoff key must be at least 32 bytes.');

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_recovery_handoffs(
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      provider_run_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_digest TEXT NOT NULL,
      evidence_digest TEXT NOT NULL,
      verification_digest TEXT NOT NULL,
      safety_decision_digest TEXT NOT NULL,
      action_grant_jti TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      continuation_json TEXT NOT NULL,
      continuation_digest TEXT NOT NULL,
      state_digest TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      UNIQUE(action_grant_jti)
    );
    CREATE INDEX IF NOT EXISTS provider_recovery_handoffs_scope
      ON provider_recovery_handoffs(tenant, provider_run_id, expires_at);
    CREATE TABLE IF NOT EXISTS provider_recovery_resume_outcomes(
      tenant TEXT NOT NULL,
      provider_run_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      continuation_digest TEXT NOT NULL,
      outcome_json TEXT NOT NULL,
      outcome_digest TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(tenant, provider_run_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS provider_recovery_handoff_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handoff_id TEXT NOT NULL,
      tenant TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS provider_recovery_handoff_events_no_update
      BEFORE UPDATE ON provider_recovery_handoff_events
      BEGIN SELECT RAISE(ABORT, 'Handoff events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS provider_recovery_handoff_events_no_delete
      BEFORE DELETE ON provider_recovery_handoff_events
      BEGIN SELECT RAISE(ABORT, 'Handoff events are append-only'); END;
  `);

  const stamp = () => Number(now());
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  const tokenFor = (claims) => {
    const payload = b64(canonical(claims));
    return `${payload}.${sign(payload)}`;
  };

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) deny('WFM_PROVIDER_HANDOFF_TOKEN', 'Invalid provider recovery handoff token.');
    const [payload, signature] = parts;
    const expected = sign(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      deny('WFM_PROVIDER_HANDOFF_SIGNATURE', 'Provider recovery handoff signature is invalid.');
    }
    try {
      return JSON.parse(unb64(payload));
    } catch {
      deny('WFM_PROVIDER_HANDOFF_TOKEN', 'Provider recovery handoff payload is invalid.');
    }
  }

  function row(id) {
    const found = db.prepare('SELECT * FROM provider_recovery_handoffs WHERE id=?').get(id);
    if (!found) deny('WFM_PROVIDER_HANDOFF_NOT_FOUND', 'Provider recovery handoff not found.', 404);
    return found;
  }

  function event(record, type, detail = {}) {
    db.prepare('INSERT INTO provider_recovery_handoff_events(handoff_id,tenant,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
      .run(record.id, record.tenant, type, JSON.stringify(detail), stamp());
  }

  function issueInternal(input) {
    const x = input && typeof input === 'object' ? input : {};
    const tenant = clean(x.tenant, 100);
    const providerRunId = clean(x.providerRunId, 120);
    const workerId = clean(x.workerId, 120);
    const actionType = clean(x.actionType, 100);
    const actorType = clean(x.actorType, 60);
    const actionGrantJti = clean(x.actionGrantJti, 120);
    const idempotencyKey = clean(x.idempotencyKey, 160);

    if (actorType !== 'deterministic-recovery-executor') {
      deny('WFM_PROVIDER_HANDOFF_ACTOR', 'Only the deterministic recovery executor can create a provider handoff.', 403);
    }
    if (!tenant || !providerRunId || !workerId) deny('WFM_PROVIDER_HANDOFF_SCOPE', 'Provider handoff scope is incomplete.');
    if (!['integration.retry', 'integration.replay-idempotent'].includes(actionType)) {
      deny('WFM_PROVIDER_HANDOFF_ACTION', 'Provider handoff action is outside the recovery allowlist.', 403);
    }
    if (!actionGrantJti || !idempotencyKey) deny('WFM_PROVIDER_HANDOFF_GRANT', 'Consumed action grant and idempotency key are required.');

    const safety = x.safetyDecision || {};
    if (safety.allowed !== true || safety.type !== actionType || safety.tenant !== tenant || safety.targetTenant !== tenant || !validDigest(safety.decisionDigest)) {
      deny('WFM_PROVIDER_HANDOFF_SAFETY', 'Matching deterministic same-tenant safety authority is required.', 403);
    }
    for (const [name, value] of Object.entries({
      targetDigest: x.targetDigest,
      evidenceDigest: x.evidenceDigest,
      verificationDigest: x.verificationDigest,
      stateDigest: x.stateDigest,
    })) {
      if (!validDigest(value)) deny('WFM_PROVIDER_HANDOFF_EVIDENCE', `Provider handoff ${name} is invalid.`);
    }
    if (!x.nextRequest || typeof x.nextRequest !== 'object' || Array.isArray(x.nextRequest)) {
      deny('WFM_PROVIDER_HANDOFF_CONTINUATION', 'Internal continuation request is required.');
    }

    const continuationJson = canonical(x.nextRequest);
    const continuationDigest = digest(x.nextRequest);
    const createdAt = stamp();
    const ttlMs = Math.max(1000, Math.min(maxTtlMs, Number(x.ttlMs || 60000)));
    const expiresAt = createdAt + ttlMs;
    const id = randomUUID();

    try {
      db.prepare(`INSERT INTO provider_recovery_handoffs(
        id,tenant,provider_run_id,worker_id,action_type,target_digest,evidence_digest,verification_digest,
        safety_decision_digest,action_grant_jti,idempotency_key,continuation_json,continuation_digest,state_digest,
        created_at,expires_at,consumed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
        id, tenant, providerRunId, workerId, actionType, x.targetDigest, x.evidenceDigest, x.verificationDigest,
        safety.decisionDigest, actionGrantJti, idempotencyKey, continuationJson, continuationDigest, x.stateDigest,
        createdAt, expiresAt,
      );
    } catch (error) {
      if (/UNIQUE constraint failed/.test(String(error && error.message))) {
        deny('WFM_PROVIDER_HANDOFF_GRANT_REPLAY', 'Recovery action grant was already used.');
      }
      throw error;
    }

    const record = row(id);
    event(record, 'handoff-issued', {
      providerRunId,
      workerId,
      actionType,
      targetDigest: x.targetDigest,
      evidenceDigest: x.evidenceDigest,
      verificationDigest: x.verificationDigest,
      safetyDecisionDigest: safety.decisionDigest,
      actionGrantJti,
      idempotencyKeyDigest: digest(idempotencyKey),
      continuationDigest,
      stateDigest: x.stateDigest,
      expiresAt,
    });

    const claims = {
      v: 1,
      jti: id,
      tenant,
      providerRunId,
      workerId,
      actionType,
      targetDigest: x.targetDigest,
      evidenceDigest: x.evidenceDigest,
      verificationDigest: x.verificationDigest,
      safetyDecisionDigest: safety.decisionDigest,
      actionGrantJti,
      idempotencyKeyDigest: digest(idempotencyKey),
      continuationDigest,
      stateDigest: x.stateDigest,
      exp: expiresAt,
    };

    return {
      internalToken: tokenFor(claims),
      publicReceipt: {
        handoffId: id,
        providerRunId,
        action: actionType,
        status: 'ready',
        expiresAt,
        continuationDigest,
      },
    };
  }

  function consumeInternal({ token, tenant, providerRunId, workerId, currentStateDigest }) {
    const claims = verifyToken(token);
    const nowMs = stamp();
    if (claims.tenant !== tenant || claims.providerRunId !== providerRunId || claims.workerId !== workerId) {
      deny('WFM_PROVIDER_HANDOFF_SCOPE', 'Provider recovery handoff scope changed.', 403);
    }
    if (!validDigest(currentStateDigest) || claims.stateDigest !== currentStateDigest) {
      deny('WFM_PROVIDER_HANDOFF_STALE', 'Provider run state changed after handoff issuance.');
    }
    if (nowMs > Number(claims.exp)) deny('WFM_PROVIDER_HANDOFF_EXPIRED', 'Provider recovery handoff expired.');

    const record = row(claims.jti);
    if (record.tenant !== tenant || record.provider_run_id !== providerRunId || record.worker_id !== workerId) {
      deny('WFM_PROVIDER_HANDOFF_SCOPE', 'Stored provider handoff scope changed.', 403);
    }
    if (record.consumed_at) deny('WFM_PROVIDER_HANDOFF_REPLAY', 'Provider recovery handoff was already consumed.');
    if (nowMs > record.expires_at) deny('WFM_PROVIDER_HANDOFF_EXPIRED', 'Provider recovery handoff expired.');

    const bindings = {
      action_type: 'actionType',
      target_digest: 'targetDigest',
      evidence_digest: 'evidenceDigest',
      verification_digest: 'verificationDigest',
      safety_decision_digest: 'safetyDecisionDigest',
      action_grant_jti: 'actionGrantJti',
      continuation_digest: 'continuationDigest',
      state_digest: 'stateDigest',
    };
    for (const [column, claim] of Object.entries(bindings)) {
      if (record[column] !== claims[claim]) deny('WFM_PROVIDER_HANDOFF_TAMPER', 'Provider recovery handoff binding changed.');
    }
    if (digest(record.idempotency_key) !== claims.idempotencyKeyDigest) {
      deny('WFM_PROVIDER_HANDOFF_TAMPER', 'Provider recovery handoff idempotency binding changed.');
    }

    const nextRequest = JSON.parse(record.continuation_json);
    if (digest(nextRequest) !== record.continuation_digest) {
      deny('WFM_PROVIDER_HANDOFF_TAMPER', 'Provider recovery continuation integrity failed.');
    }

    const update = db.prepare('UPDATE provider_recovery_handoffs SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(nowMs, record.id);
    if (Number(update.changes) !== 1) deny('WFM_PROVIDER_HANDOFF_REPLAY', 'Provider recovery handoff was concurrently consumed.');
    event(record, 'handoff-consumed', {
      workerId,
      providerRunId,
      stateDigest: currentStateDigest,
      continuationDigest: record.continuation_digest,
      idempotencyKeyDigest: digest(record.idempotency_key),
    });

    return {
      handoffId: record.id,
      providerRunId,
      workerId,
      action: record.action_type,
      nextRequest,
      continuationDigest: record.continuation_digest,
      idempotencyKey: record.idempotency_key,
    };
  }

  function publicStatus({ tenant, handoffId }) {
    const record = row(handoffId);
    if (record.tenant !== tenant) deny('WFM_PROVIDER_HANDOFF_NOT_FOUND', 'Provider recovery handoff not found.', 404);
    return {
      handoffId: record.id,
      providerRunId: record.provider_run_id,
      action: record.action_type,
      status: record.consumed_at ? 'consumed' : stamp() > record.expires_at ? 'expired' : 'ready',
      expiresAt: record.expires_at,
      continuationDigest: record.continuation_digest,
    };
  }

  function getOutcome({ tenant, providerRunId, idempotencyKey }) {
    return db.prepare(`SELECT * FROM provider_recovery_resume_outcomes
      WHERE tenant=? AND provider_run_id=? AND idempotency_key=?`).get(tenant, providerRunId, idempotencyKey) || null;
  }

  function recordOutcome({ tenant, providerRunId, idempotencyKey, continuationDigest, outcome }) {
    const existing = getOutcome({ tenant, providerRunId, idempotencyKey });
    if (existing) {
      if (existing.continuation_digest !== continuationDigest) {
        deny('WFM_PROVIDER_RESUME_IDEMPOTENCY_DRIFT', 'Idempotency key was reused for a different continuation.');
      }
      return { duplicate: true, outcome: JSON.parse(existing.outcome_json), outcomeDigest: existing.outcome_digest };
    }
    const outcomeJson = canonical(outcome);
    const outcomeDigest = digest(outcome);
    db.prepare(`INSERT INTO provider_recovery_resume_outcomes(
      tenant,provider_run_id,idempotency_key,continuation_digest,outcome_json,outcome_digest,created_at
    ) VALUES(?,?,?,?,?,?,?)`).run(tenant, providerRunId, idempotencyKey, continuationDigest, outcomeJson, outcomeDigest, stamp());
    return { duplicate: false, outcome, outcomeDigest };
  }

  function events({ tenant, handoffId }) {
    const record = row(handoffId);
    if (record.tenant !== tenant) deny('WFM_PROVIDER_HANDOFF_NOT_FOUND', 'Provider recovery handoff not found.', 404);
    return db.prepare(`SELECT event_type,detail_json,created_at FROM provider_recovery_handoff_events
      WHERE handoff_id=? AND tenant=? ORDER BY id`).all(handoffId, tenant).map((entry) => ({
        type: entry.event_type,
        detail: JSON.parse(entry.detail_json),
        createdAt: entry.created_at,
      }));
  }

  return { issueInternal, consumeInternal, publicStatus, getOutcome, recordOutcome, events };
}

function createProviderResumeOrchestrator({ store, adapter }) {
  if (!store || typeof store.consumeInternal !== 'function' || typeof store.recordOutcome !== 'function') {
    throw new Error('Provider resume orchestrator requires the handoff store.');
  }
  if (!adapter || typeof adapter.resumeFromCheckpoint !== 'function') {
    throw new Error('Provider resume orchestrator requires a normal adapter checkpoint resume function.');
  }

  async function resume(input) {
    const consumed = store.consumeInternal(input);
    const existing = store.getOutcome({
      tenant: input.tenant,
      providerRunId: input.providerRunId,
      idempotencyKey: consumed.idempotencyKey,
    });
    if (existing) {
      if (existing.continuation_digest !== consumed.continuationDigest) {
        deny('WFM_PROVIDER_RESUME_IDEMPOTENCY_DRIFT', 'Idempotency key was reused for a different continuation.');
      }
      return { ...JSON.parse(existing.outcome_json), duplicateSuppressed: true };
    }

    const adapterResult = await adapter.resumeFromCheckpoint({
      tenant: input.tenant,
      providerRunId: input.providerRunId,
      workerId: input.workerId,
      action: consumed.action,
      nextRequest: consumed.nextRequest,
      continuationDigest: consumed.continuationDigest,
      idempotencyKey: consumed.idempotencyKey,
    });

    if (!adapterResult || adapterResult.acceptedContinuationDigest !== consumed.continuationDigest) {
      deny('WFM_PROVIDER_RESUME_CHECKPOINT_MISMATCH', 'Normal adapter did not attest the committed continuation checkpoint.');
    }
    const sourceCount = Number(adapterResult.sourceCount);
    const stagedCount = Number(adapterResult.stagedCount);
    const heldCount = Number(adapterResult.heldCount);
    if (![sourceCount, stagedCount, heldCount].every(Number.isSafeInteger) || [sourceCount, stagedCount, heldCount].some((n) => n < 0)) {
      deny('WFM_PROVIDER_RESUME_RECONCILIATION', 'Provider reconciliation counts are invalid.');
    }
    if (sourceCount !== stagedCount + heldCount) {
      deny('WFM_PROVIDER_RESUME_RECONCILIATION', 'Provider source count does not reconcile to staged plus held.');
    }

    const terminal = heldCount === 0 ? 'recovered' : 'review-required';
    const outcome = {
      providerRunId: input.providerRunId,
      action: consumed.action,
      status: terminal,
      continuationDigest: consumed.continuationDigest,
      sourceCount,
      stagedCount,
      heldCount,
      providerCompletionGreen: heldCount === 0,
      autonomousBusinessApply: false,
      productionAuthorityGranted: false,
    };

    const recorded = store.recordOutcome({
      tenant: input.tenant,
      providerRunId: input.providerRunId,
      idempotencyKey: consumed.idempotencyKey,
      continuationDigest: consumed.continuationDigest,
      outcome,
    });
    return { ...recorded.outcome, duplicateSuppressed: recorded.duplicate };
  }

  return { resume };
}

module.exports = {
  canonical,
  digest,
  createProviderRecoveryHandoffStore,
  createProviderResumeOrchestrator,
};
