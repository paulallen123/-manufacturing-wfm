'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createOneDayEnterpriseEngine, REQUIREMENTS } = require('./one-day-enterprise-engine.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-one-day-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 1, '{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha', 'alpha', 'm1', 'manager', 1, 's', '00', '[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('employee@alpha', 'alpha', 'e1', 'employee', 0, 's', '00', '[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@bravo', 'bravo', 'm2', 'manager', 1, 's', '00', '[]');
  const tokens = {
    manager: 'm'.repeat(64),
    employee: 'e'.repeat(64),
    bravo: 'b'.repeat(64)
  };
  const expires = Date.now() + 60_000;
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.manager), 'manager@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.employee), 'employee@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.bravo), 'manager@bravo', expires);
  db.close();

  const sentInvitations = [];
  let invitationAttempts = 0;
  const engineOptions = {
    strictEvidence: options.strictEvidence,
    agentsApiEnabled: false,
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: options.publicOrigin ?? 'https://implementation.test',
    requireCandidateBinding: options.requireCandidateBinding,
    candidateSha: options.candidateSha || 'a'.repeat(40),
    deploymentId: options.deploymentId || 'deployment-test',
    notificationRetryDelayMs: options.notificationRetryDelayMs,
    notificationRetryPollMs: options.notificationRetryPollMs ?? 0
  };
  if (!options.omitDedicatedRecoverySecret) {
    engineOptions.invitationRecoverySecret = options.invitationRecoverySecret || 'dedicated-invitation-recovery-test-secret';
  }
  if (!options.useDefaultInvitationSender) {
    engineOptions.sendInvitation = options.sendInvitation || (async invitation => {
      invitationAttempts += 1;
      if (options.acceptThenFailFirstInvitation && invitationAttempts === 1) {
        sentInvitations.push(invitation);
        throw new Error('simulated lost provider response after acceptance');
      }
      if (Number(options.failInvitationAttempts || 0) >= invitationAttempts) throw new Error('simulated temporary mail outage');
      if (options.failFirstInvitation && invitationAttempts === 1) throw new Error('simulated temporary mail outage');
      if (options.rejectInvitationCredentials) {
        const error = new Error('simulated provider credential rejection');
        error.permanent = true;
        error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
        throw error;
      }
      if (options.failInvitationDelivery) throw new Error('simulated mail transport failure');
      sentInvitations.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-' + sentInvitations.length };
    });
  }
  const engine = createOneDayEnterpriseEngine(engineOptions);

  return {
    dir,
    dbPath,
    candidateSha: engineOptions.candidateSha,
    deploymentId: engineOptions.deploymentId,
    engine,
    tokens,
    sentInvitations,
    get invitationAttempts() { return invitationAttempts; },
    internal: { 'x-wfm-implementation-internal': 'implementation-worker-test-token' },
    contractWebhook: { 'x-wfm-contract-webhook': 'contract-webhook-test-token' },
    close() {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
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

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for automatic recovery.');
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
    body: res.body ? JSON.parse(res.body) : null,
    headers: res.headers
  };
}

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
  if (kind === 'scenario-validation') {
    return { totalScenarios: 2400, passedScenarios: 2400, criticalFailures: 0 };
  }
  if (kind === 'test-data-cleanup') {
    return { remainingTestRows: 0, liveRowsTouched: 0 };
  }
  if (kind === 'live-data-import') {
    return { sourceCount: 10000, importedCount: 10000, invalidCount: 0, checksumMatch: true };
  }
  return { checked: true };
}

async function createInvitation(f, tenant = 'alpha', contractRef = 'contract-001', targetHours = 8) {
  const recipientEmail = tenant === 'bravo' ? 'manager@bravo' : 'manager@alpha';
  const before = f.sentInvitations.length;
  const result = await call(
    f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
    { tenant, contractRef, targetHours, recipientEmail }, f.internal
  );
  assert.ok([200, 201].includes(result.status));
  if (result.status === 201) assert.equal(f.sentInvitations.length, before + 1);
  const sent = f.sentInvitations[f.sentInvitations.length - 1];
  const token = sent ? new URL(sent.startUrl).searchParams.get('implementation_invite') : null;
  return { result, token };
}

function scopeFixture(tenant = 'alpha') {
  return {
    companyName: tenant === 'bravo' ? 'Bravo Manufacturing' : 'Alpha Manufacturing',
    countries: ['United Kingdom'],
    sites: ['Plant 1'],
    employeeCount: 10000,
    sourceSystems: ['ERP', 'Payroll', 'HCM'],
    features: ['Scheduling', 'Time & attendance', 'Absence', 'Payroll output'],
    workPatterns: ['24/7 rotating shifts'],
    clockingMethods: ['Existing access control', 'Mobile fallback'],
    payrollSystem: 'Payroll provider',
    hcmSystem: 'HCM provider',
    erpSystem: 'ERP provider',
    agencyLabour: true,
    priorities: 'Accurate payroll, safe automation and simple manager workflows'
  };
}

async function startRun(f, tenant = 'alpha', contractRef = 'contract-001', targetHours = 8) {
  const invitation = await createInvitation(f, tenant, contractRef, targetHours);
  assert.ok(invitation.token);
  const token = tenant === 'bravo' ? f.tokens.bravo : f.tokens.manager;
  const started = await call(
    f.engine, token, 'POST', '/api/implementation/autonomous/start',
    { token: invitation.token }
  );
  assert.ok([200, 201].includes(started.status));
  const scoped = await call(
    f.engine, token, 'POST', '/api/implementation/autonomous/scope',
    scopeFixture(tenant)
  );
  assert.ok([200, 201].includes(scoped.status));
  assert.equal(scoped.body.scopeCaptured, true);
  return scoped.body;
}

async function passAllEvidence(f, runId, verifierSuffix = '') {
  let last;
  const db = new DatabaseSync(f.dbPath);
  const run = db.prepare('SELECT tenant FROM implementation_runs WHERE id=?').get(runId);
  db.close();
  for (const item of REQUIREMENTS) {
    let detail = evidenceDetail(item.key);
    let source = 'deterministic-test';
    if (item.key === 'tenant-environment') {
      source = 'hosted-proof';
      detail = {
        fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
        provisioned: true, tenantExists: true, environmentId: 'test-cloud-environment',
        provisioningMode: 'cloud-runtime', runtimeHealthPassed: true, healthcheckPassed: true,
        tenantIsolationVerified: true, crossTenantNegativeTests: 1, durableStateVerified: true,
        exactCandidateSha: f.candidateSha, exactTargetDeploymentId: f.deploymentId,
        tenant: run.tenant, implementationRunId: runId, verifierRunId: 'unit-' + runId + verifierSuffix,
        proofRunnerIdentity: 'unit-test-runner',
        targetDeploymentCreatedAt: new Date(Date.now() - 60000).toISOString(),
        evidenceGeneratedAt: new Date().toISOString()
      };
    }
    last = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      { runId, kind: item.key, status: 'PASS', confidence: 1, source, detail },
      f.internal
    );
    assert.equal(last.status, 200);
  }
  return last.body;
}

test('hosted readiness reopens persisted evidence from a different candidate deployment or invalid policy authority', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-current' });
  try {
    const run = await startRun(f);
    const db = new DatabaseSync(f.dbPath);
    for (const [kind, detail] of [
      ['identity-access', { exactCandidateSha: 'b'.repeat(40), exactTargetDeploymentId: 'deployment-old' }],
      ['security-controls', { exactCandidateSha: candidateSha, exactTargetDeploymentId: 'deployment-old' }],
      ['tenant-environment', { environmentId: 'another-service' }],
      ['time-policies', { exactCandidateSha: candidateSha, exactTargetDeploymentId: 'deployment-current' }]
    ]) {
      db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(run.runId, 'alpha', kind, 'PASS', 1, 'hosted-proof', JSON.stringify(detail), new Date().toISOString());
    }
    db.close();
    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const requirements = new Map(status.body.requirements.map(item => [item.key,item]));
    for(const kind of ['identity-access','security-controls','tenant-environment']) {
      assert.equal(requirements.get(kind).satisfied, false, kind + ' must reopen');
      assert.equal(requirements.get(kind).status, 'REVALIDATION_REQUIRED');
      assert.ok(requirements.get(kind).evidenceBinding.reason);
    }
    assert.equal(requirements.get('time-policies').satisfied, false);
    assert.equal(requirements.get('time-policies').status, 'REVALIDATION_REQUIRED');
    assert.match(requirements.get('time-policies').evidenceValidation.reason, /policy evidence|authoritative policy/i);
    const preserved = new DatabaseSync(f.dbPath);
    assert.equal(preserved.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE source=?').get('hosted-proof').n, 4);
    preserved.close();
  } finally { f.close(); }
});

