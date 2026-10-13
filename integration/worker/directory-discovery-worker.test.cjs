'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverEntra,
  discoverOkta,
  discoverGoogleWorkspace,
  assertSafeHttpsUrl,
  fetchJson
} = require('./directory-discovery-worker.cjs');

function headers(values = {}) {
  const map = new Map(Object.entries(values).map(([k,v]) => [k.toLowerCase(), String(v)]));
  return { get(name) { return map.get(String(name).toLowerCase()) || null; } };
}

function jsonResponse(body, { status = 200, headers: headerValues = {} } = {}) {
  return {
    status,
    headers: headers(headerValues),
    async text() { return JSON.stringify(body); }
  };
}

function routeFetch(routes, seen) {
  return async (url, options) => {
    const key = String(url);
    seen.push({ url: key, authorization: options?.headers?.Authorization });
    const route = routes.find(r => typeof r.match === 'string' ? key === r.match : r.match.test(key));
    if (!route) throw new Error(`Unexpected URL ${key}`);
    return typeof route.response === 'function' ? route.response(key, options) : route.response;
  };
}

test('URL safety rejects local/private targets and cross-origin pagination', () => {
  assert.throws(() => assertSafeHttpsUrl('http://example.com'), /non-HTTPS/);
  assert.throws(() => assertSafeHttpsUrl('https://127.0.0.1/api'), /private IPv4/);
  assert.throws(() => assertSafeHttpsUrl('https://10.1.2.3/api'), /private IPv4/);
  assert.throws(() => assertSafeHttpsUrl('https://localhost/api'), /local endpoints/);
  assert.throws(() => assertSafeHttpsUrl('https://evil.example/x', { sameOrigin: 'https://graph.microsoft.com' }), /authorized origin/);
  assert.equal(assertSafeHttpsUrl('https://graph.microsoft.com/v1.0/servicePrincipals').origin, 'https://graph.microsoft.com');
});

