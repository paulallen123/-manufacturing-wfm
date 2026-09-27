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

function fixture(engineOverrides = {}) {
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
  const engine = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: 'https://implementation.test',
    releaseSha: '1234567890abcdef1234567890abcdef12345678',
    sendInvitation: async invitation => {
      sentInvitations.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-' + sentInvitations.length };
    },
    ...engineOverrides
  });

  return {
    dir,
    dbPath,
    engine,
    tokens,
    sentInvitations,
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

async function passAllEvidence(f, runId) {
  let last;
  for (const item of REQUIREMENTS) {
    last = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId,
        kind: item.key,
        status: 'PASS',
        confidence: 1,
        source: 'deterministic-test',
        detail: evidenceDetail(item.key)
      },
      f.internal
    );
    assert.equal(last.status, 200);
  }
  return last.body;
}

test('provider-neutral signed contract webhook sends one invitation and does not start implementation', async () => {
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
    assert.equal(f.sentInvitations.length, 1);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 0);
    db.close();
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

test('contract activation creates an idempotent invitation but does not start implementation', async () => {
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
    assert.equal(f.sentInvitations.length, 1);

    const beforeStart = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(beforeStart.status, 200);
    assert.equal(beforeStart.body.state, 'AWAITING_CUSTOMER_START');
    assert.equal(beforeStart.body.runId, undefined);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 0);
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
    const firstRequirement = REQUIREMENTS.find(item => item.key !== 'configuration-scope');
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

    const staleResolution = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/decision',
      {
        runId: run.runId,
        key: 'night-overtime-threshold',
        action: 'CHANGED',
        value: { thresholdHours: 37.5, multiplier: 1.5 }
      }
    );
    assert.equal(staleResolution.status, 409);
    assert.equal(staleResolution.body.reasonCode, 'SOURCE_REVISION_CHANGED');

    const refreshedProposal = await call(
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
    assert.equal(refreshedProposal.status, 200);

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
    const proofBound = resolved.body.decisions.find(item => item.key === 'night-overtime-threshold');
    assert.equal(proofBound.proofCurrent, true);
    assert.equal(proofBound.proofCarryingState.releaseSha, '1234567890abcdef1234567890abcdef12345678');
    assert.equal(proofBound.proofCarryingState.actorAuthority, 'MANAGER');

    const evidenceChanged = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId: run.runId,
        kind: 'source-systems',
        status: 'PASS',
        confidence: 1,
        source: 'deterministic-test-refresh',
        detail: { checked: true, sourceRevision: 'r2' }
      },
      f.internal
    );
    assert.equal(evidenceChanged.status, 200);
    assert.equal(evidenceChanged.body.operationalReady, false);
    const staleDecision = evidenceChanged.body.decisions.find(item => item.key === 'night-overtime-threshold');
    assert.equal(staleDecision.proofCurrent, false);
    assert.ok(staleDecision.proofStaleReasons.includes('SOURCE_REVISION_CHANGED'));
    assert.equal(evidenceChanged.body.blockingDecisions.length, 1);
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
    assert.equal(bravoStatus.body.decisions.length, 0);

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
    assert.equal(scoped.body.operationalReady, true);
    assert.equal(scoped.body.state, 'READY');
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


test('Launch Autopilot readiness is additive and visible through the existing implementation status', async () => {
  const observed = [];
  const f = fixture({
    readinessAugmenter(readiness) {
      observed.push({ runId: readiness.runId, ready: readiness.operationalReady });
      return {
        state: readiness.operationalReady ? 'READY' : 'VALIDATE',
        ready: readiness.operationalReady,
        activation: {
          eligible: readiness.operationalReady,
          authority: readiness.operationalReady ? 'EXTERNAL_PERMIT_REQUIRED' : 'NOT_ELIGIBLE',
          productionMutation: false
        },
        compatibility: {
          existingImplementationReady: readiness.operationalReady,
          noRequirementRemoved: true,
          productionMutation: false
        }
      };
    }
  });
  try {
    const started = await startRun(f, 'alpha', 'launch-autopilot-status', 8);
    assert.ok(started.launchAutopilot);
    assert.equal(started.launchAutopilot.ready, false);

    const final = await passAllEvidence(f, started.runId);
    assert.equal(final.operationalReady, true);
    assert.equal(final.launchAutopilot.ready, true);
    assert.equal(final.launchAutopilot.activation.authority, 'EXTERNAL_PERMIT_REQUIRED');
    assert.equal(final.launchAutopilot.activation.productionMutation, false);
    assert.ok(observed.length > 1);
  } finally {
    f.close();
  }
});

test('Launch Autopilot failure cannot regress the existing implementation engine', async () => {
  const f = fixture({
    readinessAugmenter() {
      throw new Error('simulated launch coordinator outage');
    }
  });
  try {
    const started = await startRun(f, 'alpha', 'launch-autopilot-failure-isolation', 8);
    const final = await passAllEvidence(f, started.runId);
    assert.equal(final.operationalReady, true);
    assert.equal(final.state, 'READY');
    assert.equal(final.launchAutopilot.state, 'UNAVAILABLE');
    assert.equal(final.launchAutopilot.ready, false);
    assert.equal(final.launchAutopilot.compatibility.noRequirementRemoved, true);
  } finally {
    f.close();
  }
});
