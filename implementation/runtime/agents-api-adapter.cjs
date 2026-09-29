'use strict';

const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function createAgentsApiAdapter(options = {}) {
  const dbPath = text(options.dbPath, 2048);
  const apiKey = text(options.apiKey || process.env.OPENAI_API_KEY, 4096);
  const candidateSha = text(options.candidateSha || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.WFM_CANDIDATE_SHA, 64).toLowerCase();
  const deploymentId = text(options.deploymentId || process.env.RAILWAY_DEPLOYMENT_ID, 128);
  const model = text(options.model || process.env.WFM_AGENTS_MODEL || 'gpt-6-sol', 80);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!dbPath) throw new Error('Agents API adapter requires dbPath.');
  if (!apiKey) throw new Error('Agents API adapter requires OPENAI_API_KEY.');
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) throw new Error('Agents API adapter requires an exact candidate SHA.');
  if (!deploymentId) throw new Error('Agents API adapter requires an exact deployment ID.');
  if (typeof fetchImpl !== 'function') throw new Error('Agents API adapter requires fetch.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS vector_agents_sessions(' +
      'run_id TEXT NOT NULL,tenant TEXT NOT NULL,candidate_sha TEXT NOT NULL,deployment_id TEXT NOT NULL,' +
      'session_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,' +
      'PRIMARY KEY(run_id,tenant,candidate_sha,deployment_id),UNIQUE(session_id));'
  );

  const runById = db.prepare('SELECT id,tenant FROM implementation_runs WHERE id=?');
  const sessionByIdentity = db.prepare(
    'SELECT * FROM vector_agents_sessions WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=?'
  );
  const insertSession = db.prepare(
    'INSERT INTO vector_agents_sessions(run_id,tenant,candidate_sha,deployment_id,session_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const updateSessionStatus = db.prepare(
    'UPDATE vector_agents_sessions SET status=?,updated_at=? WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=?'
  );
  const supersedeOtherIdentities = db.prepare(
    "UPDATE vector_agents_sessions SET status='SUPERSEDED',updated_at=? WHERE run_id=? AND tenant=? AND NOT(candidate_sha=? AND deployment_id=?) AND status!='SUPERSEDED'"
  );
  const finalizeSession = db.prepare(
    'UPDATE vector_agents_sessions SET session_id=?,status=?,updated_at=? WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=? AND session_id=?'
  );

  function headers() {
    return {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'agents=v1'
    };
  }

  async function ensureSession({ runId, tenant, initialInput }) {
    runId = text(runId, 128);
    tenant = text(tenant, 128);
    const run = runById.get(runId);
    if (!run || run.tenant !== tenant) throw new Error('VECTOR_AGENTS_RUN_IDENTITY_MISMATCH');

    let existing = sessionByIdentity.get(runId, tenant, candidateSha, deploymentId);
    if (existing) {
      if (existing.status === 'CREATING') {
        const error = new Error('VECTOR_AGENTS_SESSION_CREATION_IN_PROGRESS');
        error.code = 'AGENTS_SESSION_CREATION_IN_PROGRESS';
        error.statusCode = 409;
        throw error;
      }
      if (existing.status === 'RECONCILIATION_REQUIRED') {
        const error = new Error('VECTOR_AGENTS_SESSION_RECONCILIATION_REQUIRED');
        error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
        error.statusCode = 409;
        throw error;
      }
      const response = await fetchImpl('https://api.openai.com/v1/agents/sessions/' + encodeURIComponent(existing.session_id), {
        method: 'GET',
        headers: headers()
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || text(payload.id, 256) !== existing.session_id) {
        const error = new Error('VECTOR_AGENTS_SESSION_RECONCILIATION_REQUIRED');
        error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
        error.statusCode = Number(response.status || 502);
        throw error;
      }
      const status = text(payload.status || existing.status || 'unknown', 80);
      updateSessionStatus.run(status, new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
      return { sessionId: existing.session_id, reused: true, status };
    }

    const stamp = new Date().toISOString();
    const reservationId = 'pending:' + randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      existing = sessionByIdentity.get(runId, tenant, candidateSha, deploymentId);
      if (!existing) {
        supersedeOtherIdentities.run(stamp, runId, tenant, candidateSha, deploymentId);
        insertSession.run(runId, tenant, candidateSha, deploymentId, reservationId, 'CREATING', stamp, stamp);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    if (existing) {
      if (existing.status === 'CREATING') {
        const error = new Error('VECTOR_AGENTS_SESSION_CREATION_IN_PROGRESS');
        error.code = 'AGENTS_SESSION_CREATION_IN_PROGRESS';
        error.statusCode = 409;
        throw error;
      }
      const error = new Error('VECTOR_AGENTS_SESSION_RECONCILIATION_REQUIRED');
      error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
      error.statusCode = 409;
      throw error;
    }

    const body = {
      agent: {
        model,
        instructions: [
          'You are the external VECTOR Customer Proof orchestration controller.',
          'Stay bound to the supplied candidate SHA, deployment, tenant and implementation run.',
          'Do not invent customer policy or payroll authority.',
          'Do not create alternate branches, deployments, tenants, proof runners or implementation runs.',
          'A completed agent turn is not customer proof; independent deterministic evidence decides release state.'
        ].join(' ')
      },
      environment: { type: 'none' },
      input: text(initialInput, 8000) || 'Read-only VECTOR customer-proof bootstrap.',
      metadata: {
        vector_sha: candidateSha,
        vector_deployment: deploymentId,
        vector_run: runId,
        vector_tenant: tenant
      },
      stream: false
    };
    let response;
    let payload = {};
    try {
      response = await fetchImpl('https://api.openai.com/v1/agents/sessions', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body)
      });
      payload = await response.json().catch(() => ({}));
    } catch (cause) {
      updateSessionStatus.run('RECONCILIATION_REQUIRED', new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
      const error = new Error('VECTOR_AGENTS_SESSION_CREATE_AMBIGUOUS');
      error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
      error.statusCode = 502;
      error.cause = cause;
      throw error;
    }
    if (!response.ok || !text(payload.id, 256)) {
      updateSessionStatus.run('RECONCILIATION_REQUIRED', new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
      const error = new Error('VECTOR_AGENTS_SESSION_CREATE_FAILED');
      error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
      error.statusCode = Number(response.status || 502);
      throw error;
    }
    const finalStamp = new Date().toISOString();
    const status = text(payload.status || 'created', 80);
    const result = finalizeSession.run(payload.id, status, finalStamp, runId, tenant, candidateSha, deploymentId, reservationId);
    if (Number(result.changes) !== 1) {
      const error = new Error('VECTOR_AGENTS_SESSION_RESERVATION_LOST');
      error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
      error.statusCode = 409;
      throw error;
    }
    return { sessionId: payload.id, reused: false, status };
  }

  return {
    ensureSession,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = { createAgentsApiAdapter };
