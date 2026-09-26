import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD || '';
const expectedRelease = process.env.EXPECTED_RELEASE || '0.6.76-hosted-staging-rc1';
const port = Number(process.env.PORT || 3000);
const timeoutMs = 20_000;
const openStatuses = new Set(['submitted','information_required','awaiting_approval','payroll_review_required']);

assert.ok(origin.startsWith('https://'), 'TARGET_ORIGIN must be https');
assert.ok(password.length >= 20, 'TARGET_PASSWORD missing/too short');

async function request(path, init = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}
function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';',1)[0];
}
async function login(email) {
  const { response } = await request('/api/login', {
    method:'POST',
    headers:{'content-type':'application/json',origin,referer:origin+'/',accept:'application/json'},
    body:JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, email + ' login failed: ' + response.status);
  const cookie = cookieFrom(response);
  assert.ok(cookie, 'missing session cookie for ' + email);
  return cookie;
}
async function authed(cookie, path, {method='GET', body} = {}) {
  return request(path, {
    method,
    headers:{
      cookie,
      accept:'application/json,text/plain,*/*',
      referer:origin+'/',
      ...(method === 'POST' ? {'content-type':'application/json', origin} : {})
    },
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
}
function londonLocalMinute(value) {
  const d = new Date(value);
  assert.ok(Number.isFinite(d.getTime()), 'invalid timestamp');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/London',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hour12:false
  }).format(d).replace(' ','T');
}

async function seed() {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body?.release, expectedRelease);
  assert.equal(health.body?.fixtureOnly, true);
  assert.equal(health.body?.productionApproved, false);

  const candidates = [
    ['maya@northstar.example','e0'],
    ['leah@northstar.example','e32'],
    ['quality@northstar.example','e16'],
    ['leeds-employee@northstar.example','e24']
  ];
  let employee = null;
  for (const [email, personId] of candidates) {
    const cookie = await login(email);
    const dash = await authed(cookie, '/api/attendance-corrections');
    assert.equal(dash.response.status, 200);
    const blocked = new Set((dash.body?.requests || [])
      .filter(q => q.employee === personId && openStatuses.has(q.status))
      .map(q => q.record));
    const record = Array.isArray(dash.body?.records)
      ? dash.body.records.find(r => r.employee === personId && r.effective?.clockIn && r.effective?.clockOut && !blocked.has(r.id))
      : null;
    if (record) { employee = {email,personId,cookie,dash:dash.body,record}; break; }
  }
  assert.ok(employee, 'no safe employee fixture found');

  const clockIn = londonLocalMinute(employee.record.effective.clockIn);
  const clockOut = londonLocalMinute(employee.record.effective.clockOut);
  const submitKey = 'persist-seed-' + randomBytes(10).toString('hex');
  const submitted = await authed(employee.cookie, '/api/attendance-corrections/command', {
    method:'POST',
    body:{
      version: employee.dash.version,
      command:'correction-submit',
      payload:{
        period:employee.record.period,
        record:employee.record.id,
        clockIn,
        clockOut,
        note:'Frozen-candidate hosted persistence proof. No attendance change intended.'
      },
      idempotencyKey:submitKey
    }
  });
  assert.equal(submitted.response.status, 200, 'submit failed');
  const correctionId = submitted.body?.result?.id;
  assert.match(String(correctionId || ''), /^AC-[a-f0-9]{32}$/i);
  assert.equal(submitted.body?.result?.revision, 1);

  const managers = ['manager@northstar.example','supervisor@northstar.example','director@northstar.example','superuser@northstar.example'];
  let manager = null;
  for (const email of managers) {
    const cookie = await login(email);
    const dash = await authed(cookie, '/api/attendance-corrections');
    if (dash.response.status !== 200) continue;
    if (dash.body?.requests?.some(q => q.id === correctionId)) { manager = {email,cookie,dash:dash.body}; break; }
  }
  assert.ok(manager, 'no authorised manager can see seeded correction');

  const reviewed = await authed(manager.cookie, '/api/attendance-corrections/command', {
    method:'POST',
    body:{
      version:manager.dash.version,
      command:'correction-review',
      payload:{
        id:correctionId,
        revision:1,
        decision:'reject',
        note:'Hosted persistence proof seed rejected by design; original evidence unchanged.'
      },
      idempotencyKey:'persist-review-' + randomBytes(10).toString('hex')
    }
  });
  assert.equal(reviewed.response.status, 200, 'review failed');
  assert.equal(reviewed.body?.result?.status, 'rejected');
  assert.equal(reviewed.body?.result?.revision, 2);

  return {
    status:'PASS',
    release:expectedRelease,
    correctionId,
    employeeEmail:employee.email,
    employeeId:employee.personId,
    reviewer:manager.email,
    record:employee.record.id,
    finalStatus:'rejected',
    revision:2,
    createdAt:new Date().toISOString()
  };
}

async function verifyFreshReadback(seedResult) {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body?.release, expectedRelease);

  const cookie = await login(seedResult.employeeEmail);
  const dash = await authed(cookie, '/api/attendance-corrections');
  assert.equal(dash.response.status, 200);
  const record = dash.body?.requests?.find(q => q.id === seedResult.correctionId);
  assert.ok(record, 'seeded correction missing on fresh-login read-back');
  assert.equal(record.status, 'rejected');
  assert.equal(record.revision, 2);
  assert.equal(record.outcome?.applied, false);
  const history = (record.history || []).map(h => h.type);
  assert.ok(history.includes('attendance-correction-submitted'));
  assert.ok(history.includes('attendance-correction-reject'));

  return {
    status:'PASS',
    correctionId:seedResult.correctionId,
    employeeEmail:seedResult.employeeEmail,
    finalStatus:record.status,
    revision:record.revision,
    history,
    verifiedAt:new Date().toISOString()
  };
}

let result;
let lastReadback = null;
let readbackCount = 0;

try {
  result = await seed();
  console.log('VECTOR_HOSTED_PERSISTENCE_SEED=' + JSON.stringify(result));
  lastReadback = await verifyFreshReadback(result);
  readbackCount += 1;
  console.log('VECTOR_HOSTED_PERSISTENCE_READBACK=' + JSON.stringify({...lastReadback, readbackCount}));
} catch (error) {
  console.error('VECTOR_HOSTED_PERSISTENCE_SEED_FAIL=' + String(error?.stack || error));
  process.exit(1);
}

setInterval(async () => {
  try {
    lastReadback = await verifyFreshReadback(result);
    readbackCount += 1;
    console.log('VECTOR_HOSTED_PERSISTENCE_READBACK=' + JSON.stringify({...lastReadback, readbackCount}));
  } catch (error) {
    console.error('VECTOR_HOSTED_PERSISTENCE_READBACK_FAIL=' + String(error?.message || error));
  }
}, 10_000);

http.createServer((req,res) => {
  const ok = result?.status === 'PASS' && lastReadback?.status === 'PASS';
  res.writeHead(ok ? 200 : 503, {'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({seed:result,lastReadback,readbackCount}));
}).listen(port,'0.0.0.0');
