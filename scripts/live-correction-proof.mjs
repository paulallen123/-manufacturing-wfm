import assert from 'node:assert/strict';
import { proofRunnerLogin } from './proof-runner-auth.mjs';
import { randomBytes } from 'node:crypto';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
assert.equal(origin, expectedOrigin);

const timeoutMs = 20_000;
const openStatuses = new Set(['submitted', 'information_required', 'awaiting_approval', 'payroll_review_required']);
function report(label, detail = '') { console.log(`${label}${detail ? ` · ${detail}` : ''}`); }
function londonLocalMinute(value) {
  const d = new Date(value);
  assert.ok(Number.isFinite(d.getTime()), 'Attendance timestamp is invalid.');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(' ', 'T');
}
async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}
function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0] ? values[0].split(';', 1)[0] : '';
}
async function login(email) {
  return proofRunnerLogin({ origin, email, timeoutMs });
}
async function authed(cookie, path, { method = 'GET', body } = {}) {
  return request(path, {
    method,
    headers: {
      cookie,
      accept: 'application/json,text/plain,*/*',
      referer: `${origin}/`,
      ...(method === 'POST' ? { 'content-type': 'application/json', origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const health = await request('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body?.release, expectedRelease);
assert.equal(health.body?.fixtureOnly, true);
assert.equal(health.body?.productionApproved, false);
assert.equal(health.body?.pilotReady, false);

const employeeCandidates = [
  ['maya@northstar.example', 'e0'],
  ['leah@northstar.example', 'e32'],
  ['quality@northstar.example', 'e16'],
  ['leeds-employee@northstar.example', 'e24'],
];
let employee = null;
for (const [email, personId] of employeeCandidates) {
  const cookie = await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  assert.equal(dash.response.status, 200, `${email} correction dashboard failed.`);
  const blockedRecordIds = new Set((dash.body?.requests || [])
    .filter(q => q.employee === personId && openStatuses.has(q.status))
    .map(q => q.record));
  const record = Array.isArray(dash.body?.records)
    ? dash.body.records.find(r => r.employee === personId && r.effective?.clockIn && r.effective?.clockOut && !blockedRecordIds.has(r.id))
    : null;
  if (record) {
    employee = { email, personId, cookie, dash: dash.body, record };
    break;
  }
}
assert.ok(employee, 'No employee fixture has a safe closed-week attendance record without an existing open correction request.');
const requestedClockIn = londonLocalMinute(employee.record.effective.clockIn);
const requestedClockOut = londonLocalMinute(employee.record.effective.clockOut);
report('correction fixture', `${employee.email} record=${employee.record.id} period=${employee.record.period}`);
report('correction local-time contract', `${requestedClockIn} -> ${requestedClockOut} Europe/London`);

// Client-supplied identity is forbidden. Prove that before creating the real fixture request.
const identityInjection = await authed(employee.cookie, '/api/attendance-corrections/command', {
  method: 'POST',
  body: {
    version: employee.dash.version,
    command: 'correction-submit',
    payload: {
      period: employee.record.period,
      record: employee.record.id,
      employee: 'm1',
      clockIn: requestedClockIn,
      clockOut: requestedClockOut,
      note: 'Controlled fixture identity-injection rejection proof.',
    },
    idempotencyKey: `proof-id-reject-${randomBytes(8).toString('hex')}`,
  },
});
assert.equal(identityInjection.response.status, 400, 'Correction accepted a client-supplied employee identity.');
report('correction identity binding', 'client-supplied employee rejected 400');

const submitKey = `proof-correction-${randomBytes(10).toString('hex')}`;
const submitBody = {
  version: employee.dash.version,
  command: 'correction-submit',
  payload: {
    period: employee.record.period,
    record: employee.record.id,
    clockIn: requestedClockIn,
    clockOut: requestedClockOut,
    note: 'Controlled fixture correction proof. Requested times intentionally match existing evidence; no attendance change is intended.',
  },
  idempotencyKey: submitKey,
};
const submitted = await authed(employee.cookie, '/api/attendance-corrections/command', { method: 'POST', body: submitBody });
assert.equal(submitted.response.status, 200, `Correction submit failed: ${submitted.response.status} ${submitted.body?.error || ''}`);
const correctionId = submitted.body?.result?.id;
assert.match(String(correctionId || ''), /^AC-[a-f0-9]{32}$/i, 'Correction request did not receive the expected server-generated ID.');
assert.ok(['submitted', 'payroll_review_required'].includes(submitted.body?.result?.status));
assert.equal(submitted.body?.result?.revision, 1);
assert.ok(Number.isInteger(submitted.body?.version));
report('correction submitted', `request=${correctionId} receipt=${submitKey} status=${submitted.body.result.status} revision=1`);

// The same idempotency key and body must replay rather than duplicate the request.
const submitReplay = await authed(employee.cookie, '/api/attendance-corrections/command', { method: 'POST', body: submitBody });
assert.equal(submitReplay.response.status, 200);
assert.equal(submitReplay.body?.replayed, true);
assert.equal(submitReplay.body?.result?.id, correctionId);
report('correction submit idempotency', 'exact retry replayed same generated request');

const managerCandidates = [
  'manager@northstar.example',
  'supervisor@northstar.example',
  'director@northstar.example',
  'superuser@northstar.example',
];
let manager = null;
for (const email of managerCandidates) {
  const cookie = await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  if (dash.response.status !== 200) continue;
  const visibleRequest = dash.body?.requests?.find(q => q.id === correctionId);
  if (visibleRequest) {
    manager = { email, cookie, dash: dash.body, visibleRequest };
    break;
  }
}
assert.ok(manager, 'No authorised manager can see the employee correction request.');
assert.equal(manager.visibleRequest.employee, employee.personId);
assert.equal(manager.visibleRequest.revision, 1);
report('manager correction visibility', `${manager.email} can review request=${correctionId}`);

// Safest review proof: reject the fixture request so no attendance record is changed.
const reviewKey = `proof-review-${randomBytes(10).toString('hex')}`;
const reviewBody = {
  version: manager.dash.version,
  command: 'correction-review',
  payload: {
    id: correctionId,
    revision: 1,
    decision: 'reject',
    note: 'Controlled fixture proof completed. Rejecting by design so the original attendance evidence remains unchanged.',
  },
  idempotencyKey: reviewKey,
};
const reviewed = await authed(manager.cookie, '/api/attendance-corrections/command', { method: 'POST', body: reviewBody });
assert.equal(reviewed.response.status, 200, `Manager correction review failed: ${reviewed.response.status} ${reviewed.body?.error || ''}`);
assert.equal(reviewed.body?.result?.id, correctionId);
assert.equal(reviewed.body?.result?.status, 'rejected');
assert.equal(reviewed.body?.result?.revision, 2);
report('manager correction decision', 'rejected by design; original attendance not mutated');

const reviewReplay = await authed(manager.cookie, '/api/attendance-corrections/command', { method: 'POST', body: reviewBody });
assert.equal(reviewReplay.response.status, 200);
assert.equal(reviewReplay.body?.replayed, true);
assert.equal(reviewReplay.body?.result?.id, correctionId);
assert.equal(reviewReplay.body?.result?.status, 'rejected');
report('correction review idempotency', 'exact retry replayed');

const employeeAfter = await authed(employee.cookie, '/api/attendance-corrections');
assert.equal(employeeAfter.response.status, 200);
const finalRequest = employeeAfter.body?.requests?.find(q => q.id === correctionId);
assert.ok(finalRequest);
assert.equal(finalRequest.status, 'rejected');
assert.equal(finalRequest.revision, 2);
assert.equal(finalRequest.outcome?.applied, false);
const historyTypes = Array.isArray(finalRequest.history) ? finalRequest.history.map(h => h.type) : [];
assert.ok(historyTypes.includes('attendance-correction-submitted'));
assert.ok(historyTypes.includes('attendance-correction-reject'));
report('correction history', historyTypes.join(' -> '));

// The source record remains present and the request is closed, proving the rejected workflow did not remove evidence.
const sourceAfter = employeeAfter.body?.records?.find(r => r.id === employee.record.id && r.period === employee.record.period);
assert.ok(sourceAfter, 'Original attendance source record disappeared after rejected correction.');
assert.equal(londonLocalMinute(finalRequest.requested.clockIn), requestedClockIn);
assert.equal(londonLocalMinute(finalRequest.requested.clockOut), requestedClockOut);

console.log('LIVE_ATTENDANCE_CORRECTION_AUDIT_PROOF=PASS');
console.log(`request=${correctionId}`);
console.log(`receipt=${submitKey}`);
console.log(`employee=${employee.email}`);
console.log(`reviewer=${manager.email}`);
console.log(`release=${expectedRelease}`);
console.log('outcome=rejected-by-design; original attendance evidence preserved');
console.log('claim_boundary=fixture-only hosted staging; productionApproved=false; pilotReady=false');
