'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNangoCredentialProvider, createForMetadataProfiles } = require('../integration/runtime/nango-credential-provider.cjs');

const AT = Date.parse('2026-10-31T12:00:00.000Z');
const KEY = 'fictional-environment-key-for-heldout-only';
const TOKEN = 'fictional-provider-token-for-heldout-only';

function binding(overrides = {}) {
  return { tenant: 'tenant_a', profileId: 'netsuite_a', provider: 'netsuite', system: 'Oracle NetSuite',
    credentialRef: 'WFM_BROKER_TOKEN_NS_A', integrationId: 'netsuite', connectionId: 'connection_a',
    expectedConnectionConfig: { accountId: '123456_SB1' }, ...overrides };
}
function context(b = binding()) {
  return { tenant: b.tenant, profileId: b.profileId, provider: b.provider, system: b.system,
    credentialRef: b.credentialRef, actor: { tenant: b.tenant, email: 'admin@example.test' } };
}
function connection(b = binding(), overrides = {}) {
  return { id: 7, connection_id: b.connectionId, provider_config_key: b.integrationId,
    provider: b.provider === 'netsuite' ? 'netsuite' : 'sap-success-factors', errors: [],
    tags: { vector_tenant_id: b.tenant, vector_profile_id: b.profileId },
    connection_config: { ...b.expectedConnectionConfig },
    credentials: { type: 'OAUTH2', access_token: TOKEN, expires_at: new Date(AT + 3_600_000).toISOString(),
      refresh_token: 'fictional-refresh-value-must-be-discarded', raw: { secret: 'fictional-raw-secret-must-be-discarded' } },
    ...overrides };
}
function response(url, value, options = {}) {
  const r = new Response(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value), {
    status: options.status ?? 200, headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  Object.defineProperty(r, 'url', { value: options.url ?? url });
  if (options.redirected) Object.defineProperty(r, 'redirected', { value: true });
  return r;
}
function provider(b = binding(), fetchImpl = async url => response(url, connection(b)), options = {}) {
  return createNangoCredentialProvider({ bindings: [b], apiKey: KEY, now: () => AT, fetchImpl, ...options });
}
function safeError(error) {
  const rendered = String(error.stack) + JSON.stringify(error);
  assert.ok(!rendered.includes(KEY));
  assert.ok(!rendered.includes(TOKEN));
  assert.ok(!rendered.includes('fictional-refresh-value-must-be-discarded'));
  assert.equal(error.cause, undefined);
  assert.match(error.code, /^NANGO_[A-Z_]+$/);
  return true;
}
function profile(b = binding()) {
  const origin = 'https://' + b.expectedConnectionConfig.accountId.toLowerCase().replaceAll('_', '-') + '.suitetalk.api.netsuite.com';
  return { id: b.profileId, tenant: b.tenant, provider: b.provider, system: b.system,
    credentialEnv: b.credentialRef, accountId: b.expectedConnectionConfig.accountId, restOrigin: origin, allowedOrigin: origin };
}

test('NetSuite requests exactly one approved connection and returns only token and real expiry', async () => {
  let calls = 0;
  const resolve = provider(binding(), async (url, init) => {
    calls++;
    const actual = new URL(url);
    assert.equal(actual.origin, 'https://api.nango.dev');
    assert.equal(actual.pathname, '/connections/connection_a');
    assert.deepEqual([...actual.searchParams], [['provider_config_key', 'netsuite'], ['refresh_token', 'false']]);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + KEY);
    assert.equal(init.body, undefined);
    return response(url, connection());
  });
  assert.deepEqual(await resolve(context()), { accessToken: TOKEN, expiresAt: '2026-10-31T13:00:00.000Z' });
  assert.equal(calls, 1);
});

test('SuccessFactors accepts only its documented TWO_STEP token and matching target', async () => {
  const b = binding({ profileId: 'sf_a', provider: 'successfactors', system: 'SAP SuccessFactors',
    credentialRef: 'WFM_BROKER_TOKEN_SF_A', integrationId: 'sap-success-factors', connectionId: 'sf_connection_a',
    expectedConnectionConfig: { apiServer: 'api10.successfactors.com', companyId: 'fictional-company-a' } });
  const doc = connection(b, { credentials: { type: 'TWO_STEP', token: TOKEN, expires_at: '2026-10-31T13:00:00Z' } });
  assert.deepEqual(await provider(b, async url => response(url, doc))(context(b)), {
    accessToken: TOKEN, expiresAt: '2026-10-31T13:00:00.000Z'
  });
  doc.credentials = { type: 'OAUTH2', access_token: TOKEN, expires_at: '2026-10-31T13:00:00.000Z' };
  await assert.rejects(provider(b, async url => response(url, doc))(context(b)), safeError);
});