test('Entra discovery follows same-origin pagination and emits metadata only', async () => {
  const seen = [];
  const fetchImpl = routeFetch([
    {
      match: 'https://graph.microsoft.com/v1.0/servicePrincipals?$top=999',
      response: jsonResponse({
        value: [
          { id: '1', appId: 'wd', displayName: 'Workday Production', publisherName: 'Workday', servicePrincipalType: 'Application', accountEnabled: true },
          { id: 'agent', displayName: 'Agent', '@odata.type': '#microsoft.graph.agentIdentityBlueprintPrincipal' }
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/servicePrincipals?$skiptoken=next'
      })
    },
    {
      match: 'https://graph.microsoft.com/v1.0/servicePrincipals?$skiptoken=next',
      response: jsonResponse({ value: [{ id: '2', appId: 'ns', displayName: 'Oracle NetSuite' }] })
    }
  ], seen);
  const result = await discoverEntra({ accessToken: 'entra-test-token', fetchImpl });
  assert.equal(result.provider, 'ENTRA');
  assert.equal(result.pages, 2);
  assert.equal(result.apps.length, 2);
  assert.equal(result.apps[0].displayName, 'Workday Production');
  assert.equal(Object.hasOwn(result.apps[0], 'accessToken'), false);
  assert.ok(seen.every(x => x.authorization === 'Bearer entra-test-token'));
});

test('Entra discovery refuses malicious nextLink so bearer token cannot be exfiltrated', async () => {
  const seen = [];
  const fetchImpl = routeFetch([{
    match: 'https://graph.microsoft.com/v1.0/servicePrincipals?$top=999',
    response: jsonResponse({ value: [], '@odata.nextLink': 'https://attacker.invalid/steal' })
  }], seen);
  await assert.rejects(() => discoverEntra({ accessToken: 'entra-test-token', fetchImpl }), /authorized origin/);
  assert.equal(seen.length, 1);
});

test('Okta discovery uses scoped bearer auth and opaque same-origin next link', async () => {
  const seen = [];
  const fetchImpl = routeFetch([
    {
      match: 'https://acme.okta.com/api/v1/apps?limit=200&useOptimization=true',
      response: jsonResponse([
        { id: 'ok1', name: 'workday', label: 'Workday', status: 'ACTIVE', signOnMode: 'SAML_2_0' }
      ], { headers: { link: '<https://acme.okta.com/api/v1/apps?after=abc>; rel="next"' } })
    },
    {
      match: 'https://acme.okta.com/api/v1/apps?after=abc',
      response: jsonResponse([{ id: 'ok2', name: 'netsuite', label: 'NetSuite', status: 'ACTIVE' }])
    }
  ], seen);
  const result = await discoverOkta({ baseUrl: 'https://acme.okta.com', accessToken: 'okta-test-token', fetchImpl });
  assert.equal(result.apps.length, 2);
  assert.equal(result.apps[0].displayName, 'Workday');
  assert.ok(seen.every(x => x.authorization === 'Bearer okta-test-token'));
});

test('Google Workspace discovery deduplicates OAuth apps and never returns user identities', async () => {
  const seen = [];
  const fetchImpl = routeFetch([
    {
      match: /https:\/\/admin\.googleapis\.com\/admin\/directory\/v1\/users\?.*/,
      response: jsonResponse({ users: [{ id: 'user-1', primaryEmail: 'sensitive1@example.test' }, { id: 'user-2', primaryEmail: 'sensitive2@example.test' }] })
    },
    {
      match: 'https://admin.googleapis.com/admin/directory/v1/users/user-1/tokens',
      response: jsonResponse({ items: [
        { clientId: 'client-workday', displayText: 'Workday', scopes: ['scope.people'], userKey: 'user-1' },
        { clientId: 'client-other', displayText: 'Other App', scopes: ['scope.other'], userKey: 'user-1' }
      ] })
    },
    {
      match: 'https://admin.googleapis.com/admin/directory/v1/users/user-2/tokens',
      response: jsonResponse({ items: [
        { clientId: 'client-workday', displayText: 'Workday', scopes: ['scope.absence'], userKey: 'user-2' }
      ] })
    }
  ], seen);
  const result = await discoverGoogleWorkspace({ accessToken: 'google-test-token', fetchImpl, maxUsers: 50, concurrency: 2 });
  assert.equal(result.usersInspected, 2);
  assert.equal(result.apps.length, 2);
  const workday = result.apps.find(x => x.appId === 'client-workday');
  assert.equal(workday.sourceMetadata.userGrantCount, 2);
  assert.deepEqual(workday.sourceMetadata.scopes.sort(), ['scope.absence', 'scope.people']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('sensitive1@example.test'), false);
  assert.equal(serialized.includes('user-1'), false);
  assert.ok(seen.every(x => x.authorization === 'Bearer google-test-token'));
});

test('provider errors redact credentials and fail clearly', async () => {
  const fetchImpl = async () => jsonResponse({ error: 'bad' }, { status: 401 });
  await assert.rejects(
    () => fetchJson('https://graph.microsoft.com/v1.0/servicePrincipals', { accessToken: 'super-secret-bearer', fetchImpl }),
    error => {
      assert.match(error.message, /HTTP 401/);
      assert.equal(error.message.includes('super-secret-bearer'), false);
      return true;
    }
  );
});


test('URL safety rejects bracketed private IPv6 and IPv4-mapped loopback literals', () => {
  for (const url of [
    'https://[::1]/api',
    'https://[fe80::1]/api',
    'https://[fc00::1]/api',
    'https://[fd00::1]/api',
    'https://[::ffff:127.0.0.1]/api'
  ]) {
    assert.throws(() => assertSafeHttpsUrl(url), /private|local/i);
  }
  assert.equal(
    assertSafeHttpsUrl('https://[2606:4700:4700::1111]/api').protocol,
    'https:'
  );
});
