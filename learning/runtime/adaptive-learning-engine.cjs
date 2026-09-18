'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/learning/adaptive';
const INTERNAL_HEADER = 'x-wfm-learning-internal';
const DAY = 24 * 60 * 60 * 1000;

const COMPETENCIES = Object.freeze({
  'time.clock': { title: 'Clock accurately', objective: 'Clock in, out and take breaks correctly.', critical: true },
  'schedule.read': { title: 'Understand your schedule', objective: 'Find shifts, changes and required actions.', critical: true },
  'absence.request': { title: 'Manage absence and leave', objective: 'Request leave and understand balances and status.', critical: true },
  'time.correct': { title: 'Correct time safely', objective: 'Raise and resolve a missing or incorrect time record.', critical: true },
  'profile.manage': { title: 'Manage your details', objective: 'Review the personal information you are allowed to maintain.', critical: false },
  'absence.decide': { title: 'Decide absence requests', objective: 'Approve or decline leave with coverage context.', critical: true },
  'time.signoff': { title: 'Complete weekly sign-off', objective: 'Resolve attendance exceptions and sign off the week.', critical: true },
  'schedule.recover': { title: 'Recover the schedule', objective: 'Resolve coverage, skills and disruption exceptions.', critical: true },
  'labour.cost': { title: 'Control labour cost', objective: 'Interpret cost and efficiency signals before acting.', critical: true },
  'team.coach': { title: 'Coach your team', objective: 'Teach common tasks and guide colleagues safely.', critical: true, teachBack: true },
  'payroll.exception': { title: 'Resolve payroll exceptions', objective: 'Identify and resolve time-to-payroll exceptions.', critical: true },
  'payroll.reconcile': { title: 'Reconcile payroll', objective: 'Compare expected and generated payroll outcomes.', critical: true },
  'payroll.export': { title: 'Control payroll output', objective: 'Validate and release payroll output with evidence.', critical: true },
  'audit.trace': { title: 'Trace decisions', objective: 'Use the audit trail to explain what changed and why.', critical: true },
  'configuration.policy': { title: 'Configure workforce policy', objective: 'Change a rule, understand impact and validate it before activation.', critical: true },
  'configuration.roles': { title: 'Configure roles safely', objective: 'Assign least-privilege roles without breaking access boundaries.', critical: true },
  'integration.health': { title: 'Manage integration health', objective: 'Understand source authority, drift, failure and recovery.', critical: true },
  'site.setup': { title: 'Configure a site', objective: 'Configure sites, departments, calendars and defaults safely.', critical: true },
  'security.audit': { title: 'Operate security controls', objective: 'Understand identity, tenant isolation and audit evidence.', critical: true },
  'feature.enablement': { title: 'Enable new functionality', objective: 'Assess, learn, validate and safely enable a new capability.', critical: true },
  'trainer.teachback': { title: 'Teach the system', objective: 'Demonstrate, explain and coach a role-based workflow.', critical: true, teachBack: true }
});

const ROLE_CURRICULA = Object.freeze({
  employee: ['time.clock', 'schedule.read', 'absence.request', 'time.correct', 'profile.manage'],
  manager: [
    'time.clock', 'schedule.read', 'absence.request', 'time.correct',
    'absence.decide', 'time.signoff', 'schedule.recover', 'labour.cost', 'team.coach'
  ],
  payroll: [
    'time.clock', 'schedule.read', 'time.correct',
    'payroll.exception', 'payroll.reconcile', 'payroll.export', 'audit.trace'
  ],
  admin: [
    'time.clock', 'schedule.read', 'absence.request', 'time.correct',
    'absence.decide', 'time.signoff', 'schedule.recover', 'labour.cost',
    'payroll.exception', 'payroll.reconcile', 'audit.trace',
    'configuration.policy', 'configuration.roles', 'integration.health',
    'site.setup', 'security.audit', 'feature.enablement', 'trainer.teachback'
  ]
});

