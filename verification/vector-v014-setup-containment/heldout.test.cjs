'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
// Test-only selector: image admission uses the modules already copied into /app.
// Without it, ordinary checkout runs retain the original source-tree targets.
const installedRoot = process.env.VECTOR_IMAGE_ADMISSION_ROOT;
const implementationRoot = installedRoot
  ? path.join(installedRoot, 'implementation-runtime')
  : path.resolve(__dirname, '../../implementation/runtime');
const integrationRoot = installedRoot
  ? path.join(installedRoot, 'integration-runtime')
  : path.resolve(__dirname, '../../integration/runtime');
const { createCustomerWorkspaceRegistry } = require(path.join(implementationRoot, 'customer-workspace.cjs'));
const { createSetupOnlyPolicy } = require(path.join(implementationRoot, 'setup-only-policy.cjs'));
const { createAutonomousIntegrationHub } = require(path.join(integrationRoot, 'autonomous-integration-hub.cjs'));

const sha = value => createHash('sha256').update(String(value)).digest('hex');
const prefix = '/api/integrations/autonomous';
const workerHeader = { 'x-wfm-integration-internal': 'synthetic-integration-worker' };

async function call(hub, token, suffix, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = 'POST';
  req.url = prefix + suffix;
  req.headers = { ...(token ? { cookie: 'wfm_session=' + token } : {}), ...headers };
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader() {},
    end(value = '') { this.body = String(value); this.headersSent = true; this.writableEnded = true; }
  };
  assert.equal(await hub.handleRequest(req, res), true);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

test('setup-only workspace cannot reach worker people sync or persist operational people', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-v014-'));
  const dbPath = path.join(dir, 'tenant.sqlite');
  const managerToken = 'm'.repeat(64);
  let hub;
  t.after(() => { hub?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);
    CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT,contract_ref_hash TEXT);
    INSERT INTO tenants VALUES('alpha',1,'{}');
    INSERT INTO users VALUES('manager@alpha','alpha','m1','manager',1,'s','00','[]');`);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(managerToken), 'manager@alpha', Date.now() + 60000);
  const registry = createCustomerWorkspaceRegistry({ db, createInitialWorkspace(binding) {
    db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run('run-alpha', binding.tenant, sha(binding.contractRef));
    return { initialSetupRunId: 'run-alpha' };
  } });
  registry.accept({ verified: true, ownerAuthorized: true, customerId: 'synthetic-customer',
    customerAuthorityRef: 'fixture/customer', tenant: 'alpha', provider: 'verified-provider',
    eventId: 'initial-event', contractRef: 'initial-contract', relationship: 'initial',
    ownerEmail: 'owner@alpha.test', ownerAuthorityRef: 'fixture/owner' });
  const policy = createSetupOnlyPolicy({ db });
  assert.equal(policy.forTenant('alpha').mode, 'SETUP_ONLY');
  assert.throws(() => policy.assertAllowed({ tenant: 'alpha', purpose: 'OPERATIONAL_READ' }),
    error => error.code === 'SETUP_ONLY_REQUIRED' && error.statusCode === 403);
  db.close();

  hub = createAutonomousIntegrationHub({ dbPath, internalToken: workerHeader['x-wfm-integration-internal'] });
  let syncStatus = 403;
  async function deniedOrContinue(suffix, token, body, headers) {
    const response = await call(hub, token, suffix, body, headers);
    if (response.status === 403) return null;
    assert.equal(response.status, 200, `${suffix} failed for an unrelated reason`);
    return response.body;
  }

  const discovery = await deniedOrContinue('/discover', managerToken, { source: 'ENTRA',
    apps: [{ appId: 'w-1', displayName: 'Workday Production' }] });
  if (discovery) {
    const candidateId = discovery.candidates.find(candidate => candidate.productKey === 'workday')?.id;
    assert.ok(candidateId);
    const confirmed = await deniedOrContinue('/confirm', managerToken,
      { candidateId, authoritativeFor: ['people'] });
    if (confirmed) {
      const connected = await deniedOrContinue('/connect', managerToken,
        { candidateId, authMethod: 'oauth2', sourceInstanceId: 'synthetic-workday' });
      if (connected) {
        const connectionId = connected.connection.id;
        const authorized = await deniedOrContinue('/authorize-complete', null,
          { connectionId, authorizationRef: 'vault://synthetic/alpha', grantedScopes: ['people.read'] }, workerHeader);
        if (authorized) {
          const preview = await deniedOrContinue('/mapping-preview', managerToken,
            { connectionId, sourceFields: ['employee_number', 'first_name', 'last_name', 'email', 'department', 'location'] });
          if (preview) {
            const mappings = preview.suggestions.map(item => ({ sourceField: item.sourceField,
              canonicalField: item.canonicalField, confidence: item.confidence }));
            const activated = await deniedOrContinue('/mapping-activate', managerToken, { connectionId, mappings });
            if (activated) {
              const synced = await call(hub, null, '/sync-validate', { tenant: 'alpha', connectionId,
                records: [{ employee_number: 'E-100', first_name: 'A', last_name: 'One',
                  email: 'a@example.test', department: 'Assembly', location: 'Plant 1' }] }, workerHeader);
              syncStatus = synced.status;
            }
          }
        }
      }
    }
  }
  const check = new DatabaseSync(dbPath);
  t.after(() => check.close());
  const peopleRows = check.prepare('SELECT COUNT(*) AS n FROM integration_canonical_people WHERE tenant=?').get('alpha').n;
  assert.deepEqual({ syncStatus, peopleRows }, { syncStatus: 403, peopleRows: 0 },
    'setup-only tenant reached operational people import');
});
