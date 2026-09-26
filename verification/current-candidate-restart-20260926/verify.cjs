'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD;
const expectedRelease = process.env.EXPECTED_RELEASE;
const candidateSha = process.env.EXPECTED_CANDIDATE_SHA;
const beforeDeploymentId = process.env.EXPECTED_BEFORE_DEPLOYMENT_ID;
const afterDeploymentId = process.env.EXPECTED_AFTER_DEPLOYMENT_ID;
const persistenceId = process.env.PERSISTENCE_ID;
const employeeEmail = process.env.PERSISTENCE_EMPLOYEE;
const expectedDigest = process.env.EXPECTED_DIGEST;
const expectedSourceDigest = process.env.EXPECTED_SOURCE_DIGEST;
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

async function readDashboard(cookie) {
  return request('/api/attendance-corrections', {
    headers: { cookie, referer: origin + '/', accept: 'application/json' },
  });
}

function emit(receipt) {
  console.log('VECTOR_CURRENT_CANDIDATE_RESTART_PROOF=' + JSON.stringify(receipt));
}

(async () => {
  assert.match(origin, /^https:\/\//, 'hosted HTTPS target required');
  assert.ok(password && password.length >= 20, 'existing fixture credential required');
  assert.match(String(candidateSha || ''), /^[a-f0-9]{40}$/i, 'candidate SHA required');
  assert.ok(beforeDeploymentId, 'before deployment identity required');
  assert.ok(afterDeploymentId, 'after deployment identity required');
  assert.notEqual(afterDeploymentId, beforeDeploymentId, 'restart must create a distinct deployment');
  assert.match(String(persistenceId || ''), /^AC-[a-f0-9]{32}$/i, 'persistence ID required');
  assert.match(String(expectedDigest || ''), /^[a-f0-9]{64}$/i, 'expected record digest required');
  assert.match(String(expectedSourceDigest || ''), /^[a-f0-9]{64}$/i, 'expected source digest required');

  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body?.release, expectedRelease);
  assert.equal(health.body?.fixtureOnly, true);
  assert.equal(health.body?.productionApproved, false);
  pass('fixture_only_boundary');

  const cookie = await login(employeeEmail);
  const dashboard = await readDashboard(cookie);
  assert.equal(dashboard.response.status, 200);
  const correction = dashboard.body?.requests?.find(item => item.id === persistenceId);
  assert.ok(correction, 'exact seeded correction is absent');
  assert.equal(correction.status, 'rejected');
  assert.equal(correction.revision, 2);
  assert.equal(correction.outcome?.applied, false);
  const history = correction.history.map(item => item.type);
  assert.ok(history.includes('attendance-correction-submitted'));
  assert.ok(history.includes('attendance-correction-reject'));
  assert.equal(hash(correction), expectedDigest, 'saved correction bytes changed across restart');
  pass('exact_correction_bytes_survived');

  const sourceRecord = dashboard.body?.records?.find(item => item.id === correction.record);
  assert.ok(sourceRecord, 'source record is absent after restart');
  assert.equal(hash(sourceRecord), expectedSourceDigest, 'source record bytes changed across restart');
  pass('source_record_bytes_survived');

  const otherCookie = await login('other@isolation.example');
  const other = await readDashboard(otherCookie);
  assert.equal(other.response.status, 200);
  assert.ok(!(other.body?.requests || []).some(item => item.id === persistenceId));
  pass('cross_tenant_isolation_survived');

  emit({
    status: 'PASS',
    scope: 'fixture-only hosted restart and exact read-back',
    candidateSha,
    sequence: { beforeDeploymentId, afterDeploymentId, distinctDeployments: true },
    assertions,
    persistence: {
      id: persistenceId,
      employee: employeeEmail,
      status: correction.status,
      revision: correction.revision,
      history,
      digest: hash(correction),
      sourceRecordId: sourceRecord.id,
      sourceDigest: hash(sourceRecord),
    },
    sourceAttendanceMutated: false,
    finishedAt: new Date().toISOString(),
  });
})().catch(error => {
  emit({
    status: 'FAIL',
    scope: 'fixture-only hosted restart and exact read-back',
    candidateSha,
    sequence: { beforeDeploymentId, afterDeploymentId },
    assertions,
    persistence: { id: persistenceId, employee: employeeEmail },
    error: String(error?.message || error).slice(0, 500),
    finishedAt: new Date().toISOString(),
  });
  process.exitCode = 1;
});
