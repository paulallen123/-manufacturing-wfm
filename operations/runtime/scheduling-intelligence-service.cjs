'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  CONTRACT_VERSION,
  createSchedulingPlan,
  repairSchedulingPlan,
  evaluateOpenShift,
  evaluateSwap,
  capabilityContract
} = require('./manufacturing-scheduling-engine.cjs');
const { forecastDemand, toHeadcountForecast } = require('./manufacturing-demand-forecast.cjs');
const { reconcileScheduleToAttendance } = require('./schedule-attendance-reconciliation.cjs');

const PREFIX = '/api/operations/scheduling';
const INTERNAL_HEADER = 'x-wfm-scheduling-internal';

function nowIso() { return new Date().toISOString(); }
function sha256(v) { return createHash('sha256').update(String(v)).digest('hex'); }
function compact(v, max = 240) { return String(v ?? '').trim().slice(0, max); }
function secureEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const p = part.trim();
    if (p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function pathOf(req) { return String(req?.url || '/').split('?')[0] || '/'; }
function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req, max = 512 * 1024) {
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const e = new Error('Invalid JSON body.');
    e.statusCode = 400;
    throw e;
  }
}

function createSchedulingIntelligenceService(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_SCHEDULING_INTERNAL_TOKEN || process.env.WFM_DEMAND_INTERNAL_TOKEN || process.env.WFM_INTEGRATION_INTERNAL_TOKEN || '';
  const publishEvent = typeof options.publishEvent === 'function' ? options.publishEvent : null;
  if (!dbPath) throw new Error('Scheduling intelligence service requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS vector_schedule_plans(' +
      'tenant TEXT NOT NULL,plan_id TEXT NOT NULL,context_revision TEXT NOT NULL,plan_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'PRIMARY KEY(tenant,plan_id));' +
    'CREATE INDEX IF NOT EXISTS vector_schedule_plan_tenant_created ON vector_schedule_plans(tenant,created_at DESC);' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_plan_update BEFORE UPDATE ON vector_schedule_plans ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule plans are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_plan_delete BEFORE DELETE ON vector_schedule_plans ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule plans are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_schedule_repairs(' +
      'tenant TEXT NOT NULL,repair_id TEXT NOT NULL,prior_plan_id TEXT NOT NULL,repair_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'PRIMARY KEY(tenant,repair_id));' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_repair_update BEFORE UPDATE ON vector_schedule_repairs ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule repairs are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_repair_delete BEFORE DELETE ON vector_schedule_repairs ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule repairs are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_schedule_reconciliations(' +
      'tenant TEXT NOT NULL,reconciliation_id TEXT NOT NULL,plan_id TEXT NOT NULL,reconciliation_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'PRIMARY KEY(tenant,reconciliation_id));' +
    'CREATE INDEX IF NOT EXISTS vector_schedule_reconciliation_tenant_created ON vector_schedule_reconciliations(tenant,created_at DESC);' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_reconciliation_update BEFORE UPDATE ON vector_schedule_reconciliations ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule reconciliations are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_schedule_reconciliation_delete BEFORE DELETE ON vector_schedule_reconciliations ' +
      "BEGIN SELECT RAISE(ABORT,'Vector schedule reconciliations are append only.'); END;"
  );

  const auth = db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const planById = db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? AND plan_id=?');
  const insertPlan = db.prepare('INSERT INTO vector_schedule_plans(tenant,plan_id,context_revision,plan_json,created_at) VALUES(?,?,?,?,?)');
  const listPlans = db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? ORDER BY created_at DESC,plan_id DESC LIMIT ?');
  const repairById = db.prepare('SELECT repair_json FROM vector_schedule_repairs WHERE tenant=? AND repair_id=?');
  const insertRepair = db.prepare('INSERT INTO vector_schedule_repairs(tenant,repair_id,prior_plan_id,repair_json,created_at) VALUES(?,?,?,?,?)');
  const reconciliationById = db.prepare('SELECT reconciliation_json FROM vector_schedule_reconciliations WHERE tenant=? AND reconciliation_id=?');
  const insertReconciliation = db.prepare('INSERT INTO vector_schedule_reconciliations(tenant,reconciliation_id,plan_id,reconciliation_json,created_at) VALUES(?,?,?,?,?)');
  const listReconciliations = db.prepare('SELECT reconciliation_json FROM vector_schedule_reconciliations WHERE tenant=? ORDER BY created_at DESC,reconciliation_id DESC LIMIT ?');

  function ctx(req) {
    const token = cookieToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }
  function requireAuth(req, res) {
    const c = ctx(req);
    if (!c) { writeJson(res, 401, { error: 'Sign in is required.' }); return null; }
    return c;
  }
  function requireManager(req, res) {
    const c = requireAuth(req, res);
    if (!c) return null;
    if (!['manager', 'director', 'supervisor'].includes(String(c.role).toLowerCase())) {
      writeJson(res, 403, { error: 'Scheduling intelligence requires an authorised manager or administrator.' });
      return null;
    }
    return c;
  }
  function requireCurrentManager(req, res, initial) {
    const current = requireManager(req, res);
    if (!current) return null;
    if (current.email !== initial.email || current.tenant !== initial.tenant || current.role !== initial.role) {
      writeJson(res, 403, { error: 'Scheduling authority changed. Refresh the signed-in context.' });
      return null;
    }
    return current;
  }
  function requireInternal(req, res) {
    if (!internalToken) { writeJson(res, 503, { error: 'Trusted scheduling worker is not configured.' }); return false; }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted scheduling worker is required.' });
      return false;
    }
    return true;
  }
  function persistPlan(plan) {
    const existing = planById.get(plan.tenant, plan.planId);
    if (existing) return { plan: JSON.parse(existing.plan_json), idempotent: true };
    insertPlan.run(plan.tenant, plan.planId, plan.contextRevision, JSON.stringify(plan), nowIso());
    try {
      publishEvent?.({
        tenant: plan.tenant,
        topic: 'scheduling.shadow.updated',
        audience: 'manager',
        payload: { planId: plan.planId, coveragePct: plan.quality?.coveragePct ?? null, executionPermitted: false }
      });
    } catch {}
    return { plan, idempotent: false };
  }
  function persistRepair(tenant, repair) {
    const existing = repairById.get(tenant, repair.repairId);
    if (existing) return { repair: JSON.parse(existing.repair_json), idempotent: true };
    insertRepair.run(tenant, repair.repairId, repair.priorPlanId, JSON.stringify(repair), nowIso());
    try {
      publishEvent?.({
        tenant,
        topic: 'scheduling.repair.shadow.updated',
        audience: 'manager',
        payload: { repairId: repair.repairId, priorPlanId: repair.priorPlanId, changeCount: repair.changeCount, executionPermitted: false }
      });
    } catch {}
    return { repair, idempotent: false };
  }
  function recentPlans(tenant, limit = 20) {
    return listPlans.all(tenant, Math.max(1, Math.min(50, Number(limit) || 20))).map(r => JSON.parse(r.plan_json));
  }
  function persistReconciliation(tenant, reconciliation) {
    const existing = reconciliationById.get(tenant, reconciliation.reconciliationId);
    if (existing) return { reconciliation: JSON.parse(existing.reconciliation_json), idempotent: true };
    insertReconciliation.run(tenant, reconciliation.reconciliationId, reconciliation.planId, JSON.stringify(reconciliation), nowIso());
    try {
      publishEvent?.({ tenant, topic: 'scheduling.reconciliation.updated', audience: 'manager', payload: { reconciliationId: reconciliation.reconciliationId, planId: reconciliation.planId, ready: reconciliation.ready, payrollAuthority: false } });
    } catch {}
    return { reconciliation, idempotent: false };
  }

  async function createInternalPlan(req, res) {
    if (!requireInternal(req, res)) return true;
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    if (!tenant) return writeJson(res, 400, { error: 'tenant is required.' });
    const plan = createSchedulingPlan({ ...(body.input || {}), tenant });
    const persisted = persistPlan(plan);
    return writeJson(res, persisted.idempotent ? 200 : 201, {
      contractVersion: CONTRACT_VERSION,
      ...persisted,
      authority: 'NO_EXECUTION'
    });
  }

  async function createInternalRepair(req, res) {
    if (!requireInternal(req, res)) return true;
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    const priorPlanId = compact(body.priorPlanId, 180);
    if (!tenant || !priorPlanId) return writeJson(res, 400, { error: 'tenant and priorPlanId are required.' });
    const row = planById.get(tenant, priorPlanId);
    if (!row) return writeJson(res, 404, { error: 'Prior schedule plan was not found.' });
    const priorPlan = JSON.parse(row.plan_json);
    const repair = repairSchedulingPlan({ ...(body.input || {}), priorPlan });
    const persisted = persistRepair(tenant, repair);
    return writeJson(res, persisted.idempotent ? 200 : 201, {
      contractVersion: CONTRACT_VERSION,
      ...persisted,
      authority: 'NO_EXECUTION'
    });
  }

  async function managerWhatIf(req, res, c) {
    const body = await readJson(req);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const plan = createSchedulingPlan({ ...(body.input || {}), tenant: c.tenant });
    return writeJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      scenarioOnly: true,
      persisted: false,
      plan,
      authority: 'NO_EXECUTION'
    });
  }

  async function managerOpenShift(req, res, c) {
    const body = await readJson(req);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const result = evaluateOpenShift(body.input || {});
    return writeJson(res, 200, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, result });
  }

  async function managerSwap(req, res, c) {
    const body = await readJson(req);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const result = evaluateSwap(body.input || {});
    return writeJson(res, 200, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, result });
  }

  async function handleRequest(req, res) {
    const path = pathOf(req);
    if (!path.startsWith(PREFIX)) return false;
    try {
      if (req.method === 'POST' && path === PREFIX + '/plan/shadow') return await createInternalPlan(req, res);
      if (req.method === 'POST' && path === PREFIX + '/repair/shadow') return await createInternalRepair(req, res);
      if (req.method === 'POST' && path === PREFIX + '/forecast/shadow') {
        if (!requireInternal(req, res)) return true;
        const b = await readJson(req);
        const forecast = forecastDemand(b.input || {});
        const labour = b.capacity ? toHeadcountForecast({ forecast, ...b.capacity }) : null;
        return writeJson(res, 200, { forecast, labour, authority: 'NO_EXECUTION' });
      }
      if (req.method === 'POST' && path === PREFIX + '/reconcile/shadow') {
        if (!requireInternal(req, res)) return true;
        const b = await readJson(req);
        const tenant = compact(b.tenant, 120);
        const planId = compact(b.planId, 180);
        if (!tenant || !planId) return writeJson(res, 400, { error: 'tenant and planId are required.' });
        const row = planById.get(tenant, planId);
        if (!row) return writeJson(res, 404, { error: 'Schedule plan was not found.' });
        const reconciliation = reconcileScheduleToAttendance({ plan: JSON.parse(row.plan_json), payrollProjection: b.payrollProjection });
        const persisted = persistReconciliation(tenant, reconciliation);
        return writeJson(res, persisted.idempotent ? 200 : 201, { ...persisted, authority: 'NO_PAYROLL_OR_SCHEDULE_EXECUTION' });
      }
      const c = requireManager(req, res);
      if (!c) return true;
      if (req.method === 'GET' && path === PREFIX + '/capabilities') {
        return writeJson(res, 200, { tenant: c.tenant, ...capabilityContract() });
      }
      if (req.method === 'GET' && path === PREFIX + '/plans') {
        return writeJson(res, 200, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, plans: recentPlans(c.tenant) });
      }
      if (req.method === 'GET' && path === PREFIX + '/reconciliations') {
        return writeJson(res, 200, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, reconciliations: listReconciliations.all(c.tenant, 20).map(r => JSON.parse(r.reconciliation_json)) });
      }
      if (req.method === 'POST' && path === PREFIX + '/forecast/what-if') {
        const b = await readJson(req);
        const current = requireCurrentManager(req, res, c);
        if (!current) return true;
        const forecast = forecastDemand(b.input || {});
        const labour = b.capacity ? toHeadcountForecast({ forecast, ...b.capacity }) : null;
        return writeJson(res, 200, { tenant: current.tenant, forecast, labour, scenarioOnly: true, authority: 'NO_EXECUTION' });
      }
      if (req.method === 'POST' && path === PREFIX + '/what-if') return await managerWhatIf(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/open-shift/evaluate') return await managerOpenShift(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/swap/evaluate') return await managerSwap(req, res, c);
      return writeJson(res, 404, { error: 'Scheduling intelligence endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 400), {
        error: error?.statusCode ? error.message : compact(error?.message || 'Scheduling intelligence failed safely.', 300),
        executionPermitted: false
      });
    }
  }

  return {
    handleRequest,
    recentPlans,
    capabilityContract,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = { createSchedulingIntelligenceService, PREFIX, INTERNAL_HEADER };
