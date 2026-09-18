'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/implementation/autonomous';
const INTERNAL_HEADER = 'x-wfm-implementation-internal';

const REQUIREMENTS = Object.freeze([
  { key: 'tenant-environment', label: 'Tenant environment', minConfidence: 0.99, budgetMinutes: 15, dependsOn: [] },
  { key: 'identity-access', label: 'Identity and access', minConfidence: 0.99, budgetMinutes: 20, dependsOn: ['tenant-environment'] },
  { key: 'source-systems', label: 'Authoritative source systems', minConfidence: 0.95, budgetMinutes: 45, dependsOn: ['identity-access'] },
  { key: 'people-data', label: 'People data and hierarchy', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['source-systems'] },
  { key: 'organisation-model', label: 'Sites, departments and cost structure', minConfidence: 0.98, budgetMinutes: 30, dependsOn: ['people-data'] },
  { key: 'time-policies', label: 'Time, break and overtime policies', minConfidence: 0.995, budgetMinutes: 45, dependsOn: ['people-data'] },
  { key: 'absence-policies', label: 'Absence and leave policies', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['people-data'] },
  { key: 'scheduling', label: 'Shift patterns and scheduling rules', minConfidence: 0.99, budgetMinutes: 45, dependsOn: ['organisation-model', 'time-policies'] },
  { key: 'approvals', label: 'Approval and delegation rules', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['organisation-model', 'identity-access'] },
  { key: 'clocking', label: 'Clocking and device rules', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['identity-access', 'time-policies'] },
  { key: 'payroll-mapping', label: 'Payroll mappings', minConfidence: 0.995, budgetMinutes: 45, dependsOn: ['source-systems', 'people-data', 'time-policies'] },
  { key: 'historical-replay', label: 'Historical replay and reconciliation', minConfidence: 0.995, budgetMinutes: 60, dependsOn: ['payroll-mapping', 'time-policies'] },
  { key: 'security-controls', label: 'Security and tenant isolation', minConfidence: 1.0, budgetMinutes: 30, dependsOn: ['tenant-environment', 'identity-access'] },
  { key: 'resilience', label: 'Recovery and failure handling', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['source-systems', 'security-controls'] },
  { key: 'role-learning', label: 'Role learning journeys generated', minConfidence: 0.99, budgetMinutes: 15, dependsOn: ['people-data'] },
  { key: 'privileged-competency', label: 'Managers/admins certified for privileged tasks', minConfidence: 0.99, budgetMinutes: 90, dependsOn: ['role-learning', 'time-policies', 'scheduling', 'payroll-mapping', 'security-controls'] },
  { key: 'frontline-readiness', label: 'Frontline users certified for first use', minConfidence: 0.99, budgetMinutes: 20, dependsOn: ['role-learning', 'absence-policies', 'scheduling', 'clocking'] }
]);

const REQUIREMENT_BY_KEY = new Map(REQUIREMENTS.map(item => [item.key, item]));

