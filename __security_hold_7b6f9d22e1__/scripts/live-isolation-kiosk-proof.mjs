import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;

assert.equal(origin, expectedOrigin, 'Unexpected staging origin.');
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD is unavailable to the proof runner.');

const timeoutMs = 20_000;
const jsonHeaders = {
  'content-type': 'application/json',
  'origin': origin,
  'referer': `${origin}/`,
  'accept': 'application/json,text/plain,*/*',
};

function report(label, detail = '') {
  console.log(`${label}${detail ? ` · ${detail}` : ''}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  return first ? first.split(';', 1)[0] : '';
}

async function login(email) {
  const { response } = await request('/api/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `${email} login failed with HTTP ${response.status}.`);
  const cookie = cookieFrom(response);
  assert.ok(cookie, `${email} login returned no session cookie.`);
  report('login', `${email} -> 200`);
  return cookie;
}

async function authed(cookie, path, { method = 'GET', body, headers = {} } = {}) {
  return request(path, {
    method,
    headers: {
      cookie,
      accept: 'application/json,text/plain,*/*',
      referer: `${origin}/`,
      ...(method === 'POST' ? { 'content-type': 'application/json', origin } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Reconfirm exact release identity before any state-changing fixture proof.
{
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200, 'Public health failed.');
  assert.equal(body?.release, expectedRelease, 'Unexpected live release identity.');
  assert.equal(body?.fixtureOnly, true, 'Interactive proof must remain fixture-only.');
  assert.equal(body?.productionApproved, false, 'Interactive proof must not run on a production-approved lane.');
  assert.equal(body?.pilotReady, false, 'Interactive proof must not run on a pilot-approved lane.');
  report('release identity', `${body.release} fixture-only`);
}

// ---- Tenant isolation ----
const northCookie = await login('superuser@northstar.example');
const isolationCookie = await login('other@isolation.example');

const northBootstrap = await authed(northCookie, '/api/bootstrap');
const isolationBootstrap = await authed(isolationCookie, '/api/bootstrap');
assert.equal(northBootstrap.response.status, 200);
assert.equal(isolationBootstrap.response.status, 200);
assert.equal(northBootstrap.body?.actor?.tenant, 'northstar-demo');
assert.equal(isolationBootstrap.body?.actor?.tenant, 'isolation-test');
assert.notEqual(northBootstrap.body.actor.tenant, isolationBootstrap.body.actor.tenant);
report('tenant identities', 'northstar-demo != isolation-test');

// Query-string and header attempts must not be able to switch a session into another tenant.
const forgedNorth = await authed(northCookie, '/api/bootstrap?tenant=isolation-test', {
  headers: { 'x-tenant-id': 'isolation-test' },
});
const forgedIsolation = await authed(isolationCookie, '/api/bootstrap?tenant=northstar-demo', {
  headers: { 'x-tenant-id': 'northstar-demo' },
});
assert.equal(forgedNorth.response.status, 200);
assert.equal(forgedIsolation.response.status, 200);
assert.equal(forgedNorth.body?.actor?.tenant, 'northstar-demo', 'Northstar session was influenced by a forged tenant selector.');
assert.equal(forgedIsolation.body?.actor?.tenant, 'isolation-test', 'Isolation-test session was influenced by a forged tenant selector.');
report('tenant override resistance', 'query/header tenant selectors ignored');

// A northstar superuser can administer only devices in its own session-derived tenant.
const preDevices = await authed(northCookie, '/api/kiosk/devices');
assert.equal(preDevices.response.status, 200, 'Superuser could not read tenant-scoped kiosk devices.');

// ---- Controlled registered-kiosk proof ----
const staff = Array.isArray(northBootstrap.body?.state?.staff) ? northBootstrap.body.state.staff : [];
const preferred = staff.find(p => p.id === 'e0' && p.site && p.onboardingReady !== false)
  || staff.find(p => p.site && p.onboardingReady !== false && p.id !== northBootstrap.body?.actor?.personId);
assert.ok(preferred, 'No fixture employee is eligible for a controlled kiosk proof.');
const site = preferred.site;
const employee = preferred.id;
report('kiosk fixture target', `employee=${employee} site=${site}`);

const register = await authed(northCookie, '/api/kiosk/devices/register', {
  method: 'POST',
  body: { site, name: `Proof kiosk ${Date.now()}` },
});
assert.equal(register.response.status, 200, `Kiosk registration failed with HTTP ${register.response.status}.`);
const deviceId = register.body?.id;
const deviceSecret = register.body?.secret;
assert.ok(deviceId && typeof deviceSecret === 'string' && deviceSecret.length >= 32, 'Kiosk registration did not return a one-time device credential.');
report('kiosk registration', `${deviceId} -> 200; secret withheld from logs`);

const base = Date.now();
const eventIn = {
  eventId: `proof-in-${randomBytes(8).toString('hex')}`,
  sequence: 1,
  employee,
  type: 'in',
  capturedAt: new Date(base - 120_000).toISOString(),
  clockOffsetMs: 0,
};
const eventOut = {
  eventId: `proof-out-${randomBytes(8).toString('hex')}`,
  sequence: 2,
  employee,
  type: 'out',
  capturedAt: new Date(base - 60_000).toISOString(),
  clockOffsetMs: 0,
};
const events = [eventIn, eventOut];

async function kioskSync(payload) {
  return request('/api/kiosk/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      'authorization': `Device ${deviceSecret}`,
      'accept': 'application/json,text/plain,*/*',
    },
    body: JSON.stringify(payload),
  });
}

// The device cannot self-select a tenant; extra tenant material is rejected before mutation.
const tenantInjection = await kioskSync({ tenant: 'isolation-test', events });
assert.equal(tenantInjection.response.status, 400, 'Kiosk accepted client-supplied tenant material.');
report('kiosk tenant injection', 'rejected 400');

const sync = await kioskSync({ events });
assert.equal(sync.response.status, 200, `Kiosk sync failed with HTTP ${sync.response.status}.`);
assert.equal(sync.body?.accepted, 2, 'Expected clock-in and clock-out to be accepted.');
assert.equal(sync.body?.held, 0, 'Controlled kiosk events were unexpectedly held.');
assert.equal(sync.body?.lastSequence, 2, 'Kiosk sequence did not advance to 2.');
assert.ok(Array.isArray(sync.body?.results) && sync.body.results.every(x => x.status === 'accepted' && x.replayed === false));
report('kiosk clock cycle', 'in accepted; out accepted; sequence=2');

// Replay of the same event IDs and content must be idempotent.
const replay = await kioskSync({ events });
assert.equal(replay.response.status, 200);
assert.equal(replay.body?.accepted, 2);
assert.equal(replay.body?.lastSequence, 2);
assert.ok(replay.body.results.every(x => x.status === 'accepted' && x.replayed === true), 'Exact kiosk replay was not identified as replayed.');
report('kiosk idempotency', 'exact replay accepted without duplicate mutation');

// A sequence gap is held and later events remain queued rather than being applied out of order.
const gap = await kioskSync({ events: [{
  eventId: `proof-gap-${randomBytes(8).toString('hex')}`,
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
report('kiosk sequence-gap control', 'held with 409; lastSequence remained 2');

// Device administration should show the live sequence/last-seen evidence, but never the secret.
const postDevices = await authed(northCookie, '/api/kiosk/devices');
assert.equal(postDevices.response.status, 200);
const device = postDevices.body?.devices?.find(x => x.id === deviceId);
assert.ok(device, 'Registered proof kiosk was not visible to its tenant administrator.');
assert.equal(device.status, 'active');
assert.ok(device.lastSeen, 'Registered proof kiosk did not record lastSeen after sync.');
assert.equal(Object.prototype.hasOwnProperty.call(device, 'secret'), false, 'Device secret leaked through device listing.');
report('kiosk admin evidence', 'active device has lastSeen; secret not returned');

// The employee-facing personal surface should remain readable after the clock cycle.
const employeeCookie = await login('maya@northstar.example');
const personal = await authed(employeeCookie, '/api/personal');
assert.equal(personal.response.status, 200, 'Employee personal view failed after kiosk clock cycle.');
report('employee personal evidence', '/api/personal -> 200 after clock cycle');

// Attendance/time review surfaces stay healthy after the controlled events.
for (const path of ['/api/time-review', '/api/attendance-corrections']) {
  const result = await authed(northCookie, path);
  assert.equal(result.response.status, 200, `${path} failed after kiosk clock cycle.`);
  report('post-clock review surface', `${path} -> 200`);
}

// Revoke the temporary proof device, then prove the credential stops working immediately.
const revoke = await authed(northCookie, '/api/kiosk/devices/revoke', {
  method: 'POST',
  body: { id: deviceId },
});
assert.equal(revoke.response.status, 200, 'Temporary proof kiosk could not be revoked.');
assert.equal(revoke.body?.status, 'revoked');
report('kiosk revocation', `${deviceId} -> revoked`);

const afterRevoke = await kioskSync({ events: [{
  eventId: `proof-after-revoke-${randomBytes(8).toString('hex')}`,
  sequence: 3,
  employee,
  type: 'in',
  capturedAt: new Date().toISOString(),
  clockOffsetMs: 0,
}] });
assert.equal(afterRevoke.response.status, 401, 'Revoked kiosk credential was still accepted.');
report('revoked credential enforcement', 'sync rejected 401');

const finalDevices = await authed(northCookie, '/api/kiosk/devices');
assert.equal(finalDevices.response.status, 200);
const finalDevice = finalDevices.body?.devices?.find(x => x.id === deviceId);
assert.equal(finalDevice?.status, 'revoked');
assert.ok(finalDevice?.revokedAt, 'Revoked kiosk lacks revocation timestamp evidence.');

console.log('LIVE_TENANT_ISOLATION_PROOF=PASS');
console.log('LIVE_KIOSK_INTERACTIVE_PROOF=PASS');
console.log(`release=${expectedRelease}`);
console.log('claim_boundary=fixture-only hosted staging; productionApproved=false; pilotReady=false');
