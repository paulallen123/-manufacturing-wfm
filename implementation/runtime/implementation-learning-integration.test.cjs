'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  createOneDayEnterpriseEngine,
  REQUIREMENTS
} = require('./one-day-enterprise-engine.cjs');
const {
  createAdaptiveLearningEngine
} = require('../../learning/runtime/adaptive-learning-engine.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function response() {
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    },
    headers
  };
}

async function call(engine, token, method, url, body, extraHeaders = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...extraHeaders
  };
  const res = response();
  const handled = await engine.handleRequest(req, res);
  assert.equal(handled, true);
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-implementation-learning-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');

  const users = [
    ['employee@alpha', 'e1', 'employee'],
    ['manager@alpha', 'm1', 'manager'],
    ['payroll@alpha', 'p1', 'payroll'],
    ['admin@alpha', 'a1', 'company-admin']
  ];
  for (const [email, personId, role] of users) {
    const permissions=role==='manager'||role==='company-admin'?['company.configure']:[];
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run(email, 'alpha', personId, role, role === 'employee' ? 0 : 1, 's', '00', JSON.stringify(permissions));
  }

  const tokens = {
    employee: 'e'.repeat(64),
    manager: 'm'.repeat(64),
    payroll: 'p'.repeat(64),
    admin: 'a'.repeat(64)
  };
  const expires = Date.now() + 60_000;
  for (const [role, token] of Object.entries(tokens)) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(sha256(token), role + '@alpha', expires);
  }
  db.close();

  const learning = createAdaptiveLearningEngine({
    dbPath,
    internalToken: 'learning-worker-test-token'
  });
  const sentInvitations = [];
  const implementation = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-worker-test-token',
    publicOrigin: 'https://implementation.test',
    candidateSha: 'a'.repeat(40),
    deploymentId: 'deployment-learning-test',
    sendInvitation: async invitation => {
      sentInvitations.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-' + sentInvitations.length };
    },
    learningSummaryProvider: tenant => learning.summaryForTenant(tenant)
  });

  return {
    dir,
    dbPath,
    candidateSha: 'a'.repeat(40),
    deploymentId: 'deployment-learning-test',
    learning,
    implementation,
    tokens,
    sentInvitations,
    learningInternal: { 'x-wfm-learning-internal': 'learning-worker-test-token' },
    implementationInternal: { 'x-wfm-implementation-internal': 'implementation-worker-test-token' },
    close() {
      implementation.close();
      learning.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const GOLDEN_JOURNEY_STEPS=[
  'contract-signed','secure-sign-in','integrations-connected','source-discovery','workforce-import','source-reconciliation',
  'customer-configuration','customer-specific-training','go-live-admission','shift-workforce-management','time-absence-approval',
  'payroll-batch-released','payroll-provider-accepted','payroll-provider-readback','downstream-state-update','roi-value-evidence',
  'support-problem-injected','support-problem-detected','support-problem-repaired'
];

function evidenceDetail(kind) {
  if (kind === 'time-policies') {
    return {
      fixtureOnly: false,
      evidenceClass: 'contract-authorised',
      sourceAuthoritative: true,
      sourceRef: 'test-contract/time-policy-v1',
      effectiveDated: true,
      effectiveDate: '2026-01-01',
      unresolvedRules: 0,
      unknownPolicyFields: 0,
      breakRulesVerified: true,
      overtimeRulesVerified: true,
      workingTimeRulesVerified: true,
      timeZoneVerified: true
    };
  }
  if (kind === 'absence-policies') {
    return {
      fixtureOnly: false,
      evidenceClass: 'contract-authorised',
      sourceAuthoritative: true,
      sourceRef: 'test-contract/absence-policy-v1',
      effectiveDated: true,
      effectiveDate: '2026-01-01',
      unresolvedRules: 0,
      unknownPolicyFields: 0,
      leaveYearVerified: true,
      entitlementMethodVerified: true,
      approvalRulesVerified: true,
      absenceTypesVerified: true,
      usesOpeningBalance: false,
      openingBalanceFictional: false,
      openingBalanceSourceVerified: false
    };
  }
  if (kind === 'source-systems') return {
    fixtureOnly:false,zeroHuman:true,humanInterventions:0,discoveryCompleted:true,authorizationVerified:true,
    providers:[{provider:'Test HCM',discovered:true,authorized:true,connected:true,mode:'sandbox'}]
  };
  if (kind === 'scheduling') return {
    cloudRuntime:true,sourceAuthoritative:true,rosterSourceVerified:true,skillCoverageVerified:true,
    availabilityVerified:true,ruleEvaluationVerified:true,publishedScheduleReadbackVerified:true,unresolvedExceptions:0
  };
  if (kind === 'approvals') return {
    cloudRuntime:true,sourceAuthoritative:true,delegationRulesVerified:true,selfApprovalBlocked:true,auditTrailVerified:true,approvalReadbackVerified:true
  };
  if (kind === 'clocking') return {
    cloudRuntime:true,sourceAuthoritative:true,deviceOrSourceVerified:true,duplicateProtectionVerified:true,offlineHandlingVerified:true,timezoneDstVerified:true,attendanceReadbackVerified:true
  };
  if (kind === 'payroll-mapping') return {
    readinessClass:'customer-specific',dataClass:'customer-authorised',mappingAuthorityVerified:true,providerTargetVerified:true,
    employeeIdentityMappingVerified:true,payCodesVerified:true,absenceMappingVerified:true,roundingPolicyVerified:true,
    releasedBatchId:'B-learning',batchChecksum:'a'.repeat(64),fullPayrollVerified:true
  };
  if (kind === 'historical-replay') return {
    dataClass:'customer-authorised',independentCalculation:true,expectedTotal:100,calculatedTotal:100,unexplainedVariance:0
  };
  if (kind === 'security-controls') return {
    cloudRuntime:true,tenantIsolationVerified:true,crossTenantNegativeTests:1,criticalFailures:0
  };
  if (kind === 'resilience') return {
    hostedRuntime:true,faultInjected:true,detected:true,classified:true,repairOrContainmentApplied:true,
    independentVerificationPassed:true,durableAuditVerified:true,replaySafetyVerified:true,rollbackRequired:false,criticalFailures:0
  };
  if (kind === 'scenario-validation') {
    const correlationId='learning-golden-journey';
    return {
      cloudRuntime:true,testDataClass:'synthetic-unit-journey',totalScenarios:GOLDEN_JOURNEY_STEPS.length,
      passedScenarios:GOLDEN_JOURNEY_STEPS.length,criticalFailures:0,correlationId,
      steps:GOLDEN_JOURNEY_STEPS.map(id=>({id,status:'PASS',evidenceRef:'learning:'+id,correlationId})),
      payrollProvider:{correlationId,batchId:'B-learning',batchChecksum:'a'.repeat(64),providerBindingDigest:'b'.repeat(64),
        batchReceiptDigest:'c'.repeat(64),readbackDigest:'d'.repeat(64),releaseEvidenceRef:'learning:payroll-batch-released',
        acceptanceEvidenceRef:'learning:payroll-provider-accepted',readbackEvidenceRef:'learning:payroll-provider-readback',fullPayrollVerified:true}
    };
  }
  if (kind === 'test-data-cleanup') {
    return { remainingTestRows: 0, liveRowsTouched: 0 };
  }
  if (kind === 'live-data-import') {
    return { fixtureOnly:false,zeroHuman:true,humanInterventions:0,sourceAuthoritative:true,sourceCount:10000,importedCount:10000,invalidCount:0,checksumMatch:true };
  }
  return { checked: true };
}

async function passTechnicalEvidence(f, runId) {
  const training = new Set(['role-learning', 'privileged-competency', 'frontline-readiness']);
  let latest = null;
  for (const item of REQUIREMENTS) {
    if (training.has(item.key)) continue;
    if(item.key==='time-policies'||item.key==='absence-policies'){
      const key=item.key==='time-policies'?'time-policy-authority':'absence-policy-authority';
      const policy={...evidenceDetail(item.key),authoritativeConfirmation:true};
      delete policy.evidenceClass;delete policy.sourceAuthoritative;delete policy.effectiveDated;delete policy.fixtureOnly;
      const decided=await call(f.implementation,f.tokens.manager,'POST','/api/implementation/autonomous/decision',{runId,key,action:'ACCEPTED',detail:policy});
      assert.equal(decided.status,200,item.key+': '+JSON.stringify(decided.body));latest=decided.body;continue;
    }
    const tenant = item.key === 'tenant-environment';
    const detail = tenant ? {
      fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
      provisioned: true, tenantExists: true, environmentId: 'test-cloud-environment',
      provisioningMode: 'cloud-runtime', runtimeHealthPassed: true, healthcheckPassed: true,
      tenantIsolationVerified: true, crossTenantNegativeTests: 1, durableStateVerified: true,
      exactCandidateSha: f.candidateSha, exactTargetDeploymentId: f.deploymentId,
      tenant: 'alpha', implementationRunId: runId, verifierRunId: 'unit-learning-' + runId,
      proofRunnerIdentity: 'unit-test-runner',
      targetDeploymentCreatedAt: new Date(Date.now() - 60000).toISOString(),
      evidenceGeneratedAt: new Date().toISOString()
    } : evidenceDetail(item.key);
    const result = await call(
      f.implementation,
      null,
      'POST',
      '/api/implementation/autonomous/evidence',
      { runId, kind: item.key, status: 'PASS', confidence: 1,
        source: tenant ? 'hosted-proof' : 'deterministic-technical-proof', detail },
      f.implementationInternal
    );
    assert.equal(result.status, 200);
    latest = result.body;
  }
  return latest;
}

async function masterPlanFor(f, email, token) {
  const plan = await call(f.learning, token, 'GET', '/api/learning/adaptive/plan');
  assert.equal(plan.status, 200);

  for (const item of plan.body.all) {
    const first = await call(
      f.learning,
      null,
      'POST',
      '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email,
        competencyKey: item.competencyKey,
        evidenceType: 'OBSERVED_SUCCESS',
        result: 'PASS',
        detail: { source: 'bounded-simulation' }
      },
      f.learningInternal
    );
    assert.equal(first.status, 200);

    const retrieval = await call(
      f.learning,
      null,
      'POST',
      '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email,
        competencyKey: item.competencyKey,
        evidenceType: 'RETRIEVAL_CHECK',
        result: 'PASS',
        detail: { source: 'bounded-simulation' }
      },
      f.learningInternal
    );
    assert.equal(retrieval.status, 200);

    if (item.teachBack) {
      const teachBack = await call(
        f.learning,
        null,
        'POST',
        '/api/learning/adaptive/evidence',
        {
          tenant: 'alpha',
          email,
          competencyKey: item.competencyKey,
          evidenceType: 'TEACH_BACK',
          result: 'PASS',
          detail: { source: 'bounded-simulation' }
        },
        f.learningInternal
      );
      assert.equal(teachBack.status, 200);
      assert.equal(teachBack.body.assignment.status, 'MASTERED');
    }
  }
}

