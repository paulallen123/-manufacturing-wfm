'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  createDecisionEpisode,
  selectDecisionOption,
  recordDecisionOutcome,
  digest
} = require('./decision-episode.cjs');
const {
  validateSimulationPassport,
  validateAssuranceEnvelope,
  assertExecutionAllowed
} = require('./frontier-decision-control.cjs');

const PREFIX = '/api/operations/autopilot';
const PERMIT_TTL_MS = 15 * 60 * 1000;
const ACTION_KIND_TO_TYPE = Object.freeze({
  OVERTIME_OVERRIDE: 'workforce.overtime_override',
  AGENCY_ASSIGNMENT: 'workforce.agency_assignment'
});

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function compact(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function iso(value) {
  const n = Date.parse(String(value ?? ''));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const p = part.trim();
    if (p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}

function pathOf(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req, max = 131072) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > max) {
      const e = new Error('Request body too large.');
      e.statusCode = 413;
      throw e;
    }
    chunks.push(b);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const e = new Error('Invalid JSON body.');
    e.statusCode = 400;
    throw e;
  }
}

function safePlan(input = {}) {
  if (compact(input.adapter, 80) !== 'workforce-lifecycle') {
    throw new Error('Unsupported Autopilot execution adapter.');
  }
  if (input.reversible !== true) {
    throw new Error('Autopilot execution requires a reversible action.');
  }
  if (input.frontierAssurance && typeof input.frontierAssurance === 'object') {
    throw new Error('Inline frontier assurance is not trusted. Register it server-side and provide only its digest.');
  }

  const action = input.action && typeof input.action === 'object' && !Array.isArray(input.action)
    ? input.action
    : null;
  if (!action) throw new Error('Autopilot action is required.');

  const kind = compact(action.kind, 40).toUpperCase();
  if (!ACTION_KIND_TO_TYPE[kind]) {
    throw new Error('Autopilot workforce execution is limited to approved overtime or agency assignment actions.');
  }
  if (!compact(action.employeeId, 120) || !iso(action.effectiveAt)) {
    throw new Error('Autopilot workforce action requires employeeId and effectiveAt.');
  }

  const rollback = input.rollback && typeof input.rollback === 'object' && !Array.isArray(input.rollback)
    ? input.rollback
    : null;
  if (!rollback || !compact(rollback.eventKey, 160) || !compact(rollback.reason, 300)) {
    throw new Error('Autopilot execution requires an explicit rollback plan.');
  }

  const frontierAssuranceDigest = compact(input.frontierAssuranceDigest, 128) || null;
  if (frontierAssuranceDigest && !/^[a-f0-9]{64}$/i.test(frontierAssuranceDigest)) {
    throw new Error('frontierAssuranceDigest must be a SHA-256 digest.');
  }

  return {
    adapter: 'workforce-lifecycle',
    reversible: true,
    action: {
      eventKey: compact(action.eventKey, 160) || 'autopilot-action',
      kind,
      employeeId: compact(action.employeeId, 120),
      effectiveAt: iso(action.effectiveAt),
      payload: action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
        ? JSON.parse(JSON.stringify(action.payload))
        : {}
    },
    rollback: {
      eventKey: compact(rollback.eventKey, 160),
      reason: compact(rollback.reason, 300)
    },
    expectedOutcome: input.expectedOutcome && typeof input.expectedOutcome === 'object' && !Array.isArray(input.expectedOutcome)
      ? JSON.parse(JSON.stringify(input.expectedOutcome))
      : null,
    frontierAssuranceDigest
  };
}

function promote(shadow) {
  return createDecisionEpisode({
    tenant: shadow.tenant,
    site: shadow.site,
    decisionType: shadow.decisionType,
    triggerId: shadow.triggerId,
    triggeredAt: shadow.triggeredAt,
    contextRevision: shadow.contextRevision,
    mode: 'HUMAN_APPROVAL',
    sourceEvidence: shadow.sourceEvidence,
    objective: {
      ...(shadow.objective?.weights || {}),
      uncertaintyPenalty: shadow.objective?.uncertaintyPenalty
    },
    options: shadow.options
  });
}

