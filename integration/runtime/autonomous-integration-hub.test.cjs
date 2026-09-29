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
  createAutonomousIntegrationHub,
  mappingSuggestions,
  detectProduct,
  validCredentialReference
} = require('./autonomous-integration-hub.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-integration-hub-'));
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

  const hub = createAutonomousIntegrationHub({ dbPath, internalToken: 'integration-worker-test-token' });
  return {
    dir,
    dbPath,
    hub,
    tokens,
    close() {
      hub.close();
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

async function call(hub, token, method, url, body, extraHeaders = {}) {
  const payload = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...extraHeaders
  };
  const res = response();
  const handled = await hub.handleRequest(req, res);
  assert.equal(handled, true);
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
    headers: res.headers
  };
}

async function configuredConnection(f) {
  const discovery = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discover', {
    source: 'ENTRA',
    apps: [
      { appId: 'w-1', displayName: 'Workday Production' },
      { appId: 'n-1', displayName: 'Oracle NetSuite' },
      { appId: 's-1', displayName: 'SAP S/4HANA' }
    ]
  });
  assert.equal(discovery.status, 200);
  assert.equal(discovery.body.detected, 3);

  const workday = discovery.body.candidates.find(x => x.productKey === 'workday');
  assert.ok(workday);

  const confirmed = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/confirm', {
    candidateId: workday.id,
    authoritativeFor: ['people', 'absence']
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.body.candidate.authoritativeFor, ['people', 'absence']);

  const connected = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/connect', {
    candidateId: workday.id,
    authMethod: 'oauth2',
    sourceInstanceId: 'wd-alpha-prod'
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.connection.state, 'AUTHORIZATION_REQUIRED');
  return connected.body.connection;
}

test('deterministic product discovery recognises common enterprise systems', () => {
  assert.equal(detectProduct({ displayName: 'Workday Production' }, 'ENTRA').product.key, 'workday');
  assert.equal(detectProduct({ name: 'Oracle NetSuite ERP' }, 'OKTA').product.key, 'netsuite');
  assert.equal(detectProduct({ name: 'UKG Pro' }, 'ENTRA').product.key, 'ukg');
  assert.equal(detectProduct({ name: 'Unrelated App' }, 'ENTRA'), null);
});

test('mapping suggestions are deterministic and fail unresolved fields closed', () => {
  const result = mappingSuggestions(['employee_number', 'first_name', 'last_name', 'mystery_field']);
  assert.equal(result[0].canonicalField, 'employeeId');
  assert.equal(result[1].canonicalField, 'firstName');
  assert.equal(result[2].canonicalField, 'lastName');
  assert.equal(result[3].canonicalField, null);
});

test('credential references accept managed pointers and reject raw credentials', () => {
  assert.equal(validCredentialReference('vault://tenant/alpha/workday'), true);
  assert.equal(validCredentialReference('managed://merge/account-123'), true);
  assert.equal(validCredentialReference('eyJhbGciOiJIUzI1NiJ9.secret-token'), false);
  assert.equal(validCredentialReference('password123'), false);
});


test('mobile can start a safe SAP connection without putting credentials on the device', async () => {
  const f = fixture();
  try {
    const result = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mobile-connect', {
      productKey: 'sap-s4hana',
      authMethod: 'oauth2',
      sourceInstanceId: 'sap-alpha-production',
      authoritativeFor: ['finance', 'production']
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.connection.productKey, 'sap-s4hana');
    assert.equal(result.body.connection.state, 'AUTHORIZATION_REQUIRED');
    assert.equal(result.body.connection.sourceInstanceId, 'sap-alpha-production');
    assert.ok(result.body.connection.semanticScopes.includes('finance.read'));
    assert.ok(result.body.connection.semanticScopes.includes('production.read'));
    assert.deepEqual(result.body.candidate.authoritativeFor, ['finance', 'production']);
    assert.equal(result.body.requiredAction.type, 'OPEN_SECURE_AUTHORIZATION');
    assert.equal(result.body.requiredAction.mode, 'server-brokered-oauth');
    assert.equal(result.body.requiredAction.secretsOnDevice, false);
    assert.equal(result.body.requiredAction.credentialSubmissionAllowed, false);
    assert.equal(result.body.requiredAction.readOnlyDefault, true);
    assert.equal(result.body.mobile.connectionRunsServerSide, true);
    assert.equal(result.body.mobile.appMayCloseAfterAuthorization, true);
    assert.equal(result.body.mobile.deviceRevocationDoesNotDisconnectSource, true);

    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.discovery.candidateCount, 1);
    assert.equal(status.body.connections.length, 1);
    assert.equal(status.body.connections[0].productKey, 'sap-s4hana');
  } finally {
    f.close();
  }
});

