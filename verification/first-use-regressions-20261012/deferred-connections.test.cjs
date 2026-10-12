'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.resolve(process.env.WFM_EXACT_SOURCE_ROOT || repositoryRoot);
const archive = path.join(repositoryRoot, 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz');
const archiveSha256 = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const candidateSha = '4fde7520b4a1d71cff6262ca6425451b7264d22e';
const deploymentId = 'test-only-pr304-deferred-connections';
const internalToken = 'test-only-implementation-worker-token';
const managerToken = 'm'.repeat(64);

const engineModule = path.join(sourceRoot, 'implementation', 'runtime', 'one-day-enterprise-engine.cjs');
const {createOneDayEnterpriseEngine} = require(engineModule);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
    ...(token ? {cookie: 'wfm_session=' + token} : {}),
    ...extraHeaders
  };
  const res = response();
  assert.equal(await engine.handleRequest(req, res), true);
  return {status: res.statusCode, body: res.body ? JSON.parse(res.body) : null};
}

function loadSealedCompiler(t) {
  assert.equal(sha256(fs.readFileSync(archive)), archiveSha256, 'sealed runtime archive changed');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deferred-connections-compiler-'));
  const extracted = spawnSync('tar', [
    '-xzf', archive, '-C', directory,
    'lib/configuration-compiler.cjs', 'lib/autonomy-safety-kernel.cjs'
  ], {encoding: 'utf8'});
  assert.equal(extracted.status, 0, extracted.stderr);
  const compilerPath = path.join(directory, 'lib', 'configuration-compiler.cjs');
  const patched = spawnSync(process.execPath, [
    path.join(sourceRoot, 'scripts', 'patch-workspace-compiler.mjs'), compilerPath
  ], {encoding: 'utf8'});
  assert.equal(patched.status, 0, patched.stderr);
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return require(compilerPath);
}

function nowAnswers() {
  return {
    organisation: {
      name: 'Example Works',
      countries: ['UK'],
      sites: [{code: 'AA', name: 'Factory', timezone: 'Europe/London'}]
    },
    workforce: {count: 1, languages: ['en'], shiftPatterns: 1},
    capabilities: {modules: ['core', 'scheduling', 'integrations'], trainingRoles: ['employee', 'manager']},
    connections: {
      timing: 'now',
      systems: [{provider: 'Example HR', mode: 'api', objectTypes: ['people']}]
    }
  };
}

function laterAnswers() {
  const value = nowAnswers();
  value.connections = {timing: 'later', systems: []};
  return value;
}

function legacyScope() {
  return {
    companyName: 'Example Works',
    countries: ['UK'],
    sites: ['Factory'],
    employeeCount: 1,
    sourceSystems: ['Legacy HCM'],
    features: ['Scheduling', 'Integrations'],
    workPatterns: ['Day shift'],
    clockingMethods: ['Badge'],
    payrollSystem: 'Legacy Payroll',
    hcmSystem: 'Legacy HCM',
    erpSystem: 'Legacy ERP',
    priorities: 'Preserve customer history while setup is amended.'
  };
}

