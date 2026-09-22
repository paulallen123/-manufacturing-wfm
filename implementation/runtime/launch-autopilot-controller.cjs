'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const STAGES = Object.freeze([
  'DISCOVER',
  'MODEL',
  'PROVISION',
  'CONNECT',
  'CONFIGURE',
  'SIMULATE',
  'RECONCILE',
  'TRAIN',
  'VALIDATE',
  'READY'
]);

const GATE_DEFINITIONS = Object.freeze([
  { key: 'scope', stage: 'DISCOVER', source: 'implementation-scope' },
  { key: 'implementation-twin', stage: 'MODEL', source: 'implementation-digital-twin' },
  { key: 'tenant-environment', stage: 'PROVISION', source: 'tenant-environment-provisioner' },
  { key: 'identity-access', stage: 'PROVISION', source: 'identity-runtime' },
  { key: 'source-systems', stage: 'CONNECT', source: 'autonomous-integration-hub' },
  { key: 'mapping', stage: 'CONNECT', source: 'integration-fabric' },
  { key: 'configuration', stage: 'CONFIGURE', source: 'configuration-inference-engine' },
  { key: 'scenario-validation', stage: 'SIMULATE', source: 'proof-runtime' },
  { key: 'historical-replay', stage: 'RECONCILE', source: 'implementation-runtime' },
  { key: 'live-data-import', stage: 'RECONCILE', source: 'integration-runtime' },
  { key: 'role-learning', stage: 'TRAIN', source: 'adaptive-learning-engine' },
  { key: 'security-controls', stage: 'VALIDATE', source: 'security-runtime' },
  { key: 'resilience', stage: 'VALIDATE', source: 'recovery-runtime' },
  { key: 'existing-readiness', stage: 'VALIDATE', source: 'one-day-enterprise-engine' }
]);

const GATE_BY_KEY = new Map(GATE_DEFINITIONS.map(g => [g.key, g]));

const INTEGRATION_ROUTES = Object.freeze([
  'NATIVE_API',
  'MIDDLEWARE',
  'EVENT',
  'DATABASE',
  'SFTP',
  'FILE',
  'DOCUMENT',
  'NATIVE_CAPTURE'
]);

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function iso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normaliseReceipt(input = {}) {
  const gate = text(input.gate, 80);
  if (!GATE_BY_KEY.has(gate)) throw new Error('Unknown implementation proof gate: ' + gate);
  const status = text(input.status, 24).toUpperCase();
  if (!['PASS', 'DEGRADED', 'FAIL', 'UNKNOWN'].includes(status)) throw new Error('Unsupported implementation proof status.');
  const source = text(input.source, 120);
  const evidenceRef = text(input.evidenceRef, 500);
  const observedAt = iso(input.observedAt);
  if (!source || !evidenceRef || !observedAt) throw new Error('Proof receipt requires source, evidenceRef and observedAt.');
  if (status === 'PASS' && input.verified !== true) throw new Error('PASS requires verified=true.');
  return {
    gate,
    status,
    source,
    evidenceRef,
    observedAt,
    verified: input.verified === true,
    twinRevision: input.twinRevision == null ? null : text(input.twinRevision, 180),
    detail: input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail)
      ? JSON.parse(JSON.stringify(input.detail))
      : {}
  };
}

function deriveReadiness(receipts = []) {
  const latest = new Map();
  for (const receipt of receipts) latest.set(receipt.gate, receipt);
  const gates = GATE_DEFINITIONS.map(def => ({
    ...def,
    status: latest.get(def.key)?.status || 'UNKNOWN',
    evidenceRef: latest.get(def.key)?.evidenceRef || null,
    observedAt: latest.get(def.key)?.observedAt || null
  }));

  let stage = 'DISCOVER';
  for (const candidate of STAGES) {
    if (candidate === 'READY') break;
    const required = gates.filter(g => STAGES.indexOf(g.stage) <= STAGES.indexOf(candidate));
    if (required.length && required.every(g => g.status === 'PASS')) stage = candidate;
    else break;
  }
  const allPass = gates.every(g => g.status === 'PASS');
  return {
    stage: allPass ? 'READY' : stage,
    ready: allPass,
    gates,
    blocking: gates.filter(g => g.status !== 'PASS').map(g => ({ gate: g.key, status: g.status, stage: g.stage }))
  };
}

