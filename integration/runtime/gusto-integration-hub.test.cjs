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
    if (options.fetchImpl) return options.fetchImpl(url, init);
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

test('Gusto appears in the existing catalog and missing setup never reports a connection', async t => {
  const f = fixture({ env: {} }); t.after(() => f.close());
  const catalog = await call(f, f.tokens.alpha, 'GET', '/catalog');
  assert.deepEqual(catalog.body.systems.find(x => x.key === 'gusto').authMethods, ['oauth2']);
  const configuration = await call(f, f.tokens.alpha, 'GET', '/gusto/configuration');
  assert.equal(configuration.status, 200);
  assert.equal(configuration.body.configured, false);
  assert.ok(configuration.body.missingConfiguration.includes('WFM_GUSTO_CLIENT_SECRET'));
  const id = await prepare(f);
  const result = await authorize(f, id);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'GUSTO_NOT_CONFIGURED');
  assert.equal(f.requests.length, 0);
  assert.equal(f.hub.statusForTenant('alpha').readiness.readyForPeopleSync, false);
});

test('authorization verifies the exact company, survives restart, and does not certify a data sync', async t => {
  const f = fixture(); t.after(() => f.close());
  const id = await prepare(f);
  const started = await authorize(f, id);
  assert.equal(started.status, 200);
  const url = new URL(started.body.authorizationUrl);
  assert.equal(url.origin, 'https://api.gusto-demo.com');
  assert.equal(url.searchParams.get('redirect_uri'), ORIGIN + PREFIX + '/oauth/callback/gusto');
  assert.equal(started.headers['cache-control'], 'no-store');
  const landing = await call(f, undefined, 'GET', callback(url.searchParams.get('state')));
  assert.equal(landing.status, 200);
  assert.match(landing.headers['content-type'], /^text\/html/);
  assert.doesNotMatch(landing.body, /fixture-code|fixture-access-token|fixture-refresh-token/);
  assert.equal(f.requests.length, 0);
  const completed = await complete(f, f.tokens.alpha, url.searchParams.get('state'));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.verified, true);
  assert.equal(completed.headers['referrer-policy'], 'no-referrer');
  const status = f.hub.statusForTenant('alpha');
  const connection = status.connections.find(c => c.id === id);
  assert.equal(connection.state, 'VALIDATING');
  assert.equal(connection.sourceInstanceId, COMPANY);
  assert.equal(connection.gusto.companyUuid, COMPANY);
  assert.equal(connection.gusto.companyName, 'Fixture company');
  assert.equal(connection.lastSyncAt, null);
  assert.equal(connection.canonicalImport, null);
  assert.equal(status.readiness.readyForPeopleSync, false);
  assert.deepEqual(connection.grantedScopes.slice().sort(), ['organisation.read', 'payroll.read', 'people.read']);
  assert.doesNotMatch(JSON.stringify(status), /fixture-access-token|fixture-refresh-token|fixture-client-secret|authorizationRef|credential_ref/);
  f.restart();
  assert.equal(f.hub.statusForTenant('alpha').connections[0].gusto.companyUuid, COMPANY);
  const verified = await call(f, f.tokens.alpha, 'POST', '/gusto/verify', { connectionId: id }, { origin: ORIGIN });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.connection.state, 'VALIDATING');
  assert.equal(verified.body.dataSynced, false);
  assert.equal(verified.body.payrollProof, false);
});

test('Gusto setup requires an administrator, the original tenant, and same-origin authorization', async t => {
  const f = fixture(); t.after(() => f.close());
  const id = await prepare(f);
  for (const token of [undefined, f.tokens.employee, f.tokens.viewer]) {
    const result = await call(f, token, 'POST', '/gusto/authorize', { connectionId: id, expectedCompanyUuid: COMPANY }, { origin: ORIGIN });
    assert.equal(result.status, token ? 403 : 401);
  }
  assert.equal((await call(f, f.tokens.bravo, 'POST', '/gusto/authorize', { connectionId: id, expectedCompanyUuid: COMPANY }, { origin: ORIGIN })).status, 404);
  for (const headers of [{}, { origin: 'https://attacker.example.test' }, { origin: 'null' }]) {
    assert.equal((await call(f, f.tokens.alpha, 'POST', '/gusto/authorize', { connectionId: id, expectedCompanyUuid: COMPANY }, headers)).status, 403);
  }
  assert.equal(f.requests.length, 0);
});

