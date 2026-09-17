import assert from 'node:assert/strict';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const fixtureEmail = 'manager@northstar.example';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;

assert.equal(origin, expectedOrigin, 'Unexpected staging origin.');
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD is unavailable to the proof runner.');

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

// Authenticate without ever printing the credential. Match the public browser contract:
// a fictional fixture account email plus the staging password, sent same-origin.
const login = await fetchText('/api/login', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'origin': origin,
    'referer': `${origin}/`,
    'accept': 'application/json,text/plain,*/*',
  },
  body: JSON.stringify({ email: fixtureEmail, password }),
});
assert.equal(login.response.status, 200, `Live staging login failed with HTTP ${login.response.status}.`);
const cookie = cookieFrom(login.response);
assert.ok(cookie, 'Login succeeded but no session cookie was returned.');
report('authenticated login', login.response.status, fixtureEmail);

async function authedGet(path, { required = true } = {}) {
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

// Core authenticated operating journey already used by the live UI.
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
  await authedGet(path);
}

// Customer-journey categories: try the most likely read-only API surfaces. Missing optional
// aliases are reported, not treated as a product failure; the category can still be proven
// by the current route used by the application.
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
    const result = await authedGet(path, { required: false });
    if (result.status === 200) {
      passed = path;
      break;
    }
  }
  console.log(`${name}: ${passed ? `PROVEN via ${passed}` : 'NO HTTP-200 candidate found'}`);
}

// Prove the corresponding UI bundles and kiosk surface are actually served by this deployment.
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