const EVIDENCE_WEIGHTS = Object.freeze({
  GUIDED_PRACTICE: 55,
  INDEPENDENT_TASK: 65,
  RETRIEVAL_CHECK: 30,
  TEACH_BACK: 45,
  OBSERVED_SUCCESS: 60
});

const PRACTICE = Object.freeze({
  'time.clock': {
    prompt: 'You notice your previous shift has no clock-out. What is the safest action?',
    options: ['Create a correction with the real finish time', 'Clock out now for yesterday', 'Ignore it'],
    answer: 0
  },
  'absence.request': {
    prompt: 'You want annual leave next week. What should you check first?',
    options: ['Balance and request status in your own leave view', 'A colleague’s private record', 'Payroll export'],
    answer: 0
  },
  'time.signoff': {
    prompt: 'Weekly sign-off shows two unresolved exceptions. What should happen before sign-off?',
    options: ['Resolve or evidence both exceptions', 'Sign off and fix them next month', 'Delete the exceptions'],
    answer: 0
  },
  'schedule.recover': {
    prompt: 'A qualified operator is absent and a line is under-covered. What is the first decision?',
    options: ['Review qualified available cover and constraints', 'Assign any employee', 'Remove the skill requirement'],
    answer: 0
  },
  'payroll.reconcile': {
    prompt: 'Generated payroll differs from the historical expected value. What should you do?',
    options: ['Trace the variance and resolve it before release', 'Release because most values match', 'Overwrite the audit result'],
    answer: 0
  },
  'configuration.policy': {
    prompt: 'You change an overtime threshold. What must happen before activation?',
    options: ['Simulate impact and validate affected outcomes', 'Activate immediately', 'Delete prior evidence'],
    answer: 0
  },
  'integration.health': {
    prompt: 'The HCM source schema drifts overnight. What is the correct response?',
    options: ['Pause unsafe mapping, reconcile and repair', 'Guess the new fields', 'Ignore the drift'],
    answer: 0
  },
  'trainer.teachback': {
    prompt: 'A colleague forgets how to correct a missed clock. How should you teach it?',
    options: ['Explain why, demonstrate safely, then let them practise', 'Do it for them every time', 'Give them admin access'],
    answer: 0
  }
});

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function requestPath(req) { return String(req?.url || '/').split('?')[0] || '/'; }
function compact(value, max = 200) { return String(value ?? '').slice(0, max); }

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