test('a configured company selection is tenant-scoped and cannot be overridden by the browser', async t => {
  const f = fixture({ env: { ...env, WFM_GUSTO_TENANT_COMPANIES_JSON: JSON.stringify({ alpha: COMPANY }) } }); t.after(() => f.close());
  assert.equal((await call(f, f.tokens.alpha, 'GET', '/gusto/configuration')).body.expectedCompanyUuid, COMPANY);
  assert.equal((await call(f, f.tokens.bravo, 'GET', '/gusto/configuration')).body.expectedCompanyUuid, null);
  const id = await prepare(f);
  const wrong = await call(f, f.tokens.alpha, 'POST', '/gusto/authorize', { connectionId: id, expectedCompanyUuid: '22222222-2222-4222-8222-222222222222' }, { origin: ORIGIN });
  assert.equal(wrong.status, 409);
  assert.equal(f.requests.length, 0);
  const selected = await call(f, f.tokens.alpha, 'POST', '/gusto/authorize', { connectionId: id }, { origin: ORIGIN });
  assert.equal(selected.status, 200);
});

test('invalid tenant configuration blocks callback completion and verification before contacting Gusto', async t => {
  const configuredEnv = { ...env, WFM_GUSTO_TENANT_COMPANIES_JSON: JSON.stringify({ alpha: COMPANY }) };
  const f = fixture({ env: configuredEnv }); t.after(() => f.close());
  const id = await prepare(f);
  const state = new URL((await authorize(f, id)).body.authorizationUrl).searchParams.get('state');
  configuredEnv.WFM_GUSTO_TENANT_COMPANIES_JSON = '{invalid';
  f.restart();
  assert.equal((await complete(f, f.tokens.alpha, state)).status, 503);
  assert.equal((await call(f, f.tokens.alpha, 'POST', '/gusto/verify', { connectionId: id }, { origin: ORIGIN })).status, 503);
  assert.equal(f.requests.length, 0);
  assert.equal(f.hub.statusForTenant('alpha').connections[0].state, 'AUTHORIZATION_REQUIRED');
});

test('a changed tenant company selection invalidates historical sync readiness and cannot activate through health attestation', async t => {
  const configuredEnv = { ...env, WFM_GUSTO_TENANT_COMPANIES_JSON: JSON.stringify({ alpha: COMPANY }) };
  const f = fixture({ env: configuredEnv }); t.after(() => f.close());
  const id = await prepare(f);
  const state = new URL((await authorize(f, id)).body.authorizationUrl).searchParams.get('state');
  assert.equal((await complete(f, f.tokens.alpha, state)).status, 200);
  const mapped = await call(f, f.tokens.alpha, 'POST', '/mapping-activate', {
    connectionId: id, mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
  });
  assert.equal(mapped.status, 200);
  const synced = await call(f, undefined, 'POST', '/sync-validate', {
    tenant: 'alpha', connectionId: id, records: [{ employee_id: 'fixture-person' }]
  }, { 'x-wfm-integration-internal': 'fixture-worker' });
  assert.equal(synced.status, 200);
  assert.equal(f.hub.statusForTenant('alpha').readiness.readyForPeopleSync, true);
  const requestCount = f.requests.length;
  configuredEnv.WFM_GUSTO_TENANT_COMPANIES_JSON = JSON.stringify({ alpha: '22222222-2222-4222-8222-222222222222' });
  f.restart();
  assert.equal(f.hub.statusForTenant('alpha').readiness.readyForPeopleSync, false);
  assert.equal(f.hub.statusForTenant('alpha').connections[0].gusto, null);
  const health = await call(f, undefined, 'POST', '/health-report', { connectionId: id, health: 'healthy' }, { 'x-wfm-integration-internal': 'fixture-worker' });
  assert.equal(health.status, 409);
  const verified = await call(f, f.tokens.alpha, 'POST', '/gusto/verify', { connectionId: id }, { origin: ORIGIN });
  assert.equal(verified.status, 409);
  assert.equal(f.requests.length, requestCount);
});