test('enterprise implementation cannot go READY until real role competence is proven', async () => {
  const f = fixture();
  try {
    const invitation = await call(
      f.implementation,
      null,
      'POST',
      '/api/implementation/autonomous/contract-activated',
      {
        tenant: 'alpha',
        contractRef: 'enterprise-contract-001',
        targetHours: 8,
        recipientEmail: 'manager@alpha'
      },
      f.implementationInternal
    );
    assert.equal(invitation.status, 201);
    assert.equal(invitation.body.invitation.state, 'AWAITING_CUSTOMER_START');
    const token = new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
    assert.ok(token);

    const start = await call(
      f.implementation,
      f.tokens.manager,
      'POST',
      '/api/implementation/autonomous/start',
      { token }
    );
    assert.equal(start.status, 201);
    const runId = start.body.runId;

    const scope = await call(
      f.implementation,
      f.tokens.manager,
      'POST',
      '/api/implementation/autonomous/scope',
      {
        companyName: 'Alpha Manufacturing',
        countries: ['United Kingdom'],
        sites: ['Plant 1'],
        employeeCount: 10000,
        sourceSystems: ['ERP', 'Payroll', 'HCM'],
        features: ['Scheduling', 'Time & attendance', 'Absence'],
        workPatterns: ['24/7 rotating shifts'],
        clockingMethods: ['Existing access control', 'Mobile fallback'],
        agencyLabour: true,
        priorities: 'Accurate payroll and role-ready go live'
      }
    );
    assert.equal(scope.status, 201);
    assert.equal(scope.body.scopeCaptured, true);

    await call(
      f.learning,
      null,
      'POST',
      '/api/learning/adaptive/bootstrap-tenant',
      { tenant: 'alpha' },
      f.learningInternal
    );

    const technical = await passTechnicalEvidence(f, runId);
    assert.equal(technical.operationalReady, false);
    assert.equal(
      technical.requirements.find(x => x.key === 'role-learning').satisfied,
      true
    );
    assert.equal(
      technical.requirements.find(x => x.key === 'privileged-competency').satisfied,
      false
    );
    assert.equal(
      technical.requirements.find(x => x.key === 'frontline-readiness').satisfied,
      false
    );

    // Even a trusted implementation worker cannot substitute a checkbox for real learning evidence.
    for (const key of ['privileged-competency', 'frontline-readiness']) {
      const fake = await call(
        f.implementation,
        null,
        'POST',
        '/api/implementation/autonomous/evidence',
        {
          runId,
          kind: key,
          status: 'PASS',
          confidence: 1,
          source: 'attempted-training-shortcut'
        },
        f.implementationInternal
      );
      assert.equal(fake.status, 200);
      assert.equal(fake.body.requirements.find(x => x.key === key).satisfied, false);
      assert.equal(fake.body.operationalReady, false);
    }

    await masterPlanFor(f, 'employee@alpha', f.tokens.employee);
    await masterPlanFor(f, 'manager@alpha', f.tokens.manager);
    await masterPlanFor(f, 'payroll@alpha', f.tokens.payroll);
    await masterPlanFor(f, 'admin@alpha', f.tokens.admin);

    const status = await call(
      f.implementation,
      f.tokens.manager,
      'GET',
      '/api/implementation/autonomous/status'
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.learningSummary.privilegedReady, true);
    assert.equal(status.body.learningSummary.fullyCertified, true);
    assert.equal(status.body.requirements.find(x=>x.key==='privileged-competency').satisfied,true);
    assert.equal(status.body.requirements.find(x=>x.key==='frontline-readiness').satisfied,true);
    assert.equal(status.body.operationalReady, false);
    assert.ok(status.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));
  } finally {
    f.close();
  }
});
