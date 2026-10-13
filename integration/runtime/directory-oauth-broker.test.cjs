'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDirectoryOAuthBroker,
  verifyState,
  signState,
  deriveVerifier,
  challengeFor,
  safeHttpsOrigin,
  ENTRA_SCOPE
} = require('./directory-oauth-broker.cjs');

function jsonResponse(body, status = 200) {
  return { status, async text() { return JSON.stringify(body); } };
}

function configured(fetchImpl, now = () => 1_800_000_000_000) {
  return createDirectoryOAuthBroker({
    publicOrigin: 'https://wfm.example.test',
    stateSecret: 'state-secret-that-is-long-enough-for-hmac-2026',
    entraClientId: 'entra-client-id',
    entraClientSecret: 'entra-client-secret-never-in-browser',
    fetchImpl,
    now
  });
}

test('public origin must be a clean HTTPS origin', () => {
  assert.equal(safeHttpsOrigin('https://wfm.example.test'), 'https://wfm.example.test');
  assert.throws(() => safeHttpsOrigin('http://wfm.example.test'), /HTTPS origin/);
  assert.throws(() => safeHttpsOrigin('https://wfm.example.test/path'), /HTTPS origin/);
  assert.throws(() => safeHttpsOrigin('https://user:pass@wfm.example.test'), /HTTPS origin/);
});

test('Entra authorization URL uses PKCE, signed state and least-privilege read scope', () => {
  const broker = configured(async () => { throw new Error('not expected'); });
  const auth = broker.buildAuthorization({ sessionId: 'session-123', provider: 'ENTRA' });
  const url = new URL(auth.authorizationUrl);
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.pathname, '/organizations/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://wfm.example.test/api/integrations/autonomous/oauth/callback/entra');
  assert.equal(url.searchParams.get('scope'), ENTRA_SCOPE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge')?.length >= 40);
  assert.ok(url.searchParams.get('state')?.includes('.'));
  assert.equal(auth.authorizationUrl.includes('entra-client-secret-never-in-browser'), false);

  const state = broker.verifyState(url.searchParams.get('state'));
  assert.equal(state.sessionId, 'session-123');
  assert.equal(state.provider, 'ENTRA');
});

test('signed OAuth state rejects tampering and expiry', () => {
  const secret = 'state-secret-that-is-long-enough-for-hmac-2026';
  const state = signState(secret, { s: 'session-1', p: 'ENTRA', e: 2_000 });
  assert.equal(verifyState(secret, state, 1_000).sessionId, 'session-1');
  assert.throws(() => verifyState(secret, state.replace('A', 'B'), 1_000), /Invalid OAuth state/);
  assert.throws(() => verifyState(secret, state, 3_000), /expired/);
});

test('PKCE verifier is deterministic per session and challenge is S256', () => {
  const secret = 'state-secret-that-is-long-enough-for-hmac-2026';
  const a = deriveVerifier(secret, 'session-A');
  const b = deriveVerifier(secret, 'session-A');
  const c = deriveVerifier(secret, 'session-B');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(challengeFor(a), challengeFor(b));
  assert.ok(a.length >= 43);
});

test('token exchange keeps client secret server-side and binds code to same redirect and verifier', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url: String(url), options });
    return jsonResponse({ access_token: 'provider-access-token', scope: ENTRA_SCOPE, expires_in: 3600 });
  };
  const broker = configured(fetchImpl);
  const auth = broker.buildAuthorization({ sessionId: 'session-abc', provider: 'ENTRA' });
  const state = new URL(auth.authorizationUrl).searchParams.get('state');

  const result = await broker.redeemAuthorizationCode({ provider: 'ENTRA', state, code: 'authorization-code' });
  assert.equal(result.sessionId, 'session-abc');
  assert.equal(result.accessToken, 'provider-access-token');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.redirect, 'error');

  const form = new URLSearchParams(seen[0].options.body);
  assert.equal(form.get('client_id'), 'entra-client-id');
  assert.equal(form.get('client_secret'), 'entra-client-secret-never-in-browser');
  assert.equal(form.get('code'), 'authorization-code');
  assert.equal(form.get('redirect_uri'), auth.redirectUri);
  assert.equal(form.get('code_verifier'), deriveVerifier('state-secret-that-is-long-enough-for-hmac-2026', 'session-abc'));
});

test('provider token failures do not leak client secrets or access tokens', async () => {
  const broker = configured(async () => jsonResponse({ error: 'invalid_grant', error_description: 'contains provider details' }, 400));
  const auth = broker.buildAuthorization({ sessionId: 'session-fail', provider: 'ENTRA' });
  const state = new URL(auth.authorizationUrl).searchParams.get('state');
  await assert.rejects(
    () => broker.redeemAuthorizationCode({ provider: 'ENTRA', state, code: 'bad-code' }),
    error => {
      assert.match(error.message, /invalid_grant/);
      assert.equal(error.message.includes('entra-client-secret-never-in-browser'), false);
      assert.equal(error.message.includes('bad-code'), false);
      return true;
    }
  );
});

test('unconfigured or over-privileged discovery providers remain gated', () => {
  const broker = configured(async () => jsonResponse({}));
  const availability = broker.availability();
  const entra = availability.find(x => x.key === 'ENTRA');
  const okta = availability.find(x => x.key === 'OKTA');
  const google = availability.find(x => x.key === 'GOOGLE_WORKSPACE');
  assert.equal(entra.configured, true);
  assert.equal(entra.permission, 'Application.Read.All');
  assert.equal(entra.persistsProviderToken, false);
  assert.equal(okta.configured, false);
  assert.equal(google.configured, false);
  assert.match(google.reason, /admin.directory.user.security/);
  assert.throws(() => broker.buildAuthorization({ sessionId: 'x', provider: 'GOOGLE_WORKSPACE' }), /not enabled/);
});

test('short state secret or missing origin disables automatic Entra authorization', () => {
  const broker = createDirectoryOAuthBroker({
    publicOrigin: 'https://wfm.example.test',
    stateSecret: 'too-short',
    entraClientId: 'id',
    entraClientSecret: 'secret'
  });
  assert.equal(broker.availability().find(x => x.key === 'ENTRA').configured, false);
  assert.throws(() => broker.buildAuthorization({ sessionId: 'x', provider: 'ENTRA' }), /not configured/);
});


test('OAuth discovery rejects overlength session IDs instead of truncating signed state and PKCE identity', () => {
  const broker = configured(async () => { throw new Error('not expected'); });
  const prefix = 's'.repeat(80);
  const a = prefix + 'A';
  const b = prefix + 'B';
  assert.equal(deriveVerifier('state-secret-that-is-long-enough-for-hmac-2026', a) === deriveVerifier('state-secret-that-is-long-enough-for-hmac-2026', b), false);
  assert.throws(() => broker.buildAuthorization({ sessionId: a, provider: 'ENTRA' }), /session/i);
  assert.throws(() => broker.buildAuthorization({ sessionId: b, provider: 'ENTRA' }), /session/i);
});

test('signed OAuth state rejects overlength or ambiguous session identifiers', () => {
  const secret = 'state-secret-that-is-long-enough-for-hmac-2026';
  const expires = 2_000;
  for (const sessionId of ['x'.repeat(81), ' session-1', 'session-1 ', 'session\n1']) {
    const state = signState(secret, { s: sessionId, p: 'ENTRA', e: expires });
    assert.throws(() => verifyState(secret, state, 1_000), /Invalid OAuth state|session/i);
  }
});