function createAutopilotExecutionEngine(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const lifecycle = options.lifecycleAdapter;
  const verifierAdapter = options.verifierAdapter || null;
  const executorId = compact(options.executorId, 120) || 'workforce-lifecycle-executor';
  const verifierId = compact(options.verifierId, 120) || 'workforce-lifecycle-verifier';
  const publish = typeof options.publishEvent === 'function' ? options.publishEvent : null;
  if (!dbPath) throw new Error('Autopilot execution engine requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;" +
    "CREATE TABLE IF NOT EXISTS vector_simulation_passports(" +
      "tenant TEXT NOT NULL,shadow_episode_id TEXT NOT NULL,passport_digest TEXT NOT NULL,passport_json TEXT NOT NULL,registered_by TEXT NOT NULL,created_at TEXT NOT NULL," +
      "PRIMARY KEY(tenant,passport_digest));" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_simulation_passport_update BEFORE UPDATE ON vector_simulation_passports " +
      "BEGIN SELECT RAISE(ABORT,'Simulation Passports are append only.'); END;" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_simulation_passport_delete BEFORE DELETE ON vector_simulation_passports " +
      "BEGIN SELECT RAISE(ABORT,'Simulation Passports are append only.'); END;" +
    "CREATE TABLE IF NOT EXISTS vector_frontier_assurances(" +
      "tenant TEXT NOT NULL,shadow_episode_id TEXT NOT NULL,assurance_digest TEXT NOT NULL,envelope_json TEXT NOT NULL,registered_by TEXT NOT NULL,created_at TEXT NOT NULL," +
      "PRIMARY KEY(tenant,assurance_digest));" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_frontier_assurance_update BEFORE UPDATE ON vector_frontier_assurances " +
      "BEGIN SELECT RAISE(ABORT,'Frontier assurances are append only.'); END;" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_frontier_assurance_delete BEFORE DELETE ON vector_frontier_assurances " +
      "BEGIN SELECT RAISE(ABORT,'Frontier assurances are append only.'); END;" +
    "CREATE TABLE IF NOT EXISTS vector_autopilot_permits(" +
      "permit_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,episode_id TEXT NOT NULL,selected_episode_json TEXT NOT NULL,plan_json TEXT NOT NULL,actor_ref TEXT NOT NULL,issued_at TEXT NOT NULL,expires_at TEXT NOT NULL);" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_permit_update BEFORE UPDATE ON vector_autopilot_permits " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot permits are append only.'); END;" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_permit_delete BEFORE DELETE ON vector_autopilot_permits " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot permits are append only.'); END;" +
    "CREATE TABLE IF NOT EXISTS vector_autopilot_execution_events(" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT,execution_id TEXT NOT NULL,permit_id TEXT NOT NULL,tenant TEXT NOT NULL,state TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS vector_autopilot_execution_idx ON vector_autopilot_execution_events(execution_id,id);" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_execution_update BEFORE UPDATE ON vector_autopilot_execution_events " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot execution evidence is append only.'); END;" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_execution_delete BEFORE DELETE ON vector_autopilot_execution_events " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot execution evidence is append only.'); END;" +
    "CREATE TABLE IF NOT EXISTS vector_autopilot_outcomes(" +
      "tenant TEXT NOT NULL,execution_id TEXT NOT NULL,root_episode_id TEXT NOT NULL,selected_episode_id TEXT NOT NULL,outcome_digest TEXT NOT NULL,episode_json TEXT NOT NULL,recorded_by TEXT NOT NULL,created_at TEXT NOT NULL," +
      "PRIMARY KEY(tenant,execution_id));" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_outcome_update BEFORE UPDATE ON vector_autopilot_outcomes " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot outcomes are append only.'); END;" +
    "CREATE TRIGGER IF NOT EXISTS no_vector_autopilot_outcome_delete BEFORE DELETE ON vector_autopilot_outcomes " +
      "BEGIN SELECT RAISE(ABORT,'Autopilot outcomes are append only.'); END;"
  );

  const auth = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const ep = db.prepare(
    'SELECT episode_json FROM vector_decision_episodes WHERE tenant=? AND episode_id=?'
  );
  const passportQ = db.prepare(
    'SELECT * FROM vector_simulation_passports WHERE tenant=? AND passport_digest=?'
  );
  const passportI = db.prepare(
    'INSERT INTO vector_simulation_passports(tenant,shadow_episode_id,passport_digest,passport_json,registered_by,created_at) VALUES(?,?,?,?,?,?)'
  );
  const assuranceQ = db.prepare(
    'SELECT * FROM vector_frontier_assurances WHERE tenant=? AND assurance_digest=?'
  );
  const assuranceI = db.prepare(
    'INSERT INTO vector_frontier_assurances(tenant,shadow_episode_id,assurance_digest,envelope_json,registered_by,created_at) VALUES(?,?,?,?,?,?)'
  );
  const permitQ = db.prepare(
    'SELECT * FROM vector_autopilot_permits WHERE tenant=? AND permit_id=?'
  );
  const permitI = db.prepare(
    'INSERT INTO vector_autopilot_permits VALUES(?,?,?,?,?,?,?,?)'
  );
  const eventI = db.prepare(
    'INSERT INTO vector_autopilot_execution_events(execution_id,permit_id,tenant,state,detail_json,created_at) VALUES(?,?,?,?,?,?)'
  );
  const executionQ = db.prepare(
    'SELECT state,detail_json,created_at FROM vector_autopilot_execution_events WHERE execution_id=? ORDER BY id'
  );
  const tenantQ = db.prepare(
    'SELECT execution_id,permit_id,state,detail_json,created_at FROM vector_autopilot_execution_events WHERE tenant=? ORDER BY id DESC LIMIT ?'
  );
  const executionEvidenceQ = db.prepare(
    'SELECT permit_id,state,detail_json,created_at FROM vector_autopilot_execution_events WHERE tenant=? AND execution_id=? ORDER BY id'
  );
  const outcomeQ = db.prepare(
    'SELECT * FROM vector_autopilot_outcomes WHERE tenant=? AND execution_id=?'
  );
  const outcomeI = db.prepare(
    'INSERT INTO vector_autopilot_outcomes(tenant,execution_id,root_episode_id,selected_episode_id,outcome_digest,episode_json,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );

  function ctx(req) {
    const token = cookieToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }

  function manager(req, res) {
    const c = ctx(req);
    if (!c) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    if (String(c.role).toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Autopilot execution requires an authorised manager or administrator.' });
      return null;
    }
    return c;
  }

  function shadowEpisode(tenant, episodeId) {
    const row = ep.get(tenant, episodeId);
    if (!row) throw Object.assign(new Error('Decision episode not found.'), { statusCode: 404 });
    const shadow = JSON.parse(row.episode_json);
    if (shadow.mode !== 'SHADOW') {
      throw Object.assign(new Error('Frontier evidence must bind to a Shadow decision episode.'), { statusCode: 409 });
    }
    return shadow;
  }

  function registerSimulationPassport({ tenant, episodeId, passport, actorRef = 'system:simulation' }) {
    const shadow = shadowEpisode(tenant, episodeId);
    validateSimulationPassport(passport);
    if (passport.sourceEpisodeId !== episodeId || passport.contextRevision !== shadow.contextRevision) {
      throw Object.assign(new Error('Simulation Passport is not bound to the current Shadow decision context.'), { statusCode: 409 });
    }
    const existing = passportQ.get(tenant, passport.passportDigest);
    if (existing) {
      if (existing.shadow_episode_id !== episodeId || existing.passport_json !== JSON.stringify(passport)) {
        throw Object.assign(new Error('Simulation Passport digest collision or binding mismatch.'), { statusCode: 409 });
      }
      return { passportDigest: passport.passportDigest, idempotent: true };
    }
    passportI.run(
      tenant,
      episodeId,
      passport.passportDigest,
      JSON.stringify(passport),
      compact(actorRef, 180) || 'system:simulation',
      new Date().toISOString()
    );
    return { passportDigest: passport.passportDigest, idempotent: false };
  }

  function registerFrontierAssurance({ tenant, episodeId, envelope, actorRef = 'system:assurance' }) {
    const shadow = shadowEpisode(tenant, episodeId);
    validateAssuranceEnvelope(envelope);
    if (envelope.sourceEpisodeId !== episodeId || envelope.contextRevision !== shadow.contextRevision) {
      throw Object.assign(new Error('Decision Assurance is not bound to the current Shadow decision context.'), { statusCode: 409 });
    }
    if (!Object.values(ACTION_KIND_TO_TYPE).includes(envelope.actionContract.actionType)) {
      throw Object.assign(new Error('Decision Assurance action type is unsupported by this execution engine.'), { statusCode: 409 });
    }
    if (envelope.verifier.executorId !== executorId || envelope.verifier.verifierId !== verifierId) {
      throw Object.assign(new Error('Decision Assurance executor/verifier identities do not match this engine.'), { statusCode: 409 });
    }
    if (!verifierAdapter || verifierAdapter === lifecycle || typeof verifierAdapter.getTrustedEvent !== 'function') {
      throw Object.assign(new Error('Frontier execution requires a distinct independent read-back verifier adapter.'), { statusCode: 503 });
    }

    const passportRow = passportQ.get(tenant, envelope.simulationPassportDigest);
    if (!passportRow || passportRow.shadow_episode_id !== episodeId) {
      throw Object.assign(new Error('Registered Simulation Passport is required before Decision Assurance.'), { statusCode: 409 });
    }
    const passport = JSON.parse(passportRow.passport_json);
    validateSimulationPassport(passport);
    if (
      digest(passport.validity) !== digest(envelope.simulationValidity) ||
      digest(passport.inputEvidenceRefs) !== digest(envelope.inputEvidenceRefs)
    ) {
      throw Object.assign(new Error('Decision Assurance does not match its registered Simulation Passport evidence.'), { statusCode: 409 });
    }

    const existing = assuranceQ.get(tenant, envelope.assuranceDigest);
    if (existing) {
      if (existing.shadow_episode_id !== episodeId || existing.envelope_json !== JSON.stringify(envelope)) {
        throw Object.assign(new Error('Decision Assurance digest collision or binding mismatch.'), { statusCode: 409 });
      }
      return { assuranceDigest: envelope.assuranceDigest, idempotent: true };
    }
    assuranceI.run(
      tenant,
      episodeId,
      envelope.assuranceDigest,
      JSON.stringify(envelope),
      compact(actorRef, 180) || 'system:assurance',
      new Date().toISOString()
    );
    return { assuranceDigest: envelope.assuranceDigest, idempotent: false };
  }

  function log(executionId, permitId, tenant, state, detail = {}) {
    eventI.run(executionId, permitId, tenant, state, JSON.stringify(detail), new Date().toISOString());
    try {
      publish?.({
        tenant,
        topic: 'autopilot.execution.updated',
        audience: 'manager',
        payload: { executionId, state }
      });
    } catch {}
  }

  function last(executionId) {
    const row = executionQ.all(executionId).at(-1);
    return row
      ? { state: row.state, detail: JSON.parse(row.detail_json), createdAt: row.created_at }
      : null;
  }

  function trustedAssurance(tenant, assuranceDigest) {
    if (!assuranceDigest) return null;
    const row = assuranceQ.get(tenant, assuranceDigest);
    if (!row) {
      throw Object.assign(new Error('Registered Decision Assurance was not found.'), { statusCode: 409 });
    }
    const envelope = JSON.parse(row.envelope_json);
    validateAssuranceEnvelope(envelope);
    if (envelope.assuranceDigest !== assuranceDigest) {
      throw Object.assign(new Error('Decision Assurance registry integrity check failed.'), { statusCode: 409 });
    }
    return { row, envelope };
  }

  function issueHumanPermit({ tenant, episodeId, optionId, actorRef, contextRevision, plan, now = Date.now() }) {
    const shadow = shadowEpisode(tenant, episodeId);
    if (compact(contextRevision, 180) !== shadow.contextRevision) {
      throw Object.assign(new Error('Decision context changed. Re-simulate before approval.'), { statusCode: 409 });
    }

    const selected = selectDecisionOption(
      promote(shadow),
      {
        optionId,
        selectedAt: new Date(now).toISOString(),
        actorRef,
        authorityDecision: 'HUMAN_APPROVED'
      }
    );
    const safe = safePlan(plan);

    let assurance = null;
    if (safe.frontierAssuranceDigest) {
      const trusted = trustedAssurance(tenant, safe.frontierAssuranceDigest);
      assurance = trusted.envelope;
      if (trusted.row.shadow_episode_id !== episodeId) {
        throw Object.assign(new Error('Decision Assurance is registered to a different Shadow episode.'), { statusCode: 409 });
      }
      assertExecutionAllowed(assurance, {
        requestedMode: 'HUMAN_APPROVAL',
        at: new Date(now).toISOString(),
        expectedEpisodeId: episodeId,
        expectedContextRevision: selected.contextRevision,
        expectedActionType: ACTION_KIND_TO_TYPE[safe.action.kind]
      });
    }

    const issuedAt = new Date(now).toISOString();
    const authorityExpiry = assurance ? Date.parse(assurance.authority.expiresAt) : Infinity;
    const expiresAtMs = Math.min(now + PERMIT_TTL_MS, authorityExpiry);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      throw Object.assign(new Error('Autopilot authority is not valid for a permit window.'), { statusCode: 409 });
    }
    const expiresAt = new Date(expiresAtMs).toISOString();

    const payload = {
      tenant,
      episodeId: selected.episodeId,
      shadowEpisodeId: episodeId,
      optionId: selected.selection.optionId,
      contextRevision: selected.contextRevision,
      actorRef: compact(actorRef, 180),
      issuedAt,
      expiresAt,
      assuranceDigest: safe.frontierAssuranceDigest,
      plan: safe
    };
    const permitId = 'ap-' + digest(payload).slice(0, 40);
    if (!permitQ.get(tenant, permitId)) {
      permitI.run(
        permitId,
        tenant,
        selected.episodeId,
        JSON.stringify(selected),
        JSON.stringify(safe),
        payload.actorRef,
        issuedAt,
        expiresAt
      );
    }
    return { permitId, ...payload };
  }

  async function executePermit({ tenant, permitId, currentContextRevision, now = Date.now() }) {
    const permit = permitQ.get(tenant, permitId);
    if (!permit) throw Object.assign(new Error('Autopilot permit not found.'), { statusCode: 404 });
    if (Date.parse(permit.expires_at) <= now) {
      throw Object.assign(new Error('Autopilot permit expired. Re-approve current evidence.'), { statusCode: 409 });
    }

    const selected = JSON.parse(permit.selected_episode_json);
    if (compact(currentContextRevision, 180) !== selected.contextRevision) {
      throw Object.assign(new Error('Decision context changed. Execution refused.'), { statusCode: 409 });
    }

    const plan = JSON.parse(permit.plan_json);
    let assurance = null;
    let verificationAdapter = lifecycle;
    if (plan.frontierAssuranceDigest) {
      const trusted = trustedAssurance(tenant, plan.frontierAssuranceDigest);
      assurance = trusted.envelope;
      assertExecutionAllowed(assurance, {
        requestedMode: 'HUMAN_APPROVAL',
        at: new Date(now).toISOString(),
        expectedEpisodeId: trusted.row.shadow_episode_id,
        expectedContextRevision: selected.contextRevision,
        expectedActionType: ACTION_KIND_TO_TYPE[plan.action.kind]
      });
      if (!verifierAdapter || verifierAdapter === lifecycle || typeof verifierAdapter.getTrustedEvent !== 'function') {
        throw Object.assign(new Error('Independent verification adapter became unavailable. Execution refused.'), { statusCode: 503 });
      }
      verificationAdapter = verifierAdapter;
    }

    const executionId = 'exec-' + digest({
      permitId,
      tenant,
      contextRevision: selected.contextRevision
    }).slice(0, 40);

    const prior = last(executionId);
    if (prior && ['VERIFIED', 'ROLLED_BACK', 'CONTAINED'].includes(prior.state)) {
      return { executionId, idempotent: true, ...prior };
    }

    if (!lifecycle?.applyTrustedEvent) {
      throw Object.assign(new Error('Authoritative workforce execution adapter is unavailable.'), { statusCode: 503 });
    }

    log(executionId, permitId, tenant, 'PREPARED', {
      episodeId: selected.episodeId,
      optionId: selected.selection.optionId,
      planDigest: digest(plan),
      assuranceDigest: plan.frontierAssuranceDigest
    });

    let applied = null;
    try {
      const action = { ...plan.action, payload: { ...plan.action.payload } };
      if (action.kind === 'OVERTIME_OVERRIDE') {
        action.payload.approvalRef = permitId;
        action.payload.approvedBy = permit.actor_ref;
      }

      applied = lifecycle.applyTrustedEvent({
        tenant,
        eventKey: plan.action.eventKey,
        event: action
      });
      if (applied?.decision?.status !== 'ACCEPTED') {
        throw new Error('Authoritative lifecycle adapter rejected the action.');
      }

      log(executionId, permitId, tenant, 'APPLIED', {
        eventId: applied.event.id,
        reasonCode: applied.decision.reasonCode
      });

      const verified = verificationAdapter.getTrustedEvent({
        tenant,
        eventKey: plan.action.eventKey
      });
      if (!verified || verified.status !== 'ACCEPTED') {
        throw new Error('Post-action verification did not confirm authoritative state.');
      }

      let outcome = null;
      if (
        !assurance &&
        plan.expectedOutcome?.actual &&
        Array.isArray(plan.expectedOutcome.evidenceRefs) &&
        plan.expectedOutcome.evidenceRefs.length
      ) {
        outcome = recordDecisionOutcome(selected, {
          observedAt: new Date(now).toISOString(),
          evidenceRefs: plan.expectedOutcome.evidenceRefs,
          actual: plan.expectedOutcome.actual,
          notes: assurance
            ? 'Frontier Autopilot outcome supplied after independent authoritative verification.'
            : 'Autopilot post-action outcome supplied by authoritative verifier.'
        });
      }

      log(executionId, permitId, tenant, 'VERIFIED', {
        eventId: verified.id,
        verifierId: assurance ? verifierId : 'legacy-lifecycle-readback',
        assuranceDigest: plan.frontierAssuranceDigest,
        outcomeDigest: outcome?.outcomeDigest || null,
        outcomePending: Boolean(assurance && !outcome)
      });

      return {
        executionId,
        idempotent: false,
        state: 'VERIFIED',
        detail: {
          eventId: verified.id,
          assuranceDigest: plan.frontierAssuranceDigest,
          outcomeDigest: outcome?.outcomeDigest || null,
          outcomePending: Boolean(assurance && !outcome)
        }
      };
    } catch (error) {
      log(executionId, permitId, tenant, 'VERIFY_FAILED', {
        error: compact(error.message, 300),
        assuranceDigest: plan.frontierAssuranceDigest
      });

      if (!applied?.event?.id) {
        log(executionId, permitId, tenant, 'CONTAINED', {
          reason: 'NO_CONFIRMED_APPLY'
        });
        return {
          executionId,
          idempotent: false,
          state: 'CONTAINED',
          detail: { reason: 'NO_CONFIRMED_APPLY' }
        };
      }

      try {
        const rollback = lifecycle.applyTrustedEvent({
          tenant,
          eventKey: plan.rollback.eventKey,
          event: {
            kind: 'RETRO_CHANGE',
            employeeId: plan.action.employeeId,
            effectiveAt: new Date(now).toISOString(),
            payload: {
              targetEventId: applied.event.id,
              reason: plan.rollback.reason,
              approvalRef: permitId,
              correction: { autopilotRollback: true }
            }
          }
        });
        if (rollback?.decision?.status !== 'ACCEPTED') {
          throw new Error('Compensating rollback was rejected.');
        }

        const confirmed = verificationAdapter.getTrustedEvent({
          tenant,
          eventKey: plan.rollback.eventKey
        });
        if (!confirmed || confirmed.status !== 'ACCEPTED') {
          throw new Error('Rollback verification failed.');
        }

        log(executionId, permitId, tenant, 'ROLLED_BACK', {
          rollbackEventId: confirmed.id,
          assuranceDigest: plan.frontierAssuranceDigest
        });
        return {
          executionId,
          idempotent: false,
          state: 'ROLLED_BACK',
          detail: {
            rollbackEventId: confirmed.id,
            assuranceDigest: plan.frontierAssuranceDigest
          }
        };
      } catch (rollbackError) {
        log(executionId, permitId, tenant, 'CONTAINED', {
          reason: 'ROLLBACK_UNCONFIRMED',
          error: compact(rollbackError.message, 300),
          assuranceDigest: plan.frontierAssuranceDigest
        });
        return {
          executionId,
          idempotent: false,
          state: 'CONTAINED',
          detail: { reason: 'ROLLBACK_UNCONFIRMED' }
        };
      }
    }
  }

  function recordVerifiedOutcome({
    tenant,
    executionId,
    observedAt,
    evidenceRefs,
    actual,
    actorRef = 'system:outcome-measurement'
  }) {
    const id = compact(executionId, 180);
    if (!id) throw Object.assign(new Error('Execution id is required for outcome measurement.'), { statusCode: 400 });
    const rows = executionEvidenceQ.all(tenant, id);
    if (!rows.length) throw Object.assign(new Error('Autopilot execution not found.'), { statusCode: 404 });
    const terminal = rows.at(-1);
    if (terminal.state !== 'VERIFIED') {
      throw Object.assign(new Error('Business outcome cannot be recorded until execution is independently VERIFIED.'), { statusCode: 409 });
    }

    const observed = iso(observedAt);
    if (!observed) throw Object.assign(new Error('Valid observedAt is required.'), { statusCode: 400 });
    if (Date.parse(observed) < Date.parse(terminal.created_at)) {
      throw Object.assign(new Error('Outcome measurement cannot predate execution verification.'), { statusCode: 409 });
    }

    const refs = Array.isArray(evidenceRefs)
      ? [...new Set(evidenceRefs.map(v => compact(v, 220)).filter(Boolean))].slice(0, 50)
      : [];
    if (!refs.length) throw Object.assign(new Error('Outcome measurement requires evidence references.'), { statusCode: 400 });
    const measured = actual && typeof actual === 'object' && !Array.isArray(actual) ? actual : {};
    if (!Object.values(measured).some(v => v != null && Number.isFinite(Number(v)))) {
      throw Object.assign(new Error('Outcome measurement requires at least one numeric business metric.'), { statusCode: 400 });
    }

    const permit = permitQ.get(tenant, terminal.permit_id);
    if (!permit) throw Object.assign(new Error('Execution permit evidence is missing.'), { statusCode: 409 });
    const selected = JSON.parse(permit.selected_episode_json);
    const plan = JSON.parse(permit.plan_json);
    let rootEpisodeId = selected.episodeId;
    if (plan.frontierAssuranceDigest) {
      const trusted = trustedAssurance(tenant, plan.frontierAssuranceDigest);
      rootEpisodeId = trusted.row.shadow_episode_id;
    }

    const completed = recordDecisionOutcome(selected, {
      observedAt: observed,
      evidenceRefs: refs,
      actual: measured,
      notes: 'Business outcome recorded after independently verified execution.'
    });

    const existing = outcomeQ.get(tenant, id);
    if (existing) {
      if (existing.outcome_digest !== completed.outcomeDigest) {
        throw Object.assign(new Error('A conflicting business outcome is already recorded for this execution.'), { statusCode: 409 });
      }
      return Object.freeze({
        contractVersion: 'VECTOR_AUTOPILOT_OUTCOME_V1',
        tenant,
        executionId: id,
        rootEpisodeId: existing.root_episode_id,
        selectedEpisodeId: existing.selected_episode_id,
        outcomeDigest: existing.outcome_digest,
        episode: JSON.parse(existing.episode_json),
        idempotent: true
      });
    }

    outcomeI.run(
      tenant,
      id,
      rootEpisodeId,
      selected.episodeId,
      completed.outcomeDigest,
      JSON.stringify(completed),
      compact(actorRef, 180) || 'system:outcome-measurement',
      new Date().toISOString()
    );

    return Object.freeze({
      contractVersion: 'VECTOR_AUTOPILOT_OUTCOME_V1',
      tenant,
      executionId: id,
      rootEpisodeId,
      selectedEpisodeId: selected.episodeId,
      outcomeDigest: completed.outcomeDigest,
      episode: completed,
      idempotent: false
    });
  }

  function outcomeForExecution(tenant, executionId) {
    const row = outcomeQ.get(tenant, compact(executionId, 180));
    if (!row) return null;
    return Object.freeze({
      contractVersion: 'VECTOR_AUTOPILOT_OUTCOME_V1',
      tenant,
      executionId: row.execution_id,
      rootEpisodeId: row.root_episode_id,
      selectedEpisodeId: row.selected_episode_id,
      outcomeDigest: row.outcome_digest,
      episode: JSON.parse(row.episode_json),
      recordedBy: row.recorded_by,
      createdAt: row.created_at
    });
  }

  function statusForTenant(tenant, limit = 50) {
    return tenantQ
      .all(tenant, Math.max(1, Math.min(100, Number(limit) || 50)))
      .map(row => ({
        executionId: row.execution_id,
        permitId: row.permit_id,
        state: row.state,
        detail: JSON.parse(row.detail_json),
        createdAt: row.created_at
      }));
  }

  async function handleRequest(req, res) {
    const path = pathOf(req);
    if (!path.startsWith(PREFIX)) return false;
    try {
      const c = manager(req, res);
      if (!c) return true;

      if (req.method === 'GET' && path === PREFIX + '/status') {
        return writeJson(res, 200, {
          contractVersion: 'VECTOR_AUTOPILOT_EXECUTION_V2',
          tenant: c.tenant,
          events: statusForTenant(c.tenant)
        });
      }

      if (req.method === 'POST' && path === PREFIX + '/permit') {
        const body = await readJson(req);
        const permit = issueHumanPermit({
          tenant: c.tenant,
          episodeId: compact(body.episodeId, 180),
          optionId: compact(body.optionId, 120),
          actorRef: c.email,
          contextRevision: compact(body.contextRevision, 180),
          plan: body.plan
        });
        return writeJson(res, 201, {
          contractVersion: 'VECTOR_AUTOPILOT_PERMIT_V2',
          permit
        });
      }

      if (req.method === 'POST' && path === PREFIX + '/execute') {
        const body = await readJson(req);
        const result = await executePermit({
          tenant: c.tenant,
          permitId: compact(body.permitId, 180),
          currentContextRevision: compact(body.contextRevision, 180)
        });
        return writeJson(
          res,
          result.state === 'VERIFIED' ? 200 : 409,
          { contractVersion: 'VECTOR_AUTOPILOT_EXECUTION_V2', result }
        );
      }

      return writeJson(res, 404, { error: 'Autopilot execution endpoint not found.' });
    } catch (error) {
      return writeJson(
        res,
        Number(error?.statusCode || 500),
        { error: error?.statusCode ? error.message : 'Autopilot execution failed safely.' }
      );
    }
  }

  return {
    handleRequest,
    registerSimulationPassport,
    registerFrontierAssurance,
    issueHumanPermit,
    executePermit,
    recordVerifiedOutcome,
    outcomeForExecution,
    statusForTenant,
    close() {
      try { db.close(); } catch {}
    }
  };
}

module.exports = Object.freeze({
  ACTION_KIND_TO_TYPE,
  createAutopilotExecutionEngine,
  safePlan
});
