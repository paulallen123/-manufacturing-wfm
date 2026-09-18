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

function fixture() {
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

  const engine = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'implementation-worker-test-token'
  });

  return {
    dir,
    dbPath,
    engine,
    tokens,
    internal: { 'x-wfm-implementation-internal': 'implementation-worker-test-token' },
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

async function startRun(f, tenant = 'alpha', contractRef = 'contract-001') {
  const result = await call(
    f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
    { tenant, contractRef, targetHours: 8 }, f.internal
  );
  assert.ok([200, 201].includes(result.status));
  return result.body;
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
        detail: { checked: true }
      },
      f.internal
    );
    assert.equal(last.status, 200);
  }
  return last.body;
}

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

test('contract activation is trusted-worker only and idempotent', async () => {
  const f = fixture();
  try {
    const denied = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-idempotent' }
    );
    assert.equal(denied.status, 403);

    const first = await startRun(f, 'alpha', 'contract-idempotent');
    const second = await startRun(f, 'alpha', 'contract-idempotent');
    assert.equal(first.runId, second.runId);
    assert.equal(first.targetHours, 8);
    assert.equal(first.operationalReady, false);
  } finally {
    f.close();
  }
});

test('readiness is fail-closed until every required evidence item passes at confidence floor', async () => {
  const f = fixture();
  try {
    const run = await startRun(f);
    const firstRequirement = REQUIREMENTS[0];
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
