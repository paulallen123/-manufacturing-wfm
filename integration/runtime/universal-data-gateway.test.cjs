'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const {
  createUniversalDataGateway,
  selectRoute,
  validateCanonicalEnvelope
} = require('./universal-data-gateway.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-universal-'));
  const dbPath = path.join(dir, 'wfm.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);'
  );
  const tokens = { manager: 'manager-token', employee: 'employee-token', bravo: 'bravo-token' };
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('manager@example.com', 'alpha', 'manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('employee@example.com', 'alpha', 'employee');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('bravo@example.com', 'bravo', 'manager');
  const expires = Date.now() + 60_000;
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(tokens.manager), 'manager@example.com', expires);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(tokens.employee), 'employee@example.com', expires);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(tokens.bravo), 'bravo@example.com', expires);
  db.close();

  const gateway = createUniversalDataGateway({ dbPath, internalToken: 'integration-worker-test-token' });
  return {
    dir,
    gateway,
    tokens,
    close() {
      gateway.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function response() {
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    },
    headers
  };
}

async function call(gateway, token, method, url, body, extraHeaders = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...extraHeaders
  };
  const res = response();
  const handled = await gateway.handleRequest(req, res);
  assert.equal(handled, true);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

test('route selector covers the major customer boundary cases', () => {
  assert.equal(selectRoute({ existingSystem: false }).route.key, 'VECTOR_NATIVE');
  assert.equal(selectRoute({
    existingSystem: true,
    apiAvailable: true,
    apiApproved: true,
    dataMayLeaveNetwork: true
  }).route.key, 'NATIVE_API');
  assert.equal(selectRoute({
    existingSystem: true,
    apiAvailable: true,
    apiApproved: false,
    dataMayLeaveNetwork: false,
    canInstallBridge: true,
    customerManagedCompute: true,
    outboundHttpsAllowed: true
  }).route.key, 'CUSTOMER_EDGE_BRIDGE');
  assert.equal(selectRoute({
    existingSystem: true,
    canAutomateExport: true,
    canUseSftp: true
  }).route.key, 'AUTOMATED_FILE_EXCHANGE');
  assert.equal(selectRoute({
    existingSystem: true,
    manualExportAvailable: true,
    manualUploadAllowed: true
  }).route.key, 'SECURE_UPLOAD');
  assert.equal(selectRoute({
    existingSystem: true,
    airGapped: true,
    customerManagedCompute: true,
    dataMayLeaveNetwork: false,
    outboundHttpsAllowed: false
  }).route.key, 'AIR_GAPPED_EDGE');
  assert.equal(selectRoute({
    existingSystem: true,
    manualExportAvailable: false,
    browserAutomationApproved: true
  }).route.key, 'CONTROLLED_READ_ONLY_AUTOMATION');
  assert.equal(selectRoute({
    existingSystem: true,
    manualExportAvailable: false,
    browserAutomationApproved: false,
    essentialDataAccessible: false
  }).route.key, 'VECTOR_GAP_CAPTURE');
});

test('canonical envelope rejects invented identity and accepts auditable records', () => {
  const bad = validateCanonicalEnvelope({
    entity: 'Person',
    sourceSystem: 'legacy-hr',
    observedAt: new Date().toISOString(),
    payload: { firstName: 'Ada' }
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('sourceId is required'));

  const good = validateCanonicalEnvelope({
    entity: 'Person',
    sourceSystem: 'legacy-hr',
    sourceId: 'E-100',
    observedAt: new Date().toISOString(),
    permissions: { groups: ['hr'] },
    payload: { firstName: 'Ada' }
  });
  assert.equal(good.valid, true);
  assert.equal(good.normalized.sourceId, 'E-100');
  assert.match(good.normalized.contentHash, /^[a-f0-9]{64}$/);
});

test('manager can create a persisted universal plan and tenant isolation is preserved', async () => {
  const f = fixture();
  try {
    const created = await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/plan', { existingSystem: false });
    assert.equal(created.status, 201);
    assert.equal(created.body.plan.routeKey, 'VECTOR_NATIVE');

    const alpha = await call(f.gateway, f.tokens.manager, 'GET', '/api/integrations/autonomous/universal/status');
    const bravo = await call(f.gateway, f.tokens.bravo, 'GET', '/api/integrations/autonomous/universal/status');
    assert.equal(alpha.body.plan.routeKey, 'VECTOR_NATIVE');
    assert.equal(bravo.body.plan, null);
  } finally {
    f.close();
  }
});

test('employee role cannot configure universal integration planning', async () => {
  const f = fixture();
  try {
    const result = await call(f.gateway, f.tokens.employee, 'POST', '/api/integrations/autonomous/universal/plan', { existingSystem: false });
    assert.equal(result.status, 403);
  } finally {
    f.close();
  }
});

test('controlled automation cannot activate without explicit customer approval', async () => {
  const f = fixture();
  try {
    const created = await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/plan', {
      existingSystem: true,
      manualExportAvailable: false,
      browserAutomationApproved: true
    });
    assert.equal(created.body.plan.routeKey, 'CONTROLLED_READ_ONLY_AUTOMATION');

    const rejected = await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/activate', {
      planId: created.body.plan.id
    });
    assert.equal(rejected.status, 409);

    const activated = await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/activate', {
      planId: created.body.plan.id,
      explicitCustomerApproval: true
    });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.plan.state, 'ACTIVATED');
  } finally {
    f.close();
  }
});

test('route becomes PROVEN only after every route-specific proof requirement passes', async () => {
  const f = fixture();
  try {
    const created = await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/plan', { existingSystem: false });
    await call(f.gateway, f.tokens.manager, 'POST', '/api/integrations/autonomous/universal/activate', { planId: created.body.plan.id });

    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    let latest;
    for (const kind of created.body.plan.readiness.proof.required) {
      latest = await call(f.gateway, null, 'POST', '/api/integrations/autonomous/universal/evidence', {
        planId: created.body.plan.id,
        kind,
        status: 'PASS',
        confidence: 1,
        detail: { verified: true }
      }, internal);
      assert.equal(latest.status, 200);
    }
    assert.equal(latest.body.plan.state, 'PROVEN');
    assert.equal(latest.body.plan.readiness.proof.proven, true);
  } finally {
    f.close();
  }
});

test('trusted worker can validate canonical envelopes', async () => {
  const f = fixture();
  try {
    const result = await call(f.gateway, null, 'POST', '/api/integrations/autonomous/universal/validate-envelope', {
      records: [{
        entity: 'Person',
        sourceSystem: 'file-export',
        sourceId: 'E-200',
        observedAt: new Date().toISOString(),
        payload: { firstName: 'Grace' }
      }]
    }, { 'x-wfm-integration-internal': 'integration-worker-test-token' });
    assert.equal(result.status, 200);
    assert.equal(result.body.valid, 1);
    assert.equal(result.body.invalid, 0);
  } finally {
    f.close();
  }
});