test('changing the company selection while authorization is pending rejects it before credential exchange', async t => {
  const configuredEnv = { ...env, WFM_GUSTO_TENANT_COMPANIES_JSON: JSON.stringify({ alpha: COMPANY }) };
  const f = fixture({ env: configuredEnv }); t.after(() => f.close());
  const state = new URL((await authorize(f, await prepare(f))).body.authorizationUrl).searchParams.get('state');
  configuredEnv.WFM_GUSTO_TENANT_COMPANIES_JSON = JSON.stringify({ alpha: '22222222-2222-4222-8222-222222222222' });
  f.restart();
  const result = await complete(f, f.tokens.alpha, state);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'GUSTO_COMPANY_MISMATCH');
  assert.equal(f.requests.length, 0);
  assert.equal(f.hub.statusForTenant('alpha').connections[0].gusto, null);
});

test('an OAuth callback from a different session or tenant cannot consume the original state', async t => {
  const f = fixture(); t.after(() => f.close());
  const started = await authorize(f, await prepare(f));
  const state = new URL(started.body.authorizationUrl).searchParams.get('state');
  for (const token of [f.tokens.bravo, f.tokens.secondSession]) {
    assert.equal((await complete(f, token, state)).status, 400);
  }
  assert.equal(f.requests.length, 0);
  assert.equal((await complete(f, f.tokens.alpha, state)).status, 200);
  const count = f.requests.length;
  assert.equal((await complete(f, f.tokens.alpha, state)).status, 400);
  assert.equal(f.requests.length, count);
});

test('a wrong Gusto company and worker attestation cannot mark Gusto authorized', async t => {
  const f = fixture({ companyUuid: '22222222-2222-4222-8222-222222222222' }); t.after(() => f.close());
  const id = await prepare(f);
  const attested = await call(f, undefined, 'POST', '/authorize-complete', { connectionId: id, authorizationRef: 'managed://forged-gusto', grantedScopes: ['people.read'], sourceInstanceId: COMPANY }, { 'x-wfm-integration-internal': 'fixture-worker' });
  assert.equal(attested.status, 409);
  const started = await authorize(f, id);
  const state = new URL(started.body.authorizationUrl).searchParams.get('state');
  const completed = await complete(f, f.tokens.alpha, state);
  assert.equal(completed.status, 403);
  assert.equal(completed.body.code, 'GUSTO_COMPANY_MISMATCH');
  const connection = f.hub.statusForTenant('alpha').connections[0];
  assert.equal(connection.state, 'AUTHORIZATION_REQUIRED');
  assert.equal(connection.sourceInstanceId, null);
  assert.deepEqual(connection.grantedScopes, []);
});

test('callback completion requires the original session and origin and errors remain secret-free', async t => {
  const f = fixture(); t.after(() => f.close());
  const started = await authorize(f, await prepare(f));
  const state = new URL(started.body.authorizationUrl).searchParams.get('state');
  assert.equal((await complete(f, undefined, state)).status, 401);
  assert.equal((await complete(f, f.tokens.alpha, state, 'fixture-code', {})).status, 403);
  assert.equal((await complete(f, f.tokens.alpha, state, 'fixture-code', { origin: 'https://attacker.example.test' })).status, 403);
  const malformed = await call(f, f.tokens.alpha, 'POST', '/gusto/complete', { state, code: 'fixture-code', providerError: 'access_denied' }, { origin: ORIGIN });
  assert.equal(malformed.status, 400);
  assert.equal(f.requests.length, 0);
  const denied = await call(f, f.tokens.alpha, 'POST', '/gusto/complete', { state, providerError: 'access_denied', error_description: 'fixture-secret-provider-message' }, { origin: ORIGIN });
  assert.ok(denied.status >= 400 && denied.status < 500);
  assert.doesNotMatch(JSON.stringify(denied), /fixture-secret-provider-message|fixture-client-secret/);
  assert.equal(denied.headers['referrer-policy'], 'no-referrer');
});
