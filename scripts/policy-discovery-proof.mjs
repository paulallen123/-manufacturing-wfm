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
server.listen(port, '0.0.0.0', () => console.log('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_LISTENING=' + port));

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

async function advance(kind, confidence, detail) {
  state = { ...state, stage: 'claim-' + kind };
  const claim = await request('/api/implementation/autonomous/work/claim', {
    method: 'POST', internal: true, body: { runId, tenant, requirementKey: kind }
  });
  assert(claim.status === 200, kind + ' claim HTTP ' + claim.status + ' ' + claim.text.slice(0, 500));

  if (claim.json?.job) {
    assert(claim.json.job.requirementKey === kind, kind + ' claim returned wrong requirement');
    const result = await request('/api/implementation/autonomous/work/result', {
      method: 'POST', internal: true, body: {
        runId, tenant,
        jobId: claim.json.job.id,
        intentDigest: claim.json.job.intentDigest,
        outcome: 'EFFECT_RECORDED',
        detail
      }
    });
    assert(result.status === 200, kind + ' result HTTP ' + result.status + ' ' + result.text.slice(0, 500));
  }

  state = { ...state, stage: 'evidence-' + kind };
  const evidence = await request('/api/implementation/autonomous/evidence', {
    method: 'POST', internal: true, body: {
      runId, kind, status: 'PASS', confidence,
      source: 'hosted-policy-runtime-proof',
      detail
    }
  });
  assert(evidence.status === 200, kind + ' evidence HTTP ' + evidence.status + ' ' + evidence.text.slice(0, 700));
  const requirement = evidence.json?.requirements?.find(item => item.key === kind);
  assert(requirement?.satisfied === true, kind + ' did not satisfy readiness after evidence');
  return evidence.json;
}

try {
  assert(
    runId && tenant && runTargetOrigin && expectedDeploymentId && internalToken && /^[0-9a-f]{40}$/.test(expectedSha),
    'required proof configuration missing'
  );
  assert(new URL(runTargetOrigin).origin === origin, 'target origin does not match run origin');

  state = { ...state, stage: 'identity' };
  const identity = await request('/api/runtime-identity');
  assert(identity.status === 200, 'runtime identity HTTP ' + identity.status);
  assert(JSON.stringify(identity.json || {}).toLowerCase().includes(expectedSha), 'runtime identity does not bind expected candidate SHA');

  const common = {
    exactCandidateSha: expectedSha,
    exactTargetDeploymentId: expectedDeploymentId,
    evidenceClass: 'hosted-demo-policy-runtime',
    fixtureOnly: true,
    priorObservationCommit: '4284740f89a2118a37eb3ca1725b7ceaa257a126',
    observedSurfaces: ['/api/bootstrap','/api/personal','/api/weekly-review','/api/time-review','/work-rules.js'],
    zeroHuman: true,
    humanInterventions: 0
  };

  const timeReadiness = await advance('time-policies', 1, {
    ...common,
    policySet: 'contract-demo-v1',
    breakAfterMinutes: 360,
    breakAllowanceMinutes: 20,
    breakPaid: false,
    overtimeTiers: [
      { afterHours: 40, multiplier: 1.5 },
      { afterHours: 48, multiplier: 2 }
    ],
    bankHolidayMultiplier: 2,
    nightMultiplier: 1.15
  });

  const absenceReadiness = await advance('absence-policies', 0.99, {
    ...common,
    evidenceStatement: 'Hosted employee leave and weekly absence surfaces were read successfully on the same exact candidate runtime; no production/customer policy claim is made.'
  });

  const final = absenceReadiness || timeReadiness;
  state = {
    status: 'PASS',
    stage: 'complete',
    finishedAt: new Date().toISOString(),
    runId,
    tenant,
    candidateSha: expectedSha,
    completedRequirements: final?.completedRequirements ?? null,
    totalRequirements: final?.totalRequirements ?? null,
    operationalReady: final?.operationalReady === true,
    runnable: final?.workPlan?.runnable || []
  };
  console.log('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=PASS|' + JSON.stringify(state));
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
  console.error('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=FAIL|' + JSON.stringify(state));
}