async function readJson(req, maxBytes = 128 * 1024) {
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

function canonicalRole(role) {
  const value = String(role || '').toLowerCase();
  if (value.includes('payroll')) return 'payroll';
  if (value.includes('admin') || value.includes('super')) return 'admin';
  if (value.includes('manager') || value.includes('leader')) return 'manager';
  return 'employee';
}

function curriculumForRole(role) {
  return ROLE_CURRICULA[canonicalRole(role)] || ROLE_CURRICULA.employee;
}

function nextRefreshMs(score) {
  if (score >= 95) return 90 * DAY;
  if (score >= 80) return 30 * DAY;
  if (score >= 60) return 14 * DAY;
  return 7 * DAY;
}

function createAdaptiveLearningEngine(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_LEARNING_INTERNAL_TOKEN || '';
  if (!dbPath) throw new Error('Adaptive learning engine requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS learning_assignments(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,' +
      'competency_key TEXT NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,' +
      'due_at_ms INTEGER NOT NULL, mastered_at_ms INTEGER, source TEXT NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,email,competency_key));' +
    'CREATE TABLE IF NOT EXISTS learning_evidence(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id TEXT NOT NULL, tenant TEXT NOT NULL,' +
      'email TEXT NOT NULL, evidence_type TEXT NOT NULL, result TEXT NOT NULL, score_value INTEGER NOT NULL,' +
      'detail_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS learning_help(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, email TEXT NOT NULL,' +
      'competency_key TEXT NOT NULL, event TEXT NOT NULL, created_at_ms INTEGER NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS learning_feature_changes(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, feature_key TEXT NOT NULL, title TEXT NOT NULL,' +
      'affected_roles_json TEXT NOT NULL, competencies_json TEXT NOT NULL, created_at TEXT NOT NULL,' +
      'UNIQUE(tenant,feature_key));' +
    'CREATE TABLE IF NOT EXISTS learning_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT, actor_hash TEXT, verb TEXT NOT NULL,' +
      'object_key TEXT NOT NULL, result_json TEXT NOT NULL, context_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_learning_event_update BEFORE UPDATE ON learning_events ' +
      "BEGIN SELECT RAISE(ABORT,'Learning events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_learning_event_delete BEFORE DELETE ON learning_events ' +
      "BEGIN SELECT RAISE(ABORT,'Learning events are append only.'); END;"
  );

  const authStmt = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const usersForTenant = db.prepare('SELECT email,tenant,role FROM users WHERE tenant=? ORDER BY email');
  const assignmentByKey = db.prepare(
    'SELECT * FROM learning_assignments WHERE tenant=? AND email=? AND competency_key=?'
  );
  const assignmentsForUser = db.prepare(
    'SELECT * FROM learning_assignments WHERE tenant=? AND email=? ORDER BY status,due_at_ms,competency_key'
  );
  const assignmentsForTenant = db.prepare(
    'SELECT * FROM learning_assignments WHERE tenant=? ORDER BY email,competency_key'
  );
  const insertAssignment = db.prepare(
    'INSERT OR IGNORE INTO learning_assignments(id,tenant,email,role,competency_key,status,score,due_at_ms,mastered_at_ms,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const updateAssignment = db.prepare(
    'UPDATE learning_assignments SET status=?,score=?,due_at_ms=?,mastered_at_ms=?,updated_at=? WHERE id=?'
  );
  const insertEvidence = db.prepare(
    'INSERT INTO learning_evidence(assignment_id,tenant,email,evidence_type,result,score_value,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const evidenceForAssignment = db.prepare(
    'SELECT * FROM learning_evidence WHERE assignment_id=? ORDER BY id'
  );
  const insertHelp = db.prepare(
    'INSERT INTO learning_help(tenant,email,competency_key,event,created_at_ms,created_at) VALUES(?,?,?,?,?,?)'
  );
  const recentHelp = db.prepare(
    'SELECT COUNT(*) AS count FROM learning_help WHERE tenant=? AND email=? AND competency_key=? AND created_at_ms>=?'
  );
  const dueNow = db.prepare(
    'UPDATE learning_assignments SET due_at_ms=?,status=CASE WHEN status=\'MASTERED\' THEN \'REFRESH_DUE\' ELSE status END,updated_at=? WHERE tenant=? AND email=? AND competency_key=?'
  );
  const insertFeature = db.prepare(
    'INSERT OR IGNORE INTO learning_feature_changes(id,tenant,feature_key,title,affected_roles_json,competencies_json,created_at) VALUES(?,?,?,?,?,?,?)'
  );
  const eventStmt = db.prepare(
    'INSERT INTO learning_events(tenant,actor_hash,verb,object_key,result_json,context_json,created_at) VALUES(?,?,?,?,?,?,?)'
  );

  function record(tenant, email, verb, objectKey, result = {}, context = {}) {
    try {
      eventStmt.run(
        tenant || null,
        email ? sha256(email).slice(0, 24) : null,
        verb,
        objectKey,
        JSON.stringify(result),
        JSON.stringify(context),
        nowIso()
      );
    } catch {}
  }

  function authContext(req) {
    const token = cookieSessionToken(req);
    if (!token) return null;
    return authStmt.get(sha256(token), Date.now()) || null;
  }

  function requireUser(req, res) {
    const ctx = authContext(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    return ctx;
  }

  function requireManager(req, res) {
    const ctx = requireUser(req, res);
    if (!ctx) return null;
    if (canonicalRole(ctx.role) === 'employee') {
      writeJson(res, 403, { error: 'Learning analytics require an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }

  function requireInternal(req, res) {
    if (!internalToken) {
      writeJson(res, 503, { error: 'Learning worker credential is not configured.' });
      return false;
    }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted learning worker is required.' });
      return false;
    }
    return true;
  }

  function ensureAssignments(user, source = 'role-curriculum') {
    const role = canonicalRole(user.role);
    const ts = nowIso();
    for (const key of curriculumForRole(role)) {
      insertAssignment.run(
        randomUUID(), user.tenant, user.email, role, key, 'DUE', 0, Date.now(), null,
        source, ts, ts
      );
    }
    return assignmentsForUser.all(user.tenant, user.email);
  }

  function recomputeAssignment(row) {
    const evidence = evidenceForAssignment.all(row.id);
    const best = new Map();
    for (const item of evidence) {
      if (item.result !== 'PASS') continue;
      best.set(item.evidence_type, Math.max(best.get(item.evidence_type) || 0, item.score_value));
    }
    const score = Math.min(100, [...best.values()].reduce((sum, value) => sum + value, 0));
    const requiresTeachBack = Boolean(COMPETENCIES[row.competency_key]?.teachBack);
    const mastered = score >= 80 && (!requiresTeachBack || best.has('TEACH_BACK'));
    const currentMasteredAt = row.mastered_at_ms || null;
    const masteredAt = mastered ? (currentMasteredAt || Date.now()) : null;
    const dueAt = mastered ? masteredAt + nextRefreshMs(score) : Date.now();
    const status = mastered ? 'MASTERED' : 'DUE';
    updateAssignment.run(status, score, dueAt, masteredAt, nowIso(), row.id);
    return assignmentByKey.get(row.tenant, row.email, row.competency_key);
  }

  function publicAssignment(row) {
    const competency = COMPETENCIES[row.competency_key] || {
      title: row.competency_key,
      objective: 'Learn and practise this capability.',
      critical: false
    };
    const scenario = PRACTICE[row.competency_key];
    return {
      competencyKey: row.competency_key,
      title: competency.title,
      objective: competency.objective,
      critical: Boolean(competency.critical),
      teachBack: Boolean(competency.teachBack),
      status: row.status,
      score: row.score,
      dueAt: new Date(row.due_at_ms).toISOString(),
      practice: scenario ? {
        prompt: scenario.prompt,
        options: scenario.options
      } : null
    };
  }

  function planForUser(user) {
    const rows = ensureAssignments(user).map(recomputeAssignment);
    const due = rows
      .filter(row => row.status !== 'MASTERED' || row.due_at_ms <= Date.now())
      .map(publicAssignment);
    const mastered = rows.filter(row => row.status === 'MASTERED').length;
    return {
      role: canonicalRole(user.role),
      progress: {
        mastered,
        total: rows.length,
        percent: rows.length ? Math.round(mastered / rows.length * 100) : 100
      },
      next: due.slice(0, 3),
      all: rows.map(publicAssignment)
    };
  }

  function summaryForTenant(tenant) {
    const users = usersForTenant.all(tenant);
    for (const user of users) ensureAssignments(user);
    const rows = assignmentsForTenant.all(tenant).map(recomputeAssignment);
    const total = rows.length;
    const mastered = rows.filter(row => row.status === 'MASTERED').length;
    const critical = rows.filter(row => COMPETENCIES[row.competency_key]?.critical);
    const criticalMastered = critical.filter(row => row.status === 'MASTERED').length;
    const privileged = rows.filter(row => row.role !== 'employee' && COMPETENCIES[row.competency_key]?.critical);
    const privilegedMastered = privileged.filter(row => row.status === 'MASTERED').length;
    return {
      users: users.length,
      assignments: total,
      mastered,
      masteryPercent: total ? Math.round(mastered / total * 100) : 100,
      criticalAssignments: critical.length,
      criticalMastered,
      criticalMasteryPercent: critical.length ? Math.round(criticalMastered / critical.length * 100) : 100,
      privilegedAssignments: privileged.length,
      privilegedMastered,
      privilegedReady: privileged.length === privilegedMastered,
      fullyCertified: total === mastered
    };
  }

  async function handleBootstrapTenant(req, res) {
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    if (!tenant) return writeJson(res, 400, { error: 'tenant is required.' });
    const users = usersForTenant.all(tenant);
    for (const user of users) ensureAssignments(user, 'implementation-bootstrap');
    record(tenant, null, 'assigned', 'role-curriculum', { users: users.length });
    return writeJson(res, 200, { tenant, ...summaryForTenant(tenant) });
  }

  async function handleEvidence(req, res) {
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    const email = compact(body.email, 240);
    const competencyKey = compact(body.competencyKey, 120);
    const evidenceType = compact(body.evidenceType, 40).toUpperCase();
    const result = compact(body.result, 20).toUpperCase();
    if (!tenant || !email || !COMPETENCIES[competencyKey]) {
      return writeJson(res, 400, { error: 'Valid tenant, email and competencyKey are required.' });
    }
    if (!EVIDENCE_WEIGHTS[evidenceType] || !['PASS', 'FAIL'].includes(result)) {
      return writeJson(res, 400, { error: 'Unsupported learning evidence.' });
    }
    const user = usersForTenant.all(tenant).find(item => item.email === email);
    if (!user) return writeJson(res, 404, { error: 'User not found.' });
    ensureAssignments(user, 'observed-task');
    const assignment = assignmentByKey.get(tenant, email, competencyKey);
    if (!assignment) return writeJson(res, 409, { error: 'Competency is not assigned to this role.' });

    insertEvidence.run(
      assignment.id, tenant, email, evidenceType, result,
      result === 'PASS' ? EVIDENCE_WEIGHTS[evidenceType] : 0,
      JSON.stringify(body.detail || {}),
      nowIso()
    );
    const updated = recomputeAssignment(assignment);
    record(tenant, email, result === 'PASS' ? 'passed' : 'failed', competencyKey, {
      evidenceType,
      score: updated.score
    });
    return writeJson(res, 200, { assignment: publicAssignment(updated) });
  }

  async function handlePractice(ctx, req, res) {
    const body = await readJson(req);
    const competencyKey = compact(body.competencyKey, 120);
    const scenario = PRACTICE[competencyKey];
    if (!scenario) return writeJson(res, 400, { error: 'No guided practice is available for this competency.' });
    ensureAssignments(ctx, 'role-curriculum');
    const assignment = assignmentByKey.get(ctx.tenant, ctx.email, competencyKey);
    if (!assignment) return writeJson(res, 403, { error: 'This competency is not assigned to your role.' });

    const answer = Number(body.answer);
    const pass = Number.isInteger(answer) && answer === scenario.answer;
    insertEvidence.run(
      assignment.id, ctx.tenant, ctx.email, 'GUIDED_PRACTICE',
      pass ? 'PASS' : 'FAIL',
      pass ? EVIDENCE_WEIGHTS.GUIDED_PRACTICE : 0,
      JSON.stringify({ scenario: competencyKey }),
      nowIso()
    );
    const updated = recomputeAssignment(assignment);
    record(ctx.tenant, ctx.email, pass ? 'passed' : 'failed', competencyKey, {
      evidenceType: 'GUIDED_PRACTICE',
      score: updated.score
    });
    return writeJson(res, 200, {
      passed: pass,
      feedback: pass
        ? 'Correct. Practise the same task independently to prove durable competence.'
        : 'Not yet. Review the safest workflow and try again.',
      assignment: publicAssignment(updated)
    });
  }

  async function handleHelp(ctx, req, res) {
    const body = await readJson(req);
    const competencyKey = compact(body.competencyKey, 120);
    const event = compact(body.event, 40).toUpperCase();
    if (!COMPETENCIES[competencyKey] || !['OPENED', 'SEARCHED', 'FAILED_ATTEMPT'].includes(event)) {
      return writeJson(res, 400, { error: 'Valid competencyKey and help event are required.' });
    }
    ensureAssignments(ctx);
    const assignment = assignmentByKey.get(ctx.tenant, ctx.email, competencyKey);
    if (!assignment) return writeJson(res, 403, { error: 'This competency is not assigned to your role.' });

    const now = Date.now();
    insertHelp.run(ctx.tenant, ctx.email, competencyKey, event, now, nowIso());
    const count = Number(recentHelp.get(ctx.tenant, ctx.email, competencyKey, now - 7 * DAY)?.count || 0);
    record(ctx.tenant, ctx.email, 'help-' + event.toLowerCase(), competencyKey, { recentHelpCount: count });
    if (count >= 3) {
      dueNow.run(now, nowIso(), ctx.tenant, ctx.email, competencyKey);
      record(ctx.tenant, ctx.email, 'refresh-scheduled', competencyKey, { reason: 'repeated-help', count });
    }
    return writeJson(res, 200, { refreshScheduled: count >= 3, recentHelpCount: count });
  }

  async function handleFeatureChange(req, res) {
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    const featureKey = compact(body.featureKey, 120);
    const title = compact(body.title, 240);
    const roles = Array.isArray(body.affectedRoles) ? body.affectedRoles.map(canonicalRole) : [];
    const competencies = Array.isArray(body.competencies)
      ? body.competencies.map(item => compact(item, 120)).filter(key => COMPETENCIES[key])
      : [];
    if (!tenant || !featureKey || !title || !roles.length || !competencies.length) {
      return writeJson(res, 400, { error: 'tenant, featureKey, title, affectedRoles and competencies are required.' });
    }

    insertFeature.run(
      randomUUID(), tenant, featureKey, title,
      JSON.stringify([...new Set(roles)]),
      JSON.stringify([...new Set(competencies)]),
      nowIso()
    );

    const users = usersForTenant.all(tenant);
    let assigned = 0;
    for (const user of users) {
      const role = canonicalRole(user.role);
      if (!roles.includes(role)) continue;
      const ts = nowIso();
      for (const competencyKey of competencies) {
        insertAssignment.run(
          randomUUID(), tenant, user.email, role, competencyKey, 'DUE', 0, Date.now(), null,
          'feature:' + featureKey, ts, ts
        );
        dueNow.run(Date.now(), nowIso(), tenant, user.email, competencyKey);
        assigned += 1;
      }
    }
    record(tenant, null, 'feature-learning-assigned', featureKey, { users: users.length, assigned });
    return writeJson(res, 200, { tenant, featureKey, assigned, summary: summaryForTenant(tenant) });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;

    try {
      if (req.method === 'POST' && path === PREFIX + '/bootstrap-tenant') {
        if (!requireInternal(req, res)) return true;
        return await handleBootstrapTenant(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/evidence') {
        if (!requireInternal(req, res)) return true;
        return await handleEvidence(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/feature-change') {
        if (!requireInternal(req, res)) return true;
        return await handleFeatureChange(req, res);
      }

      if (req.method === 'GET' && path === PREFIX + '/tenant-summary') {
        const ctx = requireManager(req, res);
        if (!ctx) return true;
        return writeJson(res, 200, summaryForTenant(ctx.tenant));
      }

      const ctx = requireUser(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/plan') {
        return writeJson(res, 200, planForUser(ctx));
      }
      if (req.method === 'POST' && path === PREFIX + '/practice') {
        return await handlePractice(ctx, req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/help') {
        return await handleHelp(ctx, req, res);
      }
      return writeJson(res, 404, { error: 'Adaptive learning endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), {
        error: error?.statusCode ? error.message : 'Adaptive learning control plane failed safely.'
      });
    }
  }

  return {
    handleRequest,
    planForUser,
    summaryForTenant,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = {
  createAdaptiveLearningEngine,
  COMPETENCIES,
  ROLE_CURRICULA,
  EVIDENCE_WEIGHTS,
  canonicalRole,
  curriculumForRole
};
