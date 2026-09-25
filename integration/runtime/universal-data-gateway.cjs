'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/integrations/autonomous/universal';
const INTERNAL_HEADER = 'x-wfm-integration-internal';

const ROUTES = Object.freeze({
  NATIVE_API: {
    key: 'NATIVE_API',
    name: 'Native API / webhook',
    automationLevel: 'AUTONOMOUS',
    freshness: ['REAL_TIME', 'MINUTES', 'HOURLY', 'DAILY'],
    customerEffort: 'LOW',
    description: 'Use the source system API and webhooks through the existing autonomous integration hub.',
    proofRequirements: ['authorization', 'schema-reconciliation', 'permissions', 'deletion-propagation', 'retry-replay']
  },
  CUSTOMER_EDGE_BRIDGE: {
    key: 'CUSTOMER_EDGE_BRIDGE',
    name: 'VECTOR Edge Bridge',
    automationLevel: 'AUTONOMOUS',
    freshness: ['MINUTES', 'HOURLY', 'DAILY'],
    customerEffort: 'LOW',
    description: 'Run a signed, read-only connector inside the customer network and send only approved canonical data outbound.',
    proofRequirements: ['signed-runtime', 'read-only-source-access', 'outbound-policy', 'schema-reconciliation', 'permissions', 'deletion-propagation', 'reconnect-replay']
  },
  AUTOMATED_FILE_EXCHANGE: {
    key: 'AUTOMATED_FILE_EXCHANGE',
    name: 'Automated file / SFTP exchange',
    automationLevel: 'AUTONOMOUS_AFTER_SETUP',
    freshness: ['HOURLY', 'DAILY'],
    customerEffort: 'LOW',
    description: 'Ingest scheduled exports through SFTP or an approved object-storage drop.',
    proofRequirements: ['transfer-authentication', 'completion-marker', 'malware-scan', 'schema-reconciliation', 'idempotency', 'deletion-semantics', 'checksum']
  },
  SECURE_UPLOAD: {
    key: 'SECURE_UPLOAD',
    name: 'Secure assisted upload',
    automationLevel: 'ASSISTED',
    freshness: ['DAILY', 'WEEKLY', 'MANUAL'],
    customerEffort: 'MEDIUM',
    description: 'Accept approved exports through a secure upload boundary, then automate parsing, mapping and reconciliation.',
    proofRequirements: ['uploader-authorization', 'malware-scan', 'schema-reconciliation', 'idempotency', 'checksum']
  },
  AIR_GAPPED_EDGE: {
    key: 'AIR_GAPPED_EDGE',
    name: 'Air-gapped / isolated VECTOR Edge',
    automationLevel: 'LOCAL_AUTONOMOUS',
    freshness: ['HOURLY', 'DAILY', 'MANUAL'],
    customerEffort: 'MEDIUM',
    description: 'Run the ingestion and canonicalisation plane in the customer-controlled environment with no required internet egress.',
    proofRequirements: ['offline-package-integrity', 'local-authentication', 'read-only-source-access', 'schema-reconciliation', 'local-audit', 'backup-restore', 'signed-export-import']
  },
  CONTROLLED_READ_ONLY_AUTOMATION: {
    key: 'CONTROLLED_READ_ONLY_AUTOMATION',
    name: 'Controlled read-only desktop/browser automation',
    automationLevel: 'GUARDED',
    freshness: ['HOURLY', 'DAILY'],
    customerEffort: 'MEDIUM',
    description: 'Use approved read-only automation only when no safer machine interface or export route exists.',
    proofRequirements: ['explicit-customer-approval', 'credential-vaulting', 'read-only-boundary', 'selector-contract', 'rate-limit', 'replay-protection', 'audit-log']
  },
  VECTOR_NATIVE: {
    key: 'VECTOR_NATIVE',
    name: 'VECTOR-native system of record',
    automationLevel: 'AUTONOMOUS',
    freshness: ['REAL_TIME'],
    customerEffort: 'LOW',
    description: 'When no source system exists, VECTOR becomes the authoritative operational source instead of requiring another product first.',
    proofRequirements: ['tenant-isolation', 'role-authorisation', 'canonical-data-validation', 'audit-log', 'backup-restore', 'future-exportability']
  },
  VECTOR_GAP_CAPTURE: {
    key: 'VECTOR_GAP_CAPTURE',
    name: 'VECTOR minimum-data gap capture',
    automationLevel: 'ASSISTED_MINIMUM',
    freshness: ['MANUAL'],
    customerEffort: 'MINIMUM_NECESSARY',
    description: 'When essential source data is inaccessible, capture only the minimum missing facts in VECTOR and keep inaccessible history clearly marked as unavailable.',
    proofRequirements: ['missing-data-register', 'minimum-input-validation', 'tenant-isolation', 'role-authorisation', 'audit-log']
  }
});

