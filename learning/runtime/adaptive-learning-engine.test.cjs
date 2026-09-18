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
  createAdaptiveLearningEngine,
  curriculumForRole
} = require('./adaptive-learning-engine.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-learning-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 1, '{}');

  const users = [
    ['employee@alpha', 'alpha', 'e1', 'employee'],
    ['manager@alpha', 'alpha', 'm1', 'manager'],
    ['admin@alpha', 'alpha', 'a1', 'company-admin'],
    ['payroll@alpha', 'alpha', 'p1', 'payroll'],
    ['manager@bravo', 'bravo', 'm2', 'manager']
  ];
  for (const [email, tenant, personId, role] of users) {
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run(email, tenant, personId, role, role === 'employee' ? 0 : 1, 's', '00', '[]');
  }

  const tokens = {
    employee: 'e'.repeat(64),
    manager: 'm'.repeat(64),
    admin: 'a'.repeat(64),
    payroll: 'p'.repeat(64),
    bravo: 'b'.repeat(64)
  };
  const expires = Date.now() + 60_000;
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.employee), 'employee@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.manager), 'manager@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.admin), 'admin@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.payroll), 'payroll@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.bravo), 'manager@bravo', expires);
  db.close();

  const engine = createAdaptiveLearningEngine({
    dbPath,
    internalToken: 'learning-worker-test-token'
  });

  return {
    dir,
    dbPath,
    engine,
    tokens,
    internal: { 'x-wfm-learning-internal': 'learning-worker-test-token' },
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

test('role curriculum protects least privilege while still teaching each role deeply', () => {
  assert.ok(curriculumForRole('employee').includes('time.clock'));
  assert.equal(curriculumForRole('employee').includes('configuration.policy'), false);
  assert.ok(curriculumForRole('manager').includes('team.coach'));
  assert.ok(curriculumForRole('payroll').includes('payroll.reconcile'));
  assert.ok(curriculumForRole('company-admin').includes('configuration.policy'));
  assert.ok(curriculumForRole('company-admin').includes('trainer.teachback'));
});

test('plan is generated automatically for the signed-in role', async () => {
  const f = fixture();
  try {
    const employee = await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    assert.equal(employee.status, 200);
    assert.equal(employee.body.role, 'employee');
    assert.equal(employee.body.progress.total, curriculumForRole('employee').length);
    assert.equal(employee.body.all.some(x => x.competencyKey === 'configuration.policy'), false);

    const admin = await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.role, 'admin');
    assert.equal(admin.body.all.some(x => x.competencyKey === 'configuration.policy'), true);
    assert.equal(admin.body.all.some(x => x.competencyKey === 'trainer.teachback'), true);
  } finally {
    f.close();
  }
});

test('guided practice teaches but cannot alone certify durable competence', async () => {
  const f = fixture();
  try {
    const practice = await call(
      f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/practice',
      { competencyKey: 'time.clock', answer: 0 }
    );
    assert.equal(practice.status, 200);
    assert.equal(practice.body.passed, true);
    assert.equal(practice.body.assignment.score, 55);
    assert.equal(practice.body.assignment.status, 'DUE');

    const observed = await call(
      f.engine, null, 'POST', '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email: 'employee@alpha',
        competencyKey: 'time.clock',
        evidenceType: 'OBSERVED_SUCCESS',
        result: 'PASS',
        detail: { simulation: true }
      },
      f.internal
    );
    assert.equal(observed.status, 200);
    assert.equal(observed.body.assignment.status, 'MASTERED');
    assert.equal(observed.body.assignment.score, 100);
  } finally {
    f.close();
  }
});

test('browser cannot self-certify independent competence', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    const denied = await call(
      f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email: 'employee@alpha',
        competencyKey: 'time.clock',
        evidenceType: 'OBSERVED_SUCCESS',
        result: 'PASS'
      }
    );
    assert.equal(denied.status, 403);
  } finally {
    f.close();
  }
});

test('repeated help use schedules a contextual refresher instead of interrupting every user', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');

    for (let i = 1; i <= 3; i++) {
      const result = await call(
        f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/help',
        { competencyKey: 'time.clock', event: 'OPENED' }
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.refreshScheduled, i >= 3);
    }
  } finally {
    f.close();
  }
});

test('new feature can automatically assign delta learning to only affected roles', async () => {
  const f = fixture();
  try {
    await call(
      f.engine, null, 'POST', '/api/learning/adaptive/bootstrap-tenant',
      { tenant: 'alpha' }, f.internal
    );

    const feature = await call(
      f.engine, null, 'POST', '/api/learning/adaptive/feature-change',
      {
        tenant: 'alpha',
        featureKey: 'new-policy-simulator',
        title: 'Policy impact simulator',
        affectedRoles: ['manager', 'admin'],
        competencies: ['schedule.recover', 'feature.enablement']
      },
      f.internal
    );
    assert.equal(feature.status, 200);
    assert.ok(feature.body.assigned >= 2);

    const employee = await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    assert.equal(employee.body.all.some(x => x.competencyKey === 'feature.enablement'), false);

    const admin = await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    assert.equal(admin.body.all.some(x => x.competencyKey === 'feature.enablement'), true);
  } finally {
    f.close();
  }
});

test('learning summary is tenant isolated and employee cannot view aggregate analytics', async () => {
  const f = fixture();
  try {
    await call(
      f.engine, null, 'POST', '/api/learning/adaptive/bootstrap-tenant',
      { tenant: 'alpha' }, f.internal
    );
    await call(
      f.engine, null, 'POST', '/api/learning/adaptive/bootstrap-tenant',
      { tenant: 'bravo' }, f.internal
    );

    const denied = await call(
      f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/tenant-summary'
    );
    assert.equal(denied.status, 403);

    const alpha = await call(
      f.engine, f.tokens.manager, 'GET', '/api/learning/adaptive/tenant-summary'
    );
    const bravo = await call(
      f.engine, f.tokens.bravo, 'GET', '/api/learning/adaptive/tenant-summary'
    );
    assert.equal(alpha.status, 200);
    assert.equal(bravo.status, 200);
    assert.equal(alpha.body.users, 4);
    assert.equal(bravo.body.users, 1);
  } finally {
    f.close();
  }
});

test('learning event evidence is append only', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    await call(
      f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/help',
      { competencyKey: 'time.clock', event: 'OPENED' }
    );

    const db = new DatabaseSync(f.dbPath);
    assert.throws(
      () => db.exec("UPDATE learning_events SET verb='tampered'"),
      /append only/
    );
    assert.throws(
      () => db.exec('DELETE FROM learning_events'),
      /append only/
    );
    db.close();
  } finally {
    f.close();
  }
});
