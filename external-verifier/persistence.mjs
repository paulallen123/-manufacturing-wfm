import assert from 'node:assert/strict';

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD || '';
const expectedRelease = process.env.EXPECTED_RELEASE || '0.6.76-hosted-staging-rc1';
const correctionId = process.env.PERSISTENCE_ID || '';
const employeeEmail = process.env.PERSISTENCE_EMPLOYEE || '';
assert.ok(origin.startsWith('https://'));
assert.ok(password.length >= 20);
assert.match(correctionId, /^AC-[a-f0-9]{32}$/i);
assert.ok(employeeEmail.includes('@'));

async function request(path, init = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}
function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';', 1)[0];
}
const health = await request('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body?.release, expectedRelease);

const login = await request('/api/login', {
  method:'POST',
  headers:{'content-type':'application/json',origin,referer:origin+'/',accept:'application/json'},
  body:JSON.stringify({email:employeeEmail,password})
});
assert.equal(login.response.status, 200);
const cookie = cookieFrom(login.response);
assert.ok(cookie);

const dash = await request('/api/attendance-corrections', {
  headers:{cookie,accept:'application/json,text/plain,*/*',referer:origin+'/'}
});
assert.equal(dash.response.status, 200);
const requestRecord = (dash.body?.requests || []).find(q => q.id === correctionId);
assert.ok(requestRecord, 'persisted correction was not found after target restart');
assert.equal(requestRecord.status, 'rejected');
assert.equal(requestRecord.revision, 2);
assert.equal(requestRecord.outcome?.applied, false);
const history = (requestRecord.history || []).map(h => h.type);
assert.ok(history.includes('attendance-correction-submitted'));
assert.ok(history.includes('attendance-correction-reject'));

console.log('VECTOR_EXTERNAL_RESTART_PERSISTENCE='+JSON.stringify({
  status:'PASS',
  release:expectedRelease,
  correctionId,
  employeeEmail,
  finalStatus:requestRecord.status,
  revision:requestRecord.revision,
  sourceAttendanceMutated:false,
  history
}));