function seedCanonicalSource(db) {
  db.exec(
    'CREATE TABLE integration_candidates(id TEXT,tenant TEXT,display_name TEXT,status TEXT,authoritative_for_json TEXT);' +
    'CREATE TABLE integration_connections(id TEXT,tenant TEXT,candidate_id TEXT,product_key TEXT,state TEXT,granted_scopes_json TEXT,credential_ref TEXT,mapping_version INTEGER);' +
    'CREATE TABLE integration_canonical_batches(id TEXT,tenant TEXT,connection_id TEXT,status TEXT,record_count INTEGER,mapping_version INTEGER,batch_checksum TEXT,created_at TEXT);' +
    'CREATE TABLE integration_canonical_people(batch_id TEXT,tenant TEXT,employee_key TEXT,record_checksum TEXT,canonical_json TEXT);'
  );
  db.prepare('INSERT INTO integration_candidates VALUES(?,?,?,?,?)')
    .run('candidate-example-hr', 'alpha', 'Example HR', 'CONFIRMED', JSON.stringify(['people']));
  db.prepare('INSERT INTO integration_connections VALUES(?,?,?,?,?,?,?,?)')
    .run('connection-example-hr', 'alpha', 'candidate-example-hr', 'example-hr', 'ACTIVE', JSON.stringify(['people.read']), 'credential-ref-existing', 1);
  db.prepare('INSERT INTO integration_canonical_batches VALUES(?,?,?,?,?,?,?,?)')
    .run('batch-example-hr', 'alpha', 'connection-example-hr', 'PASS', 1, 1, 'b'.repeat(64), new Date().toISOString());
  db.prepare('INSERT INTO integration_canonical_people VALUES(?,?,?,?,?)')
    .run('batch-example-hr', 'alpha', 'employee-1', 'c'.repeat(64), JSON.stringify({location: 'Factory', department: 'Operations'}));
}

