'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('../../integration/runtime/autonomous-integration-hub.cjs');
const { createOneDayEnterpriseEngine } = require('../../implementation/runtime/one-day-enterprise-engine.cjs');

const hash = value => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-v019-source-change-'));
  const dbPath = path.join(dir, 'tenant.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);' +
    "CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');" +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  for (const tenant of ['alpha', 'bravo']) {
    db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant, 1, '{}');
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(`manager@${tenant}`, tenant, 'manager', 'manager', 1, 's', '00', JSON.stringify(['company.configure']));
  }
  const tokens = { alpha: 'm'.repeat(64), bravo: 'b'.repeat(64) };
  for (const tenant of ['alpha', 'bravo']) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(tokens[tenant]), `manager@${tenant}`, Date.now() + 60000);
  }
  db.close();
  const engine = createOneDayEnterpriseEngine({ dbPath, internalToken: 'implementation-worker-test-token', notificationRetryPollMs: 0, agentsApiEnabled: false });
  const hub = createAutonomousIntegrationHub({ dbPath, internalToken: 'integration-worker-test-token' });
  t.after(() => { hub.close(); engine.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dbPath, engine, hub, tokens };
}

async function request(handler, token, method, url, body, extraHeaders = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { ...(token ? { cookie: 'wfm_session=' + token } : {}), ...extraHeaders };
  const res = {
    statusCode: 200, headersSent: false, writableEnded: false, body: '',
    setHeader() {},
    end(value = '') { this.body = String(value); this.headersSent = true; this.writableEnded = true; }
  };
  assert.equal(await handler.handleRequest(req, res), true);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

test('changed validated source mapping reopens source proof until a new batch arrives', async t => {
  const f = fixture(t);
  const implementation = '/api/implementation/autonomous';
  const integration = '/api/integrations/autonomous';
  const worker = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
  const started = await request(f.engine, null, 'POST', implementation + '/contract-activated',
    { tenant: 'alpha', contractRef: 'synthetic-contract', recipientEmail: 'manager@alpha' },
    { 'x-wfm-implementation-internal': 'implementation-worker-test-token' });
  assert.equal(started.status, 201);
  const before = await request(f.engine, f.tokens.alpha, 'GET', implementation + '/status');
  assert.equal(before.status, 200);
  assert.equal(before.body.requirements.find(item => item.key === 'source-systems').satisfied, false);

  const discovered = await request(f.hub, f.tokens.alpha, 'POST', integration + '/discover', {
    source: 'ENTRA', apps: [{ appId: 'w-1', displayName: 'Workday Production' }]
  });
  assert.equal(discovered.status, 200);
  const candidateId = discovered.body.candidates[0].id;
  assert.equal((await request(f.hub, f.tokens.alpha, 'POST', integration + '/confirm',
    { candidateId, authoritativeFor: ['people'] })).status, 200);
  const connected = await request(f.hub, f.tokens.alpha, 'POST', integration + '/connect',
    { candidateId, authMethod: 'oauth2', sourceInstanceId: 'synthetic-workday' });
  assert.equal(connected.status, 200);
  const connectionId = connected.body.connection.id;
  assert.equal((await request(f.hub, null, 'POST', integration + '/authorize-complete',
    { connectionId, authorizationRef: 'vault://tenant/alpha/workday', grantedScopes: ['people.read'] }, worker)).status, 200);
  const preview = await request(f.hub, f.tokens.alpha, 'POST', integration + '/mapping-preview',
    { connectionId, sourceFields: ['employee_number', 'first_name', 'last_name', 'email', 'department', 'location'] });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.unresolved, []);
  assert.equal((await request(f.hub, f.tokens.alpha, 'POST', integration + '/mapping-activate', {
    connectionId, mappings: preview.body.suggestions.map(({ sourceField, canonicalField, confidence }) => ({ sourceField, canonicalField, confidence }))
  })).status, 200);
  const validated = await request(f.hub, null, 'POST', integration + '/sync-validate', {
    tenant: 'alpha', connectionId,
    records: [{ employee_number: 'E-100', first_name: 'A', last_name: 'One', email: 'a@example.test', department: 'Assembly', location: 'Plant 1' }]
  }, worker);
  assert.equal(validated.status, 200);
  assert.equal(validated.body.reconciliation.status, 'PASS');
  const batchId = validated.body.canonicalImport.batchId;
  const persisted = new DatabaseSync(f.dbPath);
  try {
    const batch = persisted.prepare('SELECT tenant,status,record_count FROM integration_canonical_batches WHERE id=?').get(batchId);
    assert.equal(batch.tenant, 'alpha');
    assert.equal(batch.status, 'PASS');
    assert.equal(batch.record_count, 1);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS count FROM integration_canonical_people WHERE batch_id=?').get(batchId).count, 1);
  } finally {
    persisted.close();
  }

  const after = await request(f.engine, f.tokens.alpha, 'GET', implementation + '/status');
  assert.equal(after.status, 200);
  const source = after.body.requirements.find(item => item.key === 'source-systems');
  assert.equal(source.status, 'PASS');
  assert.equal(source.satisfied, true);
  assert.equal(source.detail.batchId, batchId);
  assert.equal(source.detail.connectionId, connectionId);
  const identityAccessBefore = after.body.requirements.find(item => item.key === 'identity-access');
  const remapped = preview.body.suggestions.map(({ sourceField, canonicalField, confidence }) => ({
    sourceField: sourceField === 'employee_number' ? 'worker_id' : sourceField,
    canonicalField,
    confidence
  }));
  const changedMapping = await request(f.hub, f.tokens.alpha, 'POST', integration + '/mapping-activate', {
    connectionId, mappings: remapped
  });
  assert.equal(changedMapping.status, 200);
  assert.equal(changedMapping.body.mappingVersion, 2);
  const stale = await request(f.engine, f.tokens.alpha, 'GET', implementation + '/status');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.requirements.find(item => item.key === 'source-systems').satisfied, false,
    'the old PASS batch cannot satisfy a new mapping version');
  assert.equal(stale.body.requirements.find(item => item.key === 'identity-access').status, identityAccessBefore.status,
    'a source mapping change must not independently change identity-access status');
  const obsoleteShape = await request(f.hub, null, 'POST', integration + '/sync-validate', {
    tenant: 'alpha', connectionId,
    records: [{ employee_number: 'E-100', first_name: 'A', last_name: 'One', email: 'a@example.test', department: 'Assembly', location: 'Plant 1' }]
  }, worker);
  assert.equal(obsoleteShape.status, 200, 'validation may return a bounded reconciliation result');
  assert.notEqual(obsoleteShape.body.reconciliation.status, 'PASS',
    'an old source record shape cannot satisfy the new mapping');
  const beforeRefreshed = new DatabaseSync(f.dbPath);
  try {
    assert.equal(beforeRefreshed.prepare(
      "SELECT COUNT(*) AS count FROM integration_canonical_batches WHERE tenant=? AND mapping_version=2 AND status='PASS'"
    ).get('alpha').count, 0, 'invalid v2 data cannot persist a PASS batch');
  } finally {
    beforeRefreshed.close();
  }
  const stillStale = await request(f.engine, f.tokens.alpha, 'GET', implementation + '/status');
  assert.equal(stillStale.body.requirements.find(item => item.key === 'source-systems').satisfied, false);
  const refreshed = await request(f.hub, null, 'POST', integration + '/sync-validate', {
    tenant: 'alpha', connectionId,
    records: [{ worker_id: 'E-100', first_name: 'A', last_name: 'One', email: 'a@example.test', department: 'Assembly', location: 'Plant 2' }]
  }, worker);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.reconciliation.status, 'PASS');
  assert.notEqual(refreshed.body.canonicalImport.batchId, batchId);
  const current = await request(f.engine, f.tokens.alpha, 'GET', implementation + '/status');
  assert.equal(current.status, 200);
  const currentSource = current.body.requirements.find(item => item.key === 'source-systems');
  assert.equal(currentSource.satisfied, true);
  assert.equal(currentSource.detail.batchId, refreshed.body.canonicalImport.batchId);
  assert.equal(currentSource.detail.mappingVersion, 2);
  assert.equal(current.body.requirements.find(item => item.key === 'identity-access').status, identityAccessBefore.status);
  assert.equal(current.body.requirements.find(item => item.key === 'people-data').satisfied, false,
    'a validated source batch alone cannot reconcile onboarding and operating identities');
  const retained = new DatabaseSync(f.dbPath);
  try {
    const batches = retained.prepare('SELECT id,mapping_version,status FROM integration_canonical_batches WHERE tenant=? ORDER BY rowid').all('alpha');
    assert.deepEqual(batches.map(item => [item.id, item.mapping_version, item.status]), [
      [batchId, 1, 'PASS'], [refreshed.body.canonicalImport.batchId, 2, 'PASS']
    ], 'old batch remains durable but the current mapping consumes the new batch');
  } finally {
    retained.close();
  }
  const otherTenant = await request(f.engine, f.tokens.bravo, 'GET', implementation + '/status');
  assert.equal(otherTenant.status, 200);
  assert.equal(otherTenant.body.requirements?.find(item => item.key === 'source-systems')?.satisfied ?? false, false,
    'the other tenant must not inherit source readiness');
  assert.equal(JSON.stringify(otherTenant.body).includes(batchId), false,
    'another tenant must not observe the imported batch');
  assert.equal(JSON.stringify(otherTenant.body).includes(refreshed.body.canonicalImport.batchId), false,
    'another tenant must not observe the refreshed batch');
});
