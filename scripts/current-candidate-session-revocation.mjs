import assert from 'node:assert/strict';

// Call with a disposable, approved proof session. The cookie is never returned or logged.
export async function proveSessionRevocation({ origin, cookie, expectedSha, expectedActor, fetchImpl = fetch,
  protectedPath = '/api/personal' }) {
  const target = new URL(origin);
  assert.equal(target.origin, origin, 'Origin must be an exact origin');
  assert.ok(target.protocol === 'https:' ||
    (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)),
  'Session cookies require HTTPS or local loopback');
  if (typeof cookie !== 'string' || !/^wfm_session=[A-Za-z0-9_-]+$/.test(cookie)) {
    throw new Error('A single session cookie is required');
  }
  assert.match(expectedSha, /^[a-f0-9]{40}$/, 'Exact serving SHA is required');
  const protectedUrl = new URL(protectedPath, origin);
  assert.ok(protectedPath.startsWith('/api/') && protectedUrl.origin === origin &&
    !['/api/bootstrap', '/api/logout', '/api/health'].includes(protectedUrl.pathname),
  'Protected API path is required');
  async function probe(path, method = 'GET') {
    const response = await fetchImpl(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { cookie, accept: 'application/json', origin, 'cache-control': 'no-store',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {})
    });
    assert.equal(response.headers.get('x-wfm-source-sha'), expectedSha, `Source drift at ${path}`);
    return response;
  }
  const before = await probe('/api/bootstrap');
  assert.equal(before.status, 200, 'Proof session must work before logout');
  const body = await before.json();
  assert.ok(body?.actor?.tenant && body.actor.role, 'Authenticated actor is required');
  if (expectedActor) {
    for (const key of ['tenant', 'role', 'personId']) {
      if (expectedActor[key] !== undefined) assert.equal(body.actor[key], expectedActor[key], `Actor ${key} mismatch`);
    }
  }
  const protectedBefore = await probe(protectedPath);
  assert.equal(protectedBefore.status, 200, 'Protected API must work for the session before logout');
  const logout = await probe('/api/logout', 'POST');
  assert.equal(logout.status, 200, 'Logout must succeed');
  const replayBootstrap = await probe('/api/bootstrap');
  assert.equal(replayBootstrap.status, 401, 'Logged-out cookie still opens bootstrap');
  const replayProtected = await probe(protectedPath);
  assert.equal(replayProtected.status, 401, 'Logged-out cookie still opens protected API');
  return { status: 'PASS', sourceSha: expectedSha, tenant: body.actor.tenant,
    role: body.actor.role, checks: ['authenticated-before-logout', 'protected-api-before-logout', 'logout',
      'old-cookie-bootstrap-denied', 'old-cookie-protected-api-denied'],
    boundary: 'Synthetic session replay only; no deployment, restart, or customer proof claim.' };
}
