'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createGustoCompanyConnector } = require('./gusto-company-connector.cjs');
const { serveGustoOAuthLanding } = require('./gusto-oauth-landing.cjs');

const PREFIX = '/api/integrations/autonomous';
const DISCOVERY_SOURCES = new Set(['ENTRA', 'OKTA', 'GOOGLE_WORKSPACE', 'USER', 'AGENT']);
const INTERNAL_HEADER = 'x-wfm-integration-internal';
const WORKER_PATHS = new Set([
  PREFIX + '/discovery-result',
  PREFIX + '/authorize-complete',
  PREFIX + '/sync-validate',
  PREFIX + '/health-report'
]);

const CATALOG = Object.freeze([
  { key: 'workday', name: 'Workday', category: 'hcm', aliases: ['workday'], authMethods: ['oauth2', 'service-account'], supports: ['people', 'organisation', 'absence', 'compensation'] },
  { key: 'sap-successfactors', name: 'SAP SuccessFactors', category: 'hcm', aliases: ['successfactors', 'sap successfactors'], authMethods: ['oauth2', 'service-account'], supports: ['people', 'organisation', 'absence'] },
  { key: 'sap-s4hana', name: 'SAP S/4HANA', category: 'erp', aliases: ['s 4hana', 's4hana', 'sap s4', 'sap erp'], authMethods: ['oauth2', 'service-account'], supports: ['finance', 'cost-centres', 'production', 'procurement'] },
  { key: 'netsuite', name: 'Oracle NetSuite', category: 'erp', aliases: ['netsuite', 'oracle netsuite'], authMethods: ['oauth2', 'service-account'], supports: ['finance', 'cost-centres', 'production', 'procurement'] },
  { key: 'oracle-fusion', name: 'Oracle Fusion Cloud', category: 'erp', aliases: ['oracle fusion', 'oracle cloud erp'], authMethods: ['oauth2', 'service-account'], supports: ['finance', 'people', 'procurement'] },
  { key: 'dynamics-365', name: 'Microsoft Dynamics 365', category: 'erp', aliases: ['dynamics 365', 'microsoft dynamics', 'business central'], authMethods: ['oauth2'], supports: ['finance', 'cost-centres', 'production', 'procurement'] },
  { key: 'sage', name: 'Sage', category: 'erp-payroll', aliases: ['sage payroll', 'sage hr', 'sage 50', 'sage 200', 'sage'], authMethods: ['oauth2', 'api-key'], supports: ['people', 'payroll', 'finance'] },
  { key: 'xero', name: 'Xero', category: 'accounting', aliases: ['xero'], authMethods: ['oauth2'], supports: ['finance', 'cost-centres'] },
  { key: 'quickbooks', name: 'QuickBooks', category: 'accounting', aliases: ['quickbooks', 'intuit quickbooks'], authMethods: ['oauth2'], supports: ['finance', 'cost-centres'] },
  { key: 'adp', name: 'ADP', category: 'payroll-hcm', aliases: ['adp workforce', 'adp'], authMethods: ['oauth2', 'service-account'], supports: ['people', 'payroll', 'absence'] },
  { key: 'gusto', name: 'Gusto', category: 'payroll-hcm', aliases: ['gusto'], authMethods: ['oauth2'], supports: ['people', 'organisation', 'payroll', 'time'] },
  { key: 'ukg', name: 'UKG', category: 'payroll-hcm', aliases: ['ukg pro', 'ukg ready', 'kronos', 'ultimate kronos', 'ukg'], authMethods: ['oauth2', 'service-account'], supports: ['people', 'payroll', 'absence', 'time'] },
  { key: 'dayforce', name: 'Dayforce', category: 'payroll-hcm', aliases: ['ceridian', 'dayforce'], authMethods: ['oauth2', 'service-account'], supports: ['people', 'payroll', 'absence', 'time'] },
  { key: 'personio', name: 'Personio', category: 'hcm', aliases: ['personio'], authMethods: ['oauth2', 'api-key'], supports: ['people', 'organisation', 'absence'] },
  { key: 'hibob', name: 'HiBob', category: 'hcm', aliases: ['hibob', 'bob hr'], authMethods: ['service-account'], supports: ['people', 'organisation', 'absence'] },
  { key: 'bamboohr', name: 'BambooHR', category: 'hcm', aliases: ['bamboohr', 'bamboo hr'], authMethods: ['api-key'], supports: ['people', 'organisation', 'absence'] },
  { key: 'mhr-itrent', name: 'MHR iTrent', category: 'payroll-hcm', aliases: ['itrent', 'mhr'], authMethods: ['service-account', 'sftp'], supports: ['people', 'payroll', 'absence'] },
  { key: 'zellis', name: 'Zellis', category: 'payroll-hcm', aliases: ['zellis'], authMethods: ['service-account', 'sftp'], supports: ['people', 'payroll'] },
  { key: 'sd-worx', name: 'SD Worx', category: 'payroll', aliases: ['sd worx'], authMethods: ['service-account', 'sftp'], supports: ['people', 'payroll'] },
  { key: 'iris-cascade', name: 'IRIS Cascade', category: 'payroll-hcm', aliases: ['iris cascade', 'cascade hr'], authMethods: ['service-account', 'sftp'], supports: ['people', 'payroll', 'absence'] }
]);

const CATALOG_BY_KEY = new Map(CATALOG.map(x => [x.key, x]));
const CANONICAL_FIELDS = Object.freeze({
  Person: [
    'employeeId', 'firstName', 'lastName', 'email', 'status', 'department',
    'location', 'managerId', 'jobTitle', 'startDate', 'endDate', 'payRate',
    'payCurrency', 'employmentType'
  ]
});