test('deployment change reopens previously satisfied work without deleting evidence', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-first' });
  let restarted;
  try {
    const run = await startRun(f);
    const accepted = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
      {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',
        detail:{exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-first'}},f.internal);
    assert.equal(accepted.status,200);
    const before = new DatabaseSync(f.dbPath);
    assert.equal(before.prepare('SELECT status FROM implementation_work_jobs WHERE run_id=? AND requirement_key=?').get(run.runId,'identity-access').status,'SATISFIED');
    before.close();
    f.engine.close();
    restarted=createOneDayEnterpriseEngine({dbPath:f.dbPath,requireCandidateBinding:true,candidateSha,deploymentId:'deployment-next',notificationRetryPollMs:0});
    const status=await call(restarted,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(item=>item.key==='identity-access').satisfied,false);
    const after = new DatabaseSync(f.dbPath);
    assert.notEqual(after.prepare('SELECT status FROM implementation_work_jobs WHERE run_id=? AND requirement_key=?').get(run.runId,'identity-access').status,'SATISFIED');
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE kind=?').get('identity-access').n,1);
    after.close();
  } finally { restarted?.close(); f.close(); }
});

test('hosted evidence admission refuses another candidate without recording a PASS', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-current' });
  try {
    const run = await startRun(f);
    for(const detail of [{}, {exactCandidateSha:'b'.repeat(40),exactTargetDeploymentId:'deployment-current'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-other'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',tenant:'bravo'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',runId:'another-run'}]) {
      const denied = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
        {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',detail},f.internal);
      assert.equal(denied.status,409);
      assert.equal(denied.body.readinessEvidenceAccepted,false);
    }
    const accepted = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
      {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',
        detail:{exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',tenant:'alpha',runId:run.runId}},f.internal);
    assert.equal(accepted.status,200);
    assert.equal(accepted.body.requirements.find(item=>item.key==='identity-access').satisfied,true);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE kind=?').get('identity-access').n,1);
    db.close();
  } finally { f.close(); }
});

test('provider-neutral signed contract webhook starts implementation immediately and sends one invitation', async () => {
  const f = fixture();
  try {
    const denied = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha'
      }
    );
    assert.equal(denied.status, 403);
    assert.equal(f.sentInvitations.length, 0);

    const ignored = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'draft',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha'
      },
      f.contractWebhook
    );
    assert.equal(ignored.status, 202);
    assert.equal(ignored.body.ignored, true);
    assert.equal(f.sentInvitations.length, 0);

    const signed = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha',
        targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(signed.status, 201);
    assert.equal(signed.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(signed.body.implementation.state, 'BUILDING');
    assert.equal(signed.body.implementation.operationalReady, false);
    assert.equal(signed.body.notification.delivered, true);
    assert.equal(f.sentInvitations.length, 1);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('trusted activation auto-starts a legacy pending invitation without reporting a missing run', async () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    const now = '2026-09-26T19:00:00.000Z';
    db.prepare(
      'INSERT INTO implementation_invitations(id,tenant,contract_ref_hash,recipient_hash,token_hash,status,target_hours,expires_at_ms,started_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      'legacy-invitation',
      'alpha',
      sha256('legacy-contract'),
      sha256('manager@alpha'),
      sha256('legacy-token'),
      'PENDING',
      8,
      Date.now() + 60_000,
      null,
      now,
      now
    );
    db.close();

    const activated = await call(
      f.engine,
      null,
      'POST',
      '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'legacy-contract', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );

    assert.equal(activated.status, 200);
    assert.equal(activated.body.invitation.invitationId, 'legacy-invitation');
    assert.equal(activated.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(activated.body.implementation.state, 'BUILDING');
    assert.ok(activated.body.implementation.runId);
    assert.equal(f.sentInvitations.length, 0);

    const check = new DatabaseSync(f.dbPath);
    assert.equal(check.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_AUTO_STARTED'").get().count, 1);
    check.close();
  } finally {
    f.close();
  }
});

test('employee cannot inspect enterprise implementation control plane', async () => {
  const f = fixture();
  try {
    const result = await call(
      f.engine, f.tokens.employee, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(result.status, 403);
  } finally {
    f.close();
  }
});

test('eight-hour target is assessed by parallel critical path, not serial task sum', async () => {
  const f = fixture();
  try {
    const eightHour = await startRun(f, 'alpha', 'critical-path-8h', 8);
    assert.equal(eightHour.state, 'BUILDING');
    assert.ok(eightHour.parallelWorkMinutes > eightHour.criticalPathRemainingMinutes);
    assert.ok(eightHour.criticalPathRemainingMinutes <= 480);

    const fourHour = await startRun(f, 'bravo', 'critical-path-4h', 4);
    assert.equal(fourHour.state, 'AT_RISK');
    assert.ok(fourHour.criticalPathRemainingMinutes > 240);
  } finally {
    f.close();
  }
});


test('notification transport failure cannot block trusted zero-touch implementation start', async () => {
  const f = fixture({ failInvitationDelivery: true });
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-mail-failure', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(activated.status, 201);
    assert.equal(activated.body.notification.delivered, false);
    assert.equal(activated.body.invitation, null);
    assert.equal(activated.body.implementation.state, 'BUILDING');
    assert.ok(activated.body.implementation.runId);

    const status = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.runId, activated.body.implementation.runId);
    assert.equal(status.body.state, 'BUILDING');

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 2);
    db.close();
  } finally {
    f.close();
  }
});

test('repeated trusted activation retries a failed invitation without duplicating implementation', async () => {
  const f = fixture({ failInvitationAttempts: 2 });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-retry', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.delivered, false);
    assert.equal(first.body.invitation, null);
    const repeated = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.implementation.runId, first.body.implementation.runId);
    assert.equal(repeated.body.notification.delivered, true);
    assert.equal(repeated.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(f.sentInvitations.length, 1);
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_AUTO_STARTED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('one trusted contract event automatically recovers a transient invitation failure', async () => {
  const f = fixture({ failFirstInvitation: true });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed', tenant: 'alpha', contractId: 'external-auto-mail-retry',
        implementationContactEmail: 'manager@alpha', targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.notification.delivered, true);
    assert.equal(result.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(f.invitationAttempts, 2);
    assert.equal(f.sentInvitations.length, 1);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('automatic retry preserves an ambiguously accepted invitation and delivery identity', async () => {
  const f = fixture({ acceptThenFailFirstInvitation: true });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed', tenant: 'alpha', contractId: 'external-ambiguous-mail',
        implementationContactEmail: 'manager@alpha', targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.notification.delivered, true);
    assert.equal(f.invitationAttempts, 2);
    assert.equal(f.sentInvitations.length, 2);
    assert.equal(f.sentInvitations[1].invitationId, f.sentInvitations[0].invitationId);
    assert.equal(f.sentInvitations[1].startUrl, f.sentInvitations[0].startUrl);
    assert.equal(f.sentInvitations[1].idempotencyKey, f.sentInvitations[0].idempotencyKey);
    assert.ok(f.sentInvitations[0].idempotencyKey);

    const firstToken = new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: firstToken }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.runId, result.body.implementation.runId);
  } finally {
    f.close();
  }
});

test('signed contract webhook replay uses the same bounded notification recovery', async () => {
  const f = fixture({ failInvitationAttempts: 2 });
  try {
    const event = {
      event: 'contract_signed', tenant: 'alpha', contractId: 'external-mail-retry',
      implementationContactEmail: 'manager@alpha', targetHours: 8
    };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed', event, f.contractWebhook);
    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed', event, f.contractWebhook);
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.delivered, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.notification.delivered, true);
    assert.equal(replay.body.implementation.runId, first.body.implementation.runId);
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('failed invitation retries stop at a durable three-attempt budget', async () => {
  const f = fixture({ failInvitationDelivery: true });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-budget', targetHours: 8, recipientEmail: 'manager@alpha' };
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal));
    }
    assert.deepEqual(results.map(result => result.status), [201, 200, 200, 200]);
    assert.equal(results[3].body.notification.retryExhausted, true);
    assert.equal(results[3].body.implementation.runId, results[0].body.implementation.runId);
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 3);
    db.close();
  } finally {
    f.close();
  }
});

test('simultaneous delayed retry and trusted replay cannot duplicate delivery or falsely exhaust recovery', async () => {
  let attempts = 0;
  let releaseFinalAttempt;
  let finalAttemptStarted;
  const finalStarted = new Promise(resolve => { finalAttemptStarted = resolve; });
  const finalRelease = new Promise(resolve => { releaseFinalAttempt = resolve; });
  const deliveries = [];
  let sweep;
  const f = fixture({
    notificationRetryDelayMs: 0,
    sendInvitation: async invitation => {
      attempts += 1;
      if (attempts <= 2) throw new Error('simulated provider outage');
      finalAttemptStarted();
      await finalRelease;
      deliveries.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-race-winner' };
    }
  });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-race', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);

    sweep = f.engine.retryDueNotifications({ nowMs: Date.now() + 60_000 });
    await finalStarted;
    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(replay.body.notification.retryInProgress, true);
    assert.equal(replay.body.notification.retryExhausted, false);

    releaseFinalAttempt();
    const recovery = await sweep;
    assert.equal(recovery.delivered, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(attempts, 3);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    releaseFinalAttempt?.();
    await sweep?.catch(() => {});
    f.close();
  }
});

test('implementation status explains pending and exhausted invitation recovery without exposing secrets', async () => {
  const f = fixture({ failInvitationDelivery: true });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-health', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);

    const recovering = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(recovering.status, 200);
    assert.equal(recovering.body.notificationRecovery.state, 'RECOVERING');
    assert.equal(recovering.body.notificationRecovery.attempts, 2);
    assert.equal(recovering.body.notificationRecovery.remainingAttempts, 1);
    assert.ok(recovering.body.notificationRecovery.nextRetryAt);
    assert.equal('recipientEmail' in recovering.body.notificationRecovery, false);
    assert.equal('startUrl' in recovering.body.notificationRecovery, false);
    assert.equal('contractRef' in recovering.body.notificationRecovery, false);

    const final = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(final.body.notification.retryExhausted, true);
    const exhausted = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(exhausted.body.notificationRecovery.state, 'EXHAUSTED');
    assert.equal(exhausted.body.notificationRecovery.attempts, 3);
    assert.equal(exhausted.body.notificationRecovery.remainingAttempts, 0);
    assert.equal(exhausted.body.notificationRecovery.automaticActionAvailable, false);
    assert.equal(exhausted.body.notificationRecovery.terminalAction, 'PROVIDER_OR_ADMIN_AUTHORIZATION_REQUIRED');
  } finally {
    f.close();
  }
});