function criticalPathRemainingMinutes(requirements) {
  const byKey = new Map(requirements.map(item => [item.key, item]));
  const memo = new Map();

  function remaining(key, visiting = new Set()) {
    const item = byKey.get(key);
    if (!item || item.satisfied) return 0;
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key)) throw new Error('Implementation requirement dependency cycle detected.');

    const nextVisiting = new Set(visiting);
    nextVisiting.add(key);
    const dependencyRemaining = (item.dependsOn || []).map(dep => remaining(dep, nextVisiting));
    const value = Number(item.budgetMinutes || 0) + Math.max(0, ...dependencyRemaining);
    memo.set(key, value);
    return value;
  }

  return Math.max(0, ...requirements.filter(item => !item.satisfied).map(item => remaining(item.key)));
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function compact(value, max = 200) {
  return String(value ?? '').slice(0, max);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
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

async function readJson(req, maxBytes = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function createOneDayEnterpriseEngine(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '';
  const learningSummaryProvider = typeof options.learningSummaryProvider === 'function'
    ? options.learningSummaryProvider
    : null;
  if (!dbPath) throw new Error('One-day implementation engine requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS implementation_runs(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, state TEXT NOT NULL,' +
      'started_at_ms INTEGER NOT NULL, deadline_at_ms INTEGER NOT NULL, target_hours INTEGER NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,contract_ref_hash));' +
    'CREATE TABLE IF NOT EXISTS implementation_evidence(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, tenant TEXT NOT NULL, kind TEXT NOT NULL,' +
      'status TEXT NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL, detail_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS implementation_decisions(' +
      'id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tenant TEXT NOT NULL, decision_key TEXT NOT NULL,' +
      'question TEXT NOT NULL, proposal_json TEXT NOT NULL, confidence REAL NOT NULL, risk TEXT NOT NULL,' +
      'status TEXT NOT NULL, decision_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,' +
      'UNIQUE(run_id,decision_key));' +
    'CREATE TABLE IF NOT EXISTS implementation_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, tenant TEXT, event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_implementation_event_update BEFORE UPDATE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Implementation events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_implementation_event_delete BEFORE DELETE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Implementation events are append only.'); END;"
  );

  const authStmt = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const runById = db.prepare('SELECT * FROM implementation_runs WHERE id=? AND tenant=?');
  const runByIdAnyTenant = db.prepare('SELECT * FROM implementation_runs WHERE id=?');
  const currentRun = db.prepare(
    "SELECT * FROM implementation_runs WHERE tenant=? ORDER BY started_at_ms DESC LIMIT 1"
  );
  const runByContract = db.prepare(
    'SELECT * FROM implementation_runs WHERE tenant=? AND contract_ref_hash=?'
  );
  const insertRun = db.prepare(
    'INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  const updateRunState = db.prepare(
    'UPDATE implementation_runs SET state=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const insertEvidence = db.prepare(
    'INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const latestEvidence = db.prepare(
    'SELECT e.* FROM implementation_evidence e JOIN (' +
      'SELECT kind,MAX(id) AS max_id FROM implementation_evidence WHERE run_id=? AND tenant=? GROUP BY kind' +
    ') latest ON latest.max_id=e.id ORDER BY e.kind'
  );
  const evidenceByKind = db.prepare(
    'SELECT * FROM implementation_evidence WHERE run_id=? AND tenant=? AND kind=? ORDER BY id DESC LIMIT 1'
  );
  const insertDecision = db.prepare(
    'INSERT INTO implementation_decisions(id,run_id,tenant,decision_key,question,proposal_json,confidence,risk,status,decision_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const decisionByKey = db.prepare(
    'SELECT * FROM implementation_decisions WHERE run_id=? AND tenant=? AND decision_key=?'
  );
  const listDecisions = db.prepare(
    'SELECT * FROM implementation_decisions WHERE run_id=? AND tenant=? ORDER BY created_at'
  );
  const updateDecision = db.prepare(
    'UPDATE implementation_decisions SET status=?,decision_json=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const eventStmt = db.prepare(
    'INSERT INTO implementation_events(run_id,tenant,event,detail_json,created_at) VALUES(?,?,?,?,?)'
  );

  function record(runId, tenant, event, detail = {}) {
    try {
      eventStmt.run(runId || null, tenant || null, event, JSON.stringify(detail), nowIso());
    } catch {}
  }

  function authContext(req) {
    const token = cookieSessionToken(req);
    if (!token) return null;
    return authStmt.get(sha256(token), Date.now()) || null;
  }

  function requireManager(req, res) {
    const ctx = authContext(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    if (String(ctx.role).toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Implementation control requires an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }

  function requireInternal(req, res) {
    if (!internalToken) {
      writeJson(res, 503, { error: 'Implementation worker credential is not configured.' });
      return false;
    }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted implementation worker is required.' });
      return false;
    }
    return true;
  }

  function parseDecision(row) {
    return {
      id: row.id,
      key: row.decision_key,
      question: row.question,
      proposal: JSON.parse(row.proposal_json),
      confidence: row.confidence,
      risk: row.risk,
      status: row.status,
      decision: row.decision_json ? JSON.parse(row.decision_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function readinessForRun(run) {
    const latest = latestEvidence.all(run.id, run.tenant);
    const map = new Map(latest.map(row => [row.kind, row]));
    let learningSummary = null;
    if (learningSummaryProvider) {
      try { learningSummary = learningSummaryProvider(run.tenant); } catch {}
    }

    const requirements = REQUIREMENTS.map(requirement => {
      const row = map.get(requirement.key);
      let derived = null;

      if (learningSummary && requirement.key === 'role-learning') {
        const ok = learningSummary.users > 0 && learningSummary.assignments >= learningSummary.users;
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      } else if (learningSummary && requirement.key === 'privileged-competency') {
        const ok = Boolean(learningSummary.privilegedReady);
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      } else if (learningSummary && requirement.key === 'frontline-readiness') {
        const ok = Boolean(learningSummary.fullyCertified);
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      }

      const status = derived?.status || row?.status || 'MISSING';
      const confidence = derived ? derived.confidence : (row ? Number(row.confidence) : 0);
      return {
        ...requirement,
        status,
        confidence,
        satisfied: status === 'PASS' && confidence >= requirement.minConfidence,
        source: derived?.source || row?.source || null,
        observedAt: derived ? nowIso() : (row?.created_at || null),
        detail: derived?.detail || (row ? JSON.parse(row.detail_json) : null)
      };
    });

    const decisions = listDecisions.all(run.id, run.tenant).map(parseDecision);
    const blockingDecisions = decisions.filter(item =>
      (item.risk === 'HIGH' || item.risk === 'CRITICAL') &&
      item.status !== 'ACCEPTED' &&
      item.status !== 'CHANGED'
    );

    const missing = requirements.filter(item => !item.satisfied);
    const elapsedMinutes = Math.max(0, (Date.now() - run.started_at_ms) / 60000);
    const remainingMinutes = Math.max(0, (run.deadline_at_ms - Date.now()) / 60000);
    const parallelWorkMinutes = missing.reduce((sum, item) => sum + item.budgetMinutes, 0);
    const remainingBudgetMinutes = criticalPathRemainingMinutes(requirements);
    const operationalReady = missing.length === 0 && blockingDecisions.length === 0;
    let state = operationalReady ? 'READY' : 'BUILDING';
    if (!operationalReady && Date.now() > run.deadline_at_ms) state = 'SLA_MISSED';
    else if (!operationalReady && remainingBudgetMinutes > remainingMinutes) state = 'AT_RISK';

    return {
      runId: run.id,
      tenant: run.tenant,
      state,
      operationalReady,
      targetHours: run.target_hours,
      startedAt: new Date(run.started_at_ms).toISOString(),
      deadlineAt: new Date(run.deadline_at_ms).toISOString(),
      elapsedMinutes: Math.round(elapsedMinutes),
      remainingMinutes: Math.round(remainingMinutes),
      remainingBudgetMinutes,
      criticalPathRemainingMinutes: remainingBudgetMinutes,
      parallelWorkMinutes,
      completedRequirements: requirements.filter(item => item.satisfied).length,
      totalRequirements: requirements.length,
      requirements,
      decisions,
      blockingDecisions,
      learningSummary
    };
  }

  function recompute(run) {
    const readiness = readinessForRun(run);
    if (readiness.state !== run.state) {
      updateRunState.run(readiness.state, nowIso(), run.id, run.tenant);
      record(run.id, run.tenant, 'STATE_CHANGED', { from: run.state, to: readiness.state });
      run.state = readiness.state;
    }
    return readiness;
  }

  async function handleContractActivated(req, res) {
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    const contractRef = compact(body.contractRef, 300);
    const targetHours = Math.max(1, Math.min(24, Number(body.targetHours || 8)));
    if (!tenant || !contractRef) {
      return writeJson(res, 400, { error: 'tenant and contractRef are required.' });
    }

    const contractHash = sha256(contractRef);
    const existing = runByContract.get(tenant, contractHash);
    if (existing) {
      return writeJson(res, 200, readinessForRun(existing));
    }

    const id = randomUUID();
    const started = Date.now();
    const deadline = started + targetHours * 60 * 60 * 1000;
    const ts = nowIso();
    insertRun.run(id, tenant, contractHash, 'BUILDING', started, deadline, targetHours, ts, ts);
    record(id, tenant, 'CONTRACT_ACTIVATED', {
      targetHours,
      contractRefDigest: contractHash.slice(0, 16)
    });
    const run = runByIdAnyTenant.get(id);
    return writeJson(res, 201, readinessForRun(run));
  }

  async function handleEvidence(req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const kind = compact(body.kind, 100);
    const status = compact(body.status, 20).toUpperCase();
    const confidence = Number(body.confidence);
    const source = compact(body.source || 'trusted-worker', 100);
    const run = runByIdAnyTenant.get(runId);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    if (!REQUIREMENT_BY_KEY.has(kind)) {
      return writeJson(res, 400, { error: 'Unknown implementation evidence kind.' });
    }
    if (!['PASS', 'WARN', 'FAIL'].includes(status)) {
      return writeJson(res, 400, { error: 'status must be PASS, WARN or FAIL.' });
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return writeJson(res, 400, { error: 'confidence must be between 0 and 1.' });
    }

    insertEvidence.run(
      run.id,
      run.tenant,
      kind,
      status,
      confidence,
      source,
      JSON.stringify(body.detail || {}),
      nowIso()
    );
    record(run.id, run.tenant, 'EVIDENCE_RECORDED', { kind, status, confidence, source });
    return writeJson(res, 200, recompute(run));
  }

  async function handleProposal(req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const key = compact(body.key, 120);
    const question = compact(body.question, 500);
    const risk = compact(body.risk || 'MEDIUM', 20).toUpperCase();
    const confidence = Number(body.confidence);
    const run = runByIdAnyTenant.get(runId);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    if (!key || !question || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(risk)) {
      return writeJson(res, 400, { error: 'Valid key, question and risk are required.' });
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return writeJson(res, 400, { error: 'confidence must be between 0 and 1.' });
    }

    const existing = decisionByKey.get(run.id, run.tenant, key);
    if (existing) return writeJson(res, 200, { decision: parseDecision(existing) });

    const id = randomUUID();
    const ts = nowIso();
    insertDecision.run(
      id, run.id, run.tenant, key, question, JSON.stringify(body.proposal || {}),
      confidence, risk, 'PENDING', null, ts, ts
    );
    record(run.id, run.tenant, 'DECISION_REQUIRED', { key, risk, confidence });
    return writeJson(res, 201, { decision: parseDecision(decisionByKey.get(run.id, run.tenant, key)) });
  }

  async function handleDecision(ctx, req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const key = compact(body.key, 120);
    const action = compact(body.action, 20).toUpperCase();
    const run = runById.get(runId, ctx.tenant);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    const decision = decisionByKey.get(run.id, run.tenant, key);
    if (!decision) return writeJson(res, 404, { error: 'Decision not found.' });
    if (!['ACCEPTED', 'CHANGED', 'REJECTED'].includes(action)) {
      return writeJson(res, 400, { error: 'action must be ACCEPTED, CHANGED or REJECTED.' });
    }

    const detail = action === 'CHANGED' ? body.value : body.detail;
    updateDecision.run(action, JSON.stringify(detail ?? null), nowIso(), decision.id, run.tenant);
    record(run.id, run.tenant, 'DECISION_RESOLVED', {
      key,
      action,
      by: sha256(ctx.email).slice(0, 16)
    });
    return writeJson(res, 200, recompute(run));
  }

  function handleStatus(ctx, res) {
    const run = currentRun.get(ctx.tenant);
    if (!run) return writeJson(res, 200, {
      state: 'NOT_STARTED',
      operationalReady: false,
      targetHours: 8,
      requirements: REQUIREMENTS
    });
    return writeJson(res, 200, recompute(run));
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;

    try {
      if (req.method === 'POST' && path === PREFIX + '/contract-activated') {
        if (!requireInternal(req, res)) return true;
        return await handleContractActivated(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/evidence') {
        if (!requireInternal(req, res)) return true;
        return await handleEvidence(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/proposal') {
        if (!requireInternal(req, res)) return true;
        return await handleProposal(req, res);
      }

      const ctx = requireManager(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/status') return handleStatus(ctx, res);
      if (req.method === 'POST' && path === PREFIX + '/decision') return await handleDecision(ctx, req, res);
      return writeJson(res, 404, { error: 'Autonomous implementation endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), {
        error: error?.statusCode ? error.message : 'Implementation control plane failed safely.'
      });
    }
  }

  return {
    handleRequest,
    statusForTenant(tenant) {
      const run = currentRun.get(tenant);
      return run ? recompute(run) : null;
    },
    close() { try { db.close(); } catch {} }
  };
}

module.exports = {
  createOneDayEnterpriseEngine,
  REQUIREMENTS,
  criticalPathRemainingMinutes
};
