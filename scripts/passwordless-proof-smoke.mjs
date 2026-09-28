import assert from 'node:assert/strict';
import { proofRunnerLogin } from './proof-runner-auth.mjs';

const origin = String(process.env.WFM_PROOF_TARGET_ORIGIN || '').replace(/\/$/, '');
const email = String(process.env.WFM_PROOF_RUNNER_EMAIL || 'manager@northstar.example').trim().toLowerCase();
assert.ok(origin.startsWith('https://'), 'WFM_PROOF_TARGET_ORIGIN must be HTTPS.');

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { response, body };
}

const health = await request('/api/health');
assert.equal(health.response.status, 200, 'Target health is not HTTP 200.');

const unauthenticated = await request('/api/bootstrap');
assert.equal(unauthenticated.response.status, 401, 'Protected bootstrap did not fail closed before authentication.');

const cookie = await proofRunnerLogin({ origin, email, timeoutMs: 20_000 });
assert.ok(cookie.startsWith('wfm_session='), 'Passwordless exchange did not return a WFM session.');

const authenticated = await request('/api/bootstrap', {
  headers: {
    cookie,
    accept: 'application/json,text/plain,*/*',
    referer: `${origin}/`,
  },
});
assert.equal(authenticated.response.status, 200, 'Passwordless session did not reach authenticated bootstrap.');
assert.equal(String(authenticated.body?.actor?.email || '').toLowerCase(), email, 'Authenticated actor does not match signed proof identity.');

const injected = await request('/api/bootstrap', {
  headers: {
    cookie,
    'x-wfm-tenant': 'attacker-controlled',
    accept: 'application/json,text/plain,*/*',
    referer: `${origin}/`,
  },
});
assert.equal(injected.response.status, 400, 'Client-supplied tenant authority was not rejected.');

console.log(JSON.stringify({
  result: 'PASSWORDLESS_PROOF_RUNNER_SMOKE=PASS',
  target: origin,
  actor: {
    email: authenticated.body?.actor?.email,
    tenant: authenticated.body?.actor?.tenant,
    role: authenticated.body?.actor?.role,
  },
  checks: {
    health: 200,
    unauthenticatedBootstrap: 401,
    signedSessionBootstrap: 200,
    identityHeaderInjection: 400,
  },
}));
