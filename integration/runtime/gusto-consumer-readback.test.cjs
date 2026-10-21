'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('./autonomous-integration-hub.cjs');

const PREFIX = '/api/integrations/autonomous';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://vector.example.test';
const env = {
  WFM_GUSTO_CLIENT_ID: 'fixture-client',
  WFM_GUSTO_CLIENT_SECRET: 'fixture-client-secret',
  WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString('base64'),
  WFM_PUBLIC_ORIGIN: ORIGIN,
  WFM_GUSTO_ENVIRONMENT: 'sandbox'
};

function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'vector-gusto-hub-'));
  const dbPath = join(directory, 'integration.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  const tokens = { alpha: 'a'.repeat(64), bravo: 'b'.repeat(64), employee: 'e'.repeat(64), viewer: 'v'.repeat(64), secondSession: 's'.repeat(64) };
  for (const [name, tenant, role] of [
    ['alpha', 'alpha', 'manager'], ['bravo', 'bravo', 'admin'],
    ['employee', 'alpha', 'employee'], ['viewer', 'alpha', 'viewer']
  ]) {
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(name, tenant, role);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(tokens[name]).digest('hex'), name, Date.now() + 600_000);
  }
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(tokens.secondSession).digest('hex'), 'alpha', Date.now() + 600_000);
  db.close();
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (options.fetchImpl) { const result = await options.fetchImpl(url, init); if (result) return result; }
    const path = new URL(url).pathname;
    if (path === '/oauth/token') return Response.json({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 7200, token_type: 'Bearer' });
    if (path === '/v1/token_info') return Response.json({ scope: 'companies:read employees:read payrolls:read', resource: { type: 'Company', uuid: options.companyUuid || COMPANY }, resource_owner: { type: 'CompanyAdmin', uuid: 'not-the-company' } });
    if (path === '/v1/companies/' + COMPANY) return Response.json({ uuid: COMPANY, name: 'Fixture company' });
    throw new Error('Unexpected provider request: ' + path);
  };
  let hub = createAutonomousIntegrationHub({ dbPath, env: options.env || env, fetchImpl, internalToken: 'fixture-worker' });
  return {
    dbPath, tokens, requests,
    get hub() { return hub; },
    restart() { hub.close(); hub = createAutonomousIntegrationHub({ dbPath, env: options.env || env, fetchImpl, internalToken: 'fixture-worker' }); },
    close() { hub.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}

async function call(f, token, method, suffix, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { method, url: PREFIX + suffix, headers: { ...(token ? { cookie: 'wfm_session=' + token } : {}), ...headers } });
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = String(value); this.writableEnded = true; }
  };
  assert.equal(await f.hub.handleRequest(req, res), true);
  return { status: res.statusCode, headers: res.headers, body: res.body ? (res.headers['content-type']?.startsWith('application/json') ? JSON.parse(res.body) : res.body) : null };
}

async function prepare(f) {
  const discovered = await call(f, f.tokens.alpha, 'POST', '/discover', { source: 'USER', apps: [{ productKey: 'gusto', name: 'Gusto' }] });
  assert.equal(discovered.status, 200);
  assert.equal(discovered.body.detected, 1);
  const candidate = discovered.body.candidates[0];
  assert.equal((await call(f, f.tokens.alpha, 'POST', '/confirm', { candidateId: candidate.id, authoritativeFor: ['people', 'payroll'] })).status, 200);
  const connected = await call(f, f.tokens.alpha, 'POST', '/connect', { candidateId: candidate.id, authMethod: 'oauth2' });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.connection.state, 'AUTHORIZATION_REQUIRED');
  return connected.body.connection.id;
}

async function authorize(f, connectionId) {
  return call(f, f.tokens.alpha, 'POST', '/gusto/authorize', { connectionId, expectedCompanyUuid: COMPANY }, { origin: ORIGIN });
}

function callback(state, code = 'fixture-code') {
  return '/oauth/callback/gusto?state=' + encodeURIComponent(state) + '&code=' + encodeURIComponent(code);
}

async function complete(f, token, state, code = 'fixture-code', headers = { origin: ORIGIN }) {
  return call(f, token, 'POST', '/gusto/complete', { state, code }, headers);
}

