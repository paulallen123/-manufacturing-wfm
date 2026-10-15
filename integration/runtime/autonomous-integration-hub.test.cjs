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
  screenWorkforceProvenanceShadow,
  mappingSuggestions,
  detectProduct,
  validCredentialReference
} = require('./autonomous-integration-hub.cjs');

function provenanceFixture(now = '2026-10-13T07:30:00.000Z') {
  const at = offset => new Date(Date.parse(now) + offset).toISOString();
  return {
    simulation: true,
    processEvent: {
      tenant: 'alpha', site: 'site-1', workCentre: 'line-1', batchRef: 'lot-42',
      operationRef: 'weld', eventId: 'event-42', occurredAt: at(-60000),
      sourceRevision: 'mes-r1', sourceHash: 'a'.repeat(64)
    },
    workforceSnapshot: {
      tenant: 'alpha', site: 'site-1', workCentre: 'line-1', batchRef: 'lot-42', operationRef: 'weld',
      processEventId: 'event-42', observedAt: at(-120000),
      validFrom: at(-300000), validUntil: at(600000), requiredSkill: 'WELD_L1',
      qualifiedCount: 2, requiredCount: 2, qualificationState: 'VALID',
      qualificationValidUntil: at(600000), supervisorApproved: true,
      qualityState: 'PASS', sourceRevision: 'skills-r1', sourceHash: 'b'.repeat(64)
    }
  };
}

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

test('people sync cannot activate from a connector capability without a people grant', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    const attested = await call(f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'vault://tenant/alpha/workday',
      grantedScopes: ['organisation.read']
    }, internal);
    assert.equal(attested.status, 200);
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    });

    const denied = await call(f.hub, null, 'POST', '/api/integrations/autonomous/sync-validate', {
      tenant: 'alpha',
      connectionId: connection.id,
      records: [{ employee_id: 'E-1' }]
    }, internal);
    assert.equal(denied.status, 409);
    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.connections.find(x => x.id === connection.id).state, 'VALIDATING');
    assert.equal(status.body.readiness.readyForPeopleSync, false);
  } finally {
    f.close();
  }
});

test('healthy report cannot bypass authorization or an unvalidated mapping version', async () => {
  const f = fixture();
  try {
    const connection = await configuredConnection(f);
    const internal = { 'x-wfm-integration-internal': 'integration-worker-test-token' };
    const beforeAuth = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'healthy'
    }, internal);
    assert.equal(beforeAuth.status, 409);

    await call(f.hub, null, 'POST', '/api/integrations/autonomous/authorize-complete', {
      connectionId: connection.id,
      authorizationRef: 'vault://tenant/alpha/workday',
      grantedScopes: ['people.read']
    }, internal);
    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    });
    const beforeSync = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'healthy'
    }, internal);
    assert.equal(beforeSync.status, 409);

    const validated = await call(f.hub, null, 'POST', '/api/integrations/autonomous/sync-validate', {
      tenant: 'alpha',
      connectionId: connection.id, records: [{ employee_id: 'E-1' }]
    }, internal);
    assert.equal(validated.status, 200);
    const ready = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(ready.body.readiness.readyForPeopleSync, true);

    const outage = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'rate_limited'
    }, internal);
    assert.equal(outage.body.connection.state, 'DEGRADED');
    const recovered = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'healthy'
    }, internal);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.connection.state, 'ACTIVE');

    await call(f.hub, f.tokens.manager, 'POST', '/api/integrations/autonomous/mapping-activate', {
      connectionId: connection.id,
      mappings: [{ sourceField: 'new_employee_id', canonicalField: 'employeeId', confidence: 1 }]
    });
    const stale = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'healthy'
    }, internal);
    assert.equal(stale.status, 409);
    const status = await call(f.hub, f.tokens.manager, 'GET', '/api/integrations/autonomous/status');
    assert.equal(status.body.readiness.readyForPeopleSync, false);

    await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'auth_error'
    }, internal);
    const revoked = await call(f.hub, null, 'POST', '/api/integrations/autonomous/health-report', {
      connectionId: connection.id, health: 'healthy'
    }, internal);
    assert.equal(revoked.status, 409);
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
        tenant: 'alpha',
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
    assert.equal(validated.body.canonicalImport.recordCount, 2);
    assert.equal(validated.body.canonicalImport.replayed, false);
    assert.match(validated.body.canonicalImport.checksum, /^[0-9a-f]{64}$/);

    const replay = await call(
      f.hub, null, 'POST', '/api/integrations/autonomous/sync-validate',
      {
        tenant: 'alpha',
        connectionId: connection.id,
        records: [
          { employee_number: 'E-100', first_name: 'A', last_name: 'One', email: 'a@example.test', department: 'Assembly', location: 'Plant 1' },
          { employee_number: 'E-101', first_name: 'B', last_name: 'Two', email: 'b@example.test', department: 'Assembly', location: 'Plant 1' }
        ]
      },
      internal
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.canonicalImport.replayed, true);
    assert.equal(replay.body.canonicalImport.checksum, validated.body.canonicalImport.checksum);

    const persisted = new DatabaseSync(f.dbPath);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS count FROM integration_canonical_batches').get().count, 1);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS count FROM integration_canonical_people').get().count, 2);
    persisted.close();

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
      tenant: 'alpha',
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
      tenant: 'alpha',
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

