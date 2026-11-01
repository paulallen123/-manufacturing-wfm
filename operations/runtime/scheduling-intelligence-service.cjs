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
const { createSchedulingAuthority, branchFor, workerReferences } = require('./scheduling-authority.cjs');
const { assessOrderStartVariance } = require('./order-start-variance.cjs');
const { assessProductionOutputGap } = require('./production-output-gap.cjs');
const { assessOrderMaterialAvailability } = require('./order-material-availability.cjs');

const PREFIX = '/api/operations/scheduling';
const INTERNAL_HEADER = 'x-wfm-scheduling-internal';

function nowIso() { return new Date().toISOString(); }
function sha256(v) { return createHash('sha256').update(String(v)).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
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
      "BEGIN SELECT RAISE(ABORT,'Vector schedule reconciliations are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_factory_assessment_receipts(' +
      'tenant TEXT NOT NULL,receipt_id TEXT NOT NULL,actor_email TEXT NOT NULL,person_id TEXT NOT NULL,' +
      'department TEXT NOT NULL,site_id TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'PRIMARY KEY(tenant,receipt_id));' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_factory_assessment_update BEFORE UPDATE ON vector_factory_assessment_receipts ' +
      "BEGIN SELECT RAISE(ABORT,'Declared factory assessment receipts are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_factory_assessment_delete BEFORE DELETE ON vector_factory_assessment_receipts ' +
      "BEGIN SELECT RAISE(ABORT,'Declared factory assessment receipts are append only.'); END;"
  );

  const auth = db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const authority = createSchedulingAuthority({ db, nativeHelpers: options.nativeHelpers });
  const planById = db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? AND plan_id=?');
  const insertPlan = db.prepare('INSERT INTO vector_schedule_plans(tenant,plan_id,context_revision,plan_json,created_at) VALUES(?,?,?,?,?)');
  const listPlans = db.prepare('SELECT plan_json FROM vector_schedule_plans WHERE tenant=? ORDER BY created_at DESC,plan_id DESC LIMIT ?');
  const repairById = db.prepare('SELECT repair_json FROM vector_schedule_repairs WHERE tenant=? AND repair_id=?');
  const insertRepair = db.prepare('INSERT INTO vector_schedule_repairs(tenant,repair_id,prior_plan_id,repair_json,created_at) VALUES(?,?,?,?,?)');
  const reconciliationById = db.prepare('SELECT reconciliation_json FROM vector_schedule_reconciliations WHERE tenant=? AND reconciliation_id=?');
  const insertReconciliation = db.prepare('INSERT INTO vector_schedule_reconciliations(tenant,reconciliation_id,plan_id,reconciliation_json,created_at) VALUES(?,?,?,?,?)');
  const listReconciliations = db.prepare('SELECT reconciliation_json FROM vector_schedule_reconciliations WHERE tenant=? ORDER BY created_at DESC,reconciliation_id DESC LIMIT ?');
  const factoryReceiptById = db.prepare('SELECT department,site_id,receipt_json FROM vector_factory_assessment_receipts WHERE tenant=? AND receipt_id=? AND actor_email=? AND person_id=?');
  const insertFactoryReceipt = db.prepare('INSERT INTO vector_factory_assessment_receipts(tenant,receipt_id,actor_email,person_id,department,site_id,receipt_json,created_at) VALUES(?,?,?,?,?,?,?,?)');

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
    return { ...c, source: authority.readContext(c, branchFor(req)) };
  }
  function requireCurrentManager(req, res, initial) {
    const current = requireManager(req, res);
    if (!current) return null;
    if (current.email !== initial.email || current.tenant !== initial.tenant || current.role !== initial.role || current.source.fence !== initial.source.fence) {
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
    const plan = authority.bindPlan(createSchedulingPlan({ ...(body.input || {}), tenant }), body.input || {});
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
    const calculated = repairSchedulingPlan({ ...(body.input || {}), priorPlan });
    const repairedPlan = authority.bindPlan(calculated.repairedPlan, body.input || {}, priorPlan.authorityScope);
    const repair = { ...calculated, repairedPlan, repairId: sha256(JSON.stringify([calculated.repairId, repairedPlan.planId])) };
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
    const source = authority.readContext(c, branchFor(req, body));
    const scope = authority.assertInput(source, body.input || {}, 'plan');
    const plan = authority.bindPlan(createSchedulingPlan({ ...scope.input, tenant: c.tenant }), scope.input);
    authority.assertPlan(source, plan);
    return writeJson(res, 200, authority.output(source, {
      contractVersion: CONTRACT_VERSION,
      scenarioOnly: true,
      persisted: false,
      plan,
      authority: 'NO_EXECUTION'
    }));
  }

  async function managerOpenShift(req, res, c) {
    const body = await readJson(req);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const source = authority.readContext(c, branchFor(req, body));
    const input = authority.assertInput(source, body.input || {}, 'open').input;
    const result = evaluateOpenShift(input);
    return writeJson(res, 200, authority.output(source, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, result }));
  }

  async function managerSwap(req, res, c) {
    const body = await readJson(req);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const source = authority.readContext(c, branchFor(req, body));
    const input = authority.assertInput(source, body.input || {}, 'swap').input;
    const result = evaluateSwap(input);
    return writeJson(res, 200, authority.output(source, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, result }));
  }

  async function managerOrderStartScenario(req, res, c) {
    // This endpoint consumes declarations only. No existing integration record
    // authenticates ERP/MES order evidence, so no persisted/source-backed claim
    // or execution permission may follow from a successful comparison.
    const body = await readJson(req, 16 * 1024);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    function exactFields(value, fields) {
      return value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
    }
    const recordFields = ['tenantId', 'siteId', 'lineId', 'orderId', 'source', 'recordId', 'revision', 'recordSha256', 'observedAt', 'complete', 'state'];
    if (!exactFields(body, ['siteId', 'lineId', 'orderId', 'department', 'plan', 'actual']) ||
        !exactFields(body.plan, [...recordFields, 'plannedStart', 'plannedEnd']) ||
        !exactFields(body.actual, [...recordFields, 'plannedRevision', 'plannedRecordSha256', 'actualStart']) ||
        [...new URL(String(req.url), 'http://wfm.invalid').searchParams.keys()].some(key => !['scope', 'branch'].includes(key))) {
      return writeJson(res, 400, { error: 'A declared order-start scenario with exact fields is required.', executionPermitted: false });
    }
    const source = authority.readContext(c, branchFor(req));
    authority.assertDepartmentSite(source, body.department, body.siteId);
    const asOf = nowIso();
    const result = assessOrderStartVariance({ tenantId: c.tenant, siteId: body.siteId, lineId: body.lineId,
      orderId: body.orderId, plan: body.plan, actual: body.actual, asOf, maxAgeMinutes: 120 });
    // The fixed assessor projection contains no financial data or free-form
    // source narrative; keep every false boundary flag, including costVerified.
    return writeJson(res, 200, { contractVersion: 'DECLARED_ORDER_START_SCENARIO_V1', scenarioOnly: true,
      persisted: false, sourceBasis: 'CALLER_DECLARED_ERP_MES_RECORDS', asOf, freshnessPolicyMinutes: 120,
      result, authority: 'NO_EXECUTION' });
  }

  function custodyUnavailable(error) {
    if (error?.statusCode) return error;
    const failure = new Error('Declared assessment custody is unavailable.'); failure.statusCode = 503; return failure;
  }

  function saveFactoryAssessment(req, res, initial, body, kind, scenario) {
    let transaction = false;
    try {
      // Recheck native authority under the same writer lock as both durable
      // records. A concurrent revocation must precede or follow this receipt.
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      const current = requireCurrentManager(req, res, initial);
      if (!current) { db.exec('ROLLBACK'); transaction = false; return true; }
      authority.assertDepartmentSite(current.source, body.department, body.siteId);
      const actor = current.source.actor, contractVersion = 'DECLARED_FACTORY_ASSESSMENT_RECEIPT_V1';
      const requestDigest = sha256(canonicalJson(body));
      const receiptId = sha256(canonicalJson([contractVersion, actor.tenant, actor.email, actor.personId, kind, requestDigest]));
      const existing = factoryReceiptById.get(actor.tenant, receiptId, actor.email, actor.personId);
      if (existing) {
        const receipt = JSON.parse(existing.receipt_json);
        db.exec('COMMIT'); transaction = false;
        return writeJson(res, 200, { receipt, idempotent: true });
      }
      const createdAt = nowIso();
      const receipt = { contractVersion, receiptId, requestDigest, tenantId: actor.tenant,
        department: body.department, siteId: body.siteId, kind, createdAt, input: body,
        custodyBasis: 'SERVER_RECORDED_CALLER_DECLARATION', sourceBasis: scenario.sourceBasis,
        scenarioOnly: true, persisted: true, authority: 'DECLARATION_CUSTODY_ONLY',
        sourceAuthenticated: false, lineOrderAuthority: false, causeVerified: false, costVerified: false,
        scheduleAuthority: false, executionAuthority: false,
        assessment: { asOf: scenario.asOf, result: scenario.result,
          ...(kind === 'output' ? { periodPolicyMaxDays: 31 } : { freshnessPolicyMinutes: 15 }) } };
      insertFactoryReceipt.run(actor.tenant, receiptId, actor.email, actor.personId, body.department, body.siteId, JSON.stringify(receipt), createdAt);
      // Use the existing native audit store; its absence or failure must roll
      // back custody rather than silently create a weaker substitute store.
      db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(
        actor.tenant, actor.personId, 'factory-assessment-declaration-recorded',
        JSON.stringify({ receiptId, requestDigest, kind, department: body.department, siteId: body.siteId,
          custodyOnly: true, sourceAuthenticated: false, executionAuthority: false }), createdAt);
      db.exec('COMMIT'); transaction = false;
      return writeJson(res, 201, { receipt, idempotent: false });
    } catch (error) {
      if (transaction) { try { db.exec('ROLLBACK'); } catch {} }
      throw custodyUnavailable(error);
    }
  }

  function readFactoryAssessment(req, res, initial, receiptId) {
    if ([...new URL(String(req.url), 'http://wfm.invalid').searchParams.keys()].some(key => !['scope', 'branch'].includes(key))) {
      return writeJson(res, 400, { error: 'Receipt reads accept only native scope parameters.' });
    }
    let transaction = false;
    try {
      // The native principal, hierarchy and receipt share one read snapshot.
      db.exec('BEGIN'); transaction = true;
      const current = requireCurrentManager(req, res, initial);
      if (!current) { db.exec('ROLLBACK'); transaction = false; return true; }
      const actor = current.source.actor;
      const row = factoryReceiptById.get(actor.tenant, receiptId, actor.email, actor.personId);
      if (!row) { db.exec('COMMIT'); transaction = false; return writeJson(res, 404, { error: 'Declared assessment receipt was not found.' }); }
      authority.assertDepartmentSite(current.source, row.department, row.site_id);
      const receipt = JSON.parse(row.receipt_json);
      db.exec('COMMIT'); transaction = false;
      // This is the historical declaration/calculation, not a refreshed stock
      // observation or an authenticated ERP/MES/provider readback.
      return writeJson(res, 200, { receipt });
    } catch (error) {
      if (transaction) { try { db.exec('ROLLBACK'); } catch {} }
      throw custodyUnavailable(error);
    }
  }

  async function managerFactoryScenario(req, res, c, kind, save = false) {
    // JSON declarations cannot establish provider custody, line/order authority
    // or actual stock availability. The existing native scope is rechecked
    // after the only awaited operation. Only the explicit assessment routes
    // persist declaration custody; the scenario routes invoke no write/event.
    const body = await readJson(req, 256 * 1024);
    c = requireCurrentManager(req, res, c);
    if (!c) return true;
    const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
    const outputScope = ['tenantId', 'siteId', 'lineId', 'productId', 'orderId'];
    const orderScope = ['tenantId', 'siteId', 'orderId'];
    const outputSource = [...outputScope, 'window', 'sourceName', 'revision', 'digest', 'observedAt', 'complete', 'evidenceRef'];
    const materialSource = [...orderScope, 'source', 'revision', 'digest', 'observedAt', 'complete'];
    const component = [...orderScope, 'componentId', 'unit', 'evidenceRef', 'evidenceDigest'];
    const rows = (value, fields) => Array.isArray(value) && value.length >= 1 && value.length <= 1000 && value.every(row => exact(row, fields));
    const valid = kind === 'output'
      ? exact(body, ['siteId', 'lineId', 'productId', 'orderId', 'department', 'window', 'plan', 'production']) &&
        exact(body.window, ['start', 'end']) && exact(body.plan, [...outputSource, 'targetUnits']) &&
        exact(body.production, [...outputSource, 'acceptedUnits']) &&
        exact(body.plan.window, ['start', 'end']) && exact(body.production.window, ['start', 'end'])
      : exact(body, ['siteId', 'orderId', 'department', 'bom', 'inventory']) &&
        exact(body.bom, [...materialSource, 'effectiveStart', 'effectiveEnd', 'components']) &&
        exact(body.inventory, [...materialSource, 'bomRevision', 'bomDigest', 'balances']) &&
        rows(body.bom.components, [...component, 'requiredMilliunits']) && rows(body.inventory.balances, [...component, 'allocatableMilliunits']);
    if (!valid || [...new URL(String(req.url), 'http://wfm.invalid').searchParams.keys()].some(key => !['scope', 'branch'].includes(key))) {
      return writeJson(res, 400, { error: 'A declared factory scenario with exact fields is required.', executionPermitted: false });
    }
    const source = authority.readContext(c, branchFor(req));
    authority.assertDepartmentSite(source, body.department, body.siteId);
    // These two inherited assessors require exact UTC seconds. Floor only the
    // server-owned as-of clock; never transform caller record timestamps.
    const asOf = nowIso().replace(/\.\d{3}Z$/, 'Z');
    const result = kind === 'output'
      ? assessProductionOutputGap({ tenantId: c.tenant, siteId: body.siteId, lineId: body.lineId, productId: body.productId,
          orderId: body.orderId, window: body.window, asOf, plan: body.plan, production: body.production })
      : assessOrderMaterialAvailability({ tenantId: c.tenant, siteId: body.siteId, orderId: body.orderId, asOf, bom: body.bom, inventory: body.inventory });
    if (kind === 'material' && result.bom.digest === result.inventory.digest) throw Error('BOM and inventory must declare distinct snapshot digests.');
    const scenario = {
      contractVersion: kind === 'output' ? 'DECLARED_PRODUCTION_OUTPUT_GAP_SCENARIO_V1' : 'DECLARED_ORDER_MATERIAL_AVAILABILITY_SCENARIO_V1',
      scenarioOnly: true, persisted: false,
      sourceBasis: kind === 'output' ? 'CALLER_DECLARED_ERP_MES_RECORDS' : 'CALLER_DECLARED_BOM_STOCK_RECORDS',
      asOf, ...(kind === 'output' ? { periodPolicyMaxDays: 31 } : { freshnessPolicyMinutes: 15 }), result,
      sourceAuthenticated: false, lineOrderAuthority: false, causeVerified: false, costVerified: false,
      scheduleAuthority: false, executionAuthority: false, authority: 'NO_EXECUTION'
    };
    return save ? saveFactoryAssessment(req, res, c, body, kind, scenario) : writeJson(res, 200, scenario);
  }

  function canReadReconciliation(source, reconciliation) {
    try {
      if(reconciliation.tenant!==source.actor.tenant)return false;
      const row=planById.get(source.actor.tenant,reconciliation.planId);
      if(!row||!authority.assertPlan(source,JSON.parse(row.plan_json)))return false;
      for(const id of workerReferences(reconciliation))authority.worker(source,id);
      return true;
    } catch { return false; }
  }
  function canReadEvent(context,event) {
    try {
      const source=authority.readContext(context),payload=event?.payload;
      let expected;
      if(event.topic==='scheduling.shadow.updated'){
        const row=planById.get(source.actor.tenant,payload?.planId);if(!row)return false;
        const plan=JSON.parse(row.plan_json);authority.assertPlan(source,plan);
        expected={planId:plan.planId,coveragePct:plan.quality?.coveragePct??null,executionPermitted:false};
      }else if(event.topic==='scheduling.repair.shadow.updated'){
        const row=repairById.get(source.actor.tenant,payload?.repairId);if(!row)return false;
        const repair=JSON.parse(row.repair_json),prior=planById.get(source.actor.tenant,repair.priorPlanId);if(!prior)return false;
        authority.assertPlan(source,JSON.parse(prior.plan_json));authority.assertPlan(source,repair.repairedPlan);
        for(const id of workerReferences(repair))authority.worker(source,id);
        expected={repairId:repair.repairId,priorPlanId:repair.priorPlanId,changeCount:repair.changeCount,executionPermitted:false};
      }else if(event.topic==='scheduling.reconciliation.updated'){
        const row=reconciliationById.get(source.actor.tenant,payload?.reconciliationId);if(!row)return false;
        const reconciliation=JSON.parse(row.reconciliation_json);if(!canReadReconciliation(source,reconciliation))return false;
        expected={reconciliationId:reconciliation.reconciliationId,planId:reconciliation.planId,ready:reconciliation.ready,payrollAuthority:false};
      }else return false;
      const keys=Object.keys(expected);return payload&&Object.keys(payload).length===keys.length&&keys.every(key=>payload[key]===expected[key]);
    } catch { return false; }
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
        const plans = recentPlans(c.tenant).filter(plan=>{try{return authority.assertPlan(c.source,plan);}catch{return false;}});
        return writeJson(res, 200, authority.output(c.source, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, plans }));
      }
      if (req.method === 'GET' && path === PREFIX + '/reconciliations') {
        const reconciliations = listReconciliations.all(c.tenant, 20).map(r => JSON.parse(r.reconciliation_json)).filter(r=>canReadReconciliation(c.source,r));
        return writeJson(res, 200, authority.output(c.source, { contractVersion: CONTRACT_VERSION, tenant: c.tenant, reconciliations }));
      }
      if (req.method === 'POST' && path === PREFIX + '/forecast/what-if') {
        const b = await readJson(req);
        const current = requireCurrentManager(req, res, c);
        if (!current) return true;
        const forecast = forecastDemand(b.input || {});
        const labour = b.capacity ? toHeadcountForecast({ forecast, ...b.capacity }) : null;
        const source=authority.readContext(current,branchFor(req,b));
        for(const id of workerReferences(b))authority.worker(source,id);
        return writeJson(res, 200, authority.output(source, { tenant: current.tenant, forecast, labour, scenarioOnly: true, authority: 'NO_EXECUTION' }));
      }
      if (req.method === 'POST' && path === PREFIX + '/what-if') return await managerWhatIf(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/open-shift/evaluate') return await managerOpenShift(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/swap/evaluate') return await managerSwap(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/order-start-variance/scenario') return await managerOrderStartScenario(req, res, c);
      if (req.method === 'POST' && path === PREFIX + '/production-output-gap/scenario') return await managerFactoryScenario(req, res, c, 'output');
      if (req.method === 'POST' && path === PREFIX + '/order-material-availability/scenario') return await managerFactoryScenario(req, res, c, 'material');
      if (req.method === 'POST' && path === PREFIX + '/production-output-gap/assessments') return await managerFactoryScenario(req, res, c, 'output', true);
      if (req.method === 'POST' && path === PREFIX + '/order-material-availability/assessments') return await managerFactoryScenario(req, res, c, 'material', true);
      const receiptMatch = /^\/api\/operations\/scheduling\/factory-assessments\/([a-f0-9]{64})$/.exec(path);
      if (req.method === 'GET' && receiptMatch) return readFactoryAssessment(req, res, c, receiptMatch[1]);
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
    canReadEvent,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = { createSchedulingIntelligenceService, PREFIX, INTERNAL_HEADER };
