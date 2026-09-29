'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createOneDayEnterpriseEngine } = require('./one-day-enterprise-engine.cjs');

function response() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader() {},
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    }
  };
}

async function submit(engine, body, token = 'strict-worker') {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = '/api/implementation/autonomous/evidence';
  req.headers = { 'x-wfm-implementation-internal': token };
  const res = response();
  const handled = await engine.handleRequest(req, res);
  assert.equal(handled, true);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-strict-evidence-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  db.close();

  const engine = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'strict-worker',
    strictEvidence: true,
    requireCandidateBinding: true,
    candidateSha: 'a'.repeat(40),
    deploymentId: 'deployment-current'
  });

  const seed = new DatabaseSync(dbPath);
  const now = Date.now();
  seed.prepare(
    'INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run('run-1', 'alpha', 'contract-hash', 'BUILDING', now, now + 8 * 60 * 60 * 1000, 8, new Date(now).toISOString(), new Date(now).toISOString());
  seed.close();

  return {
    engine,
    close() {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('strict wrapper preserves worker authentication before exposing contract errors', async () => {
  const f = fixture();
  try {
    const result = await submit(f.engine, {
      runId: 'run-1', kind: 'tenant-environment', status: 'PASS', confidence: 1,
      detail: { checked: true }
    }, 'wrong-token');
    assert.equal(result.status, 403);
    assert.match(result.body.error, /Trusted implementation worker/);
  } finally {
    f.close();
  }
});

test('strict wrapper rejects weak readiness evidence before it reaches the core engine', async () => {
  const f = fixture();
  try {
    const weakEnvironment = await submit(f.engine, {
      runId: 'run-1', kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'worker', detail: { checked: true }
    });
    assert.equal(weakEnvironment.status, 409);
    assert.equal(weakEnvironment.body.readinessEvidenceAccepted, false);

    const fixtureProvider = await submit(f.engine, {
      runId: 'run-1', kind: 'source-systems', status: 'PASS', confidence: 1,
      source: 'worker', detail: {
        fixtureOnly: true, zeroHuman: true, humanInterventions: 0,
        discoveryCompleted: true, authorizationVerified: true,
        providers: [{ provider: 'Fixture ERP', discovered: true, authorized: true, connected: true, mode: 'fixture' }]
      }
    });
    assert.equal(fixtureProvider.status, 409);
  } finally {
    f.close();
  }
});

test('strict wrapper admits structured zero-human cloud environment evidence and delegates to core', async () => {
  const f = fixture();
  try {
    const result = await submit(f.engine, {
      runId: 'run-1', kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'hosted-proof', detail: {
        fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
        provisioned: true, tenantExists: true, environmentId: 'railway/tenant-alpha',
        provisioningMode: 'cloud-runtime', runtimeHealthPassed: true, healthcheckPassed: true,
        tenantIsolationVerified: true, crossTenantNegativeTests: 1, durableStateVerified: true,
        exactCandidateSha: 'a'.repeat(40), exactTargetDeploymentId: 'deployment-current',
        tenant: 'alpha', implementationRunId: 'run-1', verifierRunId: 'verifier-wrapper-1',
        proofRunnerIdentity: 'unit-test-runner',
        targetDeploymentCreatedAt: new Date(Date.now() - 60000).toISOString(),
        evidenceGeneratedAt: new Date().toISOString()
      }
    });
    assert.equal(result.status, 200);
    const environment = result.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(environment.status, 'PASS');
    assert.equal(environment.satisfied, true);
  } finally {
    f.close();
  }
});
