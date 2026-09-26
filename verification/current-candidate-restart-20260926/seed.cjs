'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD;
const expectedRelease = process.env.EXPECTED_RELEASE;
const candidateSha = process.env.EXPECTED_CANDIDATE_SHA;
const beforeDeploymentId = process.env.EXPECTED_BEFORE_DEPLOYMENT_ID;
const assertions = [];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function pass(name) {
  assertions.push({ name, status: 'PASS' });
}

async function request(path, init = {}) {
  const response = await fetch(origin + path, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0] ? values[0].split(';', 1)[0] : '';
}

async function login(email) {
  const result = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, referer: origin + '/', accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(result.response.status, 200, 'login failed for ' + email);
  const cookie = cookieFrom(result.response);
  assert.ok(cookie, 'login issued no session cookie');
  return cookie;
}

async function authed(cookie, path, { method = 'GET', body } = {}) {
  return request(path, {
    method,
    headers: {
      cookie,
      accept: 'application/json',
      referer: origin + '/',
      ...(method === 'POST' ? { 'content-type': 'application/json', origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function londonMinute(value) {
  const instant = new Date(value);
  assert.ok(Number.isFinite(instant.getTime()), 'invalid source instant');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant).replace(' ', 'T');
}

function emit(receipt) {
  console.log('VECTOR_CURRENT_CANDIDATE_PERSISTENCE_PROOF=' + JSON.stringify(receipt));
}

(async () => {
  assert.match(origin, /^https:\/\//, 'hosted HTTPS target required');
  assert.ok(password && password.length >= 20, 'existing fixture credential required');
  assert.match(String(candidateSha || ''), /^[a-f0-9]{40}$/i, 'candidate SHA required');
  assert.ok(beforeDeploymentId, 'before deployment identity required');

  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body?.release, expectedRelease);
  assert.equal(health.body?.fixtureOnly, true);
  assert.equal(health.body?.productionApproved, false);
  pass('fixture_only_boundary');

  const open = new Set(['submitted', 'information_required', 'awaiting_approval', 'payroll_review_required']);
  const candidates = [
    ['maya@northstar.example', 'e0'],
    ['leah@northstar.example', 'e32'],
    ['quality@northstar.example', 'e16'],
    ['leeds-employee@northstar.example', 'e24'],
  ];
  let employee = null;
  for (const [email, personId] of candidates) {
    const cookie = await login(email);
    const dashboard = await authed(cookie, '/api/attendance-corrections');
    assert.equal(dashboard.response.status, 200);
    const blocked = new Set((dashboard.body?.requests || [])
      .filter(item => item.employee === personId && open.has(item.status))
      .map(item => item.record));
    const record = (dashboard.body?.records || []).find(item =>
      item.employee === personId && item.effective?.clockIn && item.effective?.clockOut && !blocked.has(item.id));
    if (record) {
      employee = { email, personId, cookie, dashboard: dashboard.body, record };
      break;
    }
  }
  assert.ok(employee, 'no safe closed fixture record available');
  pass('safe_fixture_selected');

  const requestedClockIn = londonMinute(employee.record.effective.clockIn);
  const requestedClockOut = londonMinute(employee.record.effective.clockOut);
  const submitKey = 'restart-seed-' + crypto.randomBytes(12).toString('hex');
  const submitBody = {
    version: employee.dashboard.version,
    command: 'correction-submit',
    payload: {
      period: employee.record.period,
      record: employee.record.id,
      clockIn: requestedClockIn,
      clockOut: requestedClockOut,
      note: 'Fixture-only restart proof. Times intentionally match the source and the request will be rejected.',
    },
    idempotencyKey: submitKey,
  };
  const submitted = await authed(employee.cookie, '/api/attendance-corrections/command', { method: 'POST', body: submitBody });
  assert.equal(submitted.response.status, 200, 'seed submission failed');
  const correctionId = submitted.body?.result?.id;
  assert.match(String(correctionId || ''), /^AC-[a-f0-9]{32}$/i);
  assert.equal(submitted.body?.result?.revision, 1);

  const replay = await authed(employee.cookie, '/api/attendance-corrections/command', { method: 'POST', body: submitBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body?.replayed, true);
  assert.equal(replay.body?.result?.id, correctionId);
  pass('submit_idempotent');

  let manager = null;
  for (const email of ['manager@northstar.example', 'supervisor@northstar.example', 'director@northstar.example', 'superuser@northstar.example']) {
    const cookie = await login(email);
    const dashboard = await authed(cookie, '/api/attendance-corrections');
    if (dashboard.response.status === 200 && dashboard.body?.requests?.some(item => item.id === correctionId)) {
      manager = { email, cookie, dashboard: dashboard.body };
      break;
    }
  }
  assert.ok(manager, 'authorised reviewer cannot see seeded request');
  const reviewBody = {
    version: manager.dashboard.version,
    command: 'correction-review',
    payload: {
      id: correctionId,
      revision: 1,
      decision: 'reject',
      note: 'Rejected by design for fixture-only restart proof; source attendance remains unchanged.',
    },
    idempotencyKey: 'restart-review-' + crypto.randomBytes(12).toString('hex'),
  };
  const reviewed = await authed(manager.cookie, '/api/attendance-corrections/command', { method: 'POST', body: reviewBody });
  assert.equal(reviewed.response.status, 200, 'seed review failed');
  assert.equal(reviewed.body?.result?.status, 'rejected');
  assert.equal(reviewed.body?.result?.revision, 2);
  pass('rejected_without_attendance_mutation');

  const after = await authed(employee.cookie, '/api/attendance-corrections');
  assert.equal(after.response.status, 200);
  const correction = after.body?.requests?.find(item => item.id === correctionId);
  assert.ok(correction, 'seeded correction missing from read-back');
  assert.equal(correction.status, 'rejected');
  assert.equal(correction.revision, 2);
  assert.equal(correction.outcome?.applied, false);
  const history = correction.history.map(item => item.type);
  assert.ok(history.includes('attendance-correction-submitted'));
  assert.ok(history.includes('attendance-correction-reject'));
  const sourceRecord = after.body?.records?.find(item => item.id === correction.record);
  assert.ok(sourceRecord, 'source record missing after rejected proof request');
  pass('exact_seed_readback');

  const otherCookie = await login('other@isolation.example');
  const other = await authed(otherCookie, '/api/attendance-corrections');
  assert.equal(other.response.status, 200);
  assert.ok(!(other.body?.requests || []).some(item => item.id === correctionId));
  pass('cross_tenant_isolation');

  const persistence = {
    id: correctionId,
    employee: employee.email,
    status: correction.status,
    revision: correction.revision,
    history,
    digest: hash(correction),
    sourceRecordId: sourceRecord.id,
    sourceDigest: hash(sourceRecord),
  };
  emit({
    status: 'PASS',
    scope: 'fixture-only hosted persistence seed',
    candidateSha,
    beforeDeploymentId,
    assertions,
    sequence: [{ phase: 'seed', beforeDeploymentId, ...persistence }],
    persistence,
    sourceAttendanceMutated: false,
    finishedAt: new Date().toISOString(),
  });
})().catch(error => {
  emit({
    status: 'FAIL',
    scope: 'fixture-only hosted persistence seed',
    candidateSha,
    beforeDeploymentId,
    assertions,
    error: String(error?.message || error).slice(0, 500),
    finishedAt: new Date().toISOString(),
  });
  process.exitCode = 1;
});