test('every tenant/profile/provider/system/credential reference mismatch refuses before fetch', async () => {
  let calls = 0;
  const resolve = provider(binding(), async url => { calls++; return response(url, connection()); });
  for (const field of ['tenant', 'profileId', 'provider', 'system', 'credentialRef']) {
    const ctx = context(); ctx[field] = 'other';
    await assert.rejects(resolve(ctx), error => error.code === 'NANGO_CONTEXT_REJECTED');
  }
  const absentActor = context(); delete absentActor.actor;
  await assert.rejects(resolve(absentActor), safeError);
  await assert.rejects(resolve({ ...context(), actor: { tenant: 'tenant_b' } }), safeError);
  assert.equal(calls, 0);
});

test('connection identity, ownership tags, account and unhealthy status cannot be substituted', async () => {
  const corruptions = [
    x => { x.connection_id = 'connection_b'; },
    x => { x.provider_config_key = 'other-integration'; },
    x => { x.provider = 'sap-success-factors'; },
    x => { x.tags.vector_tenant_id = 'tenant_b'; },
    x => { x.tags.vector_profile_id = 'other-profile'; },
    x => { delete x.tags.vector_tenant_id; },
    x => { x.connection_config.accountId = '999999_SB1'; },
    x => { x.connection_config = null; },
    x => { x.errors = [{ type: 'auth', message: TOKEN }]; },
    x => { x.errors = undefined; }
  ];
  for (const corrupt of corruptions) {
    const doc = connection(); corrupt(doc);
    await assert.rejects(provider(binding(), async url => response(url, doc))(context()), safeError);
  }
});

test('caller mutation after construction or while awaiting fetch cannot change the binding', async () => {
  const b = binding(), original = structuredClone(b); let release;
  const pending = new Promise(resolve => { release = resolve; });
  let observed;
  const resolve = provider(b, async url => { observed = url; await pending; return response(url, connection(original)); });
  b.connectionId = 'wrong_connection'; b.expectedConnectionConfig.accountId = 'wrong_account';
  const result = resolve(context(original));
  b.tenant = 'tenant_b'; b.profileId = 'other_profile';
  release();
  assert.equal((await result).accessToken, TOKEN);
  assert.equal(new URL(observed).pathname, '/connections/connection_a');
});

test('concurrent tenants completing in reverse order keep their own tokens', async () => {
  const a = binding(), b = binding({ tenant: 'tenant_b', profileId: 'netsuite_b', connectionId: 'connection_b', credentialRef: 'WFM_BROKER_TOKEN_NS_B' });
  const callbacks = new Map();
  const resolve = createNangoCredentialProvider({ bindings: [a, b], apiKey: KEY, now: () => AT,
    fetchImpl: url => new Promise(done => { callbacks.set(new URL(url).pathname, () => {
      const selected = new URL(url).pathname.endsWith('connection_a') ? a : b;
      const doc = connection(selected); doc.credentials.access_token = TOKEN + selected.tenant;
      done(response(url, doc));
    }); }) });
  const one = resolve(context(a)), two = resolve(context(b));
  callbacks.get('/connections/connection_b')();
  assert.equal((await two).accessToken, TOKEN + 'tenant_b');
  callbacks.get('/connections/connection_a')();
  assert.equal((await one).accessToken, TOKEN + 'tenant_a');
});

test('dot path IDs and prototype provider names are refused as configuration before I/O', async () => {
  let calls = 0;
  const transport = async url => { calls++; return response(url, connection()); };
  for (const id of ['.', '..']) {
    assert.throws(() => provider(binding({ connectionId: id }), transport), error => error.code === 'NANGO_CONFIGURATION_INVALID');
  }
  for (const p of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => provider(binding({ provider: p }), transport), error => error.code === 'NANGO_CONFIGURATION_INVALID');
  }
  assert.equal(calls, 0);
});

test('origin alternatives are refused without network access', () => {
  for (const origin of ['http://api.nango.dev', 'https://api.nango.dev.evil.test', 'https://api.nango.dev@evil.test',
    'https://api.nango.dev/path', 'https://api.nango.dev?redirect=evil', 'https://localhost', 'https://127.0.0.1']) {
    assert.throws(() => provider(binding(), async () => { assert.fail('unexpected fetch'); }, { apiOrigin: origin }), safeError);
  }
});

test('request deadline wins even when fetch ignores cancellation', { timeout: 1200 }, async () => {
  let signal;
  const resolve = provider(binding(), async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, { timeoutMs: 25 });
  await assert.rejects(resolve(context()), error => error.code === 'NANGO_REQUEST_TIMEOUT');
  assert.equal(signal.aborted, true);
});

