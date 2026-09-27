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
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: options.publicOrigin ?? 'https://implementation.test',
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
