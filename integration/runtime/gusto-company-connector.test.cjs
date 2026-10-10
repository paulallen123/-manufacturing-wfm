'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const COMPANY = '3c7e9f2a-6810-4e30-9d70-f902825bcd16';
const OTHER_COMPANY = 'ae927b67-4d67-4a72-aa65-fb942be19cb1';
const ADMIN = 'f947feaf-5803-4db7-86c6-43395435f627';
const START = 1_800_000_000_000;
const CLIENT_SECRET = 'test-gusto-client-secret-must-stay-server-side';
const ACCESS = 'test-gusto-access-token-must-stay-encrypted';
const REFRESH = 'test-gusto-refresh-token-must-stay-encrypted';
const CODE = 'test-authorization-code-must-not-be-stored';
const BEGIN = { tenant: 'tenant-a', connectionId: 'connection-a', sessionHash: 'session-hash-a', expectedCompanyUuid: COMPANY };

function environment(overrides = {}) {
  return {
    WFM_GUSTO_CLIENT_ID: 'test-gusto-client-id',
    WFM_GUSTO_CLIENT_SECRET: CLIENT_SECRET,
    WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64: Buffer.alloc(32, 0x97).toString('base64'),
    WFM_PUBLIC_ORIGIN: 'https://vector.example.test',
    ...overrides
  };
}

function create(options) {
  return require('./gusto-company-connector.cjs').createGustoCompanyConnector(options);
}

function fixture(t, { env = environment(), fetchImpl, db, clock } = {}) {
  const database = db || new DatabaseSync(':memory:');
  if (!db) t.after(() => database.close());
  const time = clock || { value: START };
  const connector = create({ db: database, env, now: () => time.value,
    fetchImpl: fetchImpl || (async () => { throw new Error('Unexpected external request'); }) });
  return { db: database, connector, clock: time };
}

function codeIs(code, statusCode) {
  return error => {
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    for (const secret of [CLIENT_SECRET, ACCESS, REFRESH, CODE]) {
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(String(error).includes(secret), false);
      assert.equal(String(error.stack).includes(secret), false);
    }
    return true;
  };
}

