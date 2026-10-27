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


test('malformed practice answers cannot earn credit or create evidence', async () => {
  const invalid = [null, '', '0', false, true, [], [0], {}, -1, 3, 0.5, undefined];
  for (const answer of invalid) {
    const f = fixture();
    try {
      const result = await call(f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/practice',
        { competencyKey: 'time.clock', answer });
      assert.equal(result.status, 400, 'reject malformed answer ' + JSON.stringify(answer));
      const state = new DatabaseSync(f.dbPath);
      try { assert.equal(state.prepare('SELECT COUNT(*) AS n FROM learning_evidence').get().n, 0); }
      finally { state.close(); }
      const plan = await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
      assert.equal(plan.body.all.find(x => x.competencyKey === 'time.clock').score, 0);
    } finally { f.close(); }
  }
});

test('guidance and retrieval cannot certify without independently observed task success', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/practice',
      { competencyKey: 'time.clock', answer: 0 });
    const result = await call(f.engine, null, 'POST', '/api/learning/adaptive/evidence', {
      tenant: 'alpha', email: 'employee@alpha', competencyKey: 'time.clock',
      evidenceType: 'RETRIEVAL_CHECK', result: 'PASS'
    }, f.internal);
    assert.equal(result.body.assignment.score, 85);
    assert.equal(result.body.assignment.status, 'DUE');
    const observed = await call(f.engine, null, 'POST', '/api/learning/adaptive/evidence', {
      tenant: 'alpha', email: 'employee@alpha', competencyKey: 'time.clock',
      evidenceType: 'INDEPENDENT_TASK', result: 'PASS',
      detail: { sourceClass: 'synthetic-test', taskId: 'test-clock-correction' }
    }, f.internal);
    assert.equal(observed.body.assignment.status, 'MASTERED');
  } finally { f.close(); }
});

test('legacy practice without a validated answer is retained but cannot contribute credit', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    const state = new DatabaseSync(f.dbPath);
    try {
      const assignment = state.prepare("SELECT id FROM learning_assignments WHERE email='employee@alpha' AND competency_key='time.clock'").get();
      state.prepare('INSERT INTO learning_evidence(assignment_id,tenant,email,evidence_type,result,score_value,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(assignment.id, 'alpha', 'employee@alpha', 'GUIDED_PRACTICE', 'PASS', 55, JSON.stringify({scenario:'time.clock'}), new Date().toISOString());
    } finally { state.close(); }
    const result = await call(f.engine, f.tokens.employee, 'GET', '/api/learning/adaptive/plan');
    assert.equal(result.body.all.find(x => x.competencyKey === 'time.clock').score, 0);
    const retained = new DatabaseSync(f.dbPath);
    try { assert.equal(retained.prepare('SELECT COUNT(*) AS n FROM learning_evidence').get().n, 1); }
    finally { retained.close(); }
    const corrected = await call(f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/practice',
      { competencyKey:'time.clock', answer:0 });
    assert.equal(corrected.body.assignment.score,55);
    assert.equal(corrected.body.assignment.status,'DUE');
  } finally { f.close(); }
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

test('coach and trainer competencies require explicit teach-back evidence', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.manager, 'GET', '/api/learning/adaptive/plan');

    const observed = await call(
      f.engine, null, 'POST', '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email: 'manager@alpha',
        competencyKey: 'team.coach',
        evidenceType: 'OBSERVED_SUCCESS',
        result: 'PASS'
      },
      f.internal
    );
    assert.equal(observed.status, 200);
    assert.equal(observed.body.assignment.status, 'DUE');

    const retrieval = await call(
      f.engine, null, 'POST', '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email: 'manager@alpha',
        competencyKey: 'team.coach',
        evidenceType: 'RETRIEVAL_CHECK',
        result: 'PASS'
      },
      f.internal
    );
    assert.equal(retrieval.status, 200);
    assert.equal(retrieval.body.assignment.score, 90);
    assert.equal(retrieval.body.assignment.status, 'DUE');

    const teachBack = await call(
      f.engine, null, 'POST', '/api/learning/adaptive/evidence',
      {
        tenant: 'alpha',
        email: 'manager@alpha',
        competencyKey: 'team.coach',
        evidenceType: 'TEACH_BACK',
        result: 'PASS',
        detail: { simulatedLearner: true }
      },
      f.internal
    );
    assert.equal(teachBack.status, 200);
    assert.equal(teachBack.body.assignment.status, 'MASTERED');
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


