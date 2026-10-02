'use strict';

const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ACTIVE_READONLY_PROFILE = 'active-readonly-v1';
const ACTIVE_READONLY_TOOLS = Object.freeze([
  Object.freeze({
    type: 'function',
    name: 'get_vector_binding',
    description: 'Read the exact immutable VECTOR candidate, deployment, tenant and implementation-run binding. Read only.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false })
  }),
  Object.freeze({
    type: 'function',
    name: 'get_implementation_status',
    description: 'Read the current sanitized VECTOR implementation readiness, jobs and pending decisions. Read only.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false })
  }),
  Object.freeze({
    type: 'function',
    name: 'get_customer_proof_gaps',
    description: 'Read the currently unsatisfied customer-proof requirements and next safe work. Read only.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false })
  })
]);

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractAssistantReport(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index] || {};
    if (String(item.role || '').toLowerCase() !== 'assistant') continue;
    const parts = Array.isArray(item.content) ? item.content : [];
    const values = [];
    for (const part of parts) {
      if (typeof part?.text === 'string') values.push(part.text);
      else if (typeof part?.text?.value === 'string') values.push(part.text.value);
    }
    const report = values.join('\n').trim();
    if (report) return report;
  }
  return null;
}

function createAgentsApiAdapter(options = {}) {
  const dbPath = text(options.dbPath, 2048);
  const apiKey = text(options.apiKey || process.env.OPENAI_API_KEY, 4096);
  const candidateSha = text(options.candidateSha || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.WFM_CANDIDATE_SHA, 64).toLowerCase();
  const deploymentId = text(options.deploymentId || process.env.RAILWAY_DEPLOYMENT_ID, 128);
  const model = text(options.model || process.env.WFM_AGENTS_MODEL || 'gpt-6-sol', 80);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const pollIntervalMs = Math.max(0, Number(options.pollIntervalMs ?? 500));
  const maxPolls = Math.max(1, Math.min(240, Number(options.maxPolls ?? 120)));
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
      'PRIMARY KEY(run_id,tenant,candidate_sha,deployment_id),UNIQUE(session_id));' +
    'CREATE TABLE IF NOT EXISTS vector_agents_reports(' +
      'session_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,tenant TEXT NOT NULL,candidate_sha TEXT NOT NULL,' +
      'deployment_id TEXT NOT NULL,profile TEXT NOT NULL,report_text TEXT NOT NULL,created_at TEXT NOT NULL);'
  );
  const sessionColumns = new Set(db.prepare('PRAGMA table_info(vector_agents_sessions)').all().map(item => item.name));
  if (!sessionColumns.has('agent_profile')) {
    db.exec("ALTER TABLE vector_agents_sessions ADD COLUMN agent_profile TEXT NOT NULL DEFAULT 'bootstrap-readonly-v0'");
  }

  const runById = db.prepare('SELECT id,tenant FROM implementation_runs WHERE id=?');
  const sessionByIdentity = db.prepare(
    'SELECT * FROM vector_agents_sessions WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=?'
  );
  const insertSession = db.prepare(
    'INSERT INTO vector_agents_sessions(run_id,tenant,candidate_sha,deployment_id,session_id,status,created_at,updated_at,agent_profile) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  const updateSessionStatus = db.prepare(
    'UPDATE vector_agents_sessions SET status=?,updated_at=? WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=?'
  );
  const supersedeOtherIdentities = db.prepare(
    "UPDATE vector_agents_sessions SET status='SUPERSEDED',updated_at=? WHERE run_id=? AND tenant=? AND NOT(candidate_sha=? AND deployment_id=?) AND status!='SUPERSEDED'"
  );
  const finalizeSession = db.prepare(
    'UPDATE vector_agents_sessions SET session_id=?,status=?,updated_at=?,agent_profile=? WHERE run_id=? AND tenant=? AND candidate_sha=? AND deployment_id=? AND session_id=?'
  );
  const supersededSessions = db.prepare(
    "SELECT session_id FROM vector_agents_sessions WHERE run_id=? AND tenant=? AND status='SUPERSEDED' AND session_id NOT LIKE 'pending:%'"
  );
  const upsertReport = db.prepare(
    'INSERT INTO vector_agents_reports(session_id,run_id,tenant,candidate_sha,deployment_id,profile,report_text,created_at) VALUES(?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(session_id) DO UPDATE SET report_text=excluded.report_text,created_at=excluded.created_at,profile=excluded.profile'
  );

  function headers() {
    return {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'agents=v1'
    };
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const init = { method, headers: headers() };
    if (body !== null) init.body = JSON.stringify(body);
    const response = await fetchImpl('https://api.openai.com/v1/agents' + path, init);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  async function retireSupersededSessions(runId, tenant, currentSessionId) {
    for (const row of supersededSessions.all(runId, tenant)) {
      const sessionId = text(row.session_id, 256);
      if (!sessionId || sessionId === currentSessionId) continue;
      try {
        const { response } = await request('/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
          console.warn('VECTOR_AGENTS_SESSION_RETIRE=DEFERRED session=' + sessionId.slice(0, 32) + ' status=' + response.status);
        }
      } catch {
        console.warn('VECTOR_AGENTS_SESSION_RETIRE=DEFERRED session=' + sessionId.slice(0, 32) + ' status=network');
      }
    }
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
      const { response, payload } = await request('/sessions/' + encodeURIComponent(existing.session_id));
      if (!response.ok || text(payload.id, 256) !== existing.session_id) {
        const error = new Error('VECTOR_AGENTS_SESSION_RECONCILIATION_REQUIRED');
        error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
        error.statusCode = Number(response.status || 502);
        throw error;
      }
      const status = text(payload.status || existing.status || 'unknown', 80);
      updateSessionStatus.run(status, new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
      return {
        sessionId: existing.session_id,
        reused: true,
        status,
        profile: text(existing.agent_profile || payload?.metadata?.vector_profile || ACTIVE_READONLY_PROFILE, 80)
      };
    }

    const stamp = new Date().toISOString();
    const reservationId = 'pending:' + randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      existing = sessionByIdentity.get(runId, tenant, candidateSha, deploymentId);
      if (!existing) {
        supersedeOtherIdentities.run(stamp, runId, tenant, candidateSha, deploymentId);
        insertSession.run(
          runId, tenant, candidateSha, deploymentId, reservationId, 'CREATING', stamp, stamp, ACTIVE_READONLY_PROFILE
        );
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
          'You are the active read-only VECTOR Customer Proof orchestration controller.',
          'Before answering, use all available read-only VECTOR functions to inspect the current binding, implementation status and proof gaps.',
          'Stay bound to the supplied candidate SHA, deployment, tenant and implementation run.',
          'Never invent customer policy, payroll authority, implementation evidence or completion.',
          'Never request or perform writes, deployments, branch changes, tenant creation, proof admission or release-green actions.',
          'Return a concise operational report: identity alignment, current blockers, drift, next safe actions and what remains unproven.',
          'A completed agent turn is not customer proof; independent deterministic evidence decides release state.'
        ].join(' '),
        tools: ACTIVE_READONLY_TOOLS
      },
      environment: { type: 'none' },
      input: text(initialInput, 8000) || 'Inspect the current VECTOR customer-proof state using every read-only function, then report blockers and next safe actions.',
      metadata: {
        vector_sha: candidateSha,
        vector_deployment: deploymentId,
        vector_run: runId,
        vector_tenant: tenant,
        vector_profile: ACTIVE_READONLY_PROFILE,
        vector_write_enabled: 'false'
      },
      stream: false
    };
    let response;
    let payload = {};
    try {
      ({ response, payload } = await request('/sessions', { method: 'POST', body }));
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
    const result = finalizeSession.run(
      payload.id, status, finalStamp, ACTIVE_READONLY_PROFILE,
      runId, tenant, candidateSha, deploymentId, reservationId
    );
    if (Number(result.changes) !== 1) {
      const error = new Error('VECTOR_AGENTS_SESSION_RESERVATION_LOST');
      error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
      error.statusCode = 409;
      throw error;
    }
    await retireSupersededSessions(runId, tenant, payload.id);
    return { sessionId: payload.id, reused: false, status, profile: ACTIVE_READONLY_PROFILE };
  }

  async function analyzeSession({ sessionId, runId, tenant, toolHandler, startTurn = false, prompt = null }) {
    sessionId = text(sessionId, 256);
    runId = text(runId, 128);
    tenant = text(tenant, 128);
    const run = runById.get(runId);
    if (!sessionId || !run || run.tenant !== tenant) throw new Error('VECTOR_AGENTS_RUN_IDENTITY_MISMATCH');
    if (typeof toolHandler !== 'function') throw new Error('VECTOR_AGENTS_READONLY_TOOL_HANDLER_REQUIRED');

    const allowed = new Set(ACTIVE_READONLY_TOOLS.map(item => item.name));
    const calledTools = new Set();
    let toolCalls = 0;
    let started = !startTurn;

    for (let poll = 0; poll < maxPolls; poll++) {
      const { response, payload: session } = await request('/sessions/' + encodeURIComponent(sessionId));
      if (!response.ok || text(session.id, 256) !== sessionId) {
        const error = new Error('VECTOR_AGENTS_SESSION_READ_FAILED');
        error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
        error.statusCode = Number(response.status || 502);
        throw error;
      }

      const required = Array.isArray(session.required_actions) ? session.required_actions : [];
      if (required.length) {
        const events = [];
        for (const action of required) {
          if (action?.type !== 'function_call' || !allowed.has(action?.name)) {
            const error = new Error('VECTOR_AGENTS_UNSUPPORTED_REQUIRED_ACTION');
            error.code = 'AGENTS_UNSUPPORTED_REQUIRED_ACTION';
            error.statusCode = 409;
            throw error;
          }
          const args = action.arguments && typeof action.arguments === 'object' && !Array.isArray(action.arguments)
            ? action.arguments : {};
          if (Object.keys(args).length !== 0) {
            const error = new Error('VECTOR_AGENTS_READONLY_TOOL_ARGUMENTS_REFUSED');
            error.code = 'AGENTS_READONLY_TOOL_ARGUMENTS_REFUSED';
            error.statusCode = 409;
            throw error;
          }
          toolCalls += 1;
          calledTools.add(action.name);
          if (toolCalls > 12) {
            const error = new Error('VECTOR_AGENTS_READONLY_TOOL_BUDGET_EXCEEDED');
            error.code = 'AGENTS_READONLY_TOOL_BUDGET_EXCEEDED';
            error.statusCode = 409;
            throw error;
          }
          const output = await toolHandler(action.name, args);
          const serialized = JSON.stringify(output ?? null);
          if (serialized.length > 16 * 1024) {
            const error = new Error('VECTOR_AGENTS_READONLY_TOOL_OUTPUT_TOO_LARGE');
            error.code = 'AGENTS_READONLY_TOOL_OUTPUT_TOO_LARGE';
            error.statusCode = 409;
            throw error;
          }
          events.push({
            type: 'agent.session.input.tool_result',
            turn_id: text(action.turn_id, 256),
            call_id: text(action.call_id, 256),
            success: true,
            output: serialized
          });
        }
        const submitted = await request('/sessions/' + encodeURIComponent(sessionId) + '/events', {
          method: 'POST', body: { events }
        });
        if (!submitted.response.ok) {
          const error = new Error('VECTOR_AGENTS_TOOL_RESULT_SUBMIT_FAILED');
          error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
          error.statusCode = Number(submitted.response.status || 502);
          throw error;
        }
        continue;
      }

      const status = text(session.status, 80).toLowerCase();
      if (status === 'idle') {
        // Session idle also follows a failed turn. Read its durable outcome before
        // retrying, waiting, or accepting an older assistant report.
        const turns = await request('/sessions/' + encodeURIComponent(sessionId) + '/turns?order=desc&limit=1');
        if (!turns.response.ok || !Array.isArray(turns.payload?.data)) {
          const error = new Error('VECTOR_AGENTS_TURN_READBACK_FAILED');
          error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
          error.statusCode = turns.response.ok ? 502 : Number(turns.response.status || 502);
          throw error;
        }
        const latest = turns.payload.data[0];
        if (latest && ['failed', 'cancelled', 'canceled'].includes(String(latest.status).toLowerCase())) {
          const codes = { usage_limit_exceeded:429, insufficient_quota:429, rate_limit_exceeded:429, invalid_api_key:401, model_not_found:403 };
          const providerCode = String(latest.error?.code || '').toLowerCase();
          const known = Object.prototype.hasOwnProperty.call(codes, providerCode);
          const error = new Error('VECTOR_AGENTS_ANALYSIS_TURN_FAILED');
          error.code = known ? 'AGENTS_PROVIDER_' + providerCode.toUpperCase() : 'AGENTS_ANALYSIS_TURN_FAILED';
          error.statusCode = known ? codes[providerCode] : 502;
          updateSessionStatus.run('failed', new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
          throw error;
        }
      }

      if (!started && status === 'idle') {
        const message = text(prompt, 8000) ||
          'Re-inspect the current VECTOR customer-proof state using every read-only function. Report identity alignment, blockers, drift and next safe actions.';
        const submitted = await request('/sessions/' + encodeURIComponent(sessionId) + '/events', {
          method: 'POST',
          body: {
            events: [{
              type: 'agent.session.input.message',
              input: [{ role: 'user', content: [{ type: 'input_text', text: message }] }]
            }]
          }
        });
        if (!submitted.response.ok) {
          const error = new Error('VECTOR_AGENTS_ANALYSIS_START_FAILED');
          error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
          error.statusCode = Number(submitted.response.status || 502);
          throw error;
        }
        started = true;
        continue;
      }

      if (['failed', 'cancelled', 'canceled'].includes(status)) {
        const error = new Error('VECTOR_AGENTS_ANALYSIS_TURN_FAILED');
        error.code = 'AGENTS_ANALYSIS_TURN_FAILED';
        error.statusCode = 502;
        throw error;
      }

      if (status === 'idle') {
        // A message starts a turn asynchronously. A transient idle read immediately
        // after submission is not completion and must never be accepted as success.
        if (started && calledTools.size === 0) {
          await sleep(pollIntervalMs || 1);
          continue;
        }
        const items = await request('/sessions/' + encodeURIComponent(sessionId) + '/items?order=asc&limit=100');
        if (!items.response.ok) {
          const error = new Error('VECTOR_AGENTS_ANALYSIS_ITEMS_FAILED');
          error.code = 'AGENTS_SESSION_RECONCILIATION_REQUIRED';
          error.statusCode = Number(items.response.status || 502);
          throw error;
        }
        const report = extractAssistantReport(items.payload);
        if (!report) {
          await sleep(pollIntervalMs || 1);
          continue;
        }
        if ([...allowed].some(name => !calledTools.has(name))) {
          const error = new Error('VECTOR_AGENTS_READONLY_TOOL_REQUIREMENT_UNMET');
          error.code = 'AGENTS_READONLY_TOOL_REQUIREMENT_UNMET';
          error.statusCode = 409;
          throw error;
        }
        upsertReport.run(
          sessionId, runId, tenant, candidateSha, deploymentId, ACTIVE_READONLY_PROFILE,
          report.slice(0, 32 * 1024), new Date().toISOString()
        );
        updateSessionStatus.run('idle', new Date().toISOString(), runId, tenant, candidateSha, deploymentId);
        return {
          status: 'PASS',
          sessionId,
          profile: ACTIVE_READONLY_PROFILE,
          toolCalls,
          report,
          writeEnabled: false
        };
      }

      await sleep(pollIntervalMs);
    }

    const error = new Error('VECTOR_AGENTS_ANALYSIS_TIMEOUT');
    error.code = 'AGENTS_ANALYSIS_TIMEOUT';
    error.statusCode = 504;
    throw error;
  }

  return {
    ensureSession,
    analyzeSession,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = {
  createAgentsApiAdapter,
  ACTIVE_READONLY_PROFILE,
  ACTIVE_READONLY_TOOLS
};
