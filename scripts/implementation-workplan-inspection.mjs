import http from 'node:http';

const origin = new URL(process.env.TARGET_ORIGIN).origin;
const runTargetOrigin = String(process.env.RUN_TARGET_ORIGIN || '').trim();
const runId = String(process.env.RUN_ID || '').trim();
const tenant = String(process.env.TENANT || '').trim();
const expectedSha = String(process.env.EXPECTED_CANDIDATE_SHA || '').trim().toLowerCase();
const expectedDeploymentId = String(process.env.EXPECTED_DEPLOYMENT_ID || '').trim();
const internalToken = String(process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '');
const port = Number(process.env.PORT || 3000);
let state = { status: 'PENDING', stage: 'startup', startedAt: new Date().toISOString() };

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/health' || req.url === '/proof') {
    res.statusCode = 200;
    return res.end(JSON.stringify(state));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(port, '0.0.0.0', () => console.log('VECTOR_IMPLEMENTATION_WORKPLAN_INSPECTION_LISTENING=' + port));

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function request(path, { method = 'GET', body = null, internal = false } = {}) {
  const headers = { 'x-forwarded-proto': 'https' };
  if (body !== null) headers['content-type'] = 'application/json';
  if (internal) headers['x-wfm-implementation-internal'] = internalToken;
  const response = await fetch(origin + path, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, text, json };
}

try {
  assert(
    runId && tenant && runTargetOrigin && expectedDeploymentId && internalToken && /^[0-9a-f]{40}$/.test(expectedSha),
    'required inspection configuration missing'
  );
  assert(new URL(runTargetOrigin).origin === origin, 'target origin does not match run origin');

  state = { ...state, stage: 'identity' };
  const identity = await request('/api/runtime-identity');
  assert(identity.status === 200, 'runtime identity HTTP ' + identity.status);
  assert(JSON.stringify(identity.json || {}).toLowerCase().includes(expectedSha), 'runtime identity does not bind expected candidate SHA');

  state = { ...state, stage: 'workplan' };
  const inspection = await request('/api/implementation/autonomous/work/claim', {
    method: 'POST',
    internal: true,
    body: { runId, tenant, requirementKey: '__inspection_no_such_requirement__' }
  });
  assert(inspection.status === 200, 'work-plan inspection HTTP ' + inspection.status + ' ' + inspection.text.slice(0, 700));
  assert(inspection.json?.job === null, 'inspection unexpectedly claimed a job');
  assert(Array.isArray(inspection.json?.workPlan?.jobs), 'inspection did not return work-plan jobs');

  const workPlan = inspection.json.workPlan;
  const jobs = workPlan.jobs.map(job => ({
    requirementKey: job.requirementKey,
    status: job.status,
    attempts: job.attempts,
    blockedReason: job.blockedReason || null
  }));
  state = {
    status: 'PASS',
    stage: 'complete',
    finishedAt: new Date().toISOString(),
    runId,
    tenant,
    candidateSha: expectedSha,
    targetDeploymentId: expectedDeploymentId,
    reason: inspection.json.reason,
    counts: workPlan.counts || {},
    runnable: workPlan.runnable || [],
    blocked: workPlan.blocked || [],
    failedClosed: workPlan.failedClosed || [],
    jobs
  };
  console.log('VECTOR_IMPLEMENTATION_WORKPLAN_INSPECTION=PASS|' + JSON.stringify(state));
} catch (error) {
  state = {
    status: 'FAIL',
    stage: 'failed',
    finishedAt: new Date().toISOString(),
    runId,
    tenant,
    candidateSha: expectedSha || null,
    error: String(error?.stack || error).slice(0, 5000)
  };
  console.error('VECTOR_IMPLEMENTATION_WORKPLAN_INSPECTION=FAIL|' + JSON.stringify(state));
}