test('failed invitation is retried automatically after a safe engine restart', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs: 0 });
  let restarted;
  let originalClosed = false;
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-restart', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.delivered, false);
    f.engine.close();
    originalClosed = true;
    const delivered = [];
    restarted = createOneDayEnterpriseEngine({
      dbPath: f.dbPath,
      internalToken: 'implementation-worker-test-token',
      contractWebhookSecret: 'contract-webhook-test-token',
      invitationRecoverySecret: 'dedicated-invitation-recovery-test-secret',
      publicOrigin: 'https://implementation.test',
      notificationRetryDelayMs: 0,
      notificationRetryPollMs: 5,
      sendInvitation: async invitation => {
        delivered.push(invitation);
        return { provider: 'test-mailer', messageId: 'mail-after-restart' };
      }
    });
    await waitFor(() => delivered.length === 1);
    assert.equal(delivered.length, 1);
    const recoveredToken = new URL(delivered[0].startUrl).searchParams.get('implementation_invite');
    const started = await call(
      restarted, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: recoveredToken }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.runId, first.body.implementation.runId);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    db.close();
  } finally {
    restarted?.close();
    if (!originalClosed) f.engine.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('tampered delayed-retry evidence fails closed without sending', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs: 0 });
  let restarted;
  let originalClosed = false;
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-tamper', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);
    f.engine.close();
    originalClosed = true;

    const tamper = new DatabaseSync(f.dbPath);
    tamper.prepare('UPDATE implementation_notification_outbox SET recipient_ciphertext=?').run('tampered');
    tamper.close();

    const delivered = [];
    restarted = createOneDayEnterpriseEngine({
      dbPath: f.dbPath,
      internalToken: 'implementation-worker-test-token',
      contractWebhookSecret: 'contract-webhook-test-token',
      invitationRecoverySecret: 'dedicated-invitation-recovery-test-secret',
      publicOrigin: 'https://implementation.test',
      notificationRetryPollMs: 0,
      sendInvitation: async invitation => {
        delivered.push(invitation);
        return { provider: 'test-mailer', messageId: 'must-not-send' };
      }
    });
    const recovery = await restarted.retryDueNotifications({ nowMs: Date.now() + 60_000 });
    assert.equal(recovery.blocked, 1);
    assert.equal(recovery.delivered, 0);
    assert.equal(delivered.length, 0);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'BLOCKED');
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_RECOVERY_BLOCKED'").get().count, 1);
    db.close();
  } finally {
    restarted?.close();
    if (!originalClosed) f.engine.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('missing public origin does not block trusted implementation start or create a token', async () => {
  const f = fixture({ publicOrigin: '' });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-no-origin', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.implementation.state, 'BUILDING');
    assert.equal(result.body.notification.unavailable, true);
    assert.equal(result.body.invitation, null);
    assert.equal(f.invitationAttempts, 0);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_invitations').get().count, 0);
    db.close();
  } finally {
    f.close();
  }
});

test('missing message provider configuration fails immediately without wasting retries or storing an invitation', async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  const f = fixture({ useDefaultInvitationSender: true });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-no-provider', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.implementation.state, 'BUILDING');
    assert.equal(result.body.notification.unavailable, true);
    assert.equal(result.body.notification.reason, 'MESSAGE_PROVIDER_NOT_CONFIGURED');
    assert.equal(result.body.invitation, null);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'UNAVAILABLE');
    assert.equal(status.body.notificationRecovery.terminalAction, 'MESSAGE_PROVIDER_CONFIGURATION_REQUIRED');

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_invitations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_attempts').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_UNAVAILABLE'").get().count, 1);
    db.close();
  } finally {
    f.close();
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousFrom === undefined) delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
    else process.env.WFM_IMPLEMENTATION_FROM_EMAIL = previousFrom;
  }
});

