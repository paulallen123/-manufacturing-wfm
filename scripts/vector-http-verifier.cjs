'use strict';
// Independent HTTP proof. No browser, external packages, raw response logging or production writes.
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const TARGET = 'https://vector-ui-v2-candidate-production.up.railway.app';
const MAIN = 'https://wfm-one-day-enterprise-v1-production.up.railway.app';
// Reconstructed from the sealed archive and the exact 66715f0 UI composition.
const DIGESTS = {
  '/vector-ui.js': 'e8e82b87462e2f3e7b6841ffbc6df93a56f52586097a3a46e3570941ad9f7925',
  '/vector-ui.css': '259b82cf5daf1755437bc03ba965ab8cc0c2eea26fa70a2ba3ada3f0731c8675'
};
class ProofError extends Error { constructor(code) { super(code); this.code = code; } }
function need(value, code) { if (!value) throw new ProofError(code); }
function verifyAsset(bytes, digest) {
  need(createHash('sha256').update(bytes).digest('hex') === digest, 'ASSET_DIGEST_MISMATCH');
}
function fixture(body) {
  need(body?.status === 'ok' && body.mode === 'hosted-staging' && body.fixtureOnly === true &&
    body.productionApproved === false && body.pilotReady === false && body.release === '0.6.76-hosted-staging-rc1', 'FIXTURE_BOUNDARY');
}
function localMinute(value) {
  need(Number.isFinite(Date.parse(value)), 'INVALID_FIXTURE_TIMESTAMP');
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/London', year:'numeric', month:'2-digit',
    day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(value)).replace(' ', 'T');
}
async function runProof({ origin = TARGET, password, fetchImpl = fetch, onCheck = () => {} } = {}) {
  need(origin === TARGET, 'TARGET_NOT_CANDIDATE');
  need(typeof password === 'string' && password.length >= 20, 'CREDENTIAL_REFERENCE_UNAVAILABLE');
  const checks = [];
  const cookies = [];
  let fixtureRequest = null;
  let cleanupCookie = '';
  function passed(name) { checks.push(name); onCheck(name); }
  async function request(path, cookie = '', payload, expected = 200) {
    let response;
    try {
      response = await fetchImpl(origin + path, { method: payload === undefined ? 'GET' : 'POST',
        redirect:'error', signal:AbortSignal.timeout(25000),
        headers: {'cache-control':'no-cache', accept:'application/json,text/html,*/*',
          ...(cookie ? {cookie} : {}), ...(payload === undefined ? {} : {'content-type':'application/json', origin}), referer:origin+'/'},
        ...(payload === undefined ? {} : {body:JSON.stringify(payload)}) });
    } catch { throw new ProofError('HTTP_TRANSPORT_FAILURE'); }
    need(response.status === expected, 'UNEXPECTED_HTTP_STATUS_' + response.status + '_' + path.replace(/[^a-z0-9]/gi,'_'));
    const bytes = Buffer.from(await response.arrayBuffer());
    let body = null;
    if (String(response.headers.get('content-type')).includes('json')) {
      try { body = JSON.parse(bytes.toString()); } catch { throw new ProofError('INVALID_JSON_RESPONSE'); }
    }
    return {response, bytes, body};
  }
  async function login(email) {
    const {response} = await request('/api/login', '', {email, password});
    const raw = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
    const session = raw.find(x => x.startsWith('wfm_session='));
    need(session && /HttpOnly/i.test(session) && /Secure/i.test(session) && /SameSite=Strict/i.test(session), 'SESSION_COOKIE_BOUNDARY');
    const cookie = session.split(';')[0];
    cookies.push(cookie);
    return cookie;
  }
  try {
    fixture((await request('/api/health')).body);
    passed('fixture-only health and readiness boundary');
    await request('/api/bootstrap', '', undefined, 401);
    passed('anonymous access rejected');
    const roles = {};
    for (const [name,email,role,tenant,payrollStatus] of [
      ['manager','manager@northstar.example','manager','northstar-demo',403],
      ['employee','maya@northstar.example','employee','northstar-demo',403],
      ['payroll','payroll@northstar.example','payroll_admin','northstar-demo',200],
      ['director','superuser@northstar.example','director','northstar-demo',200],
      ['other','other@isolation.example','manager','isolation-test',403]
    ]) {
      const cookie = await login(email);
      const b = (await request('/api/bootstrap', cookie)).body;
      need(b?.actor?.role === role && b.actor.tenant === tenant, 'ACTOR_BOUNDARY_' + name);
      if (name === 'employee') {
        need(b.state.staff.length > 0 && b.state.staff.every(p => p.id === b.actor.personId), 'EMPLOYEE_SCOPE');
        need(!b.state.costing && !b.state.economicCosting, 'EMPLOYEE_COST_REDACTION');
      }
      await request('/api/payroll-run', cookie, undefined, payrollStatus);
      roles[name] = {cookie, actor:b.actor};
      if (name === 'manager') cleanupCookie = cookie;
      passed(name + ' login, identity and payroll permission');
    }
    const cookie = roles.director.cookie;
    const page = (await request('/', cookie)).bytes.toString();
    need(page.includes('/vector-ui.js') && page.includes('/vector-ui.css'), 'VECTOR_ENTRYPOINTS_MISSING');
    for (const [path, digest] of Object.entries(DIGESTS)) {
      const bytes = (await request(path, cookie)).bytes;
      verifyAsset(bytes, digest);
      if (path.endsWith('.js')) need(bytes.includes(Buffer.from('VECTOR_UI_V2_20260921')), 'RELEASE_MARKER_MISSING');
      passed('exact served bytes ' + path);
    }
    for (const path of ['/api/readiness','/api/weekly-review','/api/schedule-publication','/api/operations',
      '/api/payroll-run','/api/readiness/payroll-outcomes','/api/readiness/finance-attribution',
      '/api/payroll-intelligence','/api/support/bot','/api/personal','/api/onboarding','/api/company-config',
      '/api/resources','/api/availability-control','/api/demand/plan','/api/time-review','/api/attendance-corrections',
      '/api/costs','/api/recommendations','/api/value-cockpit']) {
      await request(path, cookie); passed('read ' + path);
    }
    // Existing correction workflow: request unchanged times and reject the request by design.
    // Leaves only a fixture audit record; no payroll release, export or provider action.
    fixture((await request('/api/health')).body);
    const employee = roles.employee;
    const dash = (await request('/api/attendance-corrections', employee.cookie)).body;
    const open = new Set(['submitted','information_required','awaiting_approval','payroll_review_required']);
    const blocked = new Set((dash.requests || []).filter(q => open.has(q.status)).map(q => q.record));
    const record = (dash.records || []).find(r => r.employee === employee.actor.personId && r.effective?.clockIn && r.effective?.clockOut && !blocked.has(r.id));
    need(record, 'NO_SAFE_CORRECTION_FIXTURE');
    const submit = {version:dash.version, command:'correction-submit', idempotencyKey:'ui-http-'+randomBytes(10).toString('hex'),
      payload:{period:record.period, record:record.id, clockIn:localMinute(record.effective.clockIn), clockOut:localMinute(record.effective.clockOut),
        note:'Isolated candidate HTTP proof: requested times match current evidence. Reject by design.'}};
    const submitted = (await request('/api/attendance-corrections/command', employee.cookie, submit)).body;
    const id = submitted?.result?.id;
    if (typeof id === 'string') fixtureRequest = id;
    need(/^AC-[a-f0-9]{32}$/i.test(id || '') && submitted.result.revision === 1, 'CORRECTION_SUBMISSION');
    passed('fixture correction submitted');
    const replay = (await request('/api/attendance-corrections/command', employee.cookie, submit)).body;
    need(replay?.replayed === true && replay.result?.id === id, 'SUBMIT_IDEMPOTENCY');
    passed('duplicate submission replays one request');
    const other = (await request('/api/attendance-corrections', roles.other.cookie)).body;
    need(Array.isArray(other?.requests) && !other.requests.some(q => q.id === id), 'TENANT_ISOLATION');
    passed('new request hidden from other tenant');
    const managerDash = (await request('/api/attendance-corrections', roles.manager.cookie)).body;
    need(managerDash.requests?.some(q => q.id === id && q.employee === employee.actor.personId), 'MANAGER_REQUEST_SCOPE');
    const review = {version:managerDash.version, command:'correction-review', idempotencyKey:'ui-http-review-'+randomBytes(10).toString('hex'),
      payload:{id, revision:1, decision:'reject', note:'Controlled fixture HTTP proof complete; retain original attendance evidence.'}};
    const reviewed = (await request('/api/attendance-corrections/command', roles.manager.cookie, review)).body;
    need(reviewed?.result?.id === id && reviewed.result.status === 'rejected' && reviewed.result.revision === 2, 'REVIEW_DECISION');
    fixtureRequest = null;
    const reviewReplay = (await request('/api/attendance-corrections/command', roles.manager.cookie, review)).body;
    need(reviewReplay?.replayed === true && reviewReplay.result?.id === id && reviewReplay.result.status === 'rejected', 'REVIEW_IDEMPOTENCY');
    passed('manager decision and duplicate decision replay');
    // Re-login proves the saved result across sessions, not merely an in-memory client state.
    await request('/api/logout', employee.cookie, {});
    await request('/api/bootstrap', employee.cookie, undefined, 401);
    const fresh = await login('maya@northstar.example');
    const after = (await request('/api/attendance-corrections', fresh)).body;
    const saved = after.requests?.find(q => q.id === id);
    const original = after.records?.find(r => r.id === record.id && r.period === record.period);
    need(saved?.status === 'rejected' && saved.revision === 2 && saved.outcome?.applied === false, 'SAVED_DECISION');
    need(saved.history?.some(h => h.type === 'attendance-correction-submitted') && saved.history.some(h => h.type === 'attendance-correction-reject'), 'AUDIT_HISTORY');
    need(original?.effective?.clockIn === record.effective.clockIn && original.effective.clockOut === record.effective.clockOut, 'ORIGINAL_ATTENDANCE_CHANGED');
    passed('logout invalidates session');
    passed('saved decision and audit survive fresh login');
    passed('original attendance evidence unchanged');
    return {status:'PASS', checkedAt:new Date().toISOString(), target:origin, checks,
      assetSha256:DIGESTS, boundary:'Fixture HTTP/API and served asset proof. No browser rendering or restart durability claim.'};
  } finally {
    let cleanupFailed = false;
    if (fixtureRequest) {
      try {
        fixture((await request('/api/health')).body);
        const current = (await request('/api/attendance-corrections', cleanupCookie)).body;
        const saved = current.requests?.find(q => q.id === fixtureRequest);
        need(saved, 'FIXTURE_CLEANUP_NOT_VISIBLE');
        if (saved.status !== 'rejected') {
          const cleaned = (await request('/api/attendance-corrections/command', cleanupCookie, {
            version:current.version, command:'correction-review', idempotencyKey:'ui-http-cleanup-'+randomBytes(10).toString('hex'),
            payload:{id:fixtureRequest, revision:saved.revision, decision:'reject', note:'Close controlled fixture request after verifier interruption.'}
          })).body;
          need(cleaned?.result?.id === fixtureRequest && cleaned.result.status === 'rejected', 'FIXTURE_CLEANUP_REJECT');
        }
      } catch { cleanupFailed = true; }
    }
    // Best-effort session cleanup; never log credentials or response bodies.
    await Promise.allSettled(cookies.map(cookie => request('/api/logout', cookie, {})));
    if (cleanupFailed) throw new ProofError('FIXTURE_CLEANUP_INCOMPLETE');
  }
}
function statusResponse(path, state) {
  if (path === '/healthz') return {code:200, body:{status:'ok', component:'vector-http-verifier'}};
  if (path === '/proof') return {code:state.proof.status === 'PASS' ? 200 : 503, body:state.proof};
  if (path === '/') return {code:state.product.status === 'PASS' ? 200 : 503, body:state.product};
  return {code:404, body:{error:'Not found'}};
}
function start() {
  const state = {product:{status:'STARTING'}, proof:{status:'RUNNING', checks:[]}};
  async function probe() {
    try {
      const r = await fetch(MAIN+'/api/health', {signal:AbortSignal.timeout(12000), redirect:'error', headers:{'cache-control':'no-cache'}});
      const body = await r.json();
      state.product = {status:r.ok && body.status === 'ok' ? 'PASS' : 'FAIL', code:r.status, checkedAt:new Date().toISOString()};
    } catch { state.product = {status:'FAIL', error:'PRODUCT_HEALTH_UNAVAILABLE', checkedAt:new Date().toISOString()}; }
  }
  probe(); setInterval(probe,15000);
  http.createServer((req,res) => {
    const out = statusResponse(req.url,state);
    res.writeHead(out.code, {'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify(out.body));
  }).listen(Number(process.env.PORT || 3000),'0.0.0.0');
  console.log('VECTOR_HTTP_VERIFIER_READY');
  runProof({password:process.env.WFM_STAGING_PASSWORD, onCheck:name => {
    state.proof.checks.push(name); console.log(JSON.stringify({event:'VECTOR_HTTP_CHECK',status:'PASS',name}));
  }}).then(proof => {
    state.proof = proof; console.log(JSON.stringify({event:'VECTOR_HTTP_PROOF',...proof}));
  }).catch(error => {
    state.proof = {...state.proof,status:'FAIL',error:error instanceof ProofError ? error.code : 'UNEXPECTED_VERIFIER_ERROR',checkedAt:new Date().toISOString()};
    console.log(JSON.stringify({event:'VECTOR_HTTP_PROOF',...state.proof}));
  });
}
module.exports = {TARGET, MAIN, DIGESTS, runProof, verifyAsset, statusResponse, start};
if (!module.parent) start();
