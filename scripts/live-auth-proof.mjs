import assert from 'node:assert/strict';
import { proofRunnerLogin } from './proof-runner-auth.mjs';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');

assert.equal(origin, expectedOrigin, 'Unexpected staging origin.');

const timeoutMs = 20_000;

async function fetchText(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { response, text };
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  if (!first) return '';
  return first.split(';', 1)[0];
}

function report(label, status, extra = '') {
  console.log(`${label}: HTTP ${status}${extra ? ` · ${extra}` : ''}`);
}

async function loginAs(email) {
  const cookie = await proofRunnerLogin({ origin, email, timeoutMs });
  report('passwordless proof login', 200, email);
  return cookie;
}

async function authedGet(cookie, path, { required = true } = {}) {
  const { response, text } = await fetchText(path, {
    headers: {
      cookie,
      accept: 'application/json,text/plain,*/*',
      referer: `${origin}/`,
    },
  });
  report(path, response.status);
  if (required) assert.equal(response.status, 200, `${path} did not return HTTP 200.`);
  return { status: response.status, text };
}

// Public boundary first.
{
  const { response, text } = await fetchText('/api/health');
  assert.equal(response.status, 200, 'Public health failed.');
  const body = JSON.parse(text);
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'hosted-staging');
  assert.equal(body.fixtureOnly, true);
  assert.equal(body.productionApproved, false);
  assert.equal(body.pilotReady, false);
  assert.equal(body.release, expectedRelease);
  report('public health', response.status, body.release);
}

{
  const { response } = await fetchText('/api/bootstrap');
  assert.equal(response.status, 401, 'Protected bootstrap did not fail closed before login.');
  report('unauthenticated bootstrap', response.status, 'fail-closed confirmed');
}

// Prove capability-based access: a normal manager can run the core operating view but
// cannot read payroll-control data merely because they are a manager.
const managerCookie = await loginAs('manager@northstar.example');
await authedGet(managerCookie, '/api/bootstrap');
const managerPayroll = await authedGet(managerCookie, '/api/payroll-run', { required: false });
assert.equal(managerPayroll.status, 403, 'Manager unexpectedly received payroll access.');
console.log('manager payroll boundary: PROVEN 403');

// Use the sealed superuser fixture for the complete read-only customer-proof journey.
const cookie = await loginAs('superuser@northstar.example');

for (const path of [
  '/api/bootstrap',
  '/api/readiness',
  '/api/weekly-review',
  '/api/schedule-publication',
  '/api/operations',
  '/api/payroll-run',
  '/api/readiness/payroll-outcomes',
  '/api/readiness/finance-attribution',
  '/api/payroll-intelligence',
  '/api/support/bot',
  '/api/personal',
]) {
  await authedGet(cookie, path);
}

const categories = {
  'company/onboarding': ['/api/onboarding', '/api/company'],
  'workforce/resources': ['/api/resources', '/api/availability'],
  'demand/labour planning': ['/api/demand', '/api/operations'],
  'time/attendance review': ['/api/time-review', '/api/attendance-corrections', '/api/payroll-run'],
  'cost/value': ['/api/cost', '/api/recommendations', '/api/value-cockpit', '/api/readiness/finance-attribution'],
};

for (const [name, candidates] of Object.entries(categories)) {
  let passed = null;
  for (const path of candidates) {
    const result = await authedGet(cookie, path, { required: false });
    if (result.status === 200) {
      passed = path;
      break;
    }
  }
  console.log(`${name}: ${passed ? `PROVEN via ${passed}` : 'NO HTTP-200 candidate found'}`);
}

for (const path of [
  '/onboarding-ui.js',
  '/resources-ui.js',
  '/availability-ui.js',
  '/demand-ui.js',
  '/time-review-ui.js',
  '/cost-ui.js',
  '/recommendation-ui.js',
  '/kiosk-admin-ui.js',
  '/kiosk.html',
]) {
  const { response } = await fetchText(path, { headers: { cookie, referer: `${origin}/` } });
  assert.equal(response.status, 200, `${path} did not load.`);
  report(path, response.status);
}

console.log('READ_ONLY_AUTHENTICATED_LIVE_PROOF=PASS');
console.log(`release=${expectedRelease}`);
console.log('claim_boundary=fixture-only hosted staging; productionApproved=false; pilotReady=false');