test('provider credential rejection stops after one attempt and requests authorised repair', async () => {
  const f = fixture({ rejectInvitationCredentials: true });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-provider-auth', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.status, 201);
    assert.equal(first.body.implementation.state, 'BUILDING');
    assert.equal(first.body.notification.delivered, false);
    assert.equal(first.body.notification.blocked, true);
    assert.equal(first.body.notification.reason, 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED');
    assert.equal(f.invitationAttempts, 1);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'BLOCKED');
    assert.equal(status.body.notificationRecovery.attempts, 1);
    assert.equal(status.body.notificationRecovery.automaticActionAvailable, false);
    assert.equal(status.body.notificationRecovery.terminalAction, 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED');

    const repeated = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(repeated.body.notification.blocked, true);
    assert.equal(f.invitationAttempts, 1);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 1);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'PROVIDER_BLOCKED');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_PROVIDER_BLOCKED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('authorised provider recovery resumes the same blocked invitation exactly once', async () => {
  let providerAuthorised = false;
  const attemptedInvitations = [];
  const f = fixture({
    sendInvitation: async invitation => {
      attemptedInvitations.push(invitation);
      if (!providerAuthorised) {
        const error = new Error('simulated provider credential rejection');
        error.permanent = true;
        error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
        throw error;
      }
      return { provider: 'test-mailer', messageId: 'mail-provider-recovered' };
    }
  });
  try {
    const event = {
      tenant: 'alpha', contractRef: 'contract-provider-recovery', targetHours: 8,
      recipientEmail: 'manager@alpha'
    };
    const first = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.blocked, true);
    assert.equal(attemptedInvitations.length, 1);

    const denied = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }
    );
    assert.equal(denied.status, 403);
    assert.equal(attemptedInvitations.length, 1);

    providerAuthorised = true;
    const recovered = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.notification.delivered, true);
    assert.equal(recovered.body.notification.recovered, true);
    assert.equal(recovered.body.implementation.state, 'BUILDING');
    assert.equal(attemptedInvitations.length, 2);
    assert.equal(attemptedInvitations[1].startUrl, attemptedInvitations[0].startUrl);
    assert.equal(attemptedInvitations[1].idempotencyKey, attemptedInvitations[0].idempotencyKey);

    const repeated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(repeated.status, 409);
    assert.equal(attemptedInvitations.length, 2);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'DELIVERED');
    assert.equal(status.body.notificationRecovery.attempts, 2);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_PROVIDER_RECOVERED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('provider recovery becomes exhausted on the third failed send without a fourth action', async () => {
  let invitationAttempts = 0;
  const f = fixture({
    sendInvitation: async () => {
      invitationAttempts += 1;
      const error = new Error('simulated persistent provider credential rejection');
      error.permanent = true;
      error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
      throw error;
    }
  });
  try {
    const event = {
      tenant: 'alpha', contractRef: 'contract-provider-recovery-budget', targetHours: 8,
      recipientEmail: 'manager@alpha'
    };
    const first = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.blocked, true);

    const second = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(second.status, 409);
    assert.equal(second.body.notification.state, 'BLOCKED');

    const third = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(third.status, 409);
    assert.equal(third.body.notification.state, 'EXHAUSTED');
    assert.equal(third.body.notification.terminalAction, 'PROVIDER_OR_ADMIN_AUTHORIZATION_REQUIRED');
    assert.equal(invitationAttempts, 3);

    const fourth = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(fourth.status, 409);
    assert.equal(invitationAttempts, 3);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'EXHAUSTED');
    assert.equal(status.body.notificationRecovery.attempts, 3);
    assert.equal(status.body.notificationRecovery.remainingAttempts, 0);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'EXHAUSTED');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_RECOVERY_EXHAUSTED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('implementation entry preflight exposes missing requirements before a contract without exposing secrets', async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  const f = fixture({ useDefaultInvitationSender: true });
  try {
    const denied = await call(f.engine, null, 'GET', '/api/implementation/autonomous/preflight');
    assert.equal(denied.status, 403);

    const result = await call(
      f.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined, f.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'BLOCKED');
    assert.equal(result.body.ready, false);
    assert.deepEqual(result.body.checks, {
      contractAuthentication: true,
      secureCustomerOrigin: true,
      invitationProvider: false,
      restartRecovery: true
    });
    assert.deepEqual(result.body.requiredActions, ['MESSAGE_PROVIDER_CONFIGURATION_REQUIRED']);
    assert.equal(JSON.stringify(result.body).includes('implementation-worker-test-token'), false);
    assert.equal(JSON.stringify(result.body).includes('contract-webhook-test-token'), false);
    assert.equal('apiKey' in result.body, false);
    assert.equal('fromEmail' in result.body, false);
  } finally {
    f.close();
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousFrom === undefined) delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
    else process.env.WFM_IMPLEMENTATION_FROM_EMAIL = previousFrom;
  }

  const ready = fixture();
  try {
    const result = await call(
      ready.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined, ready.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'READY');
    assert.equal(result.body.ready, true);
    assert.deepEqual(result.body.requiredActions, []);
  } finally {
    ready.close();
  }

  const sharedSecretFallback = fixture({ omitDedicatedRecoverySecret: true });
  try {
    const result = await call(
      sharedSecretFallback.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined,
      sharedSecretFallback.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'BLOCKED');
    assert.equal(result.body.checks.restartRecovery, false);
    assert.deepEqual(result.body.requiredActions, ['INVITATION_RECOVERY_SECRET_CONFIGURATION_REQUIRED']);
  } finally {
    sharedSecretFallback.close();
  }
});

test('contract activation is idempotent and auto-starts implementation without a customer click', async () => {
  const f = fixture();
  try {
    const denied = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-idempotent', recipientEmail: 'manager@alpha' }
    );
    assert.equal(denied.status, 403);

    const first = await createInvitation(f, 'alpha', 'contract-idempotent');
    const second = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-idempotent', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(first.result.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(second.body.invitation.startedRunId, null);
    assert.equal(f.sentInvitations.length, 1);

    const beforeStart = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(beforeStart.status, 200);
    assert.equal(beforeStart.body.state, 'BUILDING');
    assert.ok(beforeStart.body.runId);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();

    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: first.token }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.state, 'BUILDING');
    assert.equal(started.body.targetHours, 8);
    assert.equal(started.body.operationalReady, false);

    const replay = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: first.token }
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.runId, started.body.runId);
  } finally {
    f.close();
  }
});

test('invitation is bound to the intended tenant and recipient', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'recipient-boundary');
    const wrongTenant = await call(
      f.engine, f.tokens.bravo, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(wrongTenant.status, 404);

    const employeeAttempt = await call(
      f.engine, f.tokens.employee, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(employeeAttempt.status, 403);

    const managerPreview = await call(
      f.engine, f.tokens.manager, 'GET',
      '/api/implementation/autonomous/invitation?token=' + encodeURIComponent(invitation.token)
    );
    assert.equal(managerPreview.status, 200);
    assert.equal(managerPreview.body.invitation.state, 'AWAITING_CUSTOMER_START');
  } finally {
    f.close();
  }
});

test('rigorous testing, cleanup and live import cannot be falsely marked complete', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'strict-proof');
    for (const [kind, detail] of [
      ['scenario-validation', { totalScenarios: 100, passedScenarios: 99, criticalFailures: 1 }],
      ['test-data-cleanup', { remainingTestRows: 1, liveRowsTouched: 0 }],
      ['live-data-import', { sourceCount: 100, importedCount: 99, invalidCount: 0, checksumMatch: true }]
    ]) {
      const result = await call(
        f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
        { runId: run.runId, kind, status: 'PASS', confidence: 1, source: 'invalid-proof', detail },
        f.internal
      );
      assert.equal(result.status, 409);
    }
  } finally {
    f.close();
  }
});

test('readiness is fail-closed until every required evidence item passes at confidence floor', async () => {
  const f = fixture();
  try {
    const run = await startRun(f);
    const firstRequirement = REQUIREMENTS.find(item => !['configuration-scope', 'tenant-environment'].includes(item.key));
    const weak = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId: run.runId,
        kind: firstRequirement.key,
        status: 'PASS',
        confidence: Math.max(0, firstRequirement.minConfidence - 0.01),
        source: 'test'
      },
      f.internal
    );
    assert.equal(weak.status, 200);
    assert.equal(weak.body.operationalReady, false);
    assert.equal(
      weak.body.requirements.find(x => x.key === firstRequirement.key).satisfied,
      false
    );

    const ready = await passAllEvidence(f, run.runId);
    assert.equal(ready.operationalReady, true);
    assert.equal(ready.state, 'READY');
    assert.equal(ready.completedRequirements, REQUIREMENTS.length);
  } finally {
    f.close();
  }
});