// Consumer boundary: use the real hub/connector and only replace provider I/O.
for (const denial of ['forbidden', 'wrong-company', 'missing-scope']) {
  test(`provider ${denial} removes durable consumer readiness; recovery requires revalidation`, async t => {
    let deny = false;
    const f = fixture({ fetchImpl: async url => {
      if (!deny || new URL(url).pathname !== '/v1/token_info') return;
      if (denial === 'forbidden') return Response.json({ error: 'synthetic-private-provider-detail' }, { status: 403 });
      return Response.json({
        scope: denial === 'missing-scope' ? 'employees:read' : 'companies:read employees:read payrolls:read',
        resource: { type: 'Company', uuid: denial === 'wrong-company' ? '22222222-2222-4222-8222-222222222222' : COMPANY }
      });
    } });
    t.after(() => f.close());
    const id = await prepare(f);
    const state = new URL((await authorize(f, id)).body.authorizationUrl).searchParams.get('state');
    assert.equal((await complete(f, f.tokens.alpha, state)).status, 200);
    assert.equal((await call(f, f.tokens.alpha, 'POST', '/mapping-activate', {
      connectionId: id, mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    })).status, 200);
    assert.equal((await call(f, undefined, 'POST', '/sync-validate', {
      tenant: 'alpha', connectionId: id, records: [{ employee_id: 'synthetic-person' }]
    }, { 'x-wfm-integration-internal': 'fixture-worker' })).status, 200);
    assert.equal(f.hub.statusForTenant('alpha').readiness.readyForPeopleSync, true);
    const priorSync = f.hub.statusForTenant('alpha').connections[0].lastSyncAt;
    assert.ok(priorSync);
    deny = true;
    const failure = await call(f, f.tokens.alpha, 'POST', '/gusto/verify', { connectionId: id }, { origin: ORIGIN });
    assert.equal(failure.status, 403);
    assert.equal(failure.body.code, { forbidden: 'GUSTO_FORBIDDEN', 'wrong-company': 'GUSTO_COMPANY_MISMATCH', 'missing-scope': 'GUSTO_SCOPE_REQUIRED' }[denial]);
    assert.doesNotMatch(JSON.stringify(failure), /synthetic-private-provider-detail|fixture-access-token|fixture-refresh-token|fixture-client-secret/);
    for (const restart of [false, true]) {
      if (restart) f.restart();
      const readback = await call(f, f.tokens.secondSession, 'GET', '/status');
      assert.equal(readback.status, 200);
      const status = readback.body;
      assert.equal(status.readiness.readyForPeopleSync, false);
      assert.equal(status.readiness.needsAdminAction, 1);
      assert.equal(status.connections[0].state, 'REAUTH_REQUIRED');
      assert.equal(status.connections[0].gusto, null);
      assert.equal(status.connections[0].lastSyncAt, priorSync);
      assert.deepEqual((await call(f, f.tokens.bravo, 'GET', '/status')).body.connections, []);
    }
    const requestCount = f.requests.length;
    const health = await call(f, undefined, 'POST', '/health-report', { connectionId: id, health: 'healthy' }, { 'x-wfm-integration-internal': 'fixture-worker' });
    assert.equal(health.status, 409);
    assert.equal(f.requests.length, requestCount);
    deny = false;
    const recovery = await call(f, f.tokens.alpha, 'POST', '/gusto/verify', { connectionId: id }, { origin: ORIGIN });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.body.dataSynced, false);
    assert.equal(recovery.body.payrollProof, false);
    assert.equal(recovery.body.connection.state, 'VALIDATING');
    f.restart();
    assert.equal(f.hub.statusForTenant('alpha').readiness.readyForPeopleSync, false);
    assert.equal(f.hub.statusForTenant('alpha').connections[0].state, 'VALIDATING');
    assert.equal(f.hub.statusForTenant('alpha').connections[0].gusto.companyUuid, COMPANY);
    assert.ok(f.requests.every(r => new URL(r.url).origin === 'https://api.gusto-demo.com'));
    assert.ok(f.requests.every(r => new URL(r.url).pathname === '/oauth/token' || r.init.method === 'GET'));
  });
}