function begin(connector, input = BEGIN) {
  const result = connector.beginAuthorization(input);
  return { ...result, state: new URL(result.authorizationUrl).searchParams.get('state') };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function provider() {
  const remote = {
    calls: [],
    tokens: { access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', expires_in: 7200 },
    tokenInfo: { scope: 'companies:read employees:read pay_schedules:read payrolls:read time_sheet:read employees:write',
      resource: { type: 'Company', uuid: COMPANY }, resource_owner: { type: 'CompanyAdmin', uuid: ADMIN } },
    company: { uuid: COMPANY, name: 'Acme Example', slug: 'acme-example', trade_name: null, ein: '99-0123456', entity_type: 'LLC' },
    override: null
  };
  remote.fetch = async (url, options) => {
    remote.calls.push({ url: String(url), options });
    if (remote.override) {
      const response = await remote.override(String(url), options);
      if (response !== undefined) return response;
    }
    const target = new URL(url);
    if (target.pathname === '/oauth/token' && options.method === 'POST') return json(remote.tokens);
    if (target.pathname === '/v1/token_info' && options.method === 'GET') return json(remote.tokenInfo);
    if (target.pathname === '/v1/companies/' + COMPANY && options.method === 'GET') return json(remote.company);
    throw new Error('Unexpected provider request.');
  };
  return remote;
}

async function authorize(connector, input = BEGIN) {
  const { state } = begin(connector, input);
  return connector.completeAuthorization({ tenant: input.tenant, sessionHash: input.sessionHash, state, code: CODE });
}

const VERIFIED = {
  connectionId: 'connection-a', authorizationRef: 'managed://gusto/connection-a',
  companyUuid: COMPANY, companyName: 'Acme Example', environment: 'sandbox',
  grantedScopes: ['organisation.read', 'people.read', 'payroll.read', 'time.read'],
  verifiedAt: '2027-01-15T08:00:00.000Z'
};

test('missing or invalid configuration cannot initiate authorization and reveals only configuration names', t => {
  const { connector } = fixture(t, { env: {} });
  assert.deepEqual(connector.availability(), {
    configured: false,
    environment: 'sandbox',
    missingConfiguration: ['WFM_GUSTO_CLIENT_ID', 'WFM_GUSTO_CLIENT_SECRET', 'WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64', 'WFM_PUBLIC_ORIGIN']
  });
  assert.throws(() => connector.beginAuthorization(BEGIN), codeIs('GUSTO_NOT_CONFIGURED', 503));
  for (const [name, invalid] of [
    ['WFM_GUSTO_ENVIRONMENT', 'production.example.test'],
    ['WFM_GUSTO_ENVIRONMENT', ['sandbox']],
    ['WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64', Buffer.alloc(31).toString('base64')],
    ['WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64', Buffer.alloc(32).toString('base64').replace(/=$/, '')],
    ['WFM_PUBLIC_ORIGIN', 'http://vector.example.test'],
    ['WFM_PUBLIC_ORIGIN', 'https://user:password@vector.example.test'],
    ['WFM_PUBLIC_ORIGIN', 'https://vector.example.test/callback'],
    ['WFM_PUBLIC_ORIGIN', 'https://vector.example.test?'],
    ['WFM_PUBLIC_ORIGIN', 'https://vector.example.test#fragment']
  ]) {
    const { connector: invalidConnector } = fixture(t, { env: environment({ [name]: invalid }) });
    assert.equal(invalidConnector.availability().configured, false, name);
    assert.deepEqual(invalidConnector.availability().missingConfiguration, [name]);
    assert.throws(() => invalidConnector.beginAuthorization(BEGIN), codeIs('GUSTO_NOT_CONFIGURED', 503));
    assert.equal(JSON.stringify(invalidConnector.availability()).includes(CLIENT_SECRET), false);
  }
});

test('authorization uses the selected Gusto host, exact callback, and opaque one-use state stored without its bearer value', t => {
  const { connector, db } = fixture(t);
  const authorization = begin(connector);
  const url = new URL(authorization.authorizationUrl);
  assert.equal(url.origin, 'https://api.gusto-demo.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'test-gusto-client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://vector.example.test/api/integrations/autonomous/oauth/callback/gusto');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'response_type', 'state']);
  assert.match(authorization.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(authorization.expiresAt, '2027-01-15T08:10:00.000Z');
  assert.equal(authorization.environment, 'sandbox');
  const rows = db.prepare('SELECT * FROM gusto_oauth_states').all();
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes(authorization.state), false);
  assert.equal(JSON.stringify(rows).includes(CLIENT_SECRET), false);
  assert.notEqual(begin(connector).state, authorization.state);
  const { connector: production } = fixture(t, { env: environment({ WFM_GUSTO_ENVIRONMENT: 'production' }) });
  assert.equal(new URL(begin(production).authorizationUrl).origin, 'https://api.gusto.com');
});

test('authorization requires a company UUID and nonempty tenant, connection, and browser binding', t => {
  const { connector, db } = fixture(t);
  for (const input of [
    { ...BEGIN, expectedCompanyUuid: '' }, { ...BEGIN, expectedCompanyUuid: 'company-123' },
    { ...BEGIN, tenant: '' }, { ...BEGIN, connectionId: '../other' }, { ...BEGIN, sessionHash: '' }
  ]) assert.throws(() => connector.beginAuthorization(input), codeIs('GUSTO_INVALID_INPUT', 400));
  assert.equal(db.prepare('SELECT count(*) AS count FROM gusto_oauth_states').get().count, 0);
});

test('callback exchanges only at Gusto and verifies company identity plus actual read grants before storing credentials', async t => {
  const remote = provider();
  // Neither this token-response claim nor a write grant may fabricate payroll/time permission.
  remote.tokens.scope = 'companies:read employees:read payrolls:read time_sheet:read';
  remote.tokenInfo.scope = 'companies:read employees:read employees:write pay_schedules:read';
  const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
  const result = await authorize(connector);
  assert.deepEqual(result, { ...VERIFIED, grantedScopes: ['organisation.read', 'people.read'] });
  assert.deepEqual(remote.calls.map(call => call.url), [
    'https://api.gusto-demo.com/oauth/token',
    'https://api.gusto-demo.com/v1/token_info',
    'https://api.gusto-demo.com/v1/companies/' + COMPANY
  ]);
  const tokenRequest = remote.calls[0].options;
  assert.deepEqual(JSON.parse(tokenRequest.body), {
    client_id: 'test-gusto-client-id', client_secret: CLIENT_SECRET,
    redirect_uri: 'https://vector.example.test/api/integrations/autonomous/oauth/callback/gusto',
    code: CODE, grant_type: 'authorization_code'
  });
  assert.equal(new Headers(tokenRequest.headers).get('Content-Type'), 'application/json');
  for (const call of remote.calls) {
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(new URL(call.url).search, '');
  }
  for (const call of remote.calls.slice(1)) {
    const headers = new Headers(call.options.headers);
    assert.equal(headers.get('Authorization'), 'Bearer ' + ACCESS);
    assert.equal(headers.get('X-Gusto-API-Version'), '2026-06-15');
  }
  const persisted = JSON.stringify(db.prepare('SELECT * FROM gusto_company_credentials').all());
  for (const forbidden of [ACCESS, REFRESH, CLIENT_SECRET, CODE, '99-0123456', ADMIN]) assert.equal(persisted.includes(forbidden), false);
  assert.equal(db.prepare('SELECT count(*) AS count FROM gusto_company_credentials').get().count, 1);
});

test('state rejects another tenant or browser without consuming the legitimate callback, then rejects replay', async t => {
  const remote = provider();
  const { connector } = fixture(t, { fetchImpl: remote.fetch });
  const { state } = begin(connector);
  for (const input of [
    { tenant: 'tenant-b', sessionHash: BEGIN.sessionHash },
    { tenant: BEGIN.tenant, sessionHash: 'different-browser' }
  ]) await assert.rejects(() => connector.completeAuthorization({ ...input, state, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  assert.equal(remote.calls.length, 0);
  assert.deepEqual(await connector.completeAuthorization({ tenant: BEGIN.tenant, sessionHash: BEGIN.sessionHash, state, code: CODE }), VERIFIED);
  await assert.rejects(() => connector.completeAuthorization({ tenant: BEGIN.tenant, sessionHash: BEGIN.sessionHash, state, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  assert.equal(remote.calls.length, 3);
});

test('expired state and declined consent never exchange a code and declined consent consumes its state', async t => {
  const remote = provider();
  const { connector, clock } = fixture(t, { fetchImpl: remote.fetch });
  const expired = begin(connector);
  clock.value += 10 * 60 * 1000;
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: expired.state, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  const declined = begin(connector);
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: declined.state, providerError: CLIENT_SECRET }), codeIs('GUSTO_OAUTH_DENIED', 400));
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: declined.state, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  assert.equal(remote.calls.length, 0);
});

test('callback rejects a non-company subject, a different company, and a mismatching company response without persisting a connection', async t => {
  for (const change of [
    remote => { remote.tokenInfo.resource = { type: 'Oauth::Application', uuid: COMPANY }; },
    remote => { remote.tokenInfo.resource = { type: 'Company', uuid: OTHER_COMPANY }; },
    remote => { remote.company.uuid = OTHER_COMPANY; },
    remote => { remote.tokenInfo.scope = 'employees:read'; }
  ]) {
    const remote = provider();
    change(remote);
    const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
    await assert.rejects(() => authorize(connector), error => {
      assert.ok(['GUSTO_TOKEN_SUBJECT_INVALID', 'GUSTO_COMPANY_MISMATCH', 'GUSTO_SCOPE_REQUIRED'].includes(error.code));
      assert.equal(error.statusCode, 403);
      return true;
    });
    assert.equal(db.prepare('SELECT count(*) AS count FROM gusto_company_credentials').get().count, 0);
    assert.equal(connector.getConnectionStatus({ tenant: BEGIN.tenant, connectionId: BEGIN.connectionId }), null);
  }
});

test('state and encrypted credentials survive restart while tenant, environment, and encryption-key boundaries remain enforced', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gusto-connector-'));
  const path = join(dir, 'integration.sqlite');
  const remote = provider();
  let db = new DatabaseSync(path);
  t.after(() => { try { db.close(); } finally { rmSync(dir, { recursive: true, force: true }); } });
  const first = create({ db, env: environment(), fetchImpl: remote.fetch, now: () => START });
  const { state } = begin(first);
  db.close();
  db = new DatabaseSync(path);
  const second = create({ db, env: environment(), fetchImpl: remote.fetch, now: () => START });
  assert.deepEqual(await second.completeAuthorization({ ...BEGIN, state, code: CODE }), VERIFIED);
  db.close();
  db = new DatabaseSync(path);
  const third = create({ db, env: environment(), fetchImpl: remote.fetch, now: () => START });
  assert.deepEqual(await third.verifyConnection({ tenant: BEGIN.tenant, connectionId: BEGIN.connectionId }), VERIFIED);
  await assert.rejects(() => third.verifyConnection({ tenant: 'tenant-b', connectionId: BEGIN.connectionId }), codeIs('GUSTO_CONNECTION_NOT_FOUND', 404));
  await assert.rejects(() => third.completeAuthorization({ ...BEGIN, state, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  const status = third.getConnectionStatus({ tenant: BEGIN.tenant, connectionId: BEGIN.connectionId });
  assert.deepEqual(status, Object.fromEntries(Object.entries(VERIFIED).filter(([key]) => key !== 'authorizationRef')));
  assert.equal(third.getConnectionStatus({ tenant: 'tenant-b', connectionId: BEGIN.connectionId }), null);
  const production = create({ db, env: environment({ WFM_GUSTO_ENVIRONMENT: 'production' }), fetchImpl: remote.fetch, now: () => START });
  assert.equal(production.getConnectionStatus(BEGIN), null);
  await assert.rejects(() => production.verifyConnection(BEGIN), codeIs('GUSTO_ENVIRONMENT_MISMATCH', 409));
  const missingConfig = create({ db, env: {}, fetchImpl: remote.fetch, now: () => START });
  assert.equal(missingConfig.getConnectionStatus(BEGIN), null);
  const wrongKey = create({ db, env: environment({ WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64: Buffer.alloc(32, 0x41).toString('base64') }), fetchImpl: remote.fetch, now: () => START });
  assert.equal(wrongKey.getConnectionStatus(BEGIN), null);
  await assert.rejects(() => wrongKey.verifyConnection(BEGIN), codeIs('GUSTO_CREDENTIALS_UNREADABLE', 503));
  assert.equal(db.prepare('SELECT 1 AS still_open').get().still_open, 1);
  for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, CODE, state]) assert.equal(readFileSync(path).includes(Buffer.from(secret)), false);
});

test('provider rejection and network failures expose safe codes without provider bodies or request secrets', async t => {
  for (const [status, code, publicStatus] of [
    [400, 'GUSTO_AUTHORIZATION_REJECTED', 400],
    [401, 'GUSTO_UNAUTHORIZED', 401],
    [403, 'GUSTO_FORBIDDEN', 403],
    [429, 'GUSTO_RATE_LIMITED', 429],
    [500, 'GUSTO_PROVIDER_UNAVAILABLE', 502]
  ]) {
    const remote = provider();
    remote.override = async () => json({ error: CLIENT_SECRET, error_description: ACCESS + REFRESH + CODE }, status);
    const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
    await assert.rejects(() => authorize(connector), codeIs(code, publicStatus));
    assert.equal(db.prepare('SELECT count(*) AS count FROM gusto_company_credentials').get().count, 0);
  }
  const { connector } = fixture(t, { fetchImpl: async () => { throw new Error(CLIENT_SECRET + CODE + ACCESS); } });
  await assert.rejects(() => authorize(connector), codeIs('GUSTO_PROVIDER_UNAVAILABLE', 502));
});

test('redirects, malformed token responses, and oversized provider bodies fail closed', async t => {
  for (const [makeResponse, expectedCode] of [
    [() => Response.redirect('https://attacker.example.test/steal', 302), 'GUSTO_PROVIDER_REDIRECT'],
    [() => json({ payload: 'x'.repeat(256 * 1024) }), 'GUSTO_RESPONSE_TOO_LARGE'],
    [() => json({ ...provider().tokens }, 200, { 'Content-Length': String(256 * 1024 + 1) }), 'GUSTO_RESPONSE_TOO_LARGE'],
    [() => new Response('<html>' + CLIENT_SECRET + '</html>'), 'GUSTO_INVALID_PROVIDER_RESPONSE'],
    [() => json({ ...provider().tokens, access_token: 'with\nnewline' }), 'GUSTO_INVALID_PROVIDER_RESPONSE'],
    [() => json({ ...provider().tokens, refresh_token: null }), 'GUSTO_INVALID_PROVIDER_RESPONSE'],
    [() => json({ ...provider().tokens, expires_in: 0 }), 'GUSTO_INVALID_PROVIDER_RESPONSE'],
    [() => json({ ...provider().tokens, token_type: 'mac' }), 'GUSTO_INVALID_PROVIDER_RESPONSE']
  ]) {
    const { connector } = fixture(t, { fetchImpl: async () => makeResponse() });
    await assert.rejects(() => authorize(connector), codeIs(expectedCode, 502));
  }
});

test('a stalled external request is aborted and cannot leave an indefinitely pending callback', { timeout: 20_000 }, async t => {
  let signal;
  const { connector } = fixture(t, { fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(CLIENT_SECRET)), { once: true }));
  } });
  await assert.rejects(() => authorize(connector), codeIs('GUSTO_PROVIDER_TIMEOUT', 504));
  assert.equal(signal.aborted, true);
});

test('expired credentials rotate as one encrypted pair and subsequent refreshes use the persisted replacement', async t => {
  const remote = provider();
  const { connector, db, clock } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  clock.value += 7_201_000;
  remote.calls.length = 0;
  remote.tokens = { access_token: 'rotated-access-one', refresh_token: 'rotated-refresh-one', token_type: 'Bearer', expires_in: 7200 };
  assert.deepEqual(await connector.verifyConnection(BEGIN), { ...VERIFIED, verifiedAt: '2027-01-15T10:00:01.000Z' });
  assert.equal(remote.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(remote.calls[0].options.body), {
    client_id: 'test-gusto-client-id', client_secret: CLIENT_SECRET,
    redirect_uri: 'https://vector.example.test/api/integrations/autonomous/oauth/callback/gusto',
    refresh_token: REFRESH, grant_type: 'refresh_token'
  });
  assert.equal(new Headers(remote.calls[1].options.headers).get('Authorization'), 'Bearer rotated-access-one');
  const reopened = create({ db, env: environment(), fetchImpl: remote.fetch, now: () => clock.value });
  remote.calls.length = 0;
  assert.equal((await reopened.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(remote.calls.some(call => call.url.endsWith('/oauth/token')), false);
  clock.value += 7_201_000;
  remote.calls.length = 0;
  remote.tokens = { access_token: 'rotated-access-two', refresh_token: 'rotated-refresh-two', token_type: 'Bearer', expires_in: 7200 };
  await reopened.verifyConnection(BEGIN);
  assert.equal(JSON.parse(remote.calls[0].options.body).refresh_token, 'rotated-refresh-one');
  const persisted = JSON.stringify(db.prepare('SELECT * FROM gusto_company_credentials').all());
  for (const secret of ['rotated-access-one', 'rotated-refresh-one', 'rotated-access-two', 'rotated-refresh-two']) assert.equal(persisted.includes(secret), false);
});

test('an early access-token 401 refreshes once and then rechecks the company with the replacement', async t => {
  const remote = provider();
  const { connector } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  remote.calls.length = 0;
  remote.tokens = { ...remote.tokens, access_token: 'fresh-after-401', refresh_token: 'refresh-after-401' };
  remote.override = async (url, options) => {
    if (url.endsWith('/v1/token_info') && new Headers(options.headers).get('Authorization') === 'Bearer ' + ACCESS) return json({ error: ACCESS }, 401);
  };
  assert.deepEqual(await connector.verifyConnection(BEGIN), VERIFIED);
  assert.equal(remote.calls.filter(call => call.url.endsWith('/oauth/token')).length, 1);
  assert.equal(new Headers(remote.calls.at(-1).options.headers).get('Authorization'), 'Bearer fresh-after-401');
});

test('transient refresh failure preserves the previous credential pair and releases its lease for retry', async t => {
  const remote = provider();
  const { connector, db, clock } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  const before = db.prepare('SELECT encrypted_tokens, credential_version FROM gusto_company_credentials').get();
  clock.value += 7_201_000;
  remote.override = async url => url.endsWith('/oauth/token') ? json({ error: REFRESH }, 500) : undefined;
  await assert.rejects(() => connector.verifyConnection(BEGIN), codeIs('GUSTO_PROVIDER_UNAVAILABLE', 502));
  assert.deepEqual(db.prepare('SELECT encrypted_tokens, credential_version FROM gusto_company_credentials').get(), before);
  remote.override = null;
  remote.calls.length = 0;
  remote.tokens = { ...remote.tokens, access_token: 'recovered-access', refresh_token: 'recovered-refresh' };
  assert.equal((await connector.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(JSON.parse(remote.calls[0].options.body).refresh_token, REFRESH);
});

test('rotated credentials survive a later provider outage but are not reported verified until a successful company check', async t => {
  const remote = provider();
  const { connector, db, clock } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  clock.value += 7_201_000;
  remote.tokens = { ...remote.tokens, access_token: 'rotated-before-outage', refresh_token: 'refresh-before-outage' };
  remote.override = async url => url.endsWith('/v1/token_info') ? json({ error: 'temporarily unavailable' }, 500) : undefined;
  await assert.rejects(() => connector.verifyConnection(BEGIN), codeIs('GUSTO_PROVIDER_UNAVAILABLE', 502));
  assert.equal(connector.getConnectionStatus(BEGIN), null);
  remote.override = null;
  remote.calls.length = 0;
  const restarted = create({ db, env: environment(), fetchImpl: remote.fetch, now: () => clock.value });
  assert.equal((await restarted.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(new Headers(remote.calls[0].options.headers).get('Authorization'), 'Bearer rotated-before-outage');
  assert.equal(remote.calls.some(call => call.url.endsWith('/oauth/token')), false);
  assert.equal(restarted.getConnectionStatus(BEGIN).companyUuid, COMPANY);
});

test('refresh revocation and repeated 401/403 responses clear verified status without loops or raw provider details', async t => {
  for (const scenario of ['refresh-400', 'refresh-401', 'read-401', 'read-403']) {
    const remote = provider();
    const { connector, clock } = fixture(t, { fetchImpl: remote.fetch });
    await authorize(connector);
    remote.calls.length = 0;
    if (scenario.startsWith('refresh')) clock.value += 7_201_000;
    remote.override = async url => {
      if (scenario.startsWith('refresh') && url.endsWith('/oauth/token')) return json({ error: CLIENT_SECRET + REFRESH }, Number(scenario.slice(-3)));
      if (scenario.startsWith('read') && url.endsWith('/v1/token_info')) return json({ error: ACCESS }, Number(scenario.slice(-3)));
    };
    const expected = scenario.startsWith('refresh') ? ['GUSTO_REAUTHORIZATION_REQUIRED', 401]
      : scenario === 'read-401' ? ['GUSTO_UNAUTHORIZED', 401] : ['GUSTO_FORBIDDEN', 403];
    await assert.rejects(() => connector.verifyConnection(BEGIN), codeIs(...expected));
    assert.equal(connector.getConnectionStatus(BEGIN), null);
    assert.ok(remote.calls.filter(call => call.url.endsWith('/oauth/token')).length <= 1);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('two SQLite connections cannot simultaneously consume a single-use refresh token', { timeout: 5000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gusto-concurrency-'));
  const path = join(dir, 'integration.sqlite');
  const dbA = new DatabaseSync(path);
  const dbB = new DatabaseSync(path);
  t.after(() => { dbA.close(); dbB.close(); rmSync(dir, { recursive: true, force: true }); });
  const remote = provider();
  const clock = { value: START };
  const { connector: first } = fixture(t, { db: dbA, clock, fetchImpl: remote.fetch });
  const { connector: second } = fixture(t, { db: dbB, clock, fetchImpl: remote.fetch });
  await authorize(first);
  clock.value += 7_201_000;
  remote.calls.length = 0;
  const started = deferred();
  const response = deferred();
  remote.override = async url => {
    if (url.endsWith('/oauth/token')) { started.resolve(); return response.promise; }
  };
  const firstVerification = first.verifyConnection(BEGIN);
  await Promise.race([started.promise, firstVerification.then(() => { throw new Error('Expired credentials were not refreshed.'); })]);
  try {
    await assert.rejects(() => second.verifyConnection(BEGIN), codeIs('GUSTO_REFRESH_IN_PROGRESS', 409));
  } finally { response.resolve(json({ ...remote.tokens, access_token: 'concurrent-access', refresh_token: 'concurrent-refresh' })); }
  assert.equal((await firstVerification).companyUuid, COMPANY);
  assert.equal((await second.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(remote.calls.filter(call => call.url.endsWith('/oauth/token')).length, 1);
});

test('a late refresh response cannot overwrite a newer completed authorization for the same connection', { timeout: 5000 }, async t => {
  const remote = provider();
  const { connector, clock } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  clock.value += 7_201_000;
  const started = deferred();
  const response = deferred();
  remote.override = async (url, options) => {
    if (url.endsWith('/oauth/token') && JSON.parse(options.body).grant_type === 'refresh_token') {
      started.resolve(); return response.promise;
    }
  };
  const staleVerification = connector.verifyConnection(BEGIN);
  // Attach a rejection observer while a new authorization completes.
  const staleResult = assert.rejects(staleVerification, codeIs('GUSTO_REFRESH_CONFLICT', 409));
  await Promise.race([started.promise, staleResult]);
  remote.tokens = { ...remote.tokens, access_token: 'new-authorization-access', refresh_token: 'new-authorization-refresh' };
  try { assert.equal((await authorize(connector)).companyUuid, COMPANY); }
  finally { response.resolve(json({ ...remote.tokens, access_token: 'stale-refresh-access', refresh_token: 'stale-refresh-token' })); }
  await staleResult;
  remote.calls.length = 0;
  await connector.verifyConnection(BEGIN);
  assert.equal(new Headers(remote.calls[0].options.headers).get('Authorization'), 'Bearer new-authorization-access');
});

test('an expired refresh lease left by a stopped worker is reclaimed safely', async t => {
  const remote = provider();
  const { connector, db, clock } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  clock.value += 7_201_000;
  db.prepare('UPDATE gusto_company_credentials SET refresh_lease_id = ?, refresh_lease_until = ?').run('stopped-worker', clock.value - 1);
  remote.calls.length = 0;
  assert.equal((await connector.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(remote.calls[0].options.method, 'POST');
  assert.equal(JSON.parse(remote.calls[0].options.body).grant_type, 'refresh_token');
});

test('encrypted credentials are authenticated against tenant, connection, company, and environment', async t => {
  for (const [field, replacement, envChange] of [
    ['tenant', 'other-tenant', {}],
    ['connection_id', 'other-connection', {}],
    ['company_uuid', OTHER_COMPANY, {}],
    ['environment', 'production', { WFM_GUSTO_ENVIRONMENT: 'production' }]
  ]) {
    const remote = provider();
    const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
    await authorize(connector);
    // Field names are a literal test allowlist, never external SQL input.
    db.prepare('UPDATE gusto_company_credentials SET ' + field + ' = ?').run(replacement);
    const consumer = create({ db, env: environment(envChange), fetchImpl: remote.fetch, now: () => START });
    const target = { tenant: field === 'tenant' ? replacement : BEGIN.tenant,
      connectionId: field === 'connection_id' ? replacement : BEGIN.connectionId };
    remote.calls.length = 0;
    await assert.rejects(() => consumer.verifyConnection(target), codeIs('GUSTO_CREDENTIALS_UNREADABLE', 503));
    assert.equal(remote.calls.length, 0);
    assert.equal(consumer.getConnectionStatus(target), null);
  }
});

test('concurrent authorizations cannot retarget an already verified connection to a different company', async t => {
  for (const reverse of [false, true]) {
    const remote = provider();
    const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
    const first = begin(connector);
    const second = begin(connector, { ...BEGIN, expectedCompanyUuid: OTHER_COMPANY });
    const companies = reverse ? [OTHER_COMPANY, COMPANY] : [COMPANY, OTHER_COMPANY];
    const states = reverse ? [second.state, first.state] : [first.state, second.state];
    let activeCompany = companies[0];
    remote.override = async url => {
      if (url.endsWith('/v1/token_info')) return json({ ...remote.tokenInfo, resource: { type: 'Company', uuid: activeCompany } });
      if (url.endsWith('/v1/companies/' + activeCompany)) return json({ ...remote.company, uuid: activeCompany });
    };
    assert.equal((await connector.completeAuthorization({ ...BEGIN, expectedCompanyUuid: activeCompany, state: states[0], code: CODE })).companyUuid, companies[0]);
    const before = db.prepare('SELECT * FROM gusto_company_credentials').get();
    activeCompany = companies[1];
    await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, expectedCompanyUuid: activeCompany, state: states[1], code: CODE }), codeIs('GUSTO_COMPANY_MISMATCH', 403));
    assert.deepEqual(db.prepare('SELECT * FROM gusto_company_credentials').get(), before);
    assert.equal(connector.getConnectionStatus(BEGIN).companyUuid, companies[0]);
  }
});

test('a pending authorization cannot move a verified connection into another Gusto environment', async t => {
  const remote = provider();
  const { connector: sandbox, db } = fixture(t, { fetchImpl: remote.fetch });
  const production = create({ db, env: environment({ WFM_GUSTO_ENVIRONMENT: 'production' }), fetchImpl: remote.fetch, now: () => START });
  const state = begin(production).state;
  await authorize(sandbox);
  const before = db.prepare('SELECT * FROM gusto_company_credentials').get();
  await assert.rejects(() => production.completeAuthorization({ ...BEGIN, state, code: CODE }), codeIs('GUSTO_ENVIRONMENT_MISMATCH', 409));
  assert.deepEqual(db.prepare('SELECT * FROM gusto_company_credentials').get(), before);
});

test('changing the registered OAuth client invalidates stored status and pending state until explicit reauthorization', async t => {
  const remote = provider();
  const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
  const pending = begin(connector).state;
  await authorize(connector);
  const replacementApp = create({ db, env: environment({ WFM_GUSTO_CLIENT_ID: 'replacement-app-id' }), fetchImpl: remote.fetch, now: () => START });
  remote.calls.length = 0;
  assert.equal(replacementApp.getConnectionStatus(BEGIN), null);
  await assert.rejects(() => replacementApp.verifyConnection(BEGIN), codeIs('GUSTO_CLIENT_MISMATCH', 409));
  await assert.rejects(() => replacementApp.completeAuthorization({ ...BEGIN, state: pending, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
  assert.equal(remote.calls.length, 0);
  assert.equal((await authorize(replacementApp)).companyUuid, COMPANY);
  assert.equal(replacementApp.getConnectionStatus(BEGIN).companyUuid, COMPANY);
  assert.equal(connector.getConnectionStatus(BEGIN), null);
  const rotatedSecret = create({ db, env: environment({ WFM_GUSTO_CLIENT_ID: 'replacement-app-id', WFM_GUSTO_CLIENT_SECRET: 'rotated-client-secret' }), fetchImpl: remote.fetch, now: () => START });
  assert.equal(rotatedSecret.getConnectionStatus(BEGIN).companyUuid, COMPANY);
});

test('a changed tenant company binding rejects a pending callback before token exchange and preserves stored credentials', async t => {
  const remote = provider();
  const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  const pending = begin(connector).state;
  const stored = db.prepare('SELECT * FROM gusto_company_credentials').get();
  remote.calls.length = 0;
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: pending, code: CODE,
    expectedCompanyUuid: OTHER_COMPANY }), codeIs('GUSTO_COMPANY_MISMATCH', 403));
  assert.equal(remote.calls.length, 0);
  assert.deepEqual(db.prepare('SELECT * FROM gusto_company_credentials').get(), stored);
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: pending, code: CODE }), codeIs('GUSTO_INVALID_STATE', 400));
});

test('temporary SQLite write contention after a successful refresh retries persistence without consuming the token twice', { timeout: 5000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gusto-refresh-write-'));
  const path = join(dir, 'integration.sqlite');
  const db = new DatabaseSync(path);
  const writer = new DatabaseSync(path);
  let releaseTimer;
  t.after(() => { clearTimeout(releaseTimer); writer.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  const remote = provider();
  const { connector, clock } = fixture(t, { db, fetchImpl: remote.fetch });
  await authorize(connector);
  clock.value += 7_201_000;
  remote.calls.length = 0;
  remote.override = async url => {
    if (url.endsWith('/oauth/token')) {
      writer.exec('BEGIN IMMEDIATE');
      releaseTimer = setTimeout(() => writer.exec('ROLLBACK'), 75);
      return json({ ...remote.tokens, access_token: 'access-after-db-lock', refresh_token: 'refresh-after-db-lock' });
    }
  };
  assert.equal((await connector.verifyConnection(BEGIN)).companyUuid, COMPANY);
  assert.equal(remote.calls.filter(call => call.url.endsWith('/oauth/token')).length, 1);
  assert.equal(new Headers(remote.calls.at(-1).options.headers).get('Authorization'), 'Bearer access-after-db-lock');
  assert.equal(connector.getConnectionStatus(BEGIN).companyUuid, COMPANY);
});

test('storage failures have safe connector errors and cannot produce a successful authorization result', async t => {
  const remote = provider();
  const { connector, db } = fixture(t, { fetchImpl: remote.fetch });
  const pending = begin(connector).state;
  db.exec('PRAGMA query_only=ON');
  assert.throws(() => connector.beginAuthorization(BEGIN), codeIs('GUSTO_STORAGE_UNAVAILABLE', 503));
  await assert.rejects(() => connector.completeAuthorization({ ...BEGIN, state: pending, code: CODE }), codeIs('GUSTO_STORAGE_UNAVAILABLE', 503));
  assert.equal(remote.calls.length, 0);
  db.exec('PRAGMA query_only=OFF');
  assert.equal((await connector.completeAuthorization({ ...BEGIN, state: pending, code: CODE })).companyUuid, COMPANY);
});

test('an old verification denial becomes a retryable conflict after a newer authorization succeeds', { timeout: 5000 }, async t => {
  const remote = provider();
  const { connector } = fixture(t, { fetchImpl: remote.fetch });
  await authorize(connector);
  const started = deferred();
  const response = deferred();
  remote.override = async (url, options) => {
    if (url.endsWith('/v1/token_info') && new Headers(options.headers).get('Authorization') === 'Bearer ' + ACCESS) {
      started.resolve(); return response.promise;
    }
  };
  const outdatedResult = assert.rejects(connector.verifyConnection(BEGIN), codeIs('GUSTO_REFRESH_CONFLICT', 409));
  await started.promise;
  remote.tokens = { ...remote.tokens, access_token: 'new-authorization-after-denial', refresh_token: 'new-refresh-after-denial' };
  try { assert.equal((await authorize(connector)).companyUuid, COMPANY); }
  finally { response.resolve(json({ error: ACCESS + REFRESH }, 403)); }
  await outdatedResult;
  assert.equal(connector.getConnectionStatus(BEGIN).companyUuid, COMPANY);
  remote.calls.length = 0;
  await connector.verifyConnection(BEGIN);
  assert.equal(new Headers(remote.calls[0].options.headers).get('Authorization'), 'Bearer new-authorization-after-denial');
});