test('high-risk inference exception blocks go-live until customer resolves it', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'contract-decision');
    const proposal = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/proposal',
      {
        runId: run.runId,
        key: 'night-overtime-threshold',
        question: 'Night overtime appears to change after 40 hours. Accept?',
        proposal: { thresholdHours: 40, multiplier: 1.5 },
        confidence: 0.91,
        risk: 'HIGH'
      },
      f.internal
    );
    assert.equal(proposal.status, 201);

    const evidenceReady = await passAllEvidence(f, run.runId);
    assert.equal(evidenceReady.operationalReady, false);
    assert.equal(evidenceReady.blockingDecisions.length, 1);

    const resolved = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/decision',
      {
        runId: run.runId,
        key: 'night-overtime-threshold',
        action: 'CHANGED',
        value: { thresholdHours: 37.5, multiplier: 1.5 }
      }
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.operationalReady, true);
    assert.equal(resolved.body.blockingDecisions.length, 0);
  } finally {
    f.close();
  }
});

test('implementation runs and decisions are tenant isolated', async () => {
  const f = fixture();
  try {
    const alpha = await startRun(f, 'alpha', 'alpha-contract');
    await startRun(f, 'bravo', 'bravo-contract');

    await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/proposal',
      {
        runId: alpha.runId,
        key: 'alpha-only',
        question: 'Alpha-only decision?',
        proposal: { value: true },
        confidence: 0.8,
        risk: 'HIGH'
      },
      f.internal
    );

    const bravoStatus = await call(
      f.engine, f.tokens.bravo, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(bravoStatus.status, 200);
    assert.equal(bravoStatus.body.tenant, 'bravo');
    assert.deepEqual(
      bravoStatus.body.decisions.map(item => item.key).sort(),
      ['absence-policy-authority', 'time-policy-authority']
    );
    assert.equal(bravoStatus.body.decisions.some(item => item.key === 'alpha-only'), false);

    const crossTenant = await call(
      f.engine, f.tokens.bravo, 'POST', '/api/implementation/autonomous/decision',
      {
        runId: alpha.runId,
        key: 'alpha-only',
        action: 'ACCEPTED'
      }
    );
    assert.equal(crossTenant.status, 404);
  } finally {
    f.close();
  }
});


test('customer configuration scope is required, persisted and tenant scoped', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'scope-required');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.scopeCaptured, false);
    assert.equal(started.body.requirements.find(x => x.key === 'configuration-scope').satisfied, false);

    const denied = await call(
      f.engine, f.tokens.employee, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(denied.status, 403);

    const invalid = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      { companyName: 'Alpha Manufacturing', countries: [], sites: [], employeeCount: 0 }
    );
    assert.equal(invalid.status, 400);

    const saved = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(saved.status, 201);
    assert.equal(saved.body.scopeCaptured, true);
    assert.equal(saved.body.customerScope.employeeCount, 10000);
    assert.equal(saved.body.requirements.find(x => x.key === 'configuration-scope').satisfied, true);

    const fetched = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/scope'
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.scopeCaptured, true);
    assert.equal(fetched.body.scope.companyName, 'Alpha Manufacturing');

    const crossTenant = await call(
      f.engine, f.tokens.bravo, 'GET', '/api/implementation/autonomous/scope'
    );
    assert.equal(crossTenant.status, 409);
  } finally {
    f.close();
  }
});

test('trusted evidence cannot bypass missing customer scope', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'scope-readiness-gate');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    const evidenceReady = await passAllEvidence(f, started.body.runId);
    assert.equal(evidenceReady.scopeCaptured, false);
    assert.equal(evidenceReady.operationalReady, false);
    assert.equal(evidenceReady.state, 'BUILDING');

    const scoped = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(scoped.status, 201);
    assert.equal(scoped.body.scopeCaptured, true);
    assert.equal(scoped.body.operationalReady, false);
    assert.equal(scoped.body.requirements.filter(item => item.status === 'REVALIDATION_REQUIRED').length, 20);
    const renewed = await passAllEvidence(f, started.body.runId, '-current-scope');
    assert.equal(renewed.operationalReady, true);
    assert.equal(renewed.state, 'READY');
    const audit = new DatabaseSync(f.dbPath);
    assert.equal(audit.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE run_id=?').get(started.body.runId).n, 42);
    audit.close();
  } finally {
    f.close();
  }
});

test('implementation audit events are append only', async () => {
  const f = fixture();
  try {
    await startRun(f, 'alpha', 'contract-audit');
    const db = new DatabaseSync(f.dbPath);
    assert.throws(
      () => db.exec("UPDATE implementation_events SET event='tampered'"),
      /append only/
    );
    assert.throws(
      () => db.exec('DELETE FROM implementation_events'),
      /append only/
    );
    db.close();
  } finally {
    f.close();
  }
});

test('unknown evidence kinds and raw untrusted evidence are rejected', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'contract-evidence');
    const browserAttempt = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/evidence',
      { runId: run.runId, kind: 'security-controls', status: 'PASS', confidence: 1 }
    );
    assert.equal(browserAttempt.status, 403);

    const unknown = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      { runId: run.runId, kind: 'made-up-control', status: 'PASS', confidence: 1 },
      f.internal
    );
    assert.equal(unknown.status, 400);
  } finally {
    f.close();
  }
});