function readState(db, engine) {
  const scopeRow = db.prepare('SELECT * FROM implementation_scope').get();
  const environmentRow = db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get('alpha');
  const evidenceRows = db.prepare("SELECT * FROM implementation_evidence WHERE kind='source-systems' ORDER BY id").all();
  const connectionRows = db.prepare('SELECT * FROM integration_connections ORDER BY id').all();
  const peopleRows = db.prepare('SELECT * FROM integration_canonical_people ORDER BY employee_key').all();
  const readiness = engine.statusForTenant('alpha');
  return {
    scope: JSON.parse(scopeRow.scope_json),
    environment: {...environmentRow, configuration: JSON.parse(environmentRow.configuration_json)},
    evidenceRows,
    connectionRows,
    peopleRows,
    readiness,
    sourceRequirement: readiness.requirements.find(item => item.key === 'source-systems'),
    configurationRequirement: readiness.requirements.find(item => item.key === 'configuration-scope'),
    sourceProofEpoch: readiness.proofEpochs['source-systems'],
    scopeEventCount: db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event IN ('CUSTOMER_SCOPE_SUBMITTED','CUSTOMER_SCOPE_UPDATED')").get().count,
    environmentEventCount: db.prepare('SELECT COUNT(*) AS count FROM tenant_environment_events').get().count,
    setupEventCount: db.prepare('SELECT COUNT(*) AS count FROM workspace_setup_events').get().count
  };
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deferred-connections-engine-'));
  const dbPath = path.join(directory, 'state.sqlite');
  const seed = new DatabaseSync(dbPath);
  seed.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);' +
    "CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');" +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  seed.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  seed.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
    .run('manager@alpha', 'alpha', 'manager-1', 'manager', 1, 'fixture-disabled', '00', JSON.stringify(['company.configure']));
  seed.prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run(sha256(managerToken), 'manager@alpha', Date.now() + 60_000);
  seed.close();

  const engine = createOneDayEnterpriseEngine({
    configurationCompiler: loadSealedCompiler(t),
    dbPath,
    agentsApiEnabled: false,
    internalToken,
    contractWebhookSecret: 'test-only-contract-webhook-token',
    invitationRecoverySecret: 'test-only-invitation-recovery-token',
    publicOrigin: 'https://implementation.test',
    candidateSha,
    deploymentId,
    requireCandidateBinding: true,
    notificationRetryPollMs: 0,
    sendInvitation: async () => ({provider: 'test-only-mailer', messageId: 'message-1'})
  });
  let db;
  t.after(() => {
    db?.close();
    engine.close();
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const started = await call(engine, null, 'POST', '/api/implementation/autonomous/contract-activated', {
    tenant: 'alpha', contractRef: 'setup-contract', recipientEmail: 'manager@alpha'
  }, {'x-wfm-implementation-internal': internalToken});
  assert.ok([200, 201].includes(started.status), JSON.stringify(started.body));

  const scoped = await call(engine, managerToken, 'POST', '/api/implementation/autonomous/scope', legacyScope());
  assert.ok([200, 201].includes(scoped.status), JSON.stringify(scoped.body));

  const route = '/api/implementation/autonomous/setup';
  const first = await call(engine, managerToken, 'POST', route, {expectedRevision: 0, answers: nowAnswers()});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const applied = await call(engine, managerToken, 'POST', route + '/apply', {
    expectedRevision: first.body.revision,
    reviewToken: first.body.reviewToken
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));

  db = new DatabaseSync(dbPath);
  seedCanonicalSource(db);
  const runId = db.prepare('SELECT id FROM implementation_runs WHERE tenant=?').get('alpha').id;
  const evidence = await call(engine, null, 'POST', '/api/implementation/autonomous/evidence', {
    runId,
    kind: 'source-systems',
    status: 'PASS',
    confidence: 1,
    source: 'test-only-existing-authorised-source',
    detail: {
      exactCandidateSha: candidateSha,
      exactTargetDeploymentId: deploymentId,
      tenant: 'alpha',
      runId,
      fixtureOnly: false,
      zeroHuman: true,
      humanInterventions: 0,
      discoveryCompleted: true,
      authorizationVerified: true,
      providers: [{provider: 'Example HR', discovered: true, authorized: true, connected: true, mode: 'sandbox'}]
    }
  }, {'x-wfm-implementation-internal': internalToken});
  assert.equal(evidence.status, 200, JSON.stringify(evidence.body));

  return {db, engine, route, first};
}

function diagnostic(before, draft, after) {
  const beforeEvidence = JSON.parse(before.evidenceRows.at(-1).detail_json);
  const afterEvidence = JSON.parse(after.evidenceRows.at(-1).detail_json);
  return {
    savedQuestionnaire: draft.answers.connections,
    savedScope: after.scope,
    savedEnvironment: after.environment.configuration,
    scopeSummary: {
      beforeSourceSystems: before.scope.sourceSystems,
      afterSourceSystems: after.scope.sourceSystems,
      legacySelectorsAfter: {
        payrollSystem: after.scope.payrollSystem,
        hcmSystem: after.scope.hcmSystem,
        erpSystem: after.scope.erpSystem
      }
    },
    environmentSummary: {
      beforeSourceSystems: before.environment.configuration.sourceSystems,
      afterSourceSystems: after.environment.configuration.sourceSystems
    },
    readiness: {
      sourceSystems: after.sourceRequirement.status,
      configuredSystemCount: after.configurationRequirement.detail.systemCount,
      proofEpochBefore: before.sourceProofEpoch,
      proofEpochAfter: after.sourceProofEpoch
    },
    evidenceBinding: {
      storedBefore: beforeEvidence._proofEpoch,
      storedAfter: afterEvidence._proofEpoch,
      currentAfter: after.sourceProofEpoch
    }
  };
}

test('now to later clears active integration claims without deleting authorised history or inventing disconnect authority', async t => {
  const f = await fixture(t);
  const before = readState(f.db, f.engine);
  const saved = await call(f.engine, managerToken, 'POST', f.route, {
    expectedRevision: f.first.body.revision,
    answers: laterAnswers()
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const duringDraft = readState(f.db, f.engine);
  assert.deepEqual(duringDraft.scope, before.scope, 'saving a draft must not change applied scope');
  assert.deepEqual(duringDraft.environment, before.environment, 'saving a draft must not change the environment');

  const applied = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: saved.body.revision,
    reviewToken: saved.body.reviewToken
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const after = readState(f.db, f.engine);

  assert.deepEqual(after.connectionRows, before.connectionRows, 'scope deferral must not fabricate provider disconnect authority');
  assert.deepEqual(after.peopleRows, before.peopleRows, 'canonical customer data must remain intact');
  assert.deepEqual(after.evidenceRows, before.evidenceRows, 'historical evidence must remain append-only and unchanged');
  assert.deepEqual(after.sourceProofEpoch, before.sourceProofEpoch, 'source-system evidence remains workforce-bound');
  assert.equal(after.connectionRows[0].state, 'ACTIVE');
  assert.equal(after.sourceRequirement.status, 'PASS');
  for (const field of ['payrollSystem', 'hcmSystem', 'erpSystem']) {
    assert.equal(after.scope[field], '', 'deferred selectors must not claim an active system');
    assert.equal(after.environment.configuration[field], '', 'environment must reflect deferred active claims');
  }
  t.diagnostic(JSON.stringify(diagnostic(before, saved.body, after), null, 2));

  assert.deepEqual({
    questionnaireTiming: saved.body.answers.connections.timing,
    requestedSystems: saved.body.answers.connections.systems,
    appliedScopeSystems: after.scope.sourceSystems,
    environmentSystems: after.environment.configuration.sourceSystems,
    readinessConfiguredSystemCount: after.configurationRequirement.detail.systemCount
  }, {
    questionnaireTiming: 'later',
    requestedSystems: [],
    appliedScopeSystems: [],
    environmentSystems: [],
    readinessConfiguredSystemCount: 0
  });
});

test('stale amendment cannot apply and repeated reviewed deferral is idempotent', async t => {
  const f = await fixture(t);
  const before = readState(f.db, f.engine);
  const saved = await call(f.engine, managerToken, 'POST', f.route, {
    expectedRevision: f.first.body.revision,
    answers: laterAnswers()
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const stale = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: f.first.body.revision,
    reviewToken: f.first.body.reviewToken
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(readState(f.db, f.engine).scope, before.scope);

  const applied = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: saved.body.revision,
    reviewToken: saved.body.reviewToken
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const once = readState(f.db, f.engine);
  const replay = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: saved.body.revision,
    reviewToken: saved.body.reviewToken
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  const twice = readState(f.db, f.engine);
  assert.equal(twice.scopeEventCount, once.scopeEventCount);
  assert.equal(twice.environmentEventCount, once.environmentEventCount);
  assert.equal(twice.setupEventCount, once.setupEventCount);
  assert.deepEqual(twice.scope.sourceSystems, []);
  assert.deepEqual(twice.environment.configuration.sourceSystems, []);
});

test('failed deferred amendment rolls back scope, environment, draft application and evidence together', async t => {
  const f = await fixture(t);
  const saved = await call(f.engine, managerToken, 'POST', f.route, {
    expectedRevision: f.first.body.revision,
    answers: laterAnswers()
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const before = readState(f.db, f.engine);
  f.db.exec("CREATE TRIGGER refuse_deferred_amendment BEFORE INSERT ON tenant_environment_events WHEN NEW.event='ENVIRONMENT_RECONFIGURED' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");

  const failed = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: saved.body.revision,
    reviewToken: saved.body.reviewToken
  });
  assert.equal(failed.status, 500);
  const rolledBack = readState(f.db, f.engine);
  assert.deepEqual(rolledBack.scope, before.scope);
  assert.deepEqual(rolledBack.environment, before.environment);
  assert.deepEqual(rolledBack.evidenceRows, before.evidenceRows);
  assert.deepEqual(rolledBack.connectionRows, before.connectionRows);
  assert.deepEqual(rolledBack.peopleRows, before.peopleRows);
  const currentDraft = await call(f.engine, managerToken, 'GET', f.route);
  assert.equal(currentDraft.body.status, 'DRAFT');
  assert.equal(currentDraft.body.revision, saved.body.revision);

  f.db.exec('DROP TRIGGER refuse_deferred_amendment');
  const retried = await call(f.engine, managerToken, 'POST', f.route + '/apply', {
    expectedRevision: saved.body.revision,
    reviewToken: saved.body.reviewToken
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  const after = readState(f.db, f.engine);
  assert.deepEqual(after.scope.sourceSystems, []);
  assert.deepEqual(after.environment.configuration.sourceSystems, []);
});
