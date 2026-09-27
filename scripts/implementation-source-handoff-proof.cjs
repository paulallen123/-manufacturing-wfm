'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('../integration/runtime/autonomous-integration-hub.cjs');
const { createOneDayEnterpriseEngine } = require('../implementation/runtime/one-day-enterprise-engine-core.cjs');

const tenant = 'proof-tenant';
const otherTenant = 'other-tenant';
const internalToken = 'proof-internal-token-with-sufficient-length';
const dbPath = path.join(os.tmpdir(), 'vector-source-handoff-' + process.pid + '.sqlite');
try { fs.unlinkSync(dbPath); } catch {}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function baseSchema() {
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  db.close();
}

function responseCapture() {
  const headers = new Map();
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(data = '') {
      this.body += Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      this.headersSent = true;
      this.writableEnded = true;
    }
  };
}

async function call(handler, method, url, headers = {}, body = null) {
  const payload = body === null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const res = responseCapture();
  const handled = await handler(req, res);
  assert.equal(handled, true, method + ' ' + url + ' was not handled');
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch {}
  return { status: res.statusCode, json, body: res.body };
}

function seedIntegration() {
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO integration_candidates(id,tenant,product_key,display_name,category,confidence,evidence_json,status,authoritative_for_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  ).run('candidate-1', tenant, 'workday', 'Workday', 'hcm', 1, '[]', 'CONFIRMED', '["people"]', now, now);
  db.prepare(
    'INSERT INTO integration_connections(id,tenant,candidate_id,product_key,category,state,auth_method,semantic_scopes_json,granted_scopes_json,credential_ref,source_instance_id,mapping_version,last_health_at,last_sync_at,failure_class,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    'connection-1', tenant, 'candidate-1', 'workday', 'hcm', 'VALIDATING', 'oauth2',
    '["people.read"]', '["people.read"]', 'managed://proof/workday', 'fixture-instance', 1,
    now, null, null, now, now
  );
  const insert = db.prepare(
    'INSERT INTO integration_mappings(id,tenant,connection_id,canonical_entity,source_field,canonical_field,confidence,status,mapping_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  );
  insert.run('mapping-1', tenant, 'connection-1', 'Person', 'employee_id', 'employeeId', 1, 'ACTIVE', 1, now);
  insert.run('mapping-2', tenant, 'connection-1', 'Person', 'site', 'location', 1, 'ACTIVE', 1, now);
  insert.run('mapping-3', tenant, 'connection-1', 'Person', 'department', 'department', 1, 'ACTIVE', 1, now);
  insert.run('mapping-4', tenant, 'connection-1', 'Person', 'email', 'email', 1, 'ACTIVE', 1, now);
  db.close();
}

function dbCounts() {
  const db = new DatabaseSync(dbPath);
  const batches = Number(db.prepare('SELECT COUNT(*) AS count FROM integration_canonical_batches').get().count);
  const people = Number(db.prepare('SELECT COUNT(*) AS count FROM integration_canonical_people').get().count);
  db.close();
  return { batches, people };
}

function seedRunAndScope(scope = null) {
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run('run-1', tenant, sha256('contract-1'), 'BUILDING', now, now + 8 * 60 * 60 * 1000, 8, nowIso, nowIso);
  if (scope) {
    db.prepare(
      'INSERT OR REPLACE INTO implementation_scope(run_id,tenant,scope_json,submitted_by_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)'
    ).run('run-1', tenant, JSON.stringify(scope), sha256('proof-admin').slice(0, 16), nowIso, nowIso);
  }
  db.close();
}

function setScope(scope) {
  const db = new DatabaseSync(dbPath);
  const nowIso = new Date().toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO implementation_scope(run_id,tenant,scope_json,submitted_by_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)'
  ).run('run-1', tenant, JSON.stringify(scope), sha256('proof-admin').slice(0, 16), nowIso, nowIso);
  db.close();
}

function requirementMap(status) {
  return new Map(status.requirements.map(item => [item.key, item]));
}