const FRESHNESS = new Set(['REAL_TIME', 'MINUTES', 'HOURLY', 'DAILY', 'WEEKLY', 'MANUAL']);

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function compact(value, max = 200) { return String(value ?? '').slice(0, max); }
function safeJsonParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function requestPath(req) { return String(req?.url || '/').split('?')[0] || '/'; }

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

async function readJson(req, maxBytes) {
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function bool(value, fallback = false) { return value === undefined ? fallback : value === true; }

function normaliseConstraints(input = {}) {
  const freshness = compact(input.freshness || 'DAILY', 20).toUpperCase();
  return {
    existingSystem: input.existingSystem !== false,
    apiAvailable: bool(input.apiAvailable),
    apiApproved: bool(input.apiApproved),
    webhookAvailable: bool(input.webhookAvailable),
    canInstallBridge: bool(input.canInstallBridge),
    customerManagedCompute: bool(input.customerManagedCompute),
    outboundHttpsAllowed: bool(input.outboundHttpsAllowed, true),
    dataMayLeaveNetwork: bool(input.dataMayLeaveNetwork, true),
    canAutomateExport: bool(input.canAutomateExport),
    canUseSftp: bool(input.canUseSftp),
    canUseObjectStorage: bool(input.canUseObjectStorage),
    manualExportAvailable: bool(input.manualExportAvailable),
    manualUploadAllowed: bool(input.manualUploadAllowed, true),
    airGapped: bool(input.airGapped),
    browserAutomationApproved: bool(input.browserAutomationApproved),
    sourceHasStableIds: bool(input.sourceHasStableIds, true),
    sourceHasPermissions: bool(input.sourceHasPermissions, true),
    sourceHasDeleteSignal: bool(input.sourceHasDeleteSignal, true),
    freshness: FRESHNESS.has(freshness) ? freshness : 'DAILY',
    essentialDataAccessible: input.essentialDataAccessible !== false,
    notes: compact(input.notes || '', 1000)
  };
}

function routePublic(routeKey) {
  const route = ROUTES[routeKey];
  return route ? {
    key: route.key,
    name: route.name,
    automationLevel: route.automationLevel,
    freshness: route.freshness,
    customerEffort: route.customerEffort,
    description: route.description,
    proofRequirements: [...route.proofRequirements]
  } : null;
}

function routeIsFeasible(routeKey, c) {
  switch (routeKey) {
    case 'VECTOR_NATIVE': return !c.existingSystem;
    case 'AIR_GAPPED_EDGE': return c.existingSystem && (c.airGapped || (!c.outboundHttpsAllowed && c.customerManagedCompute));
    case 'NATIVE_API': return c.existingSystem && c.apiAvailable && c.apiApproved && c.dataMayLeaveNetwork && !c.airGapped;
    case 'CUSTOMER_EDGE_BRIDGE': return c.existingSystem && c.canInstallBridge && c.customerManagedCompute && c.outboundHttpsAllowed && !c.airGapped;
    case 'AUTOMATED_FILE_EXCHANGE': return c.existingSystem && c.canAutomateExport && (c.canUseSftp || c.canUseObjectStorage);
    case 'SECURE_UPLOAD': return c.existingSystem && c.manualUploadAllowed && c.manualExportAvailable;
    case 'CONTROLLED_READ_ONLY_AUTOMATION': return c.existingSystem && c.browserAutomationApproved;
    case 'VECTOR_GAP_CAPTURE': return true;
    default: return false;
  }
}

function canonicalContract() {
  return {
    version: '1.0',
    required: ['entity', 'sourceSystem', 'sourceId', 'observedAt', 'payload'],
    stableIdentity: 'sourceSystem + sourceId',
    changeDetection: 'contentHash',
    deletion: 'deleted=true tombstone',
    permissions: 'permissions metadata is preserved through retrieval and operational use',
    traceability: ['sourceUpdatedAt', 'observedAt', 'contentHash', 'sourceVersion'],
    rule: 'VECTOR never invents inaccessible source facts; missing required data remains explicitly unresolved.'
  };
}

function selectRoute(input = {}) {
  const c = normaliseConstraints(input);
  let routeKey;
  let reason;

  if (!c.existingSystem) {
    routeKey = 'VECTOR_NATIVE';
    reason = 'No source system exists, so VECTOR should be authoritative rather than forcing the customer to buy another system.';
  } else if (c.airGapped || (!c.outboundHttpsAllowed && c.customerManagedCompute && !c.dataMayLeaveNetwork)) {
    routeKey = 'AIR_GAPPED_EDGE';
    reason = 'The customer requires a local or isolated data plane, so integration work must stay inside their controlled environment.';
  } else if (c.apiAvailable && c.apiApproved && c.dataMayLeaveNetwork) {
    routeKey = 'NATIVE_API';
    reason = 'An approved machine interface is available, so the lowest-friction autonomous path is the existing native integration hub.';
  } else if (c.canInstallBridge && c.customerManagedCompute && c.outboundHttpsAllowed) {
    routeKey = 'CUSTOMER_EDGE_BRIDGE';
    reason = 'The source is not safely reachable from VECTOR directly, but a customer-side read-only bridge can canonicalise data locally.';
  } else if (c.canAutomateExport && (c.canUseSftp || c.canUseObjectStorage)) {
    routeKey = 'AUTOMATED_FILE_EXCHANGE';
    reason = 'The source can export automatically even though a direct API path is unavailable.';
  } else if (c.manualExportAvailable && c.manualUploadAllowed) {
    routeKey = 'SECURE_UPLOAD';
    reason = 'The source can provide approved exports, so VECTOR can automate everything after the secure upload boundary.';
  } else if (c.browserAutomationApproved) {
    routeKey = 'CONTROLLED_READ_ONLY_AUTOMATION';
    reason = 'No safer interface exists and the customer has explicitly approved guarded read-only automation.';
  } else {
    routeKey = 'VECTOR_GAP_CAPTURE';
    reason = 'Essential data cannot currently be read or exported, so VECTOR must capture only the minimum missing operational facts and make the data limitation visible.';
  }

  const warnings = [];
  const limitations = [];
  if (!c.sourceHasStableIds && c.existingSystem) warnings.push('Source identifiers are not stable; establish deterministic identity reconciliation before live import.');
  if (!c.sourceHasPermissions && c.existingSystem) warnings.push('Source permissions are unavailable; default imported data to the most restrictive authorised access.');
  if (!c.sourceHasDeleteSignal && c.existingSystem) warnings.push('The source does not expose deletions; use full-snapshot reconciliation or explicit tombstones.');
  if (c.freshness === 'REAL_TIME' && !['NATIVE_API', 'VECTOR_NATIVE'].includes(routeKey)) warnings.push('Requested real-time freshness is not supported by the selected boundary; change the boundary or accept the fastest safe cadence.');
  if (routeKey === 'VECTOR_GAP_CAPTURE') {
    limitations.push('VECTOR cannot reconstruct inaccessible historical facts.');
    limitations.push('Capabilities that require missing source facts stay fail-closed until those facts are provided or created natively in VECTOR.');
  }
  if (routeKey === 'CONTROLLED_READ_ONLY_AUTOMATION') limitations.push('Automation is read-only, explicitly approved, auditable and revocable; it is never the default route.');

  return {
    route: routePublic(routeKey),
    reason,
    constraints: c,
    fallbackChain: Object.keys(ROUTES).filter(key => key !== routeKey && routeIsFeasible(key, c)).map(routePublic),
    canonicalContract: canonicalContract(),
    safeguards: [
      'Tenant isolation remains mandatory.',
      'No plaintext source credentials are accepted by the planning API.',
      'All transports preserve source identity, permissions, deletion semantics and reconciliation evidence.',
      'Transport failure must not silently mutate payroll, compliance or workforce records.',
      'A route is not PROVEN until every route-specific proof requirement passes.'
    ],
    warnings,
    limitations,
    readiness: {
      canProceed: routeKey !== 'VECTOR_GAP_CAPTURE' || c.essentialDataAccessible || !c.existingSystem,
      readyForOperationalDataAfterProof: routeKey !== 'VECTOR_GAP_CAPTURE' || c.essentialDataAccessible,
      requiresCustomerAction: ['SECURE_UPLOAD', 'CONTROLLED_READ_ONLY_AUTOMATION', 'VECTOR_GAP_CAPTURE'].includes(routeKey)
    }
  };
}

function validateCanonicalEnvelope(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['record must be an object'], normalized: null };
  }

  const entity = compact(record.entity, 80);
  const sourceSystem = compact(record.sourceSystem, 120);
  const sourceId = compact(record.sourceId, 200);
  const observedAt = compact(record.observedAt, 60);
  const deleted = record.deleted === true;
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : null;

  if (!entity) errors.push('entity is required');
  if (!sourceSystem) errors.push('sourceSystem is required');
  if (!sourceId) errors.push('sourceId is required');
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push('observedAt must be an ISO timestamp');
  if (!deleted && !payload) errors.push('payload object is required when deleted=false');

  const normalized = errors.length ? null : {
    entity,
    sourceSystem,
    sourceId,
    sourceUpdatedAt: record.sourceUpdatedAt ? compact(record.sourceUpdatedAt, 60) : null,
    observedAt: new Date(observedAt).toISOString(),
    deleted,
    sourceVersion: record.sourceVersion ? compact(record.sourceVersion, 120) : null,
    permissions: record.permissions && typeof record.permissions === 'object' ? record.permissions : {},
    payload: deleted ? {} : payload
  };

  if (normalized) {
    normalized.contentHash = sha256(JSON.stringify({
      entity: normalized.entity,
      sourceSystem: normalized.sourceSystem,
      sourceId: normalized.sourceId,
      deleted: normalized.deleted,
      permissions: normalized.permissions,
      payload: normalized.payload
    }));
  }
  return { valid: errors.length === 0, errors, normalized };
}

