'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createOneDayEnterpriseEngine } = require('./one-day-enterprise-engine.cjs');

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

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
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function scopeFixture() {
  return {
    companyName: 'Alpha Manufacturing',
    countries: ['United Kingdom'],
    sites: ['Plant 1'],
    employeeCount: 100,
    sourceSystems: ['HCM'],
    features: ['Scheduling', 'Time & attendance'],
    workPatterns: ['Rotating shifts'],
    clockingMethods: ['Existing access control'],
    payrollSystem: 'Payroll provider',
    hcmSystem: 'HCM provider',
    erpSystem: 'ERP provider',
    agencyLabour: false,
    priorities: 'Safe zero-human implementation'
  };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-active-implementation-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha', 'alpha', 'm1', 'manager', 1, 's', '00', '[]');
  const token = 'm'.repeat(64);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(token), 'manager@alpha', Date.now() + 60_000);
  db.close();

  const engine = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'worker-token',
    contractWebhookSecret: 'contract-token',
    invitationRecoverySecret: 'recovery-token',
    publicOrigin: 'https://implementation.test',
    sendInvitation: async () => ({ provider: 'test' })
  });
  return {
    dir,
    dbPath,
    engine,
    token,
    internal: { 'x-wfm-implementation-internal': 'worker-token' },
    close() {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('trusted activation captures authoritative scope and opens safe independent work', async () => {
  const f = fixture();
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      {
        tenant: 'alpha',
        contractRef: 'scope-from-contract',
        targetHours: 8,
        recipientEmail: 'manager@alpha',
        scope: scopeFixture()
      },
      f.internal
    );
    assert.equal(activated.status, 201);
    assert.equal(activated.body.implementation.scopeCaptured, true);
    const config = activated.body.implementation.requirements.find(item => item.key === 'configuration-scope');
    assert.equal(config.satisfied, true);
    const work = activated.body.implementation.workPlan;
    assert.equal(work.jobs.find(item => item.requirementKey === 'configuration-scope').status, 'SATISFIED');
    assert.equal(work.jobs.find(item => item.requirementKey === 'tenant-environment').status, 'PENDING');
  } finally {
    f.close();
  }
});

test('completed implementation effect remains unproven until evidence is independently recorded', async () => {
  const f = fixture();
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      {
        tenant: 'alpha',
        contractRef: 'effect-receipt-contract',
        targetHours: 8,
        recipientEmail: 'manager@alpha',
        scope: scopeFixture()
      },
      f.internal
    );
    const runId = activated.body.implementation.runId;

    const claimed = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/work/claim',
      { runId, tenant: 'alpha', requirementKey: 'tenant-environment' },
      f.internal
    );
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.job.status, 'RUNNING');

    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/work/result',
      {
        runId,
        tenant: 'alpha',
        jobId: claimed.body.job.id,
        intentDigest: claimed.body.job.intentDigest,
        outcome: 'EFFECT_RECORDED',
        detail: { providerRequestId: 'provision-1' }
      },
      f.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.evidenceRequired, true);
    assert.equal(result.body.readiness.requirements.find(item => item.key === 'tenant-environment').satisfied, false);
    assert.equal(
      result.body.readiness.workPlan.jobs.find(item => item.requirementKey === 'tenant-environment').status,
      'AWAITING_EVIDENCE'
    );

    const replay = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/work/result',
      {
        runId,
        tenant: 'alpha',
        jobId: claimed.body.job.id,
        intentDigest: claimed.body.job.intentDigest,
        outcome: 'EFFECT_RECORDED',
        detail: { providerRequestId: 'provision-1' }
      },
      f.internal
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.result.replayed, true);

    const evidenced = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId,
        kind: 'tenant-environment',
        status: 'PASS',
        confidence: 1,
        source: 'independent-verifier',
        detail: { checked: true }
      },
      f.internal
    );
    assert.equal(evidenced.status, 200);
    assert.equal(evidenced.body.requirements.find(item => item.key === 'tenant-environment').satisfied, true);
    assert.equal(
      evidenced.body.workPlan.jobs.find(item => item.requirementKey === 'tenant-environment').status,
      'SATISFIED'
    );
  } finally {
    f.close();
  }
});
