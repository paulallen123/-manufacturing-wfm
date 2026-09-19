import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
  if (body != null && headers['content-length'] == null) headers['content-length'] = Buffer.byteLength(body);
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
      res.on('data', chunk => chunks.push(chunk));
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
  const values = response.headers.getSetCookie();
  const first = values[0];
  return first ? first.split(';', 1)[0] : '';
}

async function login(email) {
  const { response, text } = await request('/api/login', {
    method: 'POST',
    headers: {
      ...hostedHeaders,
      'content-type': 'application/json',
      origin: browserOrigin,
      referer: `${browserOrigin}/`,
      accept: 'application/json',
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

async function authedCommand(cookie, path, body) {
  return request(path, {
    method: 'POST',
    headers: {
      ...hostedHeaders,
      cookie,
      accept: 'application/json',
      'content-type': 'application/json',
      origin: browserOrigin,
      referer: `${browserOrigin}/`,
    },
    body: JSON.stringify(body),
  });
}

const health = await request('/api/health', { headers: hostedHeaders });
assert.equal(health.response.status, 200, 'private health failed');
assert.equal(health.body?.release, expectedRelease, 'release identity mismatch');
assert.equal(health.body?.fixtureOnly, true, 'proof lane must be fixture-only');
assert.equal(health.body?.productionApproved, false, 'proof lane must not be production approved');
assert.equal(health.body?.pilotReady, false, 'proof lane must not be pilot ready');
console.log(`HEALTH_PASS ${health.body.release}`);

const northDirector = await login('superuser@northstar.example');
const northManager = await login('manager@northstar.example');
const northPayroll = await login('payroll@northstar.example');
const isolation = await login('other@isolation.example');
const employeeCookie = await login('maya@northstar.example');

const northBootstrap = await authed(northDirector, '/api/bootstrap');
const isolationBootstrap = await authed(isolation, '/api/bootstrap');
assert.equal(northBootstrap.response.status, 200);
assert.equal(isolationBootstrap.response.status, 200);
assert.equal(northBootstrap.body?.actor?.tenant, 'northstar-demo');
assert.equal(isolationBootstrap.body?.actor?.tenant, 'isolation-test');
assert.notEqual(northBootstrap.body.actor.tenant, isolationBootstrap.body.actor.tenant);
console.log('TENANT_IDENTITY_PASS northstar-demo!=isolation-test');

const staff = Array.isArray(northBootstrap.body?.state?.staff) ? northBootstrap.body.state.staff : [];
const preferred = staff.find(p => p.id === 'e0' && p.site && p.onboardingReady !== false)
  || staff.find(p => p.site && p.onboardingReady !== false && p.id !== northBootstrap.body?.actor?.personId);
assert.ok(preferred, 'No fixture employee eligible for kiosk proof');
const site = preferred.site;
const employee = preferred.id;

const adminCandidates = [
  ['manager', northManager],
  ['payroll_admin', northPayroll],
  ['director', northDirector],
];
let kioskAdmin = null;
for (const [role, cookie] of adminCandidates) {
  const probe = await authed(cookie, '/api/kiosk/devices');
  console.log(`KIOSK_ADMIN_ROLE_PROBE ${role}=${probe.response.status}`);
  if (!kioskAdmin && probe.response.status === 200) kioskAdmin = { role, cookie, devices: probe.body };
}
assert.ok(kioskAdmin, 'No authorised northstar fixture role can administer kiosk devices');
console.log(`KIOSK_ADMIN_ROLE_PASS ${kioskAdmin.role}`);

const isolationDevices = await authed(isolation, '/api/kiosk/devices');
assert.ok([200, 403].includes(isolationDevices.response.status), `unexpected isolation kiosk boundary ${isolationDevices.response.status}`);
console.log(`KIOSK_SECOND_TENANT_BOUNDARY_PASS ${isolationDevices.response.status}`);

const register = await authedCommand(kioskAdmin.cookie, '/api/kiosk/devices/register', {
  site,
  name: `Private proof kiosk ${Date.now()}`,
});
assert.equal(register.response.status, 200, `kiosk register failed ${register.response.status}`);
const deviceId = register.body?.id;
const deviceSecret = register.body?.secret;
assert.ok(deviceId && typeof deviceSecret === 'string' && deviceSecret.length >= 32, 'missing one-time device credential');
console.log('KIOSK_REGISTER_PASS secret-withheld');

if (isolationDevices.response.status === 200) {
  const isolationAfterRegister = await authed(isolation, '/api/kiosk/devices');
  assert.equal(isolationAfterRegister.response.status, 200);
  assert.ok(!(isolationAfterRegister.body?.devices || []).some(x => x.id === deviceId), 'registered kiosk leaked into second tenant');
  console.log('KIOSK_TENANT_ISOLATION_PASS device-not-visible-to-second-tenant');
} else {
  console.log('KIOSK_TENANT_ISOLATION_PASS second-tenant-role-denied-device-inventory');
}

async function kioskSync(payload) {
  return request('/api/kiosk/sync', {
    method: 'POST',
    headers: {
      ...hostedHeaders,
      'content-type': 'application/json',
      'x-device-id': deviceId,
      authorization: `Device ${deviceSecret}`,
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

const base = Date.now();
const events = [
  {
    eventId: `private-proof-in-${randomBytes(8).toString('hex')}`,
    sequence: 1,
    employee,
    type: 'in',
    capturedAt: new Date(base - 120_000).toISOString(),
    clockOffsetMs: 0,
  },
  {
    eventId: `private-proof-out-${randomBytes(8).toString('hex')}`,
    sequence: 2,
    employee,
    type: 'out',
    capturedAt: new Date(base - 60_000).toISOString(),
    clockOffsetMs: 0,
  },
];

const tenantInjection = await kioskSync({ tenant: 'isolation-test', events });
assert.equal(tenantInjection.response.status, 400, 'kiosk accepted client-supplied tenant');
console.log('KIOSK_TENANT_INJECTION_PASS 400');

const sync = await kioskSync({ events });
assert.equal(sync.response.status, 200, `kiosk sync failed ${sync.response.status}`);
assert.equal(sync.body?.accepted, 2);
assert.equal(sync.body?.held, 0);
assert.equal(sync.body?.lastSequence, 2);
assert.ok(Array.isArray(sync.body?.results) && sync.body.results.every(x => x.status === 'accepted' && x.replayed === false));
console.log('KIOSK_CLOCK_CYCLE_PASS in+out accepted sequence=2');

const replay = await kioskSync({ events });
assert.equal(replay.response.status, 200);
assert.equal(replay.body?.accepted, 2);
assert.equal(replay.body?.lastSequence, 2);
assert.ok(replay.body?.results?.every(x => x.status === 'accepted' && x.replayed === true), 'exact replay was not idempotent');
console.log('KIOSK_REPLAY_IDEMPOTENCY_PASS');

const gap = await kioskSync({ events: [{
  eventId: `private-proof-gap-${randomBytes(8).toString('hex')}`,
  sequence: 4,
  employee,
  type: 'in',
  capturedAt: new Date(base - 30_000).toISOString(),
  clockOffsetMs: 0,
}] });
assert.equal(gap.response.status, 200);
assert.equal(gap.body?.accepted, 0);
assert.equal(gap.body?.held, 1);
assert.equal(gap.body?.lastSequence, 2);
assert.equal(gap.body?.results?.[0]?.code, 409);
console.log('KIOSK_SEQUENCE_GAP_PASS held-with-409');

const postDevices = await authed(kioskAdmin.cookie, '/api/kiosk/devices');
assert.equal(postDevices.response.status, 200);
const device = postDevices.body?.devices?.find(x => x.id === deviceId);
assert.ok(device, 'registered kiosk missing');
assert.equal(device.status, 'active');
assert.ok(device.lastSeen, 'lastSeen missing');
assert.equal(Object.prototype.hasOwnProperty.call(device, 'secret'), false, 'device secret leaked in listing');
console.log('KIOSK_ADMIN_EVIDENCE_PASS active+lastSeen+no-secret');

const personal = await authed(employeeCookie, '/api/personal');
assert.equal(personal.response.status, 200, 'employee personal view failed after clocking');
const timeReview = await authed(northManager, '/api/time-review');
assert.equal(timeReview.response.status, 200, 'time review failed after clocking');
console.log('POST_CLOCK_SURFACES_PASS personal+time-review');

const revoke = await authedCommand(kioskAdmin.cookie, '/api/kiosk/devices/revoke', { id: deviceId });
assert.equal(revoke.response.status, 200, 'kiosk revoke failed');
assert.equal(revoke.body?.status, 'revoked');
console.log('KIOSK_REVOKE_PASS');

const afterRevoke = await kioskSync({ events: [{
  eventId: `private-proof-after-revoke-${randomBytes(8).toString('hex')}`,
  sequence: 3,
  employee,
  type: 'in',
  capturedAt: new Date().toISOString(),
  clockOffsetMs: 0,
}] });
assert.equal(afterRevoke.response.status, 401, 'revoked kiosk credential still accepted');
console.log('KIOSK_REVOKED_CREDENTIAL_PASS 401');

const finalDevices = await authed(kioskAdmin.cookie, '/api/kiosk/devices');
assert.equal(finalDevices.response.status, 200);
const finalDevice = finalDevices.body?.devices?.find(x => x.id === deviceId);
assert.equal(finalDevice?.status, 'revoked');
assert.ok(finalDevice?.revokedAt, 'revocation timestamp missing');

console.log('PRIVATE_KIOSK_CLOCKING_PROOF=PASS');
console.log('PRIVATE_KIOSK_FAILURE_MODE_PROOF=PASS');
console.log('PRIVATE_KIOSK_TENANT_ISOLATION_PROOF=PASS');
console.log(`release=${expectedRelease}`);
console.log('claim_boundary=private synthetic fixture-only proof; no public target; no real employee communication/payment');

createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain');
  res.end('private-kiosk-proof-pass\n');
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