test('legacy implementation_events schema migrates every required audit field in place without losing rows or triggers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-one-day-legacy-'));
  const dbPath = path.join(dir, 'legacy.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);' +
    'CREATE TABLE implementation_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_kind TEXT NOT NULL,' +
      'legacy_payload TEXT NOT NULL, legacy_at TEXT NOT NULL);' +
    'CREATE TRIGGER legacy_implementation_event_update BEFORE UPDATE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Legacy implementation events are append only.'); END;" +
    'CREATE TRIGGER legacy_implementation_event_delete BEFORE DELETE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Legacy implementation events are append only.'); END;"
  );
  const legacyPayload = '{"kept":true,"source":"pre-current-schema"}';
  db.prepare('INSERT INTO implementation_events(legacy_kind,legacy_payload,legacy_at) VALUES(?,?,?)')
    .run('legacy-event', legacyPayload, '2026-09-01T00:00:00.000Z');
  db.close();

  const options = {
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: 'https://implementation.test',
    sendInvitation: async () => ({ provider: 'test-mailer', messageId: 'legacy-migration' })
  };

  const engine = createOneDayEnterpriseEngine(options);
  engine.close();

  // A second startup proves the migration is idempotent after the columns exist.
  const second = createOneDayEnterpriseEngine(options);
  second.close();

  try {
    const migrated = new DatabaseSync(dbPath);
    const columns = migrated.prepare('PRAGMA table_info(implementation_events)').all().map(row => row.name);
    for (const expected of [
      'id','legacy_kind','legacy_payload','legacy_at',
      'run_id','tenant','event','detail_json','created_at'
    ]) {
      assert.ok(columns.includes(expected), 'missing migrated column: ' + expected);
    }

    const legacy = migrated.prepare(
      'SELECT legacy_kind,legacy_payload,legacy_at,run_id,tenant,event,detail_json,created_at FROM implementation_events WHERE id=1'
    ).get();
    assert.equal(legacy.legacy_kind, 'legacy-event');
    assert.equal(legacy.legacy_payload, legacyPayload);
    assert.equal(legacy.legacy_at, '2026-09-01T00:00:00.000Z');
    assert.equal(legacy.run_id, null);
    assert.equal(legacy.tenant, null);
    assert.equal(legacy.event, null);
    assert.equal(legacy.detail_json, null);
    assert.equal(legacy.created_at, null);

    const legacyTriggers = migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'legacy_implementation_event_%' ORDER BY name"
    ).all().map(row => row.name);
    assert.deepEqual(legacyTriggers, [
      'legacy_implementation_event_delete',
      'legacy_implementation_event_update'
    ]);

    migrated.prepare(
      'INSERT INTO implementation_events(run_id,tenant,event,detail_json,created_at) VALUES(?,?,?,?,?)'
    ).run('run-new','alpha','new-event','{"new":true}','2026-09-26T00:00:00.000Z');
    const current = migrated.prepare(
      'SELECT run_id,tenant,event,detail_json,created_at FROM implementation_events WHERE run_id=?'
    ).get('run-new');
    assert.equal(current.event, 'new-event');

    assert.throws(
      () => migrated.exec("UPDATE implementation_events SET legacy_kind='tampered' WHERE id=1"),
      /append only/i
    );
    migrated.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tenant-environment PASS is validator-bound, fresh, and reopened by a later terminal failure', async () => {
  const candidateSha = 'a'.repeat(40);
  const deploymentId = 'deployment-current';
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId });
  try {
    const run = await startRun(f);
    const makeDetail = (verifierRunId) => ({
      fixtureOnly: false,
      zeroHuman: true,
      humanInterventions: 0,
      provisioned: true,
      tenantExists: true,
      environmentId: 'cloud-env-alpha',
      provisioningMode: 'cloud-runtime',
      healthcheckPassed: true,
      tenantIsolationVerified: true,
      durableStateVerified: true,
      exactCandidateSha: candidateSha,
      exactTargetDeploymentId: deploymentId,
      tenant: 'alpha',
      runId: run.runId,
      verifierDeploymentId: verifierRunId
    });
    const forged = makeDetail('forged-verifier');
    const db = new DatabaseSync(f.dbPath);
    db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(run.runId, 'alpha', 'tenant-environment', 'PASS', 1, 'hosted-proof', JSON.stringify(forged), new Date().toISOString());
    db.close();
    const before = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const beforeTenant = before.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(beforeTenant.satisfied, false);
    assert.equal(beforeTenant.status, 'REVALIDATION_REQUIRED');

    const passDetail = makeDetail('verifier-pass-001');
    const pass = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: passDetail
    }, f.internal);
    assert.equal(pass.status, 200);
    const passedTenant = pass.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(passedTenant.satisfied, true);
    assert.equal(passedTenant.status, 'PASS');

    const failure = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'FAIL', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: { verifierDeploymentId: 'verifier-fail-002', terminalFailure: true, error: 'TENANT_RUNTIME_HEALTH_FAILED' }
    }, f.internal);
    assert.equal(failure.status, 200);
    const failedTenant = failure.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(failedTenant.satisfied, false);
    assert.equal(failedTenant.status, 'FAIL');

    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: passDetail
    }, f.internal);
    assert.equal(replay.status, 409);
    const reopened = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const reopenedTenant = reopened.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(reopenedTenant.satisfied, false);
    assert.equal(reopenedTenant.status, 'FAIL');
  } finally {
    f.close();
  }
});

test('strict replay proof rejects coercible or nonfinite totals and variance before durable admission', async () => {
  const f = fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const detail={exactCandidateSha:f.candidateSha,exactTargetDeploymentId:f.deploymentId,dataClass:'synthetic-scale',independentCalculation:true,expectedTotal:0,calculatedTotal:0,unexplainedVariance:0};
    for(const field of ['expectedTotal','calculatedTotal','unexplainedVariance']) {
      for(const invalid of [null,'','0',false,[],{},Infinity,-Infinity,NaN]) {
        const result=await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',{runId:run.runId,kind:'historical-replay',status:'PASS',confidence:1,source:'isolated-regression',detail:{...detail,[field]:invalid}},f.internal);
        assert.equal(result.status,409,field+'='+JSON.stringify(invalid));
      }
    }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(x=>x.key==='historical-replay').satisfied,false);
    for(const total of [0,123.45,-10.5]) {
      const result=await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',{runId:run.runId,kind:'historical-replay',status:'PASS',confidence:1,source:'isolated-regression',detail:{...detail,expectedTotal:total,calculatedTotal:total}},f.internal);
      assert.equal(result.status,200);
      assert.equal(result.body.requirements.find(x=>x.key==='historical-replay').satisfied,true);
    }
  } finally { f.close(); }
});

for(const kind of ['historical-replay','time-policies']) test('persisted malformed '+kind+' receipt loses authority but remains auditable', async()=>{
  const f=fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const binding={exactCandidateSha:f.candidateSha,exactTargetDeploymentId:f.deploymentId};
    const detail=kind==='historical-replay'?{...binding,dataClass:'synthetic-scale',independentCalculation:true,expectedTotal:null,calculatedTotal:'',unexplainedVariance:null}:{...binding,fixtureOnly:false,evidenceClass:'customer-authorised',sourceAuthoritative:true,sourceRef:'isolated-legacy-policy',effectiveDated:true,effectiveDate:'2026-02-30',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
    const db=new DatabaseSync(f.dbPath);
    try { db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(run.runId,'alpha',kind,'PASS',1,'isolated-legacy-regression',JSON.stringify(detail),new Date().toISOString()); }
    finally { db.close(); }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    const gate=status.body.requirements.find(x=>x.key===kind);
    assert.equal(gate.satisfied,false);
    assert.equal(gate.status,'REVALIDATION_REQUIRED');
    const auditDb=new DatabaseSync(f.dbPath);
    try { assert.equal(auditDb.prepare('SELECT status FROM implementation_evidence WHERE run_id=? AND kind=?').get(run.runId,kind).status,'PASS'); }
    finally { auditDb.close(); }
  } finally {f.close();}
});

test('customer policy date rejects impossible days and malformed timestamps without resolving authority', async () => {
  const f=fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const detail={authoritativeConfirmation:true,sourceRef:'isolated-regression-policy',effectiveDate:'2026-99-99',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
    for(const date of ['2026-99-99','2026-02-30','2025-02-29','2026-04-31','2026-10-01Tgarbage']) {
      const result=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/decision',{runId:run.runId,key:'time-policy-authority',action:'ACCEPTED',detail:{...detail,effectiveDate:date}});
      assert.equal(result.status,409,date);
    }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(x=>x.key==='time-policies').satisfied,false);
    const db=new DatabaseSync(f.dbPath);
    try { assert.equal(db.prepare('SELECT status FROM implementation_decisions WHERE run_id=? AND decision_key=?').get(run.runId,'time-policy-authority').status,'PENDING'); }
    finally { db.close(); }
    for(const date of ['2024-02-29','2026-10-01','2026-10-01T12:30:00Z','2026-10-01T23:30:00-02:00']) {
      const result=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/decision',{runId:run.runId,key:'time-policy-authority',action:'ACCEPTED',detail:{...detail,effectiveDate:date}});
      assert.equal(result.status,200,date);
      assert.equal(result.body.requirements.find(x=>x.key==='time-policies').satisfied,true);
    }
  } finally { f.close(); }
});