function createUniversalDataGateway(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_INTEGRATION_INTERNAL_TOKEN || '';
  const maxBodyBytes = Number(options.maxBodyBytes || 256 * 1024);
  if (!dbPath) throw new Error('Universal data gateway requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS universal_ingestion_plans(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, version INTEGER NOT NULL, route_key TEXT NOT NULL,' +
      'state TEXT NOT NULL, constraints_json TEXT NOT NULL, plan_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,version));' +
    'CREATE TABLE IF NOT EXISTS universal_ingestion_evidence(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, plan_id TEXT NOT NULL,' +
      'kind TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, detail_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS universal_ingestion_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT, plan_id TEXT, event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_universal_event_update BEFORE UPDATE ON universal_ingestion_events ' +
      "BEGIN SELECT RAISE(ABORT,'Universal ingestion events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_universal_event_delete BEFORE DELETE ON universal_ingestion_events ' +
      "BEGIN SELECT RAISE(ABORT,'Universal ingestion events are append only.'); END;"
  );

  const authStmt = db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const latestPlan = db.prepare('SELECT * FROM universal_ingestion_plans WHERE tenant=? ORDER BY version DESC LIMIT 1');
  const planById = db.prepare('SELECT * FROM universal_ingestion_plans WHERE id=? AND tenant=?');
  const maxVersion = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM universal_ingestion_plans WHERE tenant=?');
  const insertPlan = db.prepare('INSERT INTO universal_ingestion_plans(id,tenant,version,route_key,state,constraints_json,plan_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const updatePlanState = db.prepare('UPDATE universal_ingestion_plans SET state=?,updated_at=? WHERE id=? AND tenant=?');
  const insertEvidence = db.prepare('INSERT INTO universal_ingestion_evidence(tenant,plan_id,kind,status,confidence,detail_json,created_at) VALUES(?,?,?,?,?,?,?)');
  const evidenceForPlan = db.prepare('SELECT * FROM universal_ingestion_evidence WHERE tenant=? AND plan_id=? ORDER BY id ASC');
  const eventStmt = db.prepare('INSERT INTO universal_ingestion_events(tenant,plan_id,event,detail_json,created_at) VALUES(?,?,?,?,?)');

  function authContext(req) {
    const token = cookieSessionToken(req);
    if (!token) return null;
    return authStmt.get(sha256(token), Date.now()) || null;
  }

  function requireManager(req, res) {
    const ctx = authContext(req);
    if (!ctx) { writeJson(res, 401, { error: 'Sign in is required.' }); return null; }
    if (String(ctx.role).toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Universal integration planning requires an authorised administrator.' });
      return null;
    }
    return ctx;
  }

  function requireInternal(req, res) {
    if (!internalToken) { writeJson(res, 503, { error: 'Integration worker credential is not configured.' }); return false; }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted integration worker authorization required.' });
      return false;
    }
    return true;
  }

  function record(tenant, planId, event, detail = {}) {
    try { eventStmt.run(tenant || null, planId || null, event, JSON.stringify(detail), nowIso()); } catch {}
  }

  function proofSummary(row) {
    const plan = safeJsonParse(row.plan_json, {});
    const required = new Set(plan?.route?.proofRequirements || []);
    const latest = new Map();
    for (const item of evidenceForPlan.all(row.tenant, row.id)) latest.set(item.kind, item);
    const missing = [];
    const failed = [];
    const passed = [];
    for (const key of required) {
      const item = latest.get(key);
      if (!item) missing.push(key);
      else if (item.status === 'PASS' && Number(item.confidence) >= 0.99) passed.push(key);
      else failed.push(key);
    }
    return { required: [...required], passed, missing, failed, proven: required.size > 0 && !missing.length && !failed.length };
  }

  function publicPlan(row) {
    if (!row) return null;
    const plan = safeJsonParse(row.plan_json, {});
    return {
      id: row.id,
      version: row.version,
      state: row.state,
      routeKey: row.route_key,
      route: plan.route,
      reason: plan.reason,
      fallbackChain: plan.fallbackChain || [],
      canonicalContract: plan.canonicalContract,
      safeguards: plan.safeguards || [],
      warnings: plan.warnings || [],
      limitations: plan.limitations || [],
      readiness: { ...(plan.readiness || {}), proof: proofSummary(row) },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function statusForTenant(tenant) {
    const row = latestPlan.get(tenant);
    return row ? publicPlan(row) : null;
  }

  async function handlePlan(ctx, req, res) {
    const plan = selectRoute(await readJson(req, maxBodyBytes));
    const version = Number(maxVersion.get(ctx.tenant)?.version || 0) + 1;
    const id = randomUUID();
    const ts = nowIso();
    insertPlan.run(id, ctx.tenant, version, plan.route.key, 'PLANNED', JSON.stringify(plan.constraints), JSON.stringify(plan), ts, ts);
    record(ctx.tenant, id, 'universal-plan-created', { version, routeKey: plan.route.key, canProceed: plan.readiness.canProceed });
    return writeJson(res, 201, { plan: publicPlan(planById.get(id, ctx.tenant)) });
  }

  async function handleActivate(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const row = planById.get(compact(body.planId, 80), ctx.tenant);
    if (!row) return writeJson(res, 404, { error: 'Universal integration plan not found.' });
    const current = latestPlan.get(ctx.tenant);
    if (!current || current.id !== row.id) return writeJson(res, 409, { error: 'Only the current integration plan can be activated.' });
    if (row.route_key === 'CONTROLLED_READ_ONLY_AUTOMATION' && body.explicitCustomerApproval !== true) return writeJson(res, 409, { error: 'Controlled read-only automation requires explicit customer approval.' });
    if (row.route_key === 'VECTOR_GAP_CAPTURE' && body.acknowledgeDataLimit !== true) return writeJson(res, 409, { error: 'Gap capture requires acknowledgement that inaccessible facts cannot be reconstructed.' });
    updatePlanState.run('ACTIVATED', nowIso(), row.id, ctx.tenant);
    record(ctx.tenant, row.id, 'universal-plan-activated', { routeKey: row.route_key });
    return writeJson(res, 200, { plan: publicPlan(planById.get(row.id, ctx.tenant)) });
  }

  async function handleEvidence(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const row = db.prepare('SELECT * FROM universal_ingestion_plans WHERE id=?').get(compact(body.planId, 80));
    if (!row) return writeJson(res, 404, { error: 'Universal integration plan not found.' });

    const required = new Set(safeJsonParse(row.plan_json, {})?.route?.proofRequirements || []);
    const kind = compact(body.kind, 120);
    const status = compact(body.status, 20).toUpperCase();
    const confidence = Number(body.confidence);

    if (!required.has(kind)) return writeJson(res, 400, { error: 'Evidence kind is not required by this route.' });
    if (!['PASS', 'WARN', 'FAIL'].includes(status)) return writeJson(res, 400, { error: 'status must be PASS, WARN or FAIL.' });
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return writeJson(res, 400, { error: 'confidence must be between 0 and 1.' });

    insertEvidence.run(row.tenant, row.id, kind, status, confidence, JSON.stringify(body.detail || {}), nowIso());
    const summary = proofSummary(row);
    if (summary.proven) {
      updatePlanState.run('PROVEN', nowIso(), row.id, row.tenant);
      record(row.tenant, row.id, 'universal-route-proven', { routeKey: row.route_key });
    } else {
      record(row.tenant, row.id, 'universal-evidence-recorded', { kind, status, confidence });
    }

    const updated = db.prepare('SELECT * FROM universal_ingestion_plans WHERE id=?').get(row.id);
    return writeJson(res, 200, { plan: publicPlan(updated) });
  }

  async function handleValidateEnvelope(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length > 5000) return writeJson(res, 400, { error: 'Envelope validation batch exceeds 5000 records.' });
    const results = records.map(validateCanonicalEnvelope);
    const valid = results.filter(x => x.valid).length;
    return writeJson(res, 200, { received: records.length, valid, invalid: records.length - valid, results });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;

    try {
      if (req.method === 'POST' && path === PREFIX + '/evidence') {
        if (!requireInternal(req, res)) return true;
        return await handleEvidence(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/validate-envelope') {
        if (!requireInternal(req, res)) return true;
        return await handleValidateEnvelope(req, res);
      }

      const ctx = requireManager(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/catalog') return writeJson(res, 200, { routes: Object.keys(ROUTES).map(routePublic), canonicalContract: canonicalContract() });
      if (req.method === 'GET' && path === PREFIX + '/status') return writeJson(res, 200, { plan: statusForTenant(ctx.tenant) });
      if (req.method === 'POST' && path === PREFIX + '/plan') return await handlePlan(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/activate') return await handleActivate(ctx, req, res);
      return writeJson(res, 404, { error: 'Universal data gateway endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), { error: error?.statusCode ? error.message : 'Universal data gateway failed safely.' });
    }
  }

  return {
    handleRequest,
    statusForTenant,
    publicCatalog() { return Object.keys(ROUTES).map(routePublic); },
    close() { try { db.close(); } catch {} }
  };
}

module.exports = {
  createUniversalDataGateway,
  ROUTES,
  normaliseConstraints,
  selectRoute,
  canonicalContract,
  validateCanonicalEnvelope
};