function selectIntegrationRoute(candidates = []) {
  const byRoute = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const route = text(candidate.route, 40).toUpperCase();
    if (!INTEGRATION_ROUTES.includes(route)) continue;
    byRoute.set(route, candidate);
  }
  for (const route of INTEGRATION_ROUTES) {
    const c = byRoute.get(route);
    if (!c) continue;
    if (c.available !== true) continue;
    if (c.authorised !== true) continue;
    if (c.provenanceBound !== true) continue;
    if (c.reconcilable !== true) continue;
    if (c.authoritativeCoverage !== true) continue;
    return {
      route,
      source: text(c.source, 120),
      scope: Array.isArray(c.scope) ? c.scope.map(x => text(x, 120)).filter(Boolean) : [],
      fallback: route !== 'NATIVE_API'
    };
  }
  return null;
}

function gatesForImpact(impact = {}) {
  const affected = impact.affected || {};
  const keys = new Set();
  if ((affected.integrations || []).length) {
    keys.add('source-systems');
    keys.add('mapping');
    keys.add('live-data-import');
    keys.add('historical-replay');
  }
  if ((affected.configuration || []).length) {
    keys.add('configuration');
    keys.add('scenario-validation');
    keys.add('historical-replay');
  }
  if ((affected.training || []).length || (affected.roles || []).length) keys.add('role-learning');
  if ((affected.tests || []).length) keys.add('scenario-validation');
  if ((affected.readiness || []).length) keys.add('security-controls');
  return [...keys].sort();
}

