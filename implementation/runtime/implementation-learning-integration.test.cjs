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
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run(email, 'alpha', personId, role, role === 'employee' ? 0 : 1, 's', '00', '[]');
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
  const implementation = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-worker-test-token',
    learningSummaryProvider: tenant => learning.summaryForTenant(tenant)
  });

  return {
    dir,
    dbPath,
    learning,
    implementation,
    tokens,
    learningInternal: { 'x-wfm-learning-internal': 'learning-worker-test-token' },
    implementationInternal: { 'x-wfm-implementation-internal': 'implementation-worker-test-token' },
    close() {
      implementation.close();
      learning.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function passTechnicalEvidence(f, runId) {
  const training = new Set(['role-learning', 'privileged-competency', 'frontline-readiness']);
  let latest = null;
  for (const item of REQUIREMENTS) {
    if (training.has(item.key)) continue;
    const result = await call(
      f.implementation,
      null,
      'POST',
      '/api/implementation/autonomous/evidence',
      {
        runId,
        kind: item.key,
        status: 'PASS',
        confidence: 1,
        source: 'deterministic-technical-proof'
      },
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
    const start = await call(
      f.implementation,
      null,
      'POST',
      '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'enterprise-contract-001', targetHours: 8 },
      f.implementationInternal
    );
    assert.equal(start.status, 201);
    const runId = start.body.runId;

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
    assert.equal(status.body.operationalReady, true);
    assert.equal(status.body.state, 'READY');
    assert.equal(status.body.learningSummary.privilegedReady, true);
    assert.equal(status.body.learningSummary.fullyCertified, true);
  } finally {
    f.close();
  }
});