// Retained real SQLite reproductions for current configuration and strict receipt admission.
{
'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Readable}=require('node:stream'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createOneDayEnterpriseEngine,REQUIREMENTS}=require('./one-day-enterprise-engine.cjs'),observations=[],SHA='b51f291a5f73ccccd828cab4ad7650efcc67c53f',DPL='synthetic-current-review-deployment',TOKEN='review-internal-token',session='review-manager-session';const hash=x=>createHash('sha256').update(x).digest('hex');
const scope=()=>({companyName:'Review Tenant',countries:['United Kingdom'],sites:['Plant1'],employeeCount:1,sourceSystems:['HCM'],features:['Time','Absence','Payroll'],workPatterns:['daytime'],clockingMethods:['badge'],payrollSystem:'PayrollUK',hcmSystem:'HCM',erpSystem:'ERP',agencyLabour:false,priorities:'accurate payroll'});
function fixture(strict=true){const fixtures=path.join(require('node:os').tmpdir(),'vector-current-admission-tests');fs.mkdirSync(fixtures,{recursive:true});const dir=fs.mkdtempSync(path.join(fixtures,'case-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath),now=Date.now();db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('review-alpha',1,'{}');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@review','review-alpha','manager','manager',1,'salt','00','[]');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(session),'manager@review',now+3600000);db.close();const opts={dbPath,strictEvidence:strict,requireCandidateBinding:true,candidateSha:SHA,deploymentId:DPL,internalToken:TOKEN,agentsApiEnabled:false,notificationRetryPollMs:0};let engine=createOneDayEnterpriseEngine(opts);const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('run-review','review-alpha','contract','BUILDING',now,now+8*3600000,8,new Date(now).toISOString(),new Date(now).toISOString());seed.close();return{dir,dbPath,get engine(){return engine;},reopen(strictNext=true){engine.close();engine=createOneDayEnterpriseEngine({...opts,strictEvidence:strictNext});},close(){engine.close();},audit(){const d=new DatabaseSync(dbPath),r={evidence:d.prepare('SELECT * FROM implementation_evidence ORDER BY id').all(),events:d.prepare('SELECT * FROM implementation_events ORDER BY id').all(),scope:d.prepare('SELECT * FROM implementation_scope').all(),environments:d.prepare('SELECT * FROM tenant_environments').all(),jobs:d.prepare('SELECT * FROM implementation_work_jobs').all()};d.close();return r;}};}
async function call(f,route,body,auth='worker'){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=body===undefined?'GET':'POST';req.url='/api/implementation/autonomous/'+route;req.headers=auth==='worker'?{'x-wfm-implementation-internal':TOKEN}:auth==='manager'?{cookie:'wfm_session='+session}:{};const res={statusCode:200,headersSent:false,writableEnded:false,body:'',setHeader(){},end(x=''){this.body=String(x);this.headersSent=true;this.writableEnded=true;}};assert.equal(await f.engine.handleRequest(req,res),true);return{status:res.statusCode,body:res.body?JSON.parse(res.body):null};}
function detail(kind){const common={exactCandidateSha:SHA,exactTargetDeploymentId:DPL,tenant:'review-alpha',runId:'run-review',fixtureOnly:false};if(kind==='tenant-environment')return{...common,zeroHuman:true,humanInterventions:0,provisioned:true,tenantExists:true,environmentId:'synthetic-review-environment',provisioningMode:'cloud-runtime',runtimeHealthPassed:true,tenantIsolationVerified:true,crossTenantNegativeTests:1,durableStateVerified:true,implementationRunId:'run-review',verifierRunId:'review-verifier',proofRunnerIdentity:'review-identity',targetDeploymentCreatedAt:new Date(Date.now()-10000).toISOString(),evidenceGeneratedAt:new Date().toISOString()};if(['time-policies','absence-policies'].includes(kind))return{...common,evidenceClass:'customer-authorised',sourceAuthoritative:true,sourceRef:'review-customer-policy',effectiveDated:true,effectiveDate:'2026-01-01',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true,leaveYearVerified:true,entitlementMethodVerified:true,approvalRulesVerified:true,absenceTypesVerified:true,usesOpeningBalance:false,openingBalanceFictional:false,country:'United Kingdom',timeZone:'Europe/London'};if(kind==='source-systems')return{...common,zeroHuman:true,humanInterventions:0,discoveryCompleted:true,authorizationVerified:true,providers:[{provider:'review-HCM',discovered:true,authorized:true,connected:true,mode:'sandbox'}]};if(kind==='historical-replay')return{...common,dataClass:'customer-authorised',independentCalculation:true,expectedTotal:100,calculatedTotal:100,unexplainedVariance:0};if(kind==='security-controls')return{...common,cloudRuntime:true,tenantIsolationVerified:true,crossTenantNegativeTests:1,criticalFailures:0};if(kind==='scenario-validation')return{...common,cloudRuntime:true,testDataClass:'synthetic-scenario',totalScenarios:2,passedScenarios:2,criticalFailures:0};if(kind==='test-data-cleanup')return{...common,remainingTestRows:0,liveRowsTouched:0};if(kind==='live-data-import')return{...common,zeroHuman:true,humanInterventions:0,sourceAuthoritative:true,sourceCount:1,importedCount:1,invalidCount:0,checksumMatch:true};return{...common,checked:true};}
const submit=(f,kind,payload=detail(kind),auth='worker')=>call(f,'evidence',{runId:'run-review',kind,status:'PASS',confidence:1,source:kind==='tenant-environment'?'hosted-proof':'review-declared-producer',detail:payload},auth);
const row=(result,kind)=>result.body.requirements.find(x=>x.key===kind);
test('current admission: scope update must reopen previously ready evidence and provisioned configuration instead of retaining old21/21',async()=>{const f=fixture();try{const initial=await call(f,'scope',scope(),'manager');assert.equal(initial.status,201);for(const{key}of REQUIREMENTS){if(key==='configuration-scope')continue;const d=detail(key);d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;const r=await submit(f,key,d);assert.equal(r.status,200,JSON.stringify(r.body));}const before=await call(f,'status',undefined,'manager');assert.equal(before.body.operationalReady,true);assert.equal(before.body.completedRequirements,21);const beforeAudit=f.audit();const changed=scope();changed.countries=['Germany'];changed.sites=['Plant2'];changed.employeeCount=2;changed.payrollSystem='PayrollDE';const after=await call(f,'scope',changed,'manager');assert.equal(after.status,200);observations.push({name:'current scope update',fixtureDir:f.dir,initialScope:scope(),newScope:changed,before:before.body,after:after.body,durable:f.audit()});assert.equal(after.body.operationalReady,false,'Old evidence incorrectly keeps READY on changed scope');assert.ok(after.body.requirements.some(x=>x.status==='REVALIDATION_REQUIRED'));
const durableAfter=f.audit();assert.equal(durableAfter.environments[0].environment_id,initial.body.tenantEnvironment.environmentId);assert.notEqual(after.body.tenantEnvironment.configurationDigest,initial.body.tenantEnvironment.configurationDigest);assert.deepEqual(durableAfter.evidence,beforeAudit.evidence);
assert.equal(JSON.parse(durableAfter.environments[0].configuration_json).payrollSystem,'PayrollDE');
for(const{key}of REQUIREMENTS){if(key==='configuration-scope')continue;const d=detail(key);d.configurationDigest=after.body.tenantEnvironment.configurationDigest;if(key==='tenant-environment')d.verifierRunId='review-verifier-current-scope';assert.equal((await submit(f,key,d)).status,200,key);}
const renewed=await call(f,'status',undefined,'manager');assert.equal(renewed.body.operationalReady,true);assert.equal(f.audit().evidence.length,40);f.reopen(true);assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,true);
}finally{f.close();}});
const invalidPersisted=[['source-systems',d=>{d.fixtureOnly=true;d.providers[0].mode='fixture';}],['security-controls',d=>{d.cloudRuntime=false;d.tenantIsolationVerified=false;d.criticalFailures=1;}],['scenario-validation',d=>{d.cloudRuntime=false;d.testDataClass='fixture';}],['live-data-import',d=>{d.fixtureOnly=true;d.sourceAuthoritative=false;}]];
for(const[kind,mutate]of invalidPersisted)test('current admission: strict restart must revalidate exact-current persisted '+kind+' previously admitted under compatibility mode',async()=>{const f=fixture(false);try{const d=detail(kind);mutate(d);const accepted=await submit(f,kind,d);assert.equal(accepted.status,200);assert.equal(row(accepted,kind).satisfied,true);const before=f.audit();f.reopen(true);const status=await call(f,'status',undefined,'manager'),after=f.audit();assert.equal(after.evidence.length,before.evidence.length,'Evidence audit should remain');const configured=await call(f,'scope',scope(),'manager');assert.equal(configured.status,201);for(const{key}of REQUIREMENTS){if(key==='configuration-scope'||key===kind)continue;const p=detail(key);p.configurationDigest=configured.body.tenantEnvironment.configurationDigest;assert.equal((await submit(f,key,p)).status,200);}const final=await call(f,'status',undefined,'manager'),finalAudit=f.audit();assert.equal(finalAudit.evidence.length,20);assert.equal(finalAudit.evidence.find(x=>x.id===before.evidence[0].id).detail_json,before.evidence[0].detail_json,'Original invalid receipt preserved exactly');observations.push({name:'persisted strict '+kind,fixtureDir:f.dir,admitted:accepted.body.requirements.find(x=>x.key===kind),reopened:row(status,kind),beforeEvidence:before.evidence,afterEvidence:after.evidence,beforeEventCount:before.events.length,afterEventCount:after.events.length,finalReadiness:final.body,finalDurable:finalAudit});assert.equal(final.body.operationalReady,false,'One invalid persisted receipt incorrectly completes strict readiness');assert.equal(row(status,kind).satisfied,false,'Weak compatibility evidence remains current PASS');assert.equal(row(status,kind).status,'REVALIDATION_REQUIRED');}finally{f.close();}});
test('current admission: strict immediate admission rejects fixture provider, weak security and fixture live import before persistence',async()=>{const f=fixture();try{for(const[kind,mutate]of invalidPersisted){const d=detail(kind);mutate(d);const r=await submit(f,kind,d);assert.equal(r.status,409,kind);}assert.equal(f.audit().evidence.length,0);}finally{f.close();}});
test('current admission: candidate/deployment/tenant/run explicit mismatches are denied without any PASS persistence',async()=>{const f=fixture();try{for(const fields of[{exactCandidateSha:'a'.repeat(40)},{exactTargetDeploymentId:'other-deployment'},{tenant:'other-tenant'},{runId:'old-run'}]){const r=await submit(f,'identity-access',{...detail('identity-access'),...fields});assert.equal(r.status,409);}assert.equal(f.audit().evidence.length,0);}finally{f.close();}});
test('current admission: manager cookie and unauthenticated caller cannot publish internal readiness evidence',async()=>{const f=fixture();try{for(const auth of['manager','none'])assert.equal((await submit(f,'identity-access',detail('identity-access'),auth)).status,403);assert.equal(f.audit().evidence.length,0);}finally{f.close();}});