test('mobile integration endpoint rejects raw credential material and employee access', async () => {
  const f = fixture();
  try {
    const rawSecret = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mobile-connect', {
      productKey: 'sap-s4hana',
      authMethod: 'oauth2',
      clientSecret: 'must-never-reach-vecta-mobile-control-plane'
    });
    assert.equal(rawSecret.status, 400);
    assert.match(rawSecret.body.error, /credentials are not accepted/i);

    const employee = await call(f.hub, f.tokens.employee, 'POST', '/api/integrations/autonomous/mobile-connect', {
      productKey: 'sap-s4hana',
      authMethod: 'oauth2'
    });
    assert.equal(employee.status, 403);

    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.discovery.candidateCount, 0);
    assert.equal(status.body.connections.length, 0);
  } finally {
    f.close();
  }
});

test('employee role cannot inspect or configure integration control plane', async () => {
  const f = fixture();
  try {
    const result = await call(f.hub, f.tokens.employee, 'GET', '/api/integrations/autonomous/status');
    assert.equal(result.status, 403);
  } finally {
    f.close();
  }
});

test('discovery evidence is tenant-isolated', async () => {
  const f = fixture();
  try {
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discover', {
      source: 'ENTRA',
      apps: [{ appId: 'a-1', displayName: 'Workday' }]
    });
    const alpha = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    const bravo = await call(f.hub, f.tokens.bravo, 'GET', '/api/integrations/autonomous/status');
    assert.equal(alpha.body.discovery.candidateCount, 1);
    assert.equal(bravo.body.discovery.candidateCount, 0);
  } finally {
    f.close();
  }
});


test('trusted directory worker is bound to a short-lived server-side discovery session', async () => {
  const f = fixture();
  try {
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    const session = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discovery-session', {
      provider: 'ENTRA'
    });
    assert.equal(session.status, 201);
    assert.equal(session.body.discoverySession.provider, 'ENTRA');

    const denied = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discovery-result', {
      discoverySessionId: session.body.discoverySession.id,
      source: 'ENTRA',
      apps: [{ appId: 'wd-no-worker', displayName: 'Workday' }]
    });
    assert.equal(denied.status, 403);

    const ingested = await call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', {
      discoverySessionId: session.body.discoverySession.id,
      source: 'ENTRA',
      apps: [{ appId: 'wd-worker', displayName: 'Workday Production' }]
    }, internal);
    assert.equal(ingested.status, 200);
    assert.equal(ingested.body.detected, 1);

    const alpha = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    const bravo = await call(f.hub, f.tokens.bravo, 'GET', '/api/integrations/autonomous/status');
    assert.equal(alpha.body.discovery.candidateCount, 1);
    assert.equal(bravo.body.discovery.candidateCount, 0);

    const replay = await call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', {
      discoverySessionId: session.body.discoverySession.id,
      source: 'ENTRA',
      apps: [{ appId: 'replay', displayName: 'Oracle NetSuite' }]
    }, internal);
    assert.equal(replay.status, 409);
  } finally {
    f.close();
  }
});

test('concurrent worker callbacks can claim a discovery session only once', async () => {
  const f = fixture();
  try {
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    const session = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discovery-session', {
      provider: 'ENTRA'
    });
    const body = {
      discoverySessionId: session.body.discoverySession.id,
      source: 'ENTRA',
      apps: [{ appId: 'wd-race', displayName: 'Workday Production' }]
    };

    const results = await Promise.all([
      call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', body, internal),
      call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', body, internal)
    ]);
    assert.deepEqual(results.map(x => x.status).sort((a,b) => a-b), [200, 409]);

    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.discovery.candidateCount, 1);
    assert.equal(status.body.discovery.candidates[0].evidence.length, 1);
  } finally {
    f.close();
  }
});

test('discovery session rejects provider substitution and expired sessions', async () => {
  const f = fixture();
  try {
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    const mismatchSession = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discovery-session', {
      provider: 'ENTRA'
    });
    const mismatch = await call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', {
      discoverySessionId: mismatchSession.body.discoverySession.id,
      source: 'OKTA',
      apps: [{ appId: 'substitute', displayName: 'Workday' }]
    }, internal);
    assert.equal(mismatch.status, 409);

    const expiredSession = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/discovery-session', {
      provider: 'OKTA'
    });
    const db = new DatabaseSync(f.dbPath);
    db.prepare('UPDATE integration_discovery_sessions SET expires_at=? WHERE id=?').run(
      Date.now() - 1,
      expiredSession.body.discoverySession.id
    );
    db.close();
    const expired = await call(f.hub, null, 'POST', '/api/integrations/autonomous/discovery-result', {
      discoverySessionId: expiredSession.body.discoverySession.id,
      source: 'OKTA',
      apps: [{ appId: 'expired', displayName: 'Workday' }]
    }, internal);
    assert.equal(expired.status, 410);
  } finally {
    f.close();
  }
});