test('request deadline also covers a stuck response reader and stuck cancel', { timeout: 1200 }, async () => {
  let cancelled = false;
  const resolve = provider(binding(), async url => ({ url, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
    body: { getReader() { return { read() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); }, releaseLock() {} }; } }
  }), { timeoutMs: 25 });
  await assert.rejects(resolve(context()), error => error.code === 'NANGO_REQUEST_TIMEOUT');
  assert.equal(cancelled, true);
});

test('declared and streamed response limits independently prevent oversized credentials', async () => {
  for (const headers of [{ 'Content-Length': '2048' }, { 'Content-Length': '1' }]) {
    const resolve = provider(binding(), async url => response(url, 'x'.repeat(2048), { headers }), { maxResponseBytes: 1024 });
    await assert.rejects(resolve(context()), error => error.code === 'NANGO_RESPONSE_TOO_LARGE');
  }
});

test('redirects and response URL drift never yield credentials', async () => {
  for (const options of [{ status: 302 }, { redirected: true }, { url: 'https://api.nango.dev/connections/other' }, { url: 'https://other.example.test/connections/connection_a' }]) {
    await assert.rejects(provider(binding(), async url => response(url, connection(), options))(context()), error => error.code === 'NANGO_REDIRECT_REJECTED');
  }
});

test('invalid JSON, invalid UTF-8 and error responses cannot echo token-containing bodies', async () => {
  const cases = [
    url => response(url, '{"private":"' + TOKEN),
    url => response(url, new Uint8Array([0xff, 0xfe, 0x00])),
    url => response(url, { error: { message: KEY + TOKEN } }, { status: 424 }),
    () => { throw Object.assign(Error(KEY + TOKEN), { cause: { authorization: KEY } }); }
  ];
  for (const make of cases) await assert.rejects(provider(binding(), async url => make(url))(context()), safeError);
});

test('expiry must be real UTC time with more than 30 seconds and at most seven days remaining', async () => {
  for (const value of [undefined, '2026-10-31T13:00:00', '2026-10-31T13:00:00+00:00',
    '2026-10-31T12:00:30.000Z', '2026-11-07T12:00:00.001Z', '2026-10-30T12:00:00.000Z']) {
    const doc = connection(); doc.credentials.expires_at = value;
    await assert.rejects(provider(binding(), async url => response(url, doc))(context()), error => error.code === 'NANGO_CREDENTIAL_EXPIRY_INVALID');
  }
  const badCalendar = connection(); badCalendar.credentials.expires_at = '2026-02-30T12:00:00.000Z';
  await assert.rejects(provider(binding(), async url => response(url, badCalendar), { now: () => Date.parse('2026-02-28T12:00:00.000Z') })(context()),
    error => error.code === 'NANGO_CREDENTIAL_EXPIRY_INVALID');
  const boundary = connection(); boundary.credentials.expires_at = '2026-11-07T12:00:00.000Z';
  assert.equal((await provider(binding(), async url => response(url, boundary))(context())).expiresAt, boundary.credentials.expires_at);
});

test('expiry is checked after network/body consumption rather than at request start', async () => {
  let current = AT;
  const doc = connection(); doc.credentials.expires_at = new Date(AT + 60_000).toISOString();
  await assert.rejects(provider(binding(), async url => { current += 40_000; return response(url, doc); }, { now: () => current })(context()),
    error => error.code === 'NANGO_CREDENTIAL_EXPIRY_INVALID');
});

test('profile loader preserves explicit disabled mode and refuses partial or drifted mappings', async () => {
  assert.equal(createForMetadataProfiles({ profiles: [profile()], env: {} }), null);
  assert.equal(createForMetadataProfiles({ profiles: [profile()], env: { WFM_NANGO_METADATA_BINDINGS_JSON: '[]' } }), null);
  const env = { WFM_NANGO_API_KEY: KEY, WFM_NANGO_METADATA_BINDINGS_JSON: JSON.stringify([binding()]) };
  assert.throws(() => createForMetadataProfiles({ profiles: [], env }), safeError);
  assert.throws(() => createForMetadataProfiles({ profiles: [profile(), { ...profile(), id: 'another' }], env }), safeError);
  assert.throws(() => createForMetadataProfiles({ profiles: [{ ...profile(), allowedOrigin: 'https://other.example.test' }], env }), safeError);
  const resolve = createForMetadataProfiles({ profiles: [profile()], env, now: () => AT, fetchImpl: async url => response(url, connection()) });
  assert.equal((await resolve(context())).accessToken, TOKEN);
});