test('director receives privileged curriculum after earlier employee assignments', async () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    db.prepare("UPDATE users SET role='employee' WHERE email='admin@alpha'").run();
    await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    db.prepare("UPDATE users SET role='director' WHERE email='admin@alpha'").run();
    const plan = await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    assert.equal(plan.body.role, 'admin');
    assert.equal(plan.body.all.some(x => x.competencyKey === 'configuration.roles'), true);
    assert.equal(plan.body.all.some(x => x.competencyKey === 'profile.manage'), false);
    const assigned = db.prepare("SELECT role FROM learning_assignments WHERE email='admin@alpha' AND competency_key='time.clock'").get();
    assert.equal(assigned.role, 'admin');
    const summary = await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/tenant-summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.body.privilegedReady, false);
    db.close();
  } finally { f.close(); }
});

test('role demotion hides retired privileged assignments and rejects their practice and help', async () => {
  const f = fixture();
  try {
    await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    const db = new DatabaseSync(f.dbPath);
    db.prepare("UPDATE users SET role='employee' WHERE email='admin@alpha'").run();
    const plan = await call(f.engine, f.tokens.admin, 'GET', '/api/learning/adaptive/plan');
    assert.equal(plan.body.all.some(x => x.competencyKey === 'configuration.policy'), false);
    const practice = await call(f.engine, f.tokens.admin, 'POST', '/api/learning/adaptive/practice', {competencyKey:'configuration.policy',answer:0});
    assert.equal(practice.status,403);
    const help = await call(f.engine,f.tokens.admin,'POST','/api/learning/adaptive/help',{competencyKey:'configuration.policy',event:'OPENED'});
    assert.equal(help.status,403);
    const evidence = await call(f.engine,null,'POST','/api/learning/adaptive/evidence',{tenant:'alpha',email:'admin@alpha',competencyKey:'configuration.policy',evidenceType:'OBSERVED_SUCCESS',result:'PASS'},f.internal);
    assert.equal(evidence.status,409);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM learning_assignments WHERE email='admin@alpha' AND role='admin'").get().n>0, 'retired assignments retained for audit');
    db.close();
  } finally { f.close(); }
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

test('training-first read reconciles director role and reopens stale unsupported mastery', () => {
  const f=fixture();
  const {createTrainingTwin}=require('./training-twin.cjs');
  const db=new DatabaseSync(f.dbPath);
  let twin;
  try {
    f.engine.planForUser({tenant:'alpha',email:'admin@alpha',role:'employee'});
    const row=db.prepare('SELECT * FROM learning_assignments WHERE email=? AND competency_key=?').get('admin@alpha','time.clock');
    db.prepare('UPDATE learning_assignments SET status=?,score=?,due_at_ms=?,mastered_at_ms=? WHERE id=?').run('MASTERED',85,Date.now()+86400000,Date.now(),row.id);
    db.prepare('INSERT INTO learning_evidence(assignment_id,tenant,email,evidence_type,result,score_value,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(row.id,'alpha','admin@alpha','GUIDED_PRACTICE','PASS',55,'{}',new Date().toISOString());
    db.prepare('UPDATE users SET role=? WHERE email=?').run('director','admin@alpha');
    twin=createTrainingTwin({dbPath:f.dbPath});
    const profile=twin.profileForUser({tenant:'alpha',email:'admin@alpha',role:'director'});
    assert.equal(profile.role,'admin');
    assert.ok(profile.competencies.some(x=>x.competencyKey==='configuration.roles'));
    assert.equal(profile.competencies.some(x=>x.competencyKey==='profile.manage'),false);
    const clock=profile.competencies.find(x=>x.competencyKey==='time.clock');
    assert.equal(clock.status,'DUE');assert.equal(clock.score,0);assert.notEqual(clock.recommendedMode,'NONE');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM learning_evidence WHERE assignment_id=?').get(row.id).n,1);
  } finally { twin?.close();db.close();f.close(); }
});

test('feature assignments survive only while their recorded feature authorizes the current role', async () => {
 const f=fixture(),db=new DatabaseSync(f.dbPath);
 try {
  await call(f.engine,null,'POST','/api/learning/adaptive/feature-change',{tenant:'alpha',featureKey:'delta',title:'Delta',affectedRoles:['manager'],competencies:['feature.enablement']},f.internal);
  let plan=f.engine.planForUser({tenant:'alpha',email:'manager@alpha',role:'manager'});
  assert.ok(plan.all.some(x=>x.competencyKey==='feature.enablement'));
  db.prepare('UPDATE users SET role=? WHERE email=?').run('employee','manager@alpha');
  plan=f.engine.planForUser({tenant:'alpha',email:'manager@alpha',role:'employee'});
  assert.equal(plan.all.some(x=>x.competencyKey==='feature.enablement'),false);
  assert.ok(db.prepare('SELECT id FROM learning_assignments WHERE email=? AND competency_key=?').get('manager@alpha','feature.enablement'));
 } finally {db.close();f.close();}
});

test('training reads preserve an explicit refresh until fresh independent success', async()=>{
 const f=fixture(); const {createTrainingTwin}=require('./training-twin.cjs'); let twin;
 try {
  await call(f.engine,f.tokens.employee,'POST','/api/learning/adaptive/practice',{competencyKey:'time.clock',answer:0});
  const body={tenant:'alpha',email:'employee@alpha',competencyKey:'time.clock',evidenceType:'INDEPENDENT_TASK',result:'PASS'};
  await call(f.engine,null,'POST','/api/learning/adaptive/evidence',body,f.internal);
  for(let n=0;n<3;n++) await call(f.engine,f.tokens.employee,'POST','/api/learning/adaptive/help',{competencyKey:'time.clock',event:'OPENED'});
  twin=createTrainingTwin({dbPath:f.dbPath});
  let item=twin.profileForUser({tenant:'alpha',email:'employee@alpha',role:'employee'}).competencies.find(x=>x.competencyKey==='time.clock');
  assert.equal(item.status,'REFRESH_DUE');assert.ok(Date.parse(item.dueAt)<=Date.now());
  await call(f.engine,f.tokens.employee,'POST','/api/learning/adaptive/practice',{competencyKey:'time.clock',answer:0});
  item=twin.profileForUser({tenant:'alpha',email:'employee@alpha',role:'employee'}).competencies.find(x=>x.competencyKey==='time.clock');
  assert.equal(item.status,'REFRESH_DUE');
  const renewed=await call(f.engine,null,'POST','/api/learning/adaptive/evidence',body,f.internal);
  assert.equal(renewed.body.assignment.status,'MASTERED');
  assert.ok(Date.parse(renewed.body.assignment.dueAt)>Date.now());
 } finally {twin?.close();f.close();}
});

test('expired mastery leaves readiness totals until fresh independent success', async () => {
  const f = fixture(), db = new DatabaseSync(f.dbPath);
  try {
    const user = { tenant: 'alpha', email: 'employee@alpha', role: 'employee' };
    const other = { tenant: 'bravo', email: 'manager@bravo', role: 'manager' };
    await call(f.engine, f.tokens.employee, 'POST', '/api/learning/adaptive/practice',
      { competencyKey: 'time.clock', answer: 0 });
    const evidence = { tenant: user.tenant, email: user.email, competencyKey: 'time.clock',
      evidenceType: 'INDEPENDENT_TASK', result: 'PASS' };
    const earned = await call(f.engine, null, 'POST', '/api/learning/adaptive/evidence', evidence, f.internal);
    assert.equal(earned.body.assignment.status, 'MASTERED');
    const before = f.engine.summaryForTenant(user.tenant);
    const otherBefore = f.engine.summaryForTenant(other.tenant);
    const assignment = db.prepare('SELECT id,mastered_at_ms FROM learning_assignments WHERE tenant=? AND email=? AND competency_key=?')
      .get(user.tenant, user.email, 'time.clock');
    db.prepare('UPDATE learning_assignments SET due_at_ms=? WHERE id=?').run(Date.now() - 1000, assignment.id);

    const expired = f.engine.summaryForTenant(user.tenant);
    assert.equal(expired.mastered, before.mastered - 1);
    assert.equal(expired.criticalMastered, before.criticalMastered - 1);
    assert.equal(expired.fullyCertified, false);
    const plan = f.engine.planForUser(user);
    const clock = plan.all.find(item => item.competencyKey === 'time.clock');
    assert.equal(clock.status, 'REFRESH_DUE');
    assert.equal(plan.progress.mastered, 0);
    assert.ok(plan.next.some(item => item.competencyKey === 'time.clock'));
    assert.equal(db.prepare('SELECT mastered_at_ms FROM learning_assignments WHERE id=?').get(assignment.id).mastered_at_ms,
      assignment.mastered_at_ms);
    assert.deepEqual(f.engine.summaryForTenant(other.tenant), otherBefore);

    const renewed = await call(f.engine, null, 'POST', '/api/learning/adaptive/evidence', evidence, f.internal);
    assert.equal(renewed.body.assignment.status, 'MASTERED');
    assert.ok(Date.parse(renewed.body.assignment.dueAt) > Date.now());
    assert.equal(f.engine.summaryForTenant(user.tenant).mastered, before.mastered);
  } finally { db.close(); f.close(); }
});