const FIELD_SYNONYMS = Object.freeze({
  employeeId: ['employeeid', 'employee_id', 'employeenumber', 'employee_number', 'workerid', 'worker_id', 'personid', 'person_id', 'staffid', 'staff_id', 'personnelnumber'],
  firstName: ['firstname', 'first_name', 'givenname', 'given_name', 'forename'],
  lastName: ['lastname', 'last_name', 'surname', 'familyname', 'family_name'],
  email: ['email', 'emailaddress', 'email_address', 'workemail', 'work_email'],
  status: ['status', 'employeestatus', 'employee_status', 'workerstatus', 'worker_status'],
  department: ['department', 'departmentname', 'department_name', 'costcentre', 'cost_center'],
  location: ['location', 'site', 'worklocation', 'work_location', 'worksite'],
  managerId: ['managerid', 'manager_id', 'supervisorid', 'supervisor_id', 'linemanagerid', 'line_manager_id'],
  jobTitle: ['jobtitle', 'job_title', 'positiontitle', 'position_title', 'role'],
  startDate: ['startdate', 'start_date', 'hiredate', 'hire_date', 'employmentstartdate'],
  endDate: ['enddate', 'end_date', 'terminationdate', 'termination_date', 'leavingdate'],
  payRate: ['payrate', 'pay_rate', 'hourlyrate', 'hourly_rate', 'salaryrate', 'salary_rate'],
  payCurrency: ['paycurrency', 'pay_currency', 'currency', 'currencycode', 'currency_code'],
  employmentType: ['employmenttype', 'employment_type', 'contracttype', 'contract_type', 'workertype']
});

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
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

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value, max = 180) {
  return String(value ?? '').slice(0, max);
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function arrayOfStrings(value, maxItems = 50, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(v => compact(v, maxLength)).filter(Boolean);
}

function semanticScopesFor(product) {
  const scopes = [];
  if (product.supports.includes('people')) scopes.push('people.read');
  if (product.supports.includes('organisation')) scopes.push('organisation.read');
  if (product.supports.includes('absence')) scopes.push('absence.read');
  if (product.supports.includes('time')) scopes.push('time.read');
  if (product.supports.includes('payroll')) scopes.push('payroll.read');
  if (product.supports.includes('finance')) scopes.push('finance.read');
  if (product.supports.includes('cost-centres')) scopes.push('cost-centres.read');
  if (product.supports.includes('production')) scopes.push('production.read');
  if (product.supports.includes('procurement')) scopes.push('procurement.read');
  return scopes;
}

function publicCatalog() {
  return CATALOG.map(product => ({
    key: product.key,
    name: product.name,
    category: product.category,
    authMethods: product.authMethods,
    capabilities: product.supports,
    minimumSemanticScopes: semanticScopesFor(product),
    adminConsentRequired: true
  }));
}

function detectProduct(app, source) {
  const explicit = compact(app?.productKey, 80);
  if (explicit && CATALOG_BY_KEY.has(explicit)) {
    return { product: CATALOG_BY_KEY.get(explicit), confidence: source === 'USER' ? 1 : 0.99, method: 'explicit' };
  }

  const text = normalize([
    app?.name, app?.displayName, app?.publisher, app?.homepageUrl,
    app?.loginUrl, app?.domain, app?.identifier
  ].filter(Boolean).join(' '));

  let best = null;
  for (const product of CATALOG) {
    for (const alias of product.aliases) {
      const normalizedAlias = normalize(alias);
      if (!normalizedAlias || !text.includes(normalizedAlias)) continue;
      const exact = text === normalizedAlias;
      const confidence = exact ? 0.98 : normalizedAlias.length >= 8 ? 0.94 : 0.9;
      if (!best || confidence > best.confidence) best = { product, confidence, method: 'fingerprint' };
    }
  }
  return best;
}

function candidateEvidence(app, source, method) {
  return {
    source,
    method,
    observedIdentifier: compact(app?.appId || app?.id || app?.identifier || app?.domain || '', 160),
    displayName: compact(app?.name || app?.displayName || '', 160),
    observedAt: nowIso()
  };
}

function mappingSuggestions(sourceFields) {
  const reverse = new Map();
  for (const [canonical, aliases] of Object.entries(FIELD_SYNONYMS)) {
    reverse.set(normalize(canonical).replace(/ /g, ''), canonical);
    for (const alias of aliases) reverse.set(normalize(alias).replace(/ /g, ''), canonical);
  }
  return sourceFields.map(field => {
    const key = normalize(field).replace(/ /g, '');
    const canonicalField = reverse.get(key) || null;
    return {
      sourceField: compact(field, 120),
      canonicalEntity: 'Person',
      canonicalField,
      confidence: canonicalField ? 0.99 : 0,
      status: canonicalField ? 'SUGGESTED' : 'UNMAPPED'
    };
  });
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function validCredentialReference(value) {
  return /^(vault|secret|managed|merge|kombo|workato):\/\/[A-Za-z0-9._:/-]{3,200}$/.test(String(value || ''));
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function createAutonomousIntegrationHub(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_INTEGRATION_INTERNAL_TOKEN || '';
  const maxBodyBytes = Number(options.maxBodyBytes || 256 * 1024);
  if (!dbPath) throw new Error('Autonomous integration hub requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS integration_candidates(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, product_key TEXT NOT NULL, display_name TEXT NOT NULL,' +
      'category TEXT NOT NULL, confidence REAL NOT NULL, evidence_json TEXT NOT NULL, status TEXT NOT NULL,' +
      'authoritative_for_json TEXT NOT NULL DEFAULT \'[]\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,' +
      'UNIQUE(tenant,product_key));' +
    'CREATE TABLE IF NOT EXISTS integration_discovery_sessions(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,' +
      'expires_at INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS integration_connections(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, candidate_id TEXT NOT NULL, product_key TEXT NOT NULL,' +
      'category TEXT NOT NULL, state TEXT NOT NULL, auth_method TEXT NOT NULL, semantic_scopes_json TEXT NOT NULL,' +
      'granted_scopes_json TEXT NOT NULL DEFAULT \'[]\', credential_ref TEXT, source_instance_id TEXT,' +
      'mapping_version INTEGER NOT NULL DEFAULT 0, last_health_at TEXT, last_sync_at TEXT, failure_class TEXT,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,candidate_id));' +
    'CREATE TABLE IF NOT EXISTS integration_mappings(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, connection_id TEXT NOT NULL, canonical_entity TEXT NOT NULL,' +
      'source_field TEXT NOT NULL, canonical_field TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,' +
      'mapping_version INTEGER NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS integration_reconciliation_runs(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, connection_id TEXT NOT NULL, mapping_version INTEGER NOT NULL,' +
      'source_count INTEGER NOT NULL, valid_count INTEGER NOT NULL, invalid_count INTEGER NOT NULL,' +
      'duplicate_count INTEGER NOT NULL, id_digest TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS integration_canonical_batches(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, connection_id TEXT NOT NULL, mapping_version INTEGER NOT NULL,' +
      'batch_checksum TEXT NOT NULL, source_count INTEGER NOT NULL, record_count INTEGER NOT NULL,' +
      'site_count INTEGER NOT NULL, department_count INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,' +
      'UNIQUE(tenant,connection_id,mapping_version,batch_checksum));' +
    'CREATE TABLE IF NOT EXISTS integration_canonical_people(' +
      'batch_id TEXT NOT NULL, tenant TEXT NOT NULL, connection_id TEXT NOT NULL, employee_key TEXT NOT NULL,' +
      'record_checksum TEXT NOT NULL, canonical_json TEXT NOT NULL, created_at TEXT NOT NULL,' +
      'PRIMARY KEY(batch_id,employee_key));' +
    'CREATE TABLE IF NOT EXISTS integration_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT, connection_id TEXT, event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_integration_event_update BEFORE UPDATE ON integration_events ' +
      'BEGIN SELECT RAISE(ABORT,\'Integration events are append only.\'); END;' +
    'CREATE TRIGGER IF NOT EXISTS no_integration_event_delete BEFORE DELETE ON integration_events ' +
      'BEGIN SELECT RAISE(ABORT,\'Integration events are append only.\'); END;'
  );

  const gustoEnv = options.env || process.env;
  const gusto = createGustoCompanyConnector({ db, env: gustoEnv, fetchImpl: options.fetchImpl || globalThis.fetch, now: options.now || Date.now });

  const authStmt = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const candidateById = db.prepare('SELECT * FROM integration_candidates WHERE id=? AND tenant=?');
  const candidateByProduct = db.prepare('SELECT * FROM integration_candidates WHERE tenant=? AND product_key=?');
  const insertCandidate = db.prepare(
    'INSERT INTO integration_candidates(id,tenant,product_key,display_name,category,confidence,evidence_json,status,authoritative_for_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const updateCandidate = db.prepare(
    'UPDATE integration_candidates SET display_name=?,category=?,confidence=?,evidence_json=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const confirmCandidateStmt = db.prepare(
    'UPDATE integration_candidates SET status=\'CONFIRMED\',authoritative_for_json=?,updated_at=? WHERE id=? AND tenant=?'
  );

  const connectionById = db.prepare('SELECT * FROM integration_connections WHERE id=? AND tenant=?');
  const connectionByIdAnyTenant = db.prepare('SELECT * FROM integration_connections WHERE id=?');
  const discoverySessionById = db.prepare('SELECT * FROM integration_discovery_sessions WHERE id=?');
  const insertDiscoverySession = db.prepare(
    'INSERT INTO integration_discovery_sessions(id,tenant,provider,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
  );
  const claimDiscoverySession = db.prepare(
    'UPDATE integration_discovery_sessions SET status=\'PROCESSING\',updated_at=? WHERE id=? AND status=\'PENDING\' AND expires_at>?'
  );
  const completeDiscoverySession = db.prepare(
    'UPDATE integration_discovery_sessions SET status=\'COMPLETED\',updated_at=? WHERE id=? AND status=\'PROCESSING\''
  );
  const failDiscoverySession = db.prepare(
    'UPDATE integration_discovery_sessions SET status=\'FAILED\',updated_at=? WHERE id=? AND status=\'PROCESSING\''
  );
  const connectionByCandidate = db.prepare('SELECT * FROM integration_connections WHERE tenant=? AND candidate_id=?');
  const insertConnection = db.prepare(
    'INSERT INTO integration_connections(id,tenant,candidate_id,product_key,category,state,auth_method,semantic_scopes_json,granted_scopes_json,credential_ref,source_instance_id,mapping_version,last_health_at,last_sync_at,failure_class,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const updateConnectionState = db.prepare(
    'UPDATE integration_connections SET state=?,failure_class=?,last_health_at=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const authorizeConnection = db.prepare(
    'UPDATE integration_connections SET state=\'VALIDATING\',granted_scopes_json=?,credential_ref=?,source_instance_id=?,failure_class=NULL,updated_at=? WHERE id=? AND tenant=?'
  );
  const activateMappingVersion = db.prepare(
    'UPDATE integration_connections SET mapping_version=?,state=\'VALIDATING\',updated_at=? WHERE id=? AND tenant=?'
  );
  const markSync = db.prepare(
    'UPDATE integration_connections SET state=?,failure_class=?,last_sync_at=?,last_health_at=?,updated_at=? WHERE id=? AND tenant=?'
  );

  const insertMapping = db.prepare(
    'INSERT INTO integration_mappings(id,tenant,connection_id,canonical_entity,source_field,canonical_field,confidence,status,mapping_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  );
  const activeMappings = db.prepare(
    'SELECT * FROM integration_mappings WHERE tenant=? AND connection_id=? AND mapping_version=? ORDER BY canonical_field'
  );
  const insertRecon = db.prepare(
    'INSERT INTO integration_reconciliation_runs(id,tenant,connection_id,mapping_version,source_count,valid_count,invalid_count,duplicate_count,id_digest,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const canonicalBatchByChecksum = db.prepare(
    'SELECT * FROM integration_canonical_batches WHERE tenant=? AND connection_id=? AND mapping_version=? AND batch_checksum=?'
  );
  const latestCanonicalBatch = db.prepare(
    "SELECT * FROM integration_canonical_batches WHERE tenant=? AND connection_id=? AND status='PASS' ORDER BY rowid DESC LIMIT 1"
  );
  const insertCanonicalBatch = db.prepare(
    'INSERT INTO integration_canonical_batches(id,tenant,connection_id,mapping_version,batch_checksum,source_count,record_count,site_count,department_count,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insertCanonicalPerson = db.prepare(
    'INSERT INTO integration_canonical_people(batch_id,tenant,connection_id,employee_key,record_checksum,canonical_json,created_at) VALUES(?,?,?,?,?,?,?)'
  );
  const eventStmt = db.prepare(
    'INSERT INTO integration_events(tenant,connection_id,event,detail_json,created_at) VALUES(?,?,?,?,?)'
  );
  const listCandidates = db.prepare('SELECT * FROM integration_candidates WHERE tenant=? ORDER BY confidence DESC,display_name');
  const listConnections = db.prepare('SELECT * FROM integration_connections WHERE tenant=? ORDER BY created_at');
  const lastRecon = db.prepare(
    'SELECT * FROM integration_reconciliation_runs WHERE tenant=? AND connection_id=? ORDER BY rowid DESC LIMIT 1'
  );

  function hasValidatedPeopleSync(connection) {
    if (connection.product_key === 'gusto') {
      const configuration = gustoConfigurationFor(connection.tenant);
      const provider = gusto.getConnectionStatus({ tenant: connection.tenant, connectionId: connection.id });
      if (!configuration.configured || !provider || provider.companyUuid !== connection.source_instance_id ||
          (configuration.expectedCompanyUuid && configuration.expectedCompanyUuid !== provider.companyUuid) ||
          !provider.grantedScopes.includes('people.read')) return false;
    }
    const grants = safeJsonParse(connection.granted_scopes_json, []);
    const recon = lastRecon.get(connection.tenant, connection.id);
    const batch = latestCanonicalBatch.get(connection.tenant, connection.id);
    return Boolean(connection.credential_ref) && grants.includes('people.read') &&
      Number(connection.mapping_version) > 0 &&
      recon?.status === 'PASS' && Number(recon.mapping_version) === Number(connection.mapping_version) &&
      Number(recon.source_count) > 0 && Number(recon.valid_count) === Number(recon.source_count) &&
      Number(recon.invalid_count) === 0 && Number(recon.duplicate_count) === 0 &&
      batch?.status === 'PASS' && Number(batch.mapping_version) === Number(connection.mapping_version) &&
      Number(batch.record_count) === Number(recon.valid_count);
  }

  function record(tenant, connectionId, event, detail = {}) {
    try {
      eventStmt.run(tenant || null, connectionId || null, event, JSON.stringify(detail), nowIso());
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
      writeJson(res, 403, { error: 'Integration setup requires an authorised administrator.' });
      return null;
    }
    return ctx;
  }

  function requireInternal(req, res) {
    if (!internalToken) {
      writeJson(res, 503, { error: 'Integration worker credential is not configured.' });
      return false;
    }
    const provided = req?.headers?.[INTERNAL_HEADER];
    if (!secureEqual(provided, internalToken)) {
      writeJson(res, 403, { error: 'Trusted integration worker authorization required.' });
      return false;
    }
    return true;
  }

  function publicCandidate(row) {
    return {
      id: row.id,
      productKey: row.product_key,
      name: row.display_name,
      category: row.category,
      confidence: row.confidence,
      evidence: safeJsonParse(row.evidence_json, []),
      status: row.status,
      authoritativeFor: safeJsonParse(row.authoritative_for_json, [])
    };
  }

  function publicConnection(row) {
    const product = CATALOG_BY_KEY.get(row.product_key);
    const recon = lastRecon.get(row.tenant, row.id);
    const gustoMetadata = row.product_key === 'gusto' ? gusto.getConnectionStatus({ tenant: row.tenant, connectionId: row.id }) : null;
    const selectedGustoCompany = row.product_key === 'gusto' ? gustoConfigurationFor(row.tenant).expectedCompanyUuid : null;
    return {
      id: row.id,
      candidateId: row.candidate_id,
      productKey: row.product_key,
      name: product?.name || row.product_key,
      category: row.category,
      state: row.state,
      authMethod: row.auth_method,
      semanticScopes: safeJsonParse(row.semantic_scopes_json, []),
      grantedScopes: safeJsonParse(row.granted_scopes_json, []),
      sourceInstanceId: row.source_instance_id,
      mappingVersion: row.mapping_version,
      lastHealthAt: row.last_health_at,
      lastSyncAt: row.last_sync_at,
      failureClass: row.failure_class,
      ...(row.product_key === 'gusto' ? { gusto: gustoMetadata?.companyUuid === row.source_instance_id && (!selectedGustoCompany || selectedGustoCompany === row.source_instance_id) ? gustoMetadata : null } : {}),
      lastReconciliation: recon ? {
        sourceCount: recon.source_count,
        validCount: recon.valid_count,
        invalidCount: recon.invalid_count,
        duplicateCount: recon.duplicate_count,
        status: recon.status,
        createdAt: recon.created_at
      } : null,
      canonicalImport: (() => {
        const batch = latestCanonicalBatch.get(row.tenant, row.id);
        if (!batch || Number(batch.mapping_version) !== Number(row.mapping_version)) return null;
        return {
          batchId: batch.id,
          mappingVersion: batch.mapping_version,
          checksum: batch.batch_checksum,
          recordCount: batch.record_count,
          siteCount: batch.site_count,
          departmentCount: batch.department_count,
          status: batch.status,
          createdAt: batch.created_at
        };
      })()
    };
  }

  function statusForTenant(tenant) {
    const candidates = listCandidates.all(tenant).map(publicCandidate);
    const connectionRows = listConnections.all(tenant);
    const connections = connectionRows.map(publicConnection);
    const confirmedPeople = candidates.filter(c => c.status === 'CONFIRMED' && c.authoritativeFor.includes('people'));
    const confirmedIds = new Set(confirmedPeople.map(c => c.id));
    const activePeople = connectionRows.filter(c =>
      c.state === 'ACTIVE' && confirmedIds.has(c.candidate_id) && hasValidatedPeopleSync(c)
    );
    return {
      mode: 'zero-engineer-minimum-admin',
      discovery: {
        candidateCount: candidates.length,
        confirmedCount: candidates.filter(c => c.status === 'CONFIRMED').length,
        candidates
      },
      connections,
      readiness: {
        readyForPeopleSync: activePeople.length > 0,
        peopleSourceConfirmed: confirmedPeople.length > 0,
        needsAdminAction: connections.filter(c => ['AUTHORIZATION_REQUIRED', 'REAUTH_REQUIRED'].includes(c.state)).length,
        needsValidation: connections.filter(c => ['VALIDATING', 'DEGRADED'].includes(c.state)).length
      }
    };
  }

  function ingestDiscovery(tenant, source, apps) {
    const found = [];
    for (const app of apps) {
      const detected = detectProduct(app, source);
      if (!detected) continue;
      const { product, confidence, method } = detected;
      const evidence = candidateEvidence(app, source, method);
      let row = candidateByProduct.get(tenant, product.key);
      if (!row) {
        const id = randomUUID();
        const now = nowIso();
        insertCandidate.run(
          id, tenant, product.key, product.name, product.category, confidence,
          JSON.stringify([evidence]), 'DETECTED', '[]', now, now
        );
        row = candidateById.get(id, tenant);
      } else {
        const evidenceList = safeJsonParse(row.evidence_json, []);
        const signature = evidence.source + ':' + evidence.observedIdentifier + ':' + evidence.displayName;
        if (!evidenceList.some(x => (x.source + ':' + x.observedIdentifier + ':' + x.displayName) === signature)) {
          evidenceList.push(evidence);
        }
        updateCandidate.run(
          product.name, product.category, Math.max(Number(row.confidence), confidence),
          JSON.stringify(evidenceList.slice(-20)), nowIso(), row.id, tenant
        );
        row = candidateById.get(row.id, tenant);
      }
      found.push(publicCandidate(row));
    }
    record(tenant, null, 'discovery-ingested', { source, received: apps.length, detected: found.length });
    return found;
  }

  async function handleDiscover(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const source = compact(body.source, 40).toUpperCase();
    if (!DISCOVERY_SOURCES.has(source)) return writeJson(res, 400, { error: 'Unsupported discovery source.' });
    if (!Array.isArray(body.apps)) return writeJson(res, 400, { error: 'apps must be an array.' });
    if (body.apps.length > 2000) return writeJson(res, 400, { error: 'Discovery batch exceeds 2000 applications.' });
    const found = ingestDiscovery(ctx.tenant, source, body.apps);
    return writeJson(res, 200, {
      source,
      received: body.apps.length,
      detected: found.length,
      candidates: found,
      note: 'Discovery identifies likely systems. Source-system authorization is still required before data access.'
    });
  }

  async function handleCreateDiscoverySession(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const provider = compact(body.provider, 40).toUpperCase();
    if (!['ENTRA', 'OKTA', 'GOOGLE_WORKSPACE'].includes(provider)) {
      return writeJson(res, 400, { error: 'Unsupported directory discovery provider.' });
    }
    const id = randomUUID();
    const ttlMs = 15 * 60 * 1000;
    const expiresAt = Date.now() + ttlMs;
    const now = nowIso();
    insertDiscoverySession.run(id, ctx.tenant, provider, 'PENDING', expiresAt, now, now);
    record(ctx.tenant, null, 'discovery-session-created', { discoverySessionId: id, provider, expiresAt });
    return writeJson(res, 201, {
      discoverySession: { id, provider, expiresAt },
      requiredAction: {
        type: 'AUTHORIZE_DIRECTORY',
        provider,
        instruction: 'An authorised administrator approves read-only application inventory access. The worker returns metadata against this short-lived session.'
      }
    });
  }

  async function handleWorkerDiscoveryResult(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const session = discoverySessionById.get(compact(body.discoverySessionId, 80));
    if (!session) return writeJson(res, 404, { error: 'Discovery session not found.' });
    if (session.status !== 'PENDING') return writeJson(res, 409, { error: 'Discovery session has already been used.' });
    const nowMs = Date.now();
    if (Number(session.expires_at) <= nowMs) return writeJson(res, 410, { error: 'Discovery session has expired.' });
    if (!Array.isArray(body.apps)) return writeJson(res, 400, { error: 'apps must be an array.' });
    if (body.apps.length > 2000) return writeJson(res, 400, { error: 'Discovery batch exceeds 2000 applications.' });
    const source = compact(body.source, 40).toUpperCase();
    if (source !== session.provider) return writeJson(res, 409, { error: 'Discovery provider does not match the authorized session.' });

    const claimed = claimDiscoverySession.run(nowIso(), session.id, nowMs);
    if (Number(claimed.changes) !== 1) {
      return writeJson(res, 409, { error: 'Discovery session is already being processed or is no longer valid.' });
    }

    try {
      const found = ingestDiscovery(session.tenant, source, body.apps);
      const completed = completeDiscoverySession.run(nowIso(), session.id);
      if (Number(completed.changes) !== 1) throw new Error('Discovery session completion state changed unexpectedly.');
      record(session.tenant, null, 'discovery-session-completed', { discoverySessionId: session.id, provider: source, detected: found.length });
      return writeJson(res, 200, { source, received: body.apps.length, detected: found.length, candidates: found });
    } catch (error) {
      failDiscoverySession.run(nowIso(), session.id);
      record(session.tenant, null, 'discovery-session-failed', { discoverySessionId: session.id, provider: source });
      throw error;
    }
  }

  async function handleConfirm(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const candidate = candidateById.get(compact(body.candidateId, 80), ctx.tenant);
    if (!candidate) return writeJson(res, 404, { error: 'Candidate not found.' });
    const authoritativeFor = arrayOfStrings(body.authoritativeFor, 12, 40)
      .filter(x => ['people', 'payroll', 'finance', 'production', 'procurement', 'absence', 'time'].includes(x));
    confirmCandidateStmt.run(JSON.stringify(authoritativeFor), nowIso(), candidate.id, ctx.tenant);
    const updated = candidateById.get(candidate.id, ctx.tenant);
    record(ctx.tenant, null, 'candidate-confirmed', { candidateId: candidate.id, productKey: candidate.product_key, authoritativeFor });
    return writeJson(res, 200, { candidate: publicCandidate(updated) });
  }

  async function handleConnect(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const candidate = candidateById.get(compact(body.candidateId, 80), ctx.tenant);
    if (!candidate) return writeJson(res, 404, { error: 'Candidate not found.' });
    if (candidate.status !== 'CONFIRMED') return writeJson(res, 409, { error: 'Confirm the detected system before connecting it.' });
    const product = CATALOG_BY_KEY.get(candidate.product_key);
    if (!product) return writeJson(res, 409, { error: 'No supported connector profile is available.' });

    const requestedAuth = compact(body.authMethod, 40) || product.authMethods[0];
    if (!product.authMethods.includes(requestedAuth)) {
      return writeJson(res, 400, { error: 'Unsupported authentication method for this system.', supported: product.authMethods });
    }

    let connection = connectionByCandidate.get(ctx.tenant, candidate.id);
    if (!connection) {
      const id = randomUUID();
      const now = nowIso();
      insertConnection.run(
        id, ctx.tenant, candidate.id, product.key, product.category, 'AUTHORIZATION_REQUIRED',
        requestedAuth, JSON.stringify(semanticScopesFor(product)), '[]', null,
        product.key === 'gusto' ? null : compact(body.sourceInstanceId, 160) || null, 0, null, null, null, now, now
      );
      connection = connectionById.get(id, ctx.tenant);
      record(ctx.tenant, id, 'connection-created', { productKey: product.key, authMethod: requestedAuth });
    }

    return writeJson(res, 200, {
      connection: publicConnection(connection),
      requiredAction: {
        type: 'ADMIN_AUTHORIZATION',
        authMethod: connection.auth_method,
        minimumSemanticScopes: safeJsonParse(connection.semantic_scopes_json, []),
        instruction: 'An authorised administrator must approve access in the source system. Credentials are never accepted in this API.'
      }
    });
  }

  function requireGustoAdministrator(ctx, res) {
    if (!['manager', 'admin'].includes(String(ctx.role).toLowerCase())) {
      writeJson(res, 403, { error: 'Gusto setup requires an authorised administrator.' });
      return false;
    }
    return true;
  }

  function gustoConfigurationFor(tenant) {
    const availability = gusto.availability();
    const raw = gustoEnv.WFM_GUSTO_TENANT_COMPANIES_JSON;
    if (raw === undefined || raw === '') return { ...availability, expectedCompanyUuid: null };
    try {
      if (typeof raw !== 'string' || raw.length > 65536) throw new Error();
      const bindings = JSON.parse(raw);
      if (!bindings || Array.isArray(bindings) || typeof bindings !== 'object' || Object.values(bindings).some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))) throw new Error();
      return { ...availability, expectedCompanyUuid: Object.hasOwn(bindings, tenant) ? bindings[tenant] : null };
    } catch {
      return { ...availability, configured: false, expectedCompanyUuid: null, missingConfiguration: [...availability.missingConfiguration, 'WFM_GUSTO_TENANT_COMPANIES_JSON'] };
    }
  }

  function requireGustoOrigin(req, res) {
    let origin = '';
    try { origin = new URL(gustoEnv.WFM_PUBLIC_ORIGIN).origin; } catch {}
    if (!origin || req.headers?.origin !== origin) {
      writeJson(res, 403, { error: 'Start Gusto setup from this VECTOR site.', code: 'GUSTO_ORIGIN_REQUIRED' });
      return false;
    }
    return true;
  }

  function gustoConnection(ctx, res, connectionId) {
    const connection = connectionById.get(compact(connectionId, 80), ctx.tenant);
    if (!connection || connection.product_key !== 'gusto' || connection.auth_method !== 'oauth2') {
      writeJson(res, 404, { error: 'Gusto connection not found.' });
      return null;
    }
    return connection;
  }

  function saveGustoVerification(ctx, verified, preserveActive = false) {
    const connection = connectionById.get(verified.connectionId, ctx.tenant);
    if (!connection || connection.product_key !== 'gusto') {
      throw Object.assign(new Error('Gusto connection not found.'), { statusCode: 404 });
    }
    const configuredCompany = gustoConfigurationFor(ctx.tenant).expectedCompanyUuid;
    if ((connection.source_instance_id && connection.source_instance_id !== verified.companyUuid) || (configuredCompany && configuredCompany !== verified.companyUuid)) {
      throw Object.assign(new Error('The Gusto company does not match this connection.'), { statusCode: 409, code: 'GUSTO_COMPANY_MISMATCH' });
    }
    const keepActive = preserveActive && connection.state === 'ACTIVE' && hasValidatedPeopleSync(connection) && verified.grantedScopes.includes('people.read');
    authorizeConnection.run(JSON.stringify(verified.grantedScopes), verified.authorizationRef, verified.companyUuid, nowIso(), connection.id, ctx.tenant);
    updateConnectionState.run(keepActive ? 'ACTIVE' : 'VALIDATING', null, verified.verifiedAt, nowIso(), connection.id, ctx.tenant);
    record(ctx.tenant, connection.id, 'gusto-company-verified', {
      companyUuid: verified.companyUuid, environment: verified.environment,
      grantedScopeCount: verified.grantedScopes.length, verifiedAt: verified.verifiedAt
    });
    return publicConnection(connectionById.get(connection.id, ctx.tenant));
  }

  async function handleGustoAuthorize(ctx, req, res) {
    if (!requireGustoAdministrator(ctx, res)) return true;
    const body = await readJson(req, maxBodyBytes);
    const connection = gustoConnection(ctx, res, body.connectionId);
    if (!connection) return true;
    const availability = gustoConfigurationFor(ctx.tenant);
    if (!availability.configured) return writeJson(res, 503, {
      error: 'Gusto connection setup is required on this VECTOR site.', code: 'GUSTO_NOT_CONFIGURED', ...availability
    });
    if (!requireGustoOrigin(req, res)) return true;
    const expectedCompanyUuid = body.expectedCompanyUuid || availability.expectedCompanyUuid || connection.source_instance_id;
    if ((connection.source_instance_id && expectedCompanyUuid !== connection.source_instance_id) || (availability.expectedCompanyUuid && expectedCompanyUuid !== availability.expectedCompanyUuid)) {
      return writeJson(res, 409, { error: 'Reconnect the Gusto company already selected for this connection.', code: 'GUSTO_COMPANY_MISMATCH' });
    }
    const authorization = gusto.beginAuthorization({ tenant: ctx.tenant, connectionId: connection.id, sessionHash: sha256(cookieSessionToken(req)), expectedCompanyUuid });
    record(ctx.tenant, connection.id, 'gusto-authorization-started', { environment: authorization.environment });
    return writeJson(res, 200, authorization);
  }

  async function handleGustoComplete(ctx, req, res) {
    if (!requireGustoAdministrator(ctx, res)) return true;
    const configuration = gustoConfigurationFor(ctx.tenant);
    if (!configuration.configured) return writeJson(res, 503, {
      error: 'Gusto connection setup is required on this VECTOR site.', code: 'GUSTO_NOT_CONFIGURED', ...configuration
    });
    if (!requireGustoOrigin(req, res)) return true;
    const body = await readJson(req, 8192);
    if ((body.code && body.providerError) || typeof body.state !== 'string' ||
        (body.code !== undefined && body.code !== null && typeof body.code !== 'string') ||
        (body.providerError !== undefined && body.providerError !== null && typeof body.providerError !== 'string')) {
      return writeJson(res, 400, { error: 'The Gusto authorization response is invalid.', code: 'GUSTO_INVALID_CALLBACK' });
    }
    const verified = await gusto.completeAuthorization({
      tenant: ctx.tenant, sessionHash: sha256(cookieSessionToken(req)),
      state: body.state, code: body.code, providerError: body.providerError,
      expectedCompanyUuid: configuration.expectedCompanyUuid || undefined
    });
    saveGustoVerification(ctx, verified);
    return writeJson(res, 200, { verified: true });
  }

  async function handleGustoVerify(ctx, req, res) {
    if (!requireGustoAdministrator(ctx, res)) return true;
    const configuration = gustoConfigurationFor(ctx.tenant);
    if (!configuration.configured) return writeJson(res, 503, {
      error: 'Gusto connection setup is required on this VECTOR site.', code: 'GUSTO_NOT_CONFIGURED', ...configuration
    });
    if (!requireGustoOrigin(req, res)) return true;
    const body = await readJson(req, maxBodyBytes);
    const connection = gustoConnection(ctx, res, body.connectionId);
    if (!connection) return true;
    try {
      if (configuration.expectedCompanyUuid && connection.source_instance_id && configuration.expectedCompanyUuid !== connection.source_instance_id) {
        throw Object.assign(new Error('The selected Gusto company does not match this connection.'), { statusCode: 409, code: 'GUSTO_COMPANY_MISMATCH' });
      }
      const verified = await gusto.verifyConnection({ tenant: ctx.tenant, connectionId: connection.id });
      return writeJson(res, 200, { connection: saveGustoVerification(ctx, verified, true), dataSynced: false, payrollProof: false });
    } catch (error) {
      if (['GUSTO_REAUTHORIZATION_REQUIRED', 'GUSTO_UNAUTHORIZED', 'GUSTO_FORBIDDEN', 'GUSTO_COMPANY_MISMATCH', 'GUSTO_TOKEN_SUBJECT_INVALID', 'GUSTO_SCOPE_REQUIRED', 'GUSTO_ENVIRONMENT_MISMATCH', 'GUSTO_CLIENT_MISMATCH'].includes(error?.code)) {
        const current = gusto.getConnectionStatus({ tenant: ctx.tenant, connectionId: connection.id });
        const stillVerified = current && current.companyUuid === connection.source_instance_id &&
          (!configuration.expectedCompanyUuid || current.companyUuid === configuration.expectedCompanyUuid);
        // A newer successful authorization can finish while the failed provider
        // request is in flight. Its current verification must survive that error.
        if (!stillVerified) {
          updateConnectionState.run('REAUTH_REQUIRED', error.code, connection.last_health_at, nowIso(), connection.id, ctx.tenant);
          record(ctx.tenant, connection.id, 'gusto-reauthorization-required', { code: error.code });
        }
      }
      throw error;
    }
  }

  async function handleAuthorizeComplete(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const connection = connectionByIdAnyTenant.get(compact(body.connectionId, 80));
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    if (connection.product_key === 'gusto') {
      return writeJson(res, 409, { error: 'Complete Gusto authorization through the verified company connector.', code: 'GUSTO_PROVIDER_VERIFICATION_REQUIRED' });
    }
    const authorizationRef = compact(body.authorizationRef, 220);
    if (!validCredentialReference(authorizationRef)) {
      return writeJson(res, 400, { error: 'authorizationRef must be an opaque managed secret reference, never a credential value.' });
    }
    const grantedScopes = arrayOfStrings(body.grantedScopes, 80, 120);
    authorizeConnection.run(
      JSON.stringify(grantedScopes), authorizationRef, compact(body.sourceInstanceId, 160) || connection.source_instance_id,
      nowIso(), connection.id, connection.tenant
    );
    const updated = connectionById.get(connection.id, connection.tenant);
    record(connection.tenant, connection.id, 'authorization-attested', { grantedScopeCount: grantedScopes.length });
    return writeJson(res, 200, { connection: publicConnection(updated) });
  }

  async function handleMappingPreview(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const connection = connectionById.get(compact(body.connectionId, 80), ctx.tenant);
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    const sourceFields = arrayOfStrings(body.sourceFields, 200, 120);
    const suggestions = mappingSuggestions(sourceFields);
    return writeJson(res, 200, {
      canonicalEntity: 'Person',
      suggestions,
      unresolved: suggestions.filter(x => !x.canonicalField).map(x => x.sourceField),
      requiredCanonicalFields: ['employeeId', 'firstName', 'lastName']
    });
  }

  async function handleMappingActivate(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const connection = connectionById.get(compact(body.connectionId, 80), ctx.tenant);
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    if (!['VALIDATING', 'DEGRADED', 'ACTIVE'].includes(connection.state)) {
      return writeJson(res, 409, { error: 'Source authorization must be completed before mappings can be activated.' });
    }
    if (!Array.isArray(body.mappings) || body.mappings.length < 1 || body.mappings.length > 100) {
      return writeJson(res, 400, { error: 'mappings must contain 1 to 100 entries.' });
    }

    const allowed = new Set(CANONICAL_FIELDS.Person);
    const cleaned = [];
    const seenSource = new Set();
    for (const mapping of body.mappings) {
      const sourceField = compact(mapping.sourceField, 120);
      const canonicalField = compact(mapping.canonicalField, 80);
      if (!sourceField || !allowed.has(canonicalField)) {
        return writeJson(res, 400, { error: 'Mapping contains an unsupported field.', sourceField, canonicalField });
      }
      if (seenSource.has(sourceField)) return writeJson(res, 400, { error: 'Each source field can only be mapped once.', sourceField });
      seenSource.add(sourceField);
      cleaned.push({ sourceField, canonicalField, confidence: Number(mapping.confidence || 1) });
    }
    if (!cleaned.some(x => x.canonicalField === 'employeeId')) {
      return writeJson(res, 400, { error: 'employeeId mapping is required before validation.' });
    }

    const version = Number(connection.mapping_version) + 1;
    const createdAt = nowIso();
    for (const mapping of cleaned) {
      insertMapping.run(
        randomUUID(), ctx.tenant, connection.id, 'Person', mapping.sourceField, mapping.canonicalField,
        Math.min(1, Math.max(0, mapping.confidence)), 'ACTIVE', version, createdAt
      );
    }
    activateMappingVersion.run(version, nowIso(), connection.id, ctx.tenant);
    const updated = connectionById.get(connection.id, ctx.tenant);
    record(ctx.tenant, connection.id, 'mapping-version-activated', { mappingVersion: version, mappingCount: cleaned.length });
    return writeJson(res, 200, { connection: publicConnection(updated), mappingVersion: version });
  }

  async function handleSyncValidate(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const requestedTenant = compact(body.tenant, 120);
    if (!requestedTenant) return writeJson(res, 400, { error: 'tenant is required for source-data validation.' });
    const connection = connectionByIdAnyTenant.get(compact(body.connectionId, 80));
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    if (requestedTenant !== connection.tenant) {
      record(connection.tenant, connection.id, 'cross-tenant-sync-rejected', {
        requestedTenantDigest: sha256(requestedTenant).slice(0, 16)
      });
      return writeJson(res, 403, { error: 'Connection does not belong to the requested tenant.' });
    }
    if (!['VALIDATING', 'ACTIVE', 'DEGRADED'].includes(connection.state)) {
      return writeJson(res, 409, { error: 'Connection is not ready for validation.' });
    }
    if (!connection.credential_ref || !safeJsonParse(connection.granted_scopes_json, []).includes('people.read')) {
      return writeJson(res, 409, { error: 'An attested people.read grant is required before validating people records.' });
    }
    if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > 500) {
      return writeJson(res, 400, { error: 'records must contain between 1 and 500 items.' });
    }

    const mappings = activeMappings.all(connection.tenant, connection.id, Number(connection.mapping_version));
    if (!mappings.length) return writeJson(res, 409, { error: 'Activate mappings before validating a sync.' });

    const ids = [];
    const canonicalRecords = [];
    let invalid = 0;
    const seen = new Set();
    let duplicateCount = 0;
    for (const record of body.records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) { invalid++; continue; }
      const canonical = {};
      for (const mapping of mappings) {
        const value = record[mapping.source_field];
        if (value === undefined || value === null) continue;
        canonical[mapping.canonical_field] = typeof value === 'string' ? value.trim() : value;
      }
      const employeeId = canonical.employeeId === undefined || canonical.employeeId === null ? '' : String(canonical.employeeId).trim();
      if (!employeeId) { invalid++; continue; }
      const hashedId = sha256(employeeId);
      if (seen.has(hashedId)) {
        duplicateCount++;
        continue;
      }
      seen.add(hashedId);
      ids.push(hashedId);
      const normalized = {};
      for (const field of CANONICAL_FIELDS.Person) {
        if (canonical[field] === undefined || canonical[field] === null || canonical[field] === '') continue;
        normalized[field] = canonical[field];
      }
      canonicalRecords.push({
        employeeKey: hashedId,
        recordChecksum: sha256(JSON.stringify(CANONICAL_FIELDS.Person.map(field => [field, normalized[field] ?? null]))),
        canonical: normalized
      });
    }

    const valid = canonicalRecords.length;
    const status = invalid === 0 && duplicateCount === 0 && valid === body.records.length ? 'PASS' : 'NEEDS_REVIEW';
    const idDigest = sha256(ids.slice().sort().join('|'));
    insertRecon.run(
      randomUUID(), connection.tenant, connection.id, Number(connection.mapping_version), body.records.length,
      valid, invalid, duplicateCount, idDigest, status, nowIso()
    );

    let canonicalImport = null;
    if (status === 'PASS') {
      const batchChecksum = sha256([
        connection.id,
        String(connection.mapping_version),
        ...canonicalRecords.map(item => item.recordChecksum).sort()
      ].join('|'));
      const expectedCanonicalChecksum = compact(body.expectedCanonicalChecksum, 64).toLowerCase();
      if (expectedCanonicalChecksum) {
        if (!/^[0-9a-f]{64}$/.test(expectedCanonicalChecksum)) {
          return writeJson(res, 400, { error: 'expectedCanonicalChecksum must be a SHA-256 hex digest.' });
        }
        if (expectedCanonicalChecksum !== batchChecksum) {
          const stamp = nowIso();
          markSync.run('DEGRADED', 'DATA_CHECKSUM', stamp, stamp, stamp, connection.id, connection.tenant);
          record(connection.tenant, connection.id, 'canonical-checksum-mismatch', {
            mappingVersion: connection.mapping_version,
            expectedDigest: expectedCanonicalChecksum.slice(0, 16),
            observedDigest: batchChecksum.slice(0, 16)
          });
          return writeJson(res, 409, {
            error: 'Canonical import checksum does not match the expected source handoff.',
            reconciliation: { sourceCount: body.records.length, validCount: valid, invalidCount: invalid, duplicateCount, status },
            canonicalImport: null
          });
        }
      }
      let batch = canonicalBatchByChecksum.get(
        connection.tenant, connection.id, Number(connection.mapping_version), batchChecksum
      );
      let replayed = Boolean(batch);
      if (!batch) {
        const batchId = randomUUID();
        const stamp = nowIso();
        const sites = new Set(canonicalRecords.map(item => compact(item.canonical.location, 180)).filter(Boolean));
        const departments = new Set(canonicalRecords.map(item => compact(item.canonical.department, 180)).filter(Boolean));
        db.exec('BEGIN IMMEDIATE');
        try {
          batch = canonicalBatchByChecksum.get(
            connection.tenant, connection.id, Number(connection.mapping_version), batchChecksum
          );
          if (!batch) {
            insertCanonicalBatch.run(
              batchId, connection.tenant, connection.id, Number(connection.mapping_version), batchChecksum,
              body.records.length, canonicalRecords.length, sites.size, departments.size, 'PASS', stamp
            );
            for (const item of canonicalRecords) {
              insertCanonicalPerson.run(
                batchId, connection.tenant, connection.id, item.employeeKey, item.recordChecksum,
                JSON.stringify(item.canonical), stamp
              );
            }
            batch = canonicalBatchByChecksum.get(
              connection.tenant, connection.id, Number(connection.mapping_version), batchChecksum
            );
            replayed = false;
          } else {
            replayed = true;
          }
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        }
      }
      canonicalImport = {
        batchId: batch.id,
        mappingVersion: batch.mapping_version,
        checksum: batch.batch_checksum,
        recordCount: batch.record_count,
        siteCount: batch.site_count,
        departmentCount: batch.department_count,
        replayed
      };
    }

    const nextState = status === 'PASS' ? 'ACTIVE' : 'DEGRADED';
    const failureClass = status === 'PASS' ? null : 'DATA_VALIDATION';
    const stamp = nowIso();
    markSync.run(nextState, failureClass, stamp, stamp, stamp, connection.id, connection.tenant);
    const updated = connectionById.get(connection.id, connection.tenant);
    record(connection.tenant, connection.id, 'sync-validation-completed', {
      sourceCount: body.records.length, validCount: valid, invalidCount: invalid,
      duplicateCount, status, mappingVersion: connection.mapping_version,
      canonicalBatchId: canonicalImport?.batchId || null,
      canonicalBatchChecksum: canonicalImport?.checksum || null,
      replayed: canonicalImport?.replayed || false
    });
    return writeJson(res, 200, {
      connection: publicConnection(updated),
      reconciliation: { sourceCount: body.records.length, validCount: valid, invalidCount: invalid, duplicateCount, status },
      canonicalImport
    });
  }

  async function handleHealthReport(req, res) {
    const body = await readJson(req, maxBodyBytes);
    const connection = connectionByIdAnyTenant.get(compact(body.connectionId, 80));
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    const health = compact(body.health, 40);
    const transitions = {
      healthy: ['ACTIVE', null],
      auth_error: ['REAUTH_REQUIRED', 'AUTHORIZATION'],
      rate_limited: ['DEGRADED', 'RATE_LIMIT'],
      schema_drift: ['DEGRADED', 'SCHEMA_DRIFT'],
      source_error: ['DEGRADED', 'SOURCE']
    };
    if (!transitions[health]) return writeJson(res, 400, { error: 'Unsupported health state.' });
    if (health === 'healthy' && (
      !['ACTIVE', 'DEGRADED'].includes(connection.state) ||
      (connection.state === 'DEGRADED' && !['RATE_LIMIT', 'SOURCE'].includes(connection.failure_class)) ||
      !hasValidatedPeopleSync(connection)
    )) {
      return writeJson(res, 409, { error: 'Healthy transport cannot replace source authorization or a successful current mapping validation.' });
    }
    const [state, failureClass] = transitions[health];
    updateConnectionState.run(state, failureClass, nowIso(), nowIso(), connection.id, connection.tenant);
    const updated = connectionById.get(connection.id, connection.tenant);
    record(connection.tenant, connection.id, 'connection-health-changed', { health, state, failureClass });
    return writeJson(res, 200, { connection: publicConnection(updated) });
  }

  async function handleRepair(ctx, req, res) {
    const body = await readJson(req, maxBodyBytes);
    const connection = connectionById.get(compact(body.connectionId, 80), ctx.tenant);
    if (!connection) return writeJson(res, 404, { error: 'Connection not found.' });
    let requiredAction = { type: 'NONE', instruction: 'No repair action is currently required.' };
    if (connection.state === 'REAUTH_REQUIRED') {
      requiredAction = { type: 'REAUTHORIZE', instruction: 'Reconnect the source system. Existing mappings and sync checkpoints are preserved.' };
    } else if (connection.failure_class === 'SCHEMA_DRIFT') {
      requiredAction = { type: 'REVALIDATE_MAPPING', instruction: 'Review only fields affected by the detected schema change.' };
    } else if (connection.state === 'DEGRADED') {
      requiredAction = { type: 'RETRY_VALIDATION', instruction: 'Retry source validation after the external issue clears.' };
    }
    record(ctx.tenant, connection.id, 'repair-guidance-requested', { state: connection.state, failureClass: connection.failure_class, action: requiredAction.type });
    return writeJson(res, 200, { connection: publicConnection(connection), requiredAction });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;
    const gustoRoute = path.startsWith(PREFIX + '/gusto/') || path === PREFIX + '/oauth/callback/gusto';
    if (gustoRoute) res.setHeader('Referrer-Policy', 'no-referrer');

    try {
      // Gusto returns through a cross-site navigation. A minimal local document
      // establishes this site's origin before the session-bound POST, preserving
      // the application's existing SameSite=Strict session cookie.
      if (req.method === 'GET' && path === PREFIX + '/oauth/callback/gusto') return serveGustoOAuthLanding(req, res);
      if (req.method === 'POST' && WORKER_PATHS.has(path)) {
        if (!requireInternal(req, res)) return true;
        if (path === PREFIX + '/discovery-result') return await handleWorkerDiscoveryResult(req, res);
        if (path === PREFIX + '/authorize-complete') return await handleAuthorizeComplete(req, res);
        if (path === PREFIX + '/sync-validate') return await handleSyncValidate(req, res);
        if (path === PREFIX + '/health-report') return await handleHealthReport(req, res);
      }

      const ctx = requireManager(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/gusto/configuration') {
        if (!requireGustoAdministrator(ctx, res)) return true;
        return writeJson(res, 200, gustoConfigurationFor(ctx.tenant));
      }
      if (req.method === 'POST' && path === PREFIX + '/gusto/authorize') return await handleGustoAuthorize(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/gusto/complete') return await handleGustoComplete(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/gusto/verify') return await handleGustoVerify(ctx, req, res);
      if (req.method === 'GET' && path === PREFIX + '/catalog') {
        return writeJson(res, 200, { systems: publicCatalog(), discoverySources: [...DISCOVERY_SOURCES] });
      }
      if (req.method === 'GET' && path === PREFIX + '/status') {
        return writeJson(res, 200, statusForTenant(ctx.tenant));
      }
      if (req.method === 'POST' && path === PREFIX + '/discovery-session') return await handleCreateDiscoverySession(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/discover') return await handleDiscover(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/confirm') return await handleConfirm(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/connect') return await handleConnect(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/mapping-preview') return await handleMappingPreview(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/mapping-activate') return await handleMappingActivate(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/repair') return await handleRepair(ctx, req, res);
      return writeJson(res, 404, { error: 'Autonomous integration endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), {
        error: error?.statusCode ? error.message : 'Integration control plane failed safely.',
        ...(gustoRoute && /^GUSTO_[A-Z_]{1,64}$/.test(error?.code || '') ? { code: error.code } : {})
      });
    }
  }

  return {
    handleRequest,
    close() { try { db.close(); } catch {} },
    statusForTenant,
    publicCatalog
  };
}

module.exports = {
  createAutonomousIntegrationHub,
  CATALOG,
  CANONICAL_FIELDS,
  mappingSuggestions,
  detectProduct,
  validCredentialReference
};