async function main() {
  baseSchema();
  let hub = createAutonomousIntegrationHub({ dbPath, internalToken });
  seedIntegration();

  const records = [
    { employee_id: 'E-100', site: 'Tamworth', department: 'Assembly', email: 'one@example.test' },
    { employee_id: 'E-200', site: 'Tamworth', department: 'Quality', email: 'two@example.test' }
  ];
  const workerHeaders = { 'x-wfm-integration-internal': internalToken };

  const first = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.reconciliation.status, 'PASS');
  assert.equal(first.json.canonicalImport.recordCount, 2);
  assert.equal(first.json.canonicalImport.siteCount, 1);
  assert.equal(first.json.canonicalImport.departmentCount, 2);
  assert.equal(first.json.canonicalImport.replayed, false);
  assert.deepEqual(dbCounts(), { batches: 1, people: 2 });

  const replay = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.canonicalImport.replayed, true);
  assert.equal(replay.json.canonicalImport.checksum, first.json.canonicalImport.checksum);
  assert.deepEqual(dbCounts(), { batches: 1, people: 2 });

  const crossTenant = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant: otherTenant, connectionId: 'connection-1', records
  });
  assert.equal(crossTenant.status, 403);
  assert.deepEqual(dbCounts(), { batches: 1, people: 2 });

  const checksumMismatch = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records, expectedCanonicalChecksum: '0'.repeat(64)
  });
  assert.equal(checksumMismatch.status, 409);
  assert.deepEqual(dbCounts(), { batches: 1, people: 2 });

  const recoverAfterChecksum = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(recoverAfterChecksum.status, 200);
  assert.equal(recoverAfterChecksum.json.canonicalImport.replayed, true);

  const duplicate = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records: [records[0], records[0]]
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.reconciliation.status, 'NEEDS_REVIEW');
  assert.equal(duplicate.json.canonicalImport, null);
  assert.deepEqual(dbCounts(), { batches: 1, people: 2 });

  const recoverAfterDuplicate = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(recoverAfterDuplicate.status, 200);

  const revoked = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/health-report', workerHeaders, {
    connectionId: 'connection-1', health: 'auth_error'
  });
  assert.equal(revoked.status, 200);
  const revokedSync = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(revokedSync.status, 409);

  const restoreDb = new DatabaseSync(dbPath);
  restoreDb.prepare("UPDATE integration_connections SET state='VALIDATING',failure_class=NULL WHERE id=? AND tenant=?").run('connection-1', tenant);
  restoreDb.close();
  const restored = await call(hub.handleRequest, 'POST', '/api/integrations/autonomous/sync-validate', workerHeaders, {
    tenant, connectionId: 'connection-1', records
  });
  assert.equal(restored.status, 200);

  let implementation = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-proof-token',
    invitationRecoverySecret: 'implementation-proof-recovery-secret',
    notificationRetryPollMs: 0
  });
  seedRunAndScope();

  let status = implementation.statusForTenant(tenant);
  assert.ok(status);
  let requirements = requirementMap(status);
  assert.equal(requirements.get('configuration-scope').status, 'MISSING');
  assert.equal(requirements.get('source-systems').status, 'PASS');
  assert.equal(requirements.get('people-data').status, 'PASS');
  assert.equal(requirements.get('organisation-model').status, 'PASS');
  assert.equal(status.operationalReady, false);
  assert.equal(status.sourceDataSummary.employeeCount, 2);
  assert.deepEqual(status.sourceDataSummary.sites, ['Tamworth']);

  const matchingScope = {
    companyName: 'Proof Manufacturing Ltd',
    countries: ['United Kingdom'],
    sites: ['Tamworth'],
    employeeCount: 2,
    sourceSystems: ['Workday'],
    features: ['time', 'payroll'],
    workPatterns: [],
    clockingMethods: [],
    payrollSystem: '',
    hcmSystem: 'Workday',
    erpSystem: '',
    agencyLabour: false,
    priorities: '',
    notes: ''
  };
  setScope(matchingScope);
  status = implementation.statusForTenant(tenant);
  requirements = requirementMap(status);
  assert.equal(requirements.get('configuration-scope').status, 'PASS');
  assert.equal(status.completedRequirements >= 4, true);
  assert.equal(status.operationalReady, false);

  setScope({ ...matchingScope, employeeCount: 3 });
  status = implementation.statusForTenant(tenant);
  requirements = requirementMap(status);
  assert.equal(requirements.get('configuration-scope').status, 'FAIL');
  assert.equal(requirements.get('configuration-scope').detail.sourceValidation.conflicts[0].field, 'employeeCount');
  assert.equal(status.operationalReady, false);

  setScope(matchingScope);
  implementation.close();
  hub.close();

  implementation = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-proof-token',
    invitationRecoverySecret: 'implementation-proof-recovery-secret',
    notificationRetryPollMs: 0
  });
  status = implementation.statusForTenant(tenant);
  requirements = requirementMap(status);
  assert.equal(requirements.get('configuration-scope').status, 'PASS');
  assert.equal(requirements.get('source-systems').status, 'PASS');
  assert.equal(requirements.get('people-data').status, 'PASS');
  assert.equal(requirements.get('organisation-model').status, 'PASS');
  assert.equal(status.sourceDataSummary.checksum, first.json.canonicalImport.checksum);
  implementation.close();

  console.log(
    'VECTOR_IMPLEMENTATION_SOURCE_HANDOFF=PASS' +
    '|canonicalRecords=2|sites=1|departments=2|idempotentReplay=true' +
    '|crossTenantRejected=true|revokedAuthorizationRejected=true|checksumMismatchRejected=true' +
    '|restartReadback=true|scopeConflictBlocked=true|operationalReady=false'
  );

  const port = Number(process.env.PORT || 3000);
  http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', proof: 'implementation-source-handoff' }));
    }
    res.writeHead(404);
    res.end('not found');
  }).listen(port, '0.0.0.0', () => {
    console.log('VECTOR_IMPLEMENTATION_SOURCE_HANDOFF_PROOF_LISTENING=' + port);
  });
}

main().catch(error => {
  console.error('VECTOR_IMPLEMENTATION_SOURCE_HANDOFF=FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
