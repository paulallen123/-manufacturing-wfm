import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase = (process.env.PROOF_TARGET_BASE || '').replace(/\/$/, '');
const browserOrigin = (process.env.PROOF_BROWSER_ORIGIN || '').replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;
const expectedRelease = '0.6.76-hosted-staging-rc1';

assert.ok(targetBase.startsWith('http://') || targetBase.startsWith('https://'), 'PROOF_TARGET_BASE missing');
assert.ok(targetBase.includes('.railway.internal'), 'Proof target must stay on Railway private networking');
assert.ok(browserOrigin.startsWith('https://'), 'PROOF_BROWSER_ORIGIN missing');
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD missing');

const target = new URL(targetBase);
const browserHost = new URL(browserOrigin).host;
const timeoutMs = 20_000;
const hostedHeaders = {
  host: browserHost,
  'x-forwarded-host': browserHost,
  'x-forwarded-proto': 'https',
};

async function request(path, init = {}) {
  const method = init.method || 'GET';
  const headers = { ...(init.headers || {}) };
  const body = init.body == null ? null : String(init.body);
  if (body != null && headers['content-length'] == null) {
    headers['content-length'] = Buffer.byteLength(body);
  }

  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const result = await new Promise((resolve, reject) => {
    const req = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: `${target.pathname === '/' ? '' : target.pathname}${path}`,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ res, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });

  let parsed = null;
  try { parsed = result.text ? JSON.parse(result.text) : null; } catch { parsed = result.text; }
  const response = {
    status: result.res.statusCode || 0,
    headers: {
      get(name) {
        const value = result.res.headers[String(name).toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : (value ?? null);
      },
      getSetCookie() {
        const value = result.res.headers['set-cookie'];
        return Array.isArray(value) ? value : (value ? [value] : []);
      },
    },
  };
  return { response, body: parsed, text: result.text };
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  return first ? first.split(';', 1)[0] : '';
}

async function login(email) {
  const { response, text } = await request('/api/login', {
    method: 'POST',
    headers: {
      ...hostedHeaders,
      'content-type': 'application/json',
      'origin': browserOrigin,
      'referer': `${browserOrigin}/`,
      'accept': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `${email} login failed with HTTP ${response.status}: ${text.slice(0,160)}`);
  const cookie = cookieFrom(response);
  assert.ok(cookie, `${email} login returned no session cookie`);
  console.log(`LOGIN_PASS ${email}`);
  return cookie;
}

async function authed(cookie, path, extraHeaders = {}) {
  return request(path, {
    headers: {
      ...hostedHeaders,
      cookie,
      accept: 'application/json',
      referer: `${browserOrigin}/`,
      ...extraHeaders,
    },
  });
}

const health = await request('/api/health', { headers: hostedHeaders });
assert.equal(health.response.status, 200, 'private health failed');
assert.equal(health.body?.release, expectedRelease, 'release identity mismatch');
assert.equal(health.body?.fixtureOnly, true, 'proof lane must be fixture-only');
assert.equal(health.body?.productionApproved, false, 'proof lane must not be production approved');
assert.equal(health.body?.pilotReady, false, 'proof lane must not be pilot ready');
console.log(`HEALTH_PASS ${health.body.release}`);

const unauth = await request('/api/bootstrap', {
  headers: { ...hostedHeaders, origin: browserOrigin, referer: `${browserOrigin}/`, accept: 'application/json' },
});
assert.ok([401, 403].includes(unauth.response.status), `protected bootstrap unexpectedly returned ${unauth.response.status}`);
console.log(`UNAUTH_FAIL_CLOSED_PASS bootstrap=${unauth.response.status}`);

const north = await login('superuser@northstar.example');
const isolation = await login('other@isolation.example');
const employee = await login('maya@northstar.example');

const northBootstrap = await authed(north, '/api/bootstrap');
const isolationBootstrap = await authed(isolation, '/api/bootstrap');
assert.equal(northBootstrap.response.status, 200, 'northstar bootstrap failed');
assert.equal(isolationBootstrap.response.status, 200, 'isolation bootstrap failed');
assert.equal(northBootstrap.body?.actor?.tenant, 'northstar-demo', 'northstar tenant mismatch');
assert.equal(isolationBootstrap.body?.actor?.tenant, 'isolation-test', 'isolation tenant mismatch');
assert.notEqual(northBootstrap.body.actor.tenant, isolationBootstrap.body.actor.tenant, 'tenants collapsed');
console.log('TENANT_IDENTITY_PASS northstar-demo!=isolation-test');

const forgedNorth = await authed(north, '/api/bootstrap?tenant=isolation-test', { 'x-tenant-id': 'isolation-test' });
const forgedIsolation = await authed(isolation, '/api/bootstrap?tenant=northstar-demo', { 'x-tenant-id': 'northstar-demo' });
assert.equal(forgedNorth.response.status, 200);
assert.equal(forgedIsolation.response.status, 200);
assert.equal(forgedNorth.body?.actor?.tenant, 'northstar-demo', 'northstar session accepted forged tenant selector');
assert.equal(forgedIsolation.body?.actor?.tenant, 'isolation-test', 'isolation session accepted forged tenant selector');
console.log('TENANT_OVERRIDE_PASS forged selectors ignored');

for (const path of ['/api/readiness','/api/availability','/api/schedule','/api/scheduling-summary','/api/payroll-control','/api/workflows']) {
  const result = await authed(north, path);
  assert.equal(result.response.status, 200, `${path} failed with ${result.response.status}`);
  console.log(`MANAGER_JOURNEY_PASS ${path}`);
}

const personal = await authed(employee, '/api/personal');
assert.equal(personal.response.status, 200, `employee personal failed with ${personal.response.status}`);
console.log('EMPLOYEE_JOURNEY_PASS /api/personal');

console.log('PRIVATE_NETWORK_AUTH_PROOF=PASS');
console.log('PRIVATE_TENANT_ISOLATION_PROOF=PASS');
console.log('claim_boundary=private synthetic proof only; frozen target unmodified');

createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain');
  res.end('private-proof-pass\n');
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