test('synthetic process and aggregate skill evidence produce a privacy-limited shadow receipt', () => {
  const input = provenanceFixture();
  const result = screenWorkforceProvenanceShadow(input, 'alpha', '2026-10-13T07:30:00.000Z');
  assert.equal(result.status, 'SIMULATED_COMPLIANT');
  assert.equal(result.executionPermitted, false);
  assert.equal(result.disclosure.batchRef, 'lot-42');
  assert.equal(result.disclosure.qualifiedCount, 2);
  assert.match(result.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(input.processEvent.sourceHash), false);
  assert.deepEqual(screenWorkforceProvenanceShadow(input, 'alpha', '2026-10-13T07:30:00.000Z'), result);
});

test('shadow provenance requires a workforce lot reference for the process event', () => {
  const input = provenanceFixture();
  delete input.workforceSnapshot.batchRef;
  const result = screenWorkforceProvenanceShadow(input, 'alpha', '2026-10-13T07:30:00.000Z');
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.equal(result.executionPermitted, false);
  assert.equal(result.disclosure, null);
});

test('shadow provenance rejects another lot even when site, operation and event ID agree', () => {
  const input = provenanceFixture();
  input.workforceSnapshot.batchRef = 'lot-43';
  const result = screenWorkforceProvenanceShadow(input, 'alpha', '2026-10-13T07:30:00.000Z');
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.equal(result.reason, 'CROSS_SCOPE_LINK');
  assert.equal(result.disclosure, null);
});

test('shadow provenance refuses cross-tenant, stale, expired, incomplete and tampered evidence', () => {
  const changes = [
    x => { x.processEvent.tenant = 'bravo'; },
    x => { x.workforceSnapshot.site = 'site-2'; },
    x => { x.workforceSnapshot.processEventId = 'other'; },
    x => { x.workforceSnapshot.observedAt = '2026-10-13T07:20:00.000Z'; },
    x => { x.workforceSnapshot.qualificationState = 'EXPIRED'; },
    x => { x.workforceSnapshot.qualificationState = 'REVOKED'; },
    x => { x.workforceSnapshot.qualificationValidUntil = x.processEvent.occurredAt; },
    x => { x.workforceSnapshot.supervisorApproved = false; },
    x => { x.workforceSnapshot.qualityState = 'UNKNOWN'; },
    x => { x.workforceSnapshot.qualifiedCount = 1; },
    x => { x.workforceSnapshot.personName = 'PRIVATE WORKER'; },
    x => { x.workforceSnapshot.sourceHash = 'invalid'; },
    x => { x.processEvent.batchRef = 42; },
    x => { x.simulation = false; },
    x => { x.expectedDigest = '0'.repeat(64); }
  ];
  for (let i = 0; i < 1008; i++) {
    const input = provenanceFixture();
    changes[i % changes.length](input);
    const result = screenWorkforceProvenanceShadow(input, 'alpha', '2026-10-13T07:30:00.000Z');
    assert.notEqual(result.status, 'SIMULATED_COMPLIANT', `case ${i}`);
    assert.equal(result.executionPermitted, false);
    assert.equal(result.disclosure, null);
  }
});

test('saved digest detects changed aggregate evidence on replay', () => {
  const input = provenanceFixture();
  const at = '2026-10-13T07:30:00.000Z';
  const first = screenWorkforceProvenanceShadow(input, 'alpha', at);
  const replay = structuredClone(input);
  replay.expectedDigest = first.inputDigest;
  assert.deepEqual(screenWorkforceProvenanceShadow(replay, 'alpha', at), first);
  replay.workforceSnapshot.qualifiedCount = 3;
  const changed = screenWorkforceProvenanceShadow(replay, 'alpha', at);
  assert.equal(changed.status, 'UNVERIFIABLE');
  assert.equal(changed.reason, 'DIGEST_MISMATCH');
});

test('manager-only tenant-scoped provenance shadow route does not persist supplied evidence', async () => {
  const f = fixture();
  try {
    const body = provenanceFixture(new Date().toISOString());
    const endpoint = '/api/integrations/autonomous/workforce-provenance/shadow';
    assert.equal((await call(f.hub, null, 'POST', endpoint, body)).status, 401);
    assert.equal((await call(f.hub, f.tokens.employee, 'POST', endpoint, body)).status, 403);
    const result = await call(f.hub, f.tokens.manager, 'POST', endpoint, body);
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'SIMULATED_COMPLIANT');
    const crossTenant = structuredClone(body);
    crossTenant.processEvent.tenant = 'bravo';
    assert.equal((await call(f.hub, f.tokens.manager, 'POST', endpoint, crossTenant)).body.status, 'UNVERIFIABLE');
    const crossLot = structuredClone(body);
    crossLot.workforceSnapshot.batchRef = 'lot-43';
    assert.equal((await call(f.hub, f.tokens.manager, 'POST', endpoint, crossLot)).body.status, 'UNVERIFIABLE');
    const db = new DatabaseSync(f.dbPath, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM integration_events').get().n, 0);
    db.close();
  } finally { f.close(); }
});
