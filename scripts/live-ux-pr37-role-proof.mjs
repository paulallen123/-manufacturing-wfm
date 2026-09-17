import assert from 'node:assert/strict';

const origin = 'https://wfm-ux-pr37-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const password = process.env.WFM_STAGING_PASSWORD;
assert.ok(password && password.length >= 20, 'Staging credential unavailable.');

const timeoutMs = 20_000;
async function fetchText(path, init = {}) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { response, text };
}
function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0] ? values[0].split(';', 1)[0] : '';
}
async function login(email) {
  const { response } = await fetchText('/api/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      referer: `${origin}/`,
      accept: 'application/json,text/plain,*/*',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `${email} login failed: HTTP ${response.status}`);
  const cookie = cookieFrom(response);
  assert.ok(cookie, `${email} login returned no session cookie.`);
  console.log(`UX_ROLE_LOGIN=${email}:200`);
  return cookie;
}
async function get(cookie, path, expected = 200) {
  const { response, text } = await fetchText(path, {
    headers: { cookie, accept: 'application/json,text/plain,*/*', referer: `${origin}/` },
  });
  assert.equal(response.status, expected, `${path} returned HTTP ${response.status}; expected ${expected}.`);
  console.log(`UX_ROLE_API=${path}:${response.status}`);
  return text;
}

const health = await fetchText('/api/health');
assert.equal(health.response.status, 200);
const healthBody = JSON.parse(health.text);
assert.equal(healthBody.release, expectedRelease);
assert.equal(healthBody.fixtureOnly, true);
assert.equal(healthBody.productionApproved, false);
assert.equal(healthBody.pilotReady, false);
console.log(`UX_LIVE_RELEASE=${healthBody.release}`);

const unauth = await fetchText('/api/bootstrap');
assert.equal(unauth.response.status, 401);
console.log('UX_UNAUTHENTICATED_BOOTSTRAP=401');

const manager = await login('manager@northstar.example');
for (const path of ['/api/bootstrap', '/api/weekly-review', '/api/time-review', '/api/operations', '/api/recommendations']) {
  await get(manager, path);
}
await get(manager, '/api/payroll-run', 403);
console.log('UX_MANAGER_ROLE_BOUNDARY=PASS');

const employee = await login('maya@northstar.example');
for (const path of ['/api/bootstrap', '/api/personal', '/api/time-review', '/api/attendance-corrections']) {
  await get(employee, path);
}
console.log('UX_EMPLOYEE_SELF_SERVICE_APIS=PASS');

const superuser = await login('superuser@northstar.example');
for (const path of ['/api/bootstrap', '/api/readiness', '/api/schedule-publication', '/api/payroll-run']) {
  await get(superuser, path);
}
console.log('UX_SUPERUSER_SPECIALIST_APIS=PASS');

const html = await fetchText('/');
assert.equal(html.response.status, 200);
assert.ok(html.text.includes('value-cockpit-ui.js'));
assert.ok(html.text.includes('factory-control-ui.css'));
assert.ok(!/ux-reset(?:-cycle\d+)?\.(?:js|css)/.test(html.text), 'Standalone UX overlay unexpectedly exposed in HTML.');

const servedJs = await fetchText('/value-cockpit-ui.js');
const servedCss = await fetchText('/factory-control-ui.css');
assert.equal(servedJs.response.status, 200);
assert.equal(servedCss.response.status, 200);

const jsInvariants = [
  "overview:'Today'",
  "leave:'Absence'",
  "'weekly-review':'Sign off'",
  "'savings-decisions':'Performance'",
  'Annual entitlement',
  'Remaining now',
  'Left if approved',
  'Available after all pending',
  'Who else is off',
  'ux-more-button',
  'Work the exceptions, not the timesheet.',
  'Is my time correct?',
  'Week &amp; filters',
  'What needs checking',
  'Review and correct',
  'window.WFMUXCycle9=',
  'WFM_UX_RESET_CYCLE9_BEGIN',
];
for (const invariant of jsInvariants) {
  assert.ok(servedJs.text.includes(invariant), `Hosted JS missing UX invariant: ${invariant}`);
}
const cssInvariants = [
  'html,body{max-width:100%;overflow-x:hidden}',
  '.ux-tool-drawer',
  '.ux-signoff-desk',
  '[data-ux-time-review="calm"]',
  '[data-ux-employee-time="calm"]',
  'WFM_UX_RESET_CYCLE9_BEGIN',
];
for (const invariant of cssInvariants) {
  assert.ok(servedCss.text.includes(invariant), `Hosted CSS missing UX invariant: ${invariant}`);
}

console.log('HOSTED_UX_ROLE_FIRST_BUNDLE=PASS');
console.log('HOSTED_UX_MANAGER_EMPLOYEE_CONTRACT=PASS');
console.log(`origin=${origin}`);
console.log(`release=${expectedRelease}`);
console.log('claim_boundary=fixture-only hosted staging; productionApproved=false; pilotReady=false');
