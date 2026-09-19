import assert from 'node:assert/strict';
import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const publicOrigin = String(process.env.WFM_PUBLIC_ORIGIN || '').replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD || '';
const expectedRelease = '0.6.76-hosted-staging-rc1';

assert.ok(publicOrigin.startsWith('https://'), 'WFM_PUBLIC_ORIGIN must be an HTTPS proof origin.');
assert.ok(password.length >= 20, 'WFM_STAGING_PASSWORD must be a non-derived 20+ character proof credential.');

const host = new URL(publicOrigin).host;
const timeoutMs = 10_000;

function request(path, init = {}) {
  return new Promise((resolve, reject) => {
    const payload = init.body == null ? null : String(init.body);
    const headers = {
      host,
      'x-forwarded-proto': 'https',
      ...(init.headers || {}),
    };
    if (payload && headers['content-length'] == null) {
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: init.method || 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        resolve({ status: res.statusCode || 0, headers: res.headers, body, text });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timeout for ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(result) {
  const values = result.headers['set-cookie'] || [];
  const first = Array.isArray(values) ? values[0] : values;
  assert.ok(first, 'Authenticated login returned no session cookie.');
  return String(first).split(';', 1)[0];
}

async function login(email, suppliedPassword = password) {
  const result = await request('/api/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicOrigin,
      referer: `${publicOrigin}/`,
      accept: 'application/json,text/plain,*/*',
    },
    body: JSON.stringify({ email, password: suppliedPassword }),
  });
  return { status: result.status, body: result.body, cookie: result.status === 200 ? cookieFrom(result) : '' };
}

async function authed(cookie, path) {
  return request(path, {
    headers: {
      cookie,
      accept: 'application/json,text/plain,*/*',
      referer: `${publicOrigin}/`,
    },
  });
}

const health = await request('/api/health');
assert.equal(health.status, 200, 'Health endpoint failed.');
assert.equal(health.body?.status, 'ok', 'Health payload was not ok.');
assert.equal(health.body?.release, expectedRelease, 'Unexpected release identity.');
assert.equal(health.body?.fixtureOnly, true, 'Self-verification must remain fixture-only.');
assert.equal(health.body?.productionApproved, false, 'Self-verification must not run on a production-approved candidate.');
assert.equal(health.body?.pilotReady, false, 'Self-verification must not run on a pilot-ready candidate.');

const unauth = await request('/api/bootstrap');
assert.ok([401, 403].includes(unauth.status), `Protected bootstrap did not fail closed before login: HTTP ${unauth.status}.`);

const badLogin = await login('manager@northstar.example', `${password}-wrong`);
assert.ok([401, 403].includes(badLogin.status), `Wrong-password login was not rejected: HTTP ${badLogin.status}.`);

const manager = await login('manager@northstar.example');
assert.equal(manager.status, 200, 'Manager login failed.');
const managerBootstrap = await authed(manager.cookie, '/api/bootstrap');
assert.equal(managerBootstrap.status, 200, 'Manager bootstrap failed.');
assert.equal(managerBootstrap.body?.actor?.role, 'manager', 'Manager role identity mismatch.');
assert.equal(managerBootstrap.body?.actor?.tenant, 'northstar-demo', 'Manager tenant identity mismatch.');
const managerPayroll = await authed(manager.cookie, '/api/payroll-run');
assert.equal(managerPayroll.status, 403, 'Manager unexpectedly received payroll access.');
for (const path of ['/api/weekly-review', '/api/time-review', '/api/attendance-corrections', '/api/operations']) {
  const r = await authed(manager.cookie, path);
  assert.equal(r.status, 200, `Manager surface failed: ${path}`);
}

const employee = await login('maya@northstar.example');
assert.equal(employee.status, 200, 'Employee login failed.');
const employeeBootstrap = await authed(employee.cookie, '/api/bootstrap');
assert.equal(employeeBootstrap.status, 200, 'Employee bootstrap failed.');
assert.equal(employeeBootstrap.body?.actor?.role, 'employee', 'Employee role identity mismatch.');
assert.equal(employeeBootstrap.body?.actor?.tenant, 'northstar-demo', 'Employee tenant identity mismatch.');
for (const path of ['/api/personal', '/api/time-review', '/api/attendance-corrections']) {
  const r = await authed(employee.cookie, path);
  assert.equal(r.status, 200, `Employee surface failed: ${path}`);
}

const payroll = await login('payroll@northstar.example');
assert.equal(payroll.status, 200, 'Payroll login failed.');
const payrollBootstrap = await authed(payroll.cookie, '/api/bootstrap');
assert.equal(payrollBootstrap.status, 200, 'Payroll bootstrap failed.');
assert.equal(payrollBootstrap.body?.actor?.role, 'payroll_admin', 'Payroll role identity mismatch.');
assert.equal(payrollBootstrap.body?.actor?.tenant, 'northstar-demo', 'Payroll tenant identity mismatch.');
for (const path of ['/api/payroll-run', '/api/readiness/payroll-outcomes', '/api/payroll-intelligence']) {
  const r = await authed(payroll.cookie, path);
  assert.equal(r.status, 200, `Payroll surface failed: ${path}`);
}

const north = await login('superuser@northstar.example');
const isolation = await login('other@isolation.example');
assert.equal(north.status, 200, 'Northstar superuser login failed.');
assert.equal(isolation.status, 200, 'Isolation-tenant login failed.');
const northBootstrap = await authed(north.cookie, '/api/bootstrap');
const isolationBootstrap = await authed(isolation.cookie, '/api/bootstrap');
assert.equal(northBootstrap.body?.actor?.tenant, 'northstar-demo', 'Northstar tenant mismatch.');
assert.equal(isolationBootstrap.body?.actor?.tenant, 'isolation-test', 'Isolation tenant mismatch.');
assert.notEqual(northBootstrap.body?.actor?.tenant, isolationBootstrap.body?.actor?.tenant, 'Synthetic tenants were not isolated.');

const forgedNorth = await request('/api/bootstrap?tenant=isolation-test', {
  headers: {
    cookie: north.cookie,
    'x-tenant-id': 'isolation-test',
    accept: 'application/json',
    referer: `${publicOrigin}/`,
  },
});
assert.equal(forgedNorth.status, 200, 'Forged-tenant resistance request failed unexpectedly.');
assert.equal(forgedNorth.body?.actor?.tenant, 'northstar-demo', 'Client-supplied tenant selector changed session tenant.');

for (const path of ['/api/onboarding', '/api/schedule-publication', '/api/readiness', '/api/availability']) {
  const r = await authed(north.cookie, path);
  assert.equal(r.status, 200, `Core read-only proof surface failed: ${path}`);
}

console.log(JSON.stringify({
  result: 'PASS',
  release: expectedRelease,
  fixtureOnly: true,
  roles: ['manager', 'employee', 'payroll_admin', 'director'],
  tenants: ['northstar-demo', 'isolation-test'],
  boundaries: ['unauthenticated-fail-closed', 'wrong-password-rejected', 'manager-payroll-denied', 'tenant-override-resisted'],
  surfaces: ['onboarding', 'schedule-publication', 'weekly-review', 'time-review', 'attendance-corrections', 'availability', 'payroll-run', 'payroll-outcomes', 'payroll-intelligence'],
  claimBoundary: 'Private loopback synthetic self-verification only; no external deployment, real employee data, communications, payments or production integrations.'
}, null, 2));
