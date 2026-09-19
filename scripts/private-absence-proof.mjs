import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
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
const hostedHeaders = { host: browserHost, 'x-forwarded-host': browserHost, 'x-forwarded-proto': 'https' };
const timeoutMs = 20_000;

async function request(path, init = {}) {
  const method = init.method || 'GET';
  const headers = { ...(init.headers || {}) };
  const body = init.body == null ? null : String(init.body);
  if (body != null && headers['content-length'] == null) headers['content-length'] = Buffer.byteLength(body);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const result = await new Promise((resolve, reject) => {
    const req = transport({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path, headers, timeout: timeoutMs }, res => {
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
  return { status: result.res.statusCode || 0, body: parsed, text: result.text, headers: result.res.headers };
}
function cookieFrom(r) {
  const value = r.headers['set-cookie'];
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values[0] ? values[0].split(';', 1)[0] : '';
}
async function login(email) {
  const r = await request('/api/login', { method: 'POST', headers: { ...hostedHeaders, 'content-type': 'application/json', origin: browserOrigin, referer: `${browserOrigin}/`, accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `${email} login failed ${r.status}: ${r.text.slice(0,160)}`);
  const cookie = cookieFrom(r); assert.ok(cookie, `${email} returned no session`);
  return cookie;
}
async function authed(cookie, path) {
  return request(path, { headers: { ...hostedHeaders, cookie, accept: 'application/json', referer: `${browserOrigin}/` } });
}
async function command(cookie, version, name, payload) {
  return request('/api/command', { method: 'POST', headers: { ...hostedHeaders, cookie, accept: 'application/json', 'content-type': 'application/json', origin: browserOrigin, referer: `${browserOrigin}/` }, body: JSON.stringify({ command: name, payload, version }) });
}
async function post(cookie, path, payload) {
  return request(path, { method: 'POST', headers: { ...hostedHeaders, cookie, accept: 'application/json', 'content-type': 'application/json', origin: browserOrigin, referer: `${browserOrigin}/` }, body: JSON.stringify(payload) });
}
function findNamed(node, name, accept, depth = 0, seen = new Set()) {
  if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return null;
  seen.add(node);
  if (Object.prototype.hasOwnProperty.call(node, name) && accept(node[name])) return node[name];
  for (const value of Object.values(node)) {
    const found = findNamed(value, name, accept, depth + 1, seen);
    if (found !== null) return found;
  }
  return null;
}
function versionOf(b) { return findNamed(b, 'version', Number.isInteger); }
function requestsOf(b) { return findNamed(b, 'requests', Array.isArray) || []; }
function actorOf(b) { return findNamed(b, 'actor', v => !!v && typeof v === 'object' && !Array.isArray(v)) || {}; }
function isoDatePlus(days) { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0,10); }

const health = await request('/api/health', { headers: hostedHeaders });
assert.equal(health.status, 200); assert.equal(health.body?.release, expectedRelease); assert.equal(health.body?.fixtureOnly, true); assert.equal(health.body?.productionApproved, false); assert.equal(health.body?.pilotReady, false);
console.log(`HEALTH_PASS ${health.body.release}`);

const employeeEmail = 'maya@northstar.example';
const managerCandidates = ['manager@northstar.example','supervisor@northstar.example','director@northstar.example','superuser@northstar.example'];
const otherEmail = 'other@isolation.example';
const employeeCookie = await login(employeeEmail);
const otherCookie = await login(otherEmail);
const employeeBefore = await authed(employeeCookie, '/api/bootstrap');
const otherBefore = await authed(otherCookie, '/api/bootstrap');
assert.equal(employeeBefore.status, 200); assert.equal(otherBefore.status, 200);
assert.equal(actorOf(employeeBefore.body)?.tenant, 'northstar-demo');
assert.equal(actorOf(otherBefore.body)?.tenant, 'isolation-test');
assert.notEqual(actorOf(employeeBefore.body)?.tenant, actorOf(otherBefore.body)?.tenant);
const employeePerson = actorOf(employeeBefore.body)?.personId;
assert.ok(employeePerson, 'employee personId missing');
const beforeVersion = versionOf(employeeBefore.body);
assert.ok(Number.isInteger(beforeVersion), `bootstrap version missing; top-level keys=${Object.keys(employeeBefore.body || {}).join(',')}`);
const beforeRequests = requestsOf(employeeBefore.body);
console.log(`BOOTSTRAP_STATE_PASS version=${beforeVersion} requests=${beforeRequests.length}`);

let date = null;
for (const days of [35,42,49,56,63,70,77,84]) {
  const candidate = isoDatePlus(days);
  if (!beforeRequests.some(r => r.employee === employeePerson && r.date === candidate && r.status !== 'declined')) { date = candidate; break; }
}
assert.ok(date, 'no safe synthetic future leave date found');

const submitted = await command(employeeCookie, beforeVersion, 'leave-request', { date, hours: 8 });
assert.equal(submitted.status, 200, `leave request failed ${submitted.status}: ${submitted.text.slice(0,240)}`);
console.log(`LEAVE_REQUEST_SUBMIT_PASS date=${date}`);

const employeeAfterSubmit = await authed(employeeCookie, '/api/bootstrap');
assert.equal(employeeAfterSubmit.status, 200);
const created = requestsOf(employeeAfterSubmit.body).find(r => r.employee === employeePerson && r.date === date && r.status !== 'declined');
assert.ok(created, 'submitted leave request not visible to employee');
assert.equal(created.status, 'pending');
assert.equal(created.kind, 'Annual leave');
assert.equal(Number(created.hours), 8);
assert.ok(created.id, 'request id missing');
console.log('LEAVE_REQUEST_VISIBILITY_PASS pending annual-leave');

const duplicateVersion = versionOf(employeeAfterSubmit.body);
assert.ok(Number.isInteger(duplicateVersion));
const duplicate = await command(employeeCookie, duplicateVersion, 'leave-request', { date, hours: 8 });
assert.notEqual(duplicate.status, 200, 'duplicate leave request unexpectedly succeeded');
const employeeAfterDuplicate = await authed(employeeCookie, '/api/bootstrap');
const duplicates = requestsOf(employeeAfterDuplicate.body).filter(r => r.employee === employeePerson && r.date === date && r.status !== 'declined');
assert.equal(duplicates.length, 1, 'duplicate request was created');
console.log(`LEAVE_DUPLICATE_GUARD_PASS status=${duplicate.status}`);

const otherAfter = await authed(otherCookie, '/api/bootstrap');
assert.equal(otherAfter.status, 200);
assert.ok(!requestsOf(otherAfter.body).some(r => r.id === created.id || (r.employee === employeePerson && r.date === date)), 'leave request leaked to second tenant');
console.log('LEAVE_TENANT_ISOLATION_PASS');

let reviewer = null;
for (const email of managerCandidates) {
  const cookie = await login(email);
  const dash = await authed(cookie, '/api/bootstrap');
  if (dash.status !== 200 || actorOf(dash.body)?.tenant !== 'northstar-demo') continue;
  const visible = requestsOf(dash.body).find(r => r.id === created.id);
  if (!visible) continue;
  const capacity = await post(cookie, '/api/leave-capacity', { ...visible, employee: visible.employee, requestId: visible.id });
  if (capacity.status === 200) { reviewer = { email, cookie, dash: dash.body, visible, capacity: capacity.body }; break; }
}
assert.ok(reviewer, 'no authorised reviewer could see request and execute leave-capacity check');
console.log(`LEAVE_CAPACITY_REVIEW_PASS reviewer=${reviewer.email}`);

const reviewVersion = versionOf(reviewer.dash);
assert.ok(Number.isInteger(reviewVersion), 'reviewer version missing');
const decision = await command(reviewer.cookie, reviewVersion, 'rules-leave-decision', { id: created.id, decision: 'declined', reviewed: true, reason: 'Controlled synthetic proof: decline by design after capacity review.' });
assert.equal(decision.status, 200, `leave decision failed ${decision.status}: ${decision.text.slice(0,240)}`);
console.log('LEAVE_DECISION_PASS declined-by-design');

const employeeFinal = await authed(employeeCookie, '/api/bootstrap');
assert.equal(employeeFinal.status, 200);
const final = requestsOf(employeeFinal.body).find(r => r.id === created.id);
assert.ok(final, 'final leave request missing');
assert.equal(final.status, 'declined', `unexpected final leave status ${final.status}`);
const otherFinal = await authed(otherCookie, '/api/bootstrap');
assert.ok(!requestsOf(otherFinal.body).some(r => r.id === created.id), 'final leave record leaked to second tenant');
console.log('PRIVATE_ABSENCE_END_TO_END_PROOF=PASS');
console.log('claim_boundary=private synthetic fixture-only proof; decline-by-design; no employee communication/payment; productionApproved=false; pilotReady=false');

createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','text/plain');res.end('proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
