import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD || '';
const expectedRelease = process.env.EXPECTED_RELEASE || '0.6.76-hosted-staging-rc1';
assert.ok(origin.startsWith('https://'));
assert.ok(password.length >= 20);
const timeoutMs = 20000;
const openStatuses = new Set(['submitted','information_required','awaiting_approval','payroll_review_required']);

async function request(path, init = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}
function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';', 1)[0];
}
async function login(email) {
  const { response } = await request('/api/login', {
    method:'POST',
    headers:{'content-type':'application/json',origin,referer:origin+'/',accept:'application/json'},
    body:JSON.stringify({email,password})
  });
  assert.equal(response.status, 200, email + ' login failed: ' + response.status);
  const cookie = cookieFrom(response);
  assert.ok(cookie, email + ' missing session cookie');
  return cookie;
}
async function authed(cookie, path, { method='GET', body } = {}) {
  return request(path, {
    method,
    headers:{cookie,accept:'application/json,text/plain,*/*',referer:origin+'/',...(method==='POST'?{'content-type':'application/json',origin}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
}
function londonLocalMinute(value) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  }).format(new Date(value)).replace(' ','T');
}

const health = await request('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body?.release, expectedRelease);
assert.equal(health.body?.fixtureOnly, true);
assert.equal(health.body?.productionApproved, false);

const employeeCandidates = [
  ['maya@northstar.example','e0'],
  ['leah@northstar.example','e32'],
  ['quality@northstar.example','e16'],
  ['leeds-employee@northstar.example','e24']
];
let employee = null;
for (const [email, personId] of employeeCandidates) {
  const cookie = await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  if (dash.response.status !== 200) continue;
  const blocked = new Set((dash.body?.requests || []).filter(q => q.employee === personId && openStatuses.has(q.status)).map(q => q.record));
  const record = (dash.body?.records || []).find(r => r.employee === personId && r.effective?.clockIn && r.effective?.clockOut && !blocked.has(r.id));
  if (record) { employee = { email, personId, cookie, dash:dash.body, record }; break; }
}
assert.ok(employee, 'no safe employee correction fixture');
const clockIn = londonLocalMinute(employee.record.effective.clockIn);
const clockOut = londonLocalMinute(employee.record.effective.clockOut);

const injection = await authed(employee.cookie, '/api/attendance-corrections/command', {
  method:'POST',
  body:{
    version:employee.dash.version,
    command:'correction-submit',
    payload:{period:employee.record.period,record:employee.record.id,employee:'m1',clockIn,clockOut,note:'External proof identity injection rejection.'},
    idempotencyKey:'ext-id-reject-'+randomBytes(8).toString('hex')
  }
});
assert.equal(injection.response.status, 400);

const submitKey = 'ext-correction-'+randomBytes(10).toString('hex');
const submitBody = {
  version:employee.dash.version,
  command:'correction-submit',
  payload:{period:employee.record.period,record:employee.record.id,clockIn,clockOut,note:'External proof correction. Times intentionally unchanged.'},
  idempotencyKey:submitKey
};
const submitted = await authed(employee.cookie, '/api/attendance-corrections/command', { method:'POST', body:submitBody });
assert.equal(submitted.response.status, 200);
const correctionId = submitted.body?.result?.id;
assert.match(String(correctionId || ''), /^AC-[a-f0-9]{32}$/i);
assert.equal(submitted.body?.result?.revision, 1);

const replay = await authed(employee.cookie, '/api/attendance-corrections/command', { method:'POST', body:submitBody });
assert.equal(replay.response.status, 200);
assert.equal(replay.body?.replayed, true);
assert.equal(replay.body?.result?.id, correctionId);

const managerCandidates = ['manager@northstar.example','supervisor@northstar.example','director@northstar.example','superuser@northstar.example'];
let manager = null;
for (const email of managerCandidates) {
  const cookie = await login(email);
  const dash = await authed(cookie, '/api/attendance-corrections');
  if (dash.response.status !== 200) continue;
  const visible = (dash.body?.requests || []).find(q => q.id === correctionId);
  if (visible) { manager = { email, cookie, dash:dash.body }; break; }
}
assert.ok(manager, 'no authorised reviewer can see correction');

const reviewKey = 'ext-review-'+randomBytes(10).toString('hex');
const reviewBody = {
  version:manager.dash.version,
  command:'correction-review',
  payload:{id:correctionId,revision:1,decision:'reject',note:'External proof completed; reject by design so source attendance is unchanged.'},
  idempotencyKey:reviewKey
};
const reviewed = await authed(manager.cookie, '/api/attendance-corrections/command', { method:'POST', body:reviewBody });
assert.equal(reviewed.response.status, 200);
assert.equal(reviewed.body?.result?.status, 'rejected');
assert.equal(reviewed.body?.result?.revision, 2);

const reviewReplay = await authed(manager.cookie, '/api/attendance-corrections/command', { method:'POST', body:reviewBody });
assert.equal(reviewReplay.response.status, 200);
assert.equal(reviewReplay.body?.replayed, true);

const after = await authed(employee.cookie, '/api/attendance-corrections');
assert.equal(after.response.status, 200);
const finalRequest = (after.body?.requests || []).find(q => q.id === correctionId);
assert.ok(finalRequest);
assert.equal(finalRequest.status, 'rejected');
assert.equal(finalRequest.revision, 2);
assert.equal(finalRequest.outcome?.applied, false);
const history = (finalRequest.history || []).map(h => h.type);
assert.ok(history.includes('attendance-correction-submitted'));
assert.ok(history.includes('attendance-correction-reject'));
assert.ok((after.body?.records || []).some(r => r.id === employee.record.id && r.period === employee.record.period));

console.log('VECTOR_EXTERNAL_MUTATION_PROOF='+JSON.stringify({
  status:'PASS',
  release:expectedRelease,
  correctionId,
  employeeEmail:employee.email,
  reviewerEmail:manager.email,
  sourceRecord:employee.record.id,
  submitReplay:true,
  reviewReplay:true,
  finalStatus:'rejected',
  sourceAttendanceMutated:false,
  history
}));
