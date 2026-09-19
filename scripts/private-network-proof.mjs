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

async function authedCommand(cookie, path, body, extraHeaders = {}) {
  return request(path, {
    method: 'POST',
    headers: {
      ...hostedHeaders,
      cookie,
      accept: 'application/json',
      'content-type': 'application/json',
      origin: browserOrigin,
      referer: `${browserOrigin}/`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function require200(cookie, path, label = 'JOURNEY_PASS') {
  const result = await authed(cookie, path);
  assert.equal(result.response.status, 200, `${path} failed with ${result.response.status}`);
  console.log(`${label} ${path}`);
  return result;
}

function londonLocalMinute(value) {
  const d = new Date(value);
  assert.ok(Number.isFinite(d.getTime()), 'Attendance timestamp is invalid');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(' ', 'T');
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
assert.equal(unauth.response.status, 401, `protected bootstrap unexpectedly returned ${unauth.response.status}`);
console.log('UNAUTH_FAIL_CLOSED_PASS bootstrap=401');

const north = await login('superuser@northstar.example');
const isolation = await login('other@isolation.example');
const employee = await login('maya@northstar.example');
const manager = await login('manager@northstar.example');

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

await require200(manager, '/api/bootstrap', 'MANAGER_ROLE_PASS');
const managerPayroll = await authed(manager, '/api/payroll-run');
assert.equal(managerPayroll.response.status, 403, `manager payroll boundary returned ${managerPayroll.response.status}`);
console.log('MANAGER_PAYROLL_BOUNDARY_PASS 403');

for (const path of [
  '/api/readiness',
  '/api/weekly-review',
  '/api/schedule-publication',
  '/api/operations',
  '/api/payroll-run',
  '/api/readiness/payroll-outcomes',
  '/api/readiness/finance-attribution',
  '/api/payroll-intelligence',
  '/api/support/bot',
]) {
  await require200(north, path, 'SUPERUSER_JOURNEY_PASS');
}

const categoryCandidates = {
  onboarding: ['/api/onboarding', '/api/company'],
  workforce: ['/api/resources', '/api/availability'],
  attendance: ['/api/time-review', '/api/attendance-corrections'],
  value: ['/api/cost', '/api/recommendations', '/api/value-cockpit'],
};
for (const [category, paths] of Object.entries(categoryCandidates)) {
  let passed = null;
  for (const path of paths) {
    const result = await authed(north, path);
    if (result.response.status === 200) { passed = path; break; }
  }
  assert.ok(passed, `${category} had no HTTP-200 route`);
  console.log(`CATEGORY_PASS ${category} ${passed}`);
}

await require200(employee, '/api/personal', 'EMPLOYEE_JOURNEY_PASS');

// Safe write proof: submit and reject a fixture-only correction whose requested times
// exactly match the source record. This proves identity binding, idempotency,
// manager review, audit history and tenant isolation without mutating attendance.
const openStatuses = new Set(['submitted', 'information_required', 'awaiting_approval', 'payroll_review_required']);
const employeeCandidates = [
  ['maya@northstar.example', 'e0', employee],
  ['leah@northstar.example', 'e32', null],
  ['quality@northstar.example', 'e16', null],
  ['leeds-employee@northstar.example', 'e24', null],
];
let correctionEmployee = null;
for (const [email, personId, existingCookie] of employeeCandidates) {
  const cookie = existingCookie || await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  assert.equal(dash.response.status, 200, `${email} correction dashboard failed`);
  const blockedRecordIds = new Set((dash.body?.requests || [])
    .filter(q => q.employee === personId && openStatuses.has(q.status))
    .map(q => q.record));
  const record = Array.isArray(dash.body?.records)
    ? dash.body.records.find(r => r.employee === personId && r.effective?.clockIn && r.effective?.clockOut && !blockedRecordIds.has(r.id))
    : null;
  if (record) {
    correctionEmployee = { email, personId, cookie, dash: dash.body, record };
    break;
  }
}
assert.ok(correctionEmployee, 'No safe fixture attendance record available for correction proof');
const requestedClockIn = londonLocalMinute(correctionEmployee.record.effective.clockIn);
const requestedClockOut = londonLocalMinute(correctionEmployee.record.effective.clockOut);

const identityInjection = await authedCommand(correctionEmployee.cookie, '/api/attendance-corrections/command', {
  version: correctionEmployee.dash.version,
  command: 'correction-submit',
  payload: {
    period: correctionEmployee.record.period,
    record: correctionEmployee.record.id,
    employee: 'm1',
    clockIn: requestedClockIn,
    clockOut: requestedClockOut,
    note: 'Private synthetic identity-injection rejection proof.',
  },
  idempotencyKey: `private-proof-id-reject-${randomBytes(8).toString('hex')}`,
});
assert.equal(identityInjection.response.status, 400, 'Correction accepted client-supplied employee identity');
console.log('CORRECTION_IDENTITY_BINDING_PASS 400');

const submitKey = `private-proof-correction-${randomBytes(10).toString('hex')}`;
const submitBody = {
  version: correctionEmployee.dash.version,
  command: 'correction-submit',
  payload: {
    period: correctionEmployee.record.period,
    record: correctionEmployee.record.id,
    clockIn: requestedClockIn,
    clockOut: requestedClockOut,
    note: 'Private synthetic correction proof. Requested times match existing evidence; no attendance change intended.',
  },
  idempotencyKey: submitKey,
};
const submitted = await authedCommand(correctionEmployee.cookie, '/api/attendance-corrections/command', submitBody);
assert.equal(submitted.response.status, 200, `Correction submit failed: ${submitted.response.status}`);
const correctionId = submitted.body?.result?.id;
assert.match(String(correctionId || ''), /^AC-[a-f0-9]{32}$/i, 'Correction request missing server-generated ID');
assert.ok(['submitted', 'payroll_review_required'].includes(submitted.body?.result?.status));
assert.equal(submitted.body?.result?.revision, 1);
console.log(`CORRECTION_SUBMIT_PASS ${correctionId}`);

const submitReplay = await authedCommand(correctionEmployee.cookie, '/api/attendance-corrections/command', submitBody);
assert.equal(submitReplay.response.status, 200);
assert.equal(submitReplay.body?.replayed, true);
assert.equal(submitReplay.body?.result?.id, correctionId);
console.log('CORRECTION_SUBMIT_IDEMPOTENCY_PASS');

const managerCandidates = [
  ['manager@northstar.example', manager],
  ['supervisor@northstar.example', null],
  ['director@northstar.example', null],
  ['superuser@northstar.example', north],
];
let correctionManager = null;
for (const [email, existingCookie] of managerCandidates) {
  const cookie = existingCookie || await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  if (dash.response.status !== 200) continue;
  const visibleRequest = dash.body?.requests?.find(q => q.id === correctionId);
  if (visibleRequest) {
    correctionManager = { email, cookie, dash: dash.body, visibleRequest };
    break;
  }
}
assert.ok(correctionManager, 'No authorised manager can see correction request');
assert.equal(correctionManager.visibleRequest.employee, correctionEmployee.personId);
console.log('CORRECTION_MANAGER_VISIBILITY_PASS');

const reviewKey = `private-proof-review-${randomBytes(10).toString('hex')}`;
const reviewBody = {
  version: correctionManager.dash.version,
  command: 'correction-review',
  payload: {
    id: correctionId,
    revision: 1,
    decision: 'reject',
    note: 'Private synthetic proof complete. Rejecting by design to preserve attendance evidence.',
  },
  idempotencyKey: reviewKey,
};
const reviewed = await authedCommand(correctionManager.cookie, '/api/attendance-corrections/command', reviewBody);
assert.equal(reviewed.response.status, 200, `Manager correction review failed: ${reviewed.response.status}`);
assert.equal(reviewed.body?.result?.id, correctionId);
assert.equal(reviewed.body?.result?.status, 'rejected');
assert.equal(reviewed.body?.result?.revision, 2);
console.log('CORRECTION_REVIEW_PASS rejected');

const reviewReplay = await authedCommand(correctionManager.cookie, '/api/attendance-corrections/command', reviewBody);
assert.equal(reviewReplay.response.status, 200);
assert.equal(reviewReplay.body?.replayed, true);
assert.equal(reviewReplay.body?.result?.id, correctionId);
assert.equal(reviewReplay.body?.result?.status, 'rejected');
console.log('CORRECTION_REVIEW_IDEMPOTENCY_PASS');

const employeeAfter = await authed(correctionEmployee.cookie, '/api/attendance-corrections');
assert.equal(employeeAfter.response.status, 200);
const finalRequest = employeeAfter.body?.requests?.find(q => q.id === correctionId);
assert.ok(finalRequest, 'Correction request missing after review');
assert.equal(finalRequest.status, 'rejected');
assert.equal(finalRequest.revision, 2);
assert.equal(finalRequest.outcome?.applied, false);
const historyTypes = Array.isArray(finalRequest.history) ? finalRequest.history.map(h => h.type) : [];
assert.ok(historyTypes.includes('attendance-correction-submitted'));
assert.ok(historyTypes.includes('attendance-correction-reject'));
const sourceAfter = employeeAfter.body?.records?.find(r => r.id === correctionEmployee.record.id && r.period === correctionEmployee.record.period);
assert.ok(sourceAfter, 'Original attendance source record disappeared');
console.log('CORRECTION_AUDIT_HISTORY_PASS');

const isolationCorrections = await authed(isolation, '/api/attendance-corrections');
assert.equal(isolationCorrections.response.status, 200, 'Isolation tenant correction dashboard failed');
assert.ok(!(isolationCorrections.body?.requests || []).some(q => q.id === correctionId), 'Correction leaked into second tenant');
console.log('CORRECTION_TENANT_ISOLATION_PASS');

console.log('PRIVATE_NETWORK_AUTH_PROOF=PASS');
console.log('PRIVATE_TENANT_ISOLATION_PROOF=PASS');
console.log('PRIVATE_ROLE_BOUNDARY_PROOF=PASS');
console.log('PRIVATE_CORRECTION_WRITE_PROOF=PASS');
console.log('claim_boundary=private synthetic proof only; frozen target unmodified; correction rejected by design');

createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain');
  res.end('private-proof-pass\n');
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