test('browser/admin cannot attest provider authorization without trusted worker', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const denied = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'vault://tenant/alpha/workday',
      grantedScopes: ['people.read']
    });
    assert.equal(denied.status, 403);

    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.connections[0].state, 'AUTHORIZATION_REQUIRED');
  } finally {
    f.close();
  }
});

test('trusted worker can attest authorization, activate mapping, validate sync and reach ACTIVE', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };

    const authorized = await call(
      f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete',
      {
        connectionId: connection.id,
        authorizationRef: 'vault://tenant/alpha/workday',
        grantedScopes: ['people.read', 'organisation.read', 'absence.read']
      },
      internal
    );
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.connection.state, 'VALIDATING');

    const preview = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-preview', {
      connectionId: connection.id,
      sourceFields: ['employee_number', 'first_name', 'last_name', 'email', 'department', 'location']
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.unresolved.length, 0);

    const mappings = preview.body.suggestions.map(x => ({
      sourceField: x.sourceField,
      canonicalField: x.canonicalField,
      confidence: x.confidence
    }));
    const activated = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings
    });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.mappingVersion, 1);

    const validated = await call(
      f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/sync-validate',
      {
        connectionId: connection.id,
        records: [
          { employee_number: 'E-100', first_name: 'A', last_name: 'One', email: 'a@example.test', department: 'Assembly', location: 'Plant 1' },
          { employee_number: 'E-101', first_name: 'B', last_name: 'Two', email: 'b@example.test', department: 'Assembly', location: 'Plant 1' }
        ]
      },
      internal
    );
    assert.equal(validated.status, 200);
    assert.equal(validated.body.connection.state, 'ACTIVE');
    assert.equal(validated.body.reconciliation.status, 'PASS');

    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.readiness.readyForPeopleSync, true);
    assert.equal(status.body.readiness.needsAdminAction, 0);
  } finally {
    f.close();
  }
});

test('validation with duplicate identifiers degrades safely instead of silently activating', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    await call(f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'managed://kombo/linked-account-1',
      grantedScopes: ['people.read']
    }, internal);
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [
        { sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 },
        { sourceField: 'first_name', canonicalField: 'firstName', confidence: 1 },
        { sourceField: 'last_name', canonicalField: 'lastName', confidence: 1 }
      ]
    });

    const validated = await call(f.hub, null, 'POST', '/api/integrations/autonomous/sync-validate', {
      connectionId: connection.id,
      records: [
        { employee_id: 'E-1', first_name: 'A', last_name: 'One' },
        { employee_id: 'E-1', first_name: 'B', last_name: 'Two' }
      ]
    }, internal);
    assert.equal(validated.body.connection.state, 'DEGRADED');
    assert.equal(validated.body.reconciliation.duplicateCount, 1);
    assert.equal(validated.body.reconciliation.status, 'NEEDS_REVIEW');
  } finally {
    f.close();
  }
});

test('schema drift produces targeted repair guidance while preserving mapping version', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    await call(f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'vault://tenant/alpha/workday',
      grantedScopes: ['people.read']
    }, internal);
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    });

    const health = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id,
      health: 'schema_drift'
    }, internal);
    assert.equal(health.body.connection.state, 'DEGRADED');
    assert.equal(health.body.connection.failureClass, 'SCHEMA_DRIFT');
    assert.equal(health.body.connection.mappingVersion, 1);

    const repair = await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/repair', {
      connectionId: connection.id
    });
    assert.equal(repair.body.requiredAction.type, 'REVALIDATE_MAPPING');
    assert.equal(repair.body.connection.mappingVersion, 1);
  } finally {
    f.close();
  }
});

test('reconciliation stores only counts and digests, not raw employee payloads', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    await call(f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'vault://tenant/alpha/workday',
      grantedScopes: ['people.read']
    }, internal);
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    });
    await call(f.hub, null, 'POST', '/api/integrations/autonomous/sync-validate', {
      connectionId: connection.id,
      records: [{ employee_id: 'SECRET-EMPLOYEE-ID', salary: 'VERY-SENSITIVE' }]
    }, internal);

    const db = new DatabaseSync(f.dbPath, { readOnly: true });
    const recon = JSON.stringify(db.prepare('SELECT * FROM integration_reconciliation_runs').all());
    const events = JSON.stringify(db.prepare('SELECT * FROM integration_events').all());
    db.close();
    assert.equal(recon.includes('SECRET-EMPLOYEE-ID'), false);
    assert.equal(recon.includes('VERY-SENSITIVE'), false);
    assert.equal(events.includes('SECRET-EMPLOYEE-ID'), false);
    assert.equal(events.includes('VERY-SENSITIVE'), false);
  } finally {
    f.close();
  }
});