async function admitReady(f){await call(f,'scope',scope(),'manager');for(const{key}of REQUIREMENTS){if(key!=='configuration-scope')assert.equal((await submit(f,key)).status,200,key);}assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,true);}
test('current admission: same-count scope changes invalidate server-bound receipts without caller digest and cannot resurrect them by changing back',async()=>{const f=fixture();try{await admitReady(f);const before=f.audit(),old=scope();const changed={...old,countries:['Germany'],sites:['Plant2'],payrollSystem:'PayrollDE'};const updated=await call(f,'scope',changed,'manager');assert.equal(updated.body.operationalReady,false);assert.equal(updated.body.requirements.filter(x=>x.status==='REVALIDATION_REQUIRED').length,20);assert.deepEqual(f.audit().evidence,before.evidence);f.reopen(true);assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,false);const back=await call(f,'scope',old,'manager');assert.equal(back.body.operationalReady,false,'Prior identical configuration must not resurrect old-revision authority');assert.deepEqual(f.audit().evidence,before.evidence);assert.equal(f.audit().environments[0].environment_id,before.environments[0].environment_id);}finally{f.close();}});
test('current admission: identical scope resubmission preserves ready receipts and existing effect/job identity',async()=>{const f=fixture();try{await admitReady(f);const before=f.audit(),d=new DatabaseSync(f.dbPath),count=d.prepare('SELECT COUNT(*) AS n FROM tenant_environment_events').get().n;d.close();const again=await call(f,'scope',scope(),'manager');assert.equal(again.body.operationalReady,true);assert.deepEqual(f.audit().evidence,before.evidence);assert.deepEqual(f.audit().jobs.map(x=>[x.id,x.intent_digest,x.status]),before.jobs.map(x=>[x.id,x.intent_digest,x.status]));const check=new DatabaseSync(f.dbPath);assert.equal(check.prepare('SELECT COUNT(*) AS n FROM tenant_environment_events').get().n,count);check.close();}finally{f.close();}});
test('current admission: configuration digest mismatch and caller-issued configuration seal are refused before storing evidence',async()=>{const f=fixture();try{await call(f,'scope',scope(),'manager');assert.equal((await submit(f,'identity-access',{...detail('identity-access'),configurationDigest:'prior-configuration'})).status,409);assert.equal((await submit(f,'identity-access',{...detail('identity-access'),_configurationValidation:{version:1}})).status,409);assert.equal(f.audit().evidence.length,0);}finally{f.close();}});

test('current admission: receipts accepted before first configuration cannot acquire its authority retroactively',async()=>{const f=fixture();try{for(const{key}of REQUIREMENTS)if(key!=='configuration-scope')assert.equal((await submit(f,key)).status,200,key);const before=f.audit();assert.ok(before.evidence.every(x=>!JSON.parse(x.detail_json)._configurationValidation));const changed={...scope(),countries:['Germany'],sites:['Plant2'],payrollSystem:'PayrollDE'};const captured=await call(f,'scope',changed,'manager');assert.equal(captured.body.operationalReady,false);assert.equal(captured.body.requirements.filter(x=>x.status==='REVALIDATION_REQUIRED').length,20);assert.deepEqual(f.audit().evidence,before.evidence);}finally{f.close();}});
test('current admission: trusted contract scope changes share the revision boundary and cannot resurrect prior scope receipts',async()=>{const f=fixture();try{const d=new DatabaseSync(f.dbPath);d.prepare('UPDATE implementation_runs SET contract_ref_hash=? WHERE id=?').run(hash('review-existing-contract'),'run-review');d.close();await admitReady(f);const before=f.audit();const activate=s=>call(f,'contract-activated',{tenant:'review-alpha',contractRef:'review-existing-contract',recipientEmail:'synthetic@example.invalid',scope:s});const changed={...scope(),countries:['Germany'],sites:['Plant2'],payrollSystem:'PayrollDE'};await activate(changed);assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,false);await activate(scope());assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,false);assert.deepEqual(f.audit().evidence,before.evidence);assert.equal(f.audit().environments[0].environment_id,before.environments[0].environment_id);}finally{f.close();}});


test('current admission: orchestration enters normal operation only after all readiness gates are satisfied',async()=>{
  const f=fixture();try{
    const initial=await call(f,'scope',scope(),'manager');
    assert.equal(initial.status,201);
    let status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.orchestration.implementationComplete,false);
    assert.notEqual(status.body.orchestration.nextMode,'NORMAL_OPERATION');
    for(const{key}of REQUIREMENTS){
      if(key==='configuration-scope')continue;
      const d=detail(key);
      d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;
      const accepted=await submit(f,key,d);
      assert.equal(accepted.status,200,key);
    }
    status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.operationalReady,true);
    assert.equal(status.body.orchestration.implementationComplete,true);
    assert.equal(status.body.orchestration.nextMode,'NORMAL_OPERATION');
    assert.equal(status.body.orchestration.customerActionRequired,false);
    assert.equal(status.body.orchestration.autonomousWorkRemaining,false);
  }finally{f.close();}
});

test('current admission: orchestration surfaces customer authority instead of pretending implementation is complete',async()=>{
  const f=fixture();try{
    const initial=await call(f,'scope',scope(),'manager');
    assert.equal(initial.status,201);
    for(const{key}of REQUIREMENTS){
      if(['configuration-scope','absence-policies'].includes(key))continue;
      const d=detail(key);
      d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;
      assert.equal((await submit(f,key,d)).status,200,key);
    }
    const status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.operationalReady,false);
    assert.equal(status.body.orchestration.implementationComplete,false);
    assert.equal(status.body.orchestration.customerActionRequired,true);
    assert.equal(status.body.orchestration.nextMode,'AWAITING_CUSTOMER_AUTHORITY');
    assert.ok(status.body.orchestration.awaitingExternalAuthority.some(x=>x.requirementKey==='absence-policies'));
  }finally{f.close();}
});

}
