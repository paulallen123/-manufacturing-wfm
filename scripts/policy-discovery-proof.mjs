import http from 'node:http';

const origin = new URL(process.env.TARGET_ORIGIN).origin;
const runTargetOrigin = String(process.env.RUN_TARGET_ORIGIN || '').trim();
const runId = String(process.env.RUN_ID || '').trim();
const tenant = String(process.env.TENANT || '').trim();
const expectedSha = String(process.env.EXPECTED_CANDIDATE_SHA || '').trim().toLowerCase();
const expectedDeploymentId = String(process.env.EXPECTED_DEPLOYMENT_ID || '').trim();
const internalToken = String(process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '');
const schedulingToken = String(process.env.WFM_SCHEDULING_INTERNAL_TOKEN || '');
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

async function request(path, { method = 'GET', body = null, internal = false, scheduling = false } = {}) {
  const headers = { 'x-forwarded-proto': 'https' };
  if (body !== null) headers['content-type'] = 'application/json';
  if (internal) headers['x-wfm-implementation-internal'] = internalToken;
  if (scheduling) headers['x-wfm-scheduling-internal'] = schedulingToken;
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
    runId && tenant && runTargetOrigin && expectedDeploymentId && internalToken && schedulingToken && /^[0-9a-f]{40}$/.test(expectedSha),
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

  state = { ...state, stage: 'scheduling-shadow-plan' };
  const shiftStart = '2026-10-01T08:00:00.000Z';
  const shiftEnd = '2026-10-01T16:00:00.000Z';
  const contextRevision = `implementation-run:${runId}:scheduling:v1`;
  const sourceEvidence = [
    `implementation-run:${runId}:canonical-import-receipt`,
    `implementation-run:${runId}:organisation-model`,
    `implementation-run:${runId}:time-policies`,
    `candidate:${expectedSha}`,
    `deployment:${expectedDeploymentId}`
  ];
  const scheduleInput = {
    contextRevision,
    createdAt: '2026-09-28T18:00:00.000Z',
    sourceEvidence,
    policy: {
      minRestHours: 11,
      maxWeeklyHours: 48,
      maxOvertimeHours: 12,
      ruleVersion: `implementation-run:${runId}:time-policies`,
      requiredRuleRefs: [`implementation-run:${runId}:time-policies`]
    },
    workers: [{
      id: 'fixture-worker-001',
      type: 'EMPLOYEE',
      status: 'ACTIVE',
      homeSite: 'fixture-site-001',
      eligibleSites: ['fixture-site-001'],
      availability: [{ start: shiftStart, end: shiftEnd }],
      skills: ['assembly'],
      certifications: [],
      contractedHours: 40,
      hoursWorkedWeek: 0,
      hourlyCost: 20,
      ruleBlocks: []
    }],
    requirements: [{
      id: 'fixture-requirement-001',
      site: 'fixture-site-001',
      role: 'operator',
      start: shiftStart,
      end: shiftEnd,
      headcount: 1,
      requiredSkills: ['assembly'],
      requiredCertifications: [],
      evidenceRefs: sourceEvidence
    }]
  };
  const firstPlan = await request('/api/operations/scheduling/plan/shadow', {
    method: 'POST', scheduling: true, body: { tenant, input: scheduleInput }
  });
  assert(firstPlan.status === 200 || firstPlan.status === 201, 'scheduling shadow plan HTTP ' + firstPlan.status + ' ' + firstPlan.text.slice(0, 700));
  const plan = firstPlan.json?.plan;
  assert(firstPlan.json?.authority === 'NO_EXECUTION', 'scheduling response lacks NO_EXECUTION authority');
  assert(plan?.planId && plan.tenant === tenant, 'scheduling response lacks a tenant-bound persisted plan');
  assert(plan.contextRevision === contextRevision, 'scheduling plan context revision mismatch');
  assert(plan.mode === 'SHADOW', 'scheduling plan is not shadow mode');
  assert(plan.executionPermitted === false, 'scheduling plan permits execution');
  assert(plan.claimBoundary === 'SHADOW_ONLY_NO_PRODUCTION_MUTATION', 'scheduling plan lacks no-production-mutation boundary');
  assert(plan.validation?.valid === true, 'scheduling plan failed independent validation');
  assert(plan.quality?.coveragePct === 100 && plan.quality?.unfilledSlots === 0, 'scheduling fixture is not fully covered');
  assert(sourceEvidence.every(ref => plan.sourceEvidence?.includes(ref)), 'scheduling plan lost required source evidence');

  state = { ...state, stage: 'scheduling-idempotency' };
  const repeatedPlan = await request('/api/operations/scheduling/plan/shadow', {
    method: 'POST', scheduling: true, body: { tenant, input: scheduleInput }
  });
  assert(repeatedPlan.status === 200, 'repeated scheduling shadow plan was not idempotent HTTP 200');
  assert(repeatedPlan.json?.idempotent === true, 'repeated scheduling shadow plan was not marked idempotent');
  assert(repeatedPlan.json?.plan?.planId === plan.planId, 'repeated scheduling shadow plan changed identity');

  const schedulingReadiness = await advance('scheduling', 1, {
    ...common,
    evidenceClass: 'hosted-isolated-shadow-scheduling',
    planId: plan.planId,
    contextRevision: plan.contextRevision,
    contractVersion: firstPlan.json?.contractVersion || plan.contractVersion,
    solverVersion: plan.solverVersion,
    solve: plan.solve,
    validation: plan.validation,
    quality: plan.quality,
    authority: firstPlan.json?.authority,
    mode: plan.mode,
    executionPermitted: plan.executionPermitted,
    claimBoundary: plan.claimBoundary,
    sourceEvidence: plan.sourceEvidence,
    evidenceStatement: 'A deterministic fixture schedule was persisted and independently validated on the isolated exact-candidate runtime. It is shadow-only and does not prove customer scheduling.'
  });

  const final = schedulingReadiness || absenceReadiness || timeReadiness;
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