function createLaunchAutopilotController(options = {}) {
  if (!options.db && !options.dbPath) throw new Error('Launch Autopilot requires db or dbPath.');
  const ownsDb = !options.db;
  const db = options.db || new DatabaseSync(options.dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS launch_autopilot_runs(' +
      'run_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS launch_autopilot_receipts(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,tenant TEXT NOT NULL,gate_key TEXT NOT NULL,' +
      'status TEXT NOT NULL,source TEXT NOT NULL,evidence_ref TEXT NOT NULL,observed_at TEXT NOT NULL,' +
      'verified INTEGER NOT NULL,twin_revision TEXT,detail_json TEXT NOT NULL,digest TEXT NOT NULL,created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS launch_autopilot_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,tenant TEXT NOT NULL,event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL,created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS launch_receipt_no_update BEFORE UPDATE ON launch_autopilot_receipts ' +
      "BEGIN SELECT RAISE(ABORT,'Launch Autopilot receipts are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS launch_receipt_no_delete BEFORE DELETE ON launch_autopilot_receipts ' +
      "BEGIN SELECT RAISE(ABORT,'Launch Autopilot receipts are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS launch_event_no_update BEFORE UPDATE ON launch_autopilot_events ' +
      "BEGIN SELECT RAISE(ABORT,'Launch Autopilot events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS launch_event_no_delete BEFORE DELETE ON launch_autopilot_events ' +
      "BEGIN SELECT RAISE(ABORT,'Launch Autopilot events are append only.'); END;"
  );

  const runQ = db.prepare('SELECT * FROM launch_autopilot_runs WHERE run_id=? AND tenant=?');
  const insertRun = db.prepare('INSERT INTO launch_autopilot_runs(run_id,tenant,state,created_at,updated_at) VALUES(?,?,?,?,?)');
  const updateRun = db.prepare('UPDATE launch_autopilot_runs SET state=?,updated_at=? WHERE run_id=? AND tenant=?');
  const insertReceipt = db.prepare('INSERT INTO launch_autopilot_receipts(run_id,tenant,gate_key,status,source,evidence_ref,observed_at,verified,twin_revision,detail_json,digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const latestReceipts = db.prepare(
    'SELECT r.* FROM launch_autopilot_receipts r JOIN (' +
      'SELECT gate_key,MAX(id) AS max_id FROM launch_autopilot_receipts WHERE run_id=? AND tenant=? GROUP BY gate_key' +
    ') x ON x.max_id=r.id ORDER BY r.gate_key'
  );
  const latestReceiptByGate = db.prepare('SELECT * FROM launch_autopilot_receipts WHERE run_id=? AND tenant=? AND gate_key=? ORDER BY id DESC LIMIT 1');
  const insertEvent = db.prepare('INSERT INTO launch_autopilot_events(run_id,tenant,event,detail_json,created_at) VALUES(?,?,?,?,?)');
  const eventsQ = db.prepare('SELECT event,detail_json,created_at FROM launch_autopilot_events WHERE run_id=? AND tenant=? ORDER BY id');

  function nowIso() { return new Date().toISOString(); }

  function ensureRun(tenant, runId) {
    tenant = text(tenant, 120);
    runId = text(runId, 180) || randomUUID();
    if (!tenant) throw new Error('tenant is required.');
    let row = runQ.get(runId, tenant);
    if (!row) {
      const ts = nowIso();
      insertRun.run(runId, tenant, 'DISCOVER', ts, ts);
      insertEvent.run(runId, tenant, 'RUN_CREATED', JSON.stringify({ state: 'DISCOVER' }), ts);
      row = runQ.get(runId, tenant);
    }
    return { tenant, runId, state: row.state };
  }

  function publicReceipt(row) {
    return {
      gate: row.gate_key,
      status: row.status,
      source: row.source,
      evidenceRef: row.evidence_ref,
      observedAt: row.observed_at,
      verified: Boolean(row.verified),
      twinRevision: row.twin_revision || null,
      detail: JSON.parse(row.detail_json),
      digest: row.digest
    };
  }

  function status(tenant, runId) {
    const run = runQ.get(text(runId, 180), text(tenant, 120));
    if (!run) return null;
    const receipts = latestReceipts.all(runId, tenant).map(publicReceipt);
    const readiness = deriveReadiness(receipts);
    return {
      tenant,
      runId,
      state: readiness.stage,
      ready: readiness.ready,
      gates: readiness.gates,
      blocking: readiness.blocking,
      activation: {
        eligible: readiness.ready,
        authority: readiness.ready ? 'EXTERNAL_PERMIT_REQUIRED' : 'NOT_ELIGIBLE',
        productionMutation: false
      },
      receipts
    };
  }

  function recordReceipt({ tenant, runId, receipt }) {
    const run = ensureRun(tenant, runId);
    const normalised = normaliseReceipt(receipt);
    const receiptDigest = digest({ tenant: run.tenant, runId: run.runId, ...normalised });
    const existing = latestReceiptByGate.get(run.runId, run.tenant, normalised.gate);
    if (existing && existing.digest === receiptDigest) return status(run.tenant, run.runId);
    const ts = nowIso();
    const before = status(run.tenant, run.runId);
    insertReceipt.run(
      run.runId, run.tenant, normalised.gate, normalised.status, normalised.source,
      normalised.evidenceRef, normalised.observedAt, normalised.verified ? 1 : 0,
      normalised.twinRevision, JSON.stringify(normalised.detail), receiptDigest, ts
    );
    const after = status(run.tenant, run.runId);
    updateRun.run(after.state, ts, run.runId, run.tenant);
    const event = before && STAGES.indexOf(after.state) < STAGES.indexOf(before.state)
      ? 'READINESS_REGRESSED'
      : after.ready && !before?.ready
        ? 'READINESS_PROVEN'
        : 'EVIDENCE_RECORDED';
    insertEvent.run(run.runId, run.tenant, event, JSON.stringify({
      gate: normalised.gate,
      status: normalised.status,
      fromStage: before?.state || null,
      toStage: after.state,
      receiptDigest
    }), ts);
    return after;
  }

  function invalidateForTwinImpact({ tenant, runId, impact, twinRevision, source = 'implementation-digital-twin' }) {
    const run = ensureRun(tenant, runId);
    const gates = gatesForImpact(impact);
    const observedAt = nowIso();
    for (const gate of gates) {
      recordReceipt({
        tenant: run.tenant,
        runId: run.runId,
        receipt: {
          gate,
          status: 'DEGRADED',
          source,
          evidenceRef: 'twin-impact:' + text(twinRevision || impact?.toRevision || 'unknown', 180) + ':' + gate,
          observedAt,
          verified: false,
          twinRevision: twinRevision || impact?.toRevision || null,
          detail: { reason: 'TWIN_CHANGE_REVALIDATION_REQUIRED', impactedBy: impact?.changed || [] }
        }
      });
    }
    insertEvent.run(run.runId, run.tenant, 'DELTA_REVALIDATION_OPENED', JSON.stringify({ gates, twinRevision: twinRevision || impact?.toRevision || null }), observedAt);
    return status(run.tenant, run.runId);
  }

  function events(tenant, runId) {
    return eventsQ.all(text(runId, 180), text(tenant, 120)).map(row => ({
      event: row.event,
      detail: JSON.parse(row.detail_json),
      createdAt: row.created_at
    }));
  }

  return {
    ensureRun,
    recordReceipt,
    status,
    invalidateForTwinImpact,
    events,
    close() { if (ownsDb) try { db.close(); } catch {} }
  };
}

module.exports = {
  STAGES,
  GATE_DEFINITIONS,
  INTEGRATION_ROUTES,
  deriveReadiness,
  selectIntegrationRoute,
  gatesForImpact,
  createLaunchAutopilotController,
  normaliseReceipt,
  digest
};
