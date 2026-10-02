'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('../../integration/runtime/autonomous-integration-hub.cjs');

// Run source commands as inert JSON transformations, never run curl/Docker/Railway.
const workflow = fs.readFileSync(path.join(__dirname, 'autonomous-integration-fabric.yml'), 'utf8');
const jobs = ['local-proof', 'hosted-railway-proof'];
function jobSource(job) {
  const start = workflow.indexOf('\n  ' + job + ':');
  assert.ok(start >= 0, 'job exists');
  const end = workflow.indexOf('\n  hosted-railway-proof:', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
}
function binding(job, document) {
  const source = jobSource(job);
  const assignment = source.split('\n').find(line => line.trimStart().startsWith('tenant_json="$(node -e "'));
  assert.ok(assignment, 'tenant binding must exist in ' + job);
  const script = assignment.match(/node -e "(.*)"\)"$/)?.[1];
  assert.ok(script, 'extract exact source expression');
  let output = '';
  vm.runInNewContext(script, {
    require(name) {
      assert.equal(name, job === 'local-proof' ? '/tmp/bootstrap.json' : '/tmp/hosted-bootstrap.json');
      return JSON.parse(JSON.stringify(document));
    },
    process: {
      exit(code) { throw new Error('binding rejected:' + code); },
      stdout: { write(value) { output += value; } }
    }
  }, { timeout: 1000 });
  return output;
}
function syncBody(job, connectionId, tenantJson = JSON.stringify('alpha')) {
  const line = jobSource(job).split('\n').find(value => value.includes('/sync-validate'));
  assert.ok(line, 'actual sync curl command exists');
  const literal = line.match(/--data "((?:\\.|[^"\\])*)"/)?.[1];
  assert.ok(literal, 'actual double quoted body exists');
  const decoded = literal.replace(/\\(["\\])/g, '$1');
  assert.equal(/\$[a-z_]/i.test(decoded.replace(/\$connection_id|\$tenant_json/g, '')), false, 'only expected body bindings');
  const expanded = decoded.replace(/\$connection_id/g, connectionId).replace(/\$tenant_json/g, () => tenantJson);
  return JSON.parse(expanded);
}
function actor(tenant = 'alpha') {
  return { actor: { email: 'manager@northstar.example', role: 'manager', tenant } };
}
function fixture(tenant = 'alpha') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lane03-workflow-tenant-'));
  const dbPath = path.join(folder, 'fixture.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  const token = 'm'.repeat(64), bravoToken = 'b'.repeat(64), employeeToken = 'e'.repeat(64);
  const session = db.prepare('INSERT INTO sessions VALUES(?,?,?)');
  const user = db.prepare('INSERT INTO users VALUES(?,?,?)');
  for (const [email, scopedTenant, role, value] of [
    ['manager@northstar.example', tenant, 'manager', token],
    ['manager@bravo', 'bravo', 'manager', bravoToken],
    ['employee@alpha', tenant, 'employee', employeeToken]
  ]) {
    user.run(email, scopedTenant, role);
    session.run(createHash('sha256').update(value).digest('hex'), email, Date.now() + 60000);
  }
  db.close();
  const hub = createAutonomousIntegrationHub({ dbPath, internalToken: 'workflow-tenant-fixture', env: {} });
  return {
    hub, token, bravoToken, employeeToken, dbPath,
    close() {
      hub.close();
      const resolved = path.resolve(folder);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('lane03-workflow-tenant-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  };
}
async function call(f, method, route, body, token = f.token, worker = false) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method; req.url = '/api/integrations/autonomous/' + route;
  req.headers = { ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...(worker ? { 'x-wfm-integration-internal': worker === true ? 'workflow-tenant-fixture' : worker } : {}) };
  const res = { statusCode: 200, headersSent: false, writableEnded: false, body: '', setHeader() {},
    end(value) { this.body = String(value); this.headersSent = true; this.writableEnded = true; } };
  assert.equal(await f.hub.handleRequest(req, res), true);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function readyConnection(f) {
  const discovered = await call(f, 'POST', 'discover', {
    source: 'ENTRA', apps: [{ appId: 'wd-fixture', displayName: 'Workday Production' }]
  });
  assert.equal(discovered.status, 200);
  const candidateId = discovered.body.candidates.find(c => c.productKey === 'workday').id;
  assert.equal((await call(f, 'POST', 'confirm', { candidateId, authoritativeFor: ['people', 'absence'] })).status, 200);
  const connected = await call(f, 'POST', 'connect', { candidateId, authMethod: 'oauth2', sourceInstanceId: 'workday-fixture' });
  assert.equal(connected.status, 200);
  const connectionId = connected.body.connection.id;
  const authorized = await call(f, 'POST', 'authorize-complete', {
    connectionId, authorizationRef: 'vault://fixture/workday', grantedScopes: ['people.read', 'absence.read']
  }, f.token, true);
  assert.equal(authorized.status, 200);
  const mapped = await call(f, 'POST', 'mapping-activate', { connectionId, mappings: [
    { sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 },
    { sourceField: 'first_name', canonicalField: 'firstName', confidence: 1 },
    { sourceField: 'last_name', canonicalField: 'lastName', confidence: 1 }
  ] });
  assert.equal(mapped.status, 200);
  return connectionId;
}
function assertNotImported(f, connectionId) {
  const db = new DatabaseSync(f.dbPath);
  try {
    assert.equal(db.prepare('SELECT state FROM integration_connections WHERE id=?').get(connectionId).state, 'VALIDATING');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integration_canonical_batches').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integration_canonical_people').get().n, 0);
  } finally { db.close(); }
}

for (const job of jobs) {
  test(job + ': exact extracted curl body satisfies real handler required tenant contract', async () => {
    const f = fixture();
    try {
      const id = await readyConnection(f);
      const result = await call(f, 'POST', 'sync-validate', syncBody(job, id), f.token, true);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.connection.state, 'ACTIVE');
      assert.equal(result.body.connection.canonicalImport.recordCount, 2);
    } finally { f.close(); }
  });
  test(job + ': actual body reaches ACTIVE/PASS with authenticated actor tenant', async () => {
    const f = fixture();
    try {
      const connectionId = await readyConnection(f);
      const tenantJson = binding(job, actor());
      const payload = syncBody(job, connectionId, tenantJson);
      assert.equal(payload.tenant, 'alpha');
      const result = await call(f, 'POST', 'sync-validate', payload, f.token, true);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.connection.state, 'ACTIVE');
      assert.equal(result.body.reconciliation.status, 'PASS');
      assert.equal(result.body.connection.canonicalImport.recordCount, 2);
      assert.equal((await call(f, 'GET', 'status')).body.readiness.readyForPeopleSync, true);
      assert.equal((await call(f, 'GET', 'status', undefined, f.bravoToken)).body.readiness.readyForPeopleSync, false);
      const db = new DatabaseSync(f.dbPath);
      try {
        const rows = db.prepare('SELECT tenant,canonical_json FROM integration_canonical_people').all();
        assert.equal(rows.length, 2);
        assert.ok(rows.every(row => row.tenant === 'alpha'));
        assert.deepEqual(rows.map(row => JSON.parse(row.canonical_json).employeeId).sort(),
          job === 'local-proof' ? ['E-100', 'E-101'] : ['E-HOST-100', 'E-HOST-101']);
      } finally { db.close(); }
    } finally { f.close(); }
  });
  test(job + ': bootstrap request uses existing authenticated cookie and matching origin', () => {
    const source = jobSource(job), line = source.split('\n').find(v => v.includes('/api/bootstrap'));
    assert.ok(line, 'bootstrap request exists');
    assert.match(line, /curl -sSf/);
    assert.match(line, /-H "Cookie: \$cookie"/);
    assert.match(line, job === 'local-proof' ? /http:\/\/127\.0\.0\.1:38119\/api\/bootstrap/ : /\$HOSTED_BASE_URL\/api\/bootstrap/);
    if (job === 'local-proof') {
      assert.match(line, /Host: staging.integration.test/); assert.match(line, /X-Forwarded-Proto: https/);
    }
    assert.ok(source.indexOf(line) > source.indexOf('test -n "$cookie"'));
    assert.ok(source.indexOf(line) < source.indexOf('tenant_json='));
    assert.ok(source.indexOf('tenant_json=') < source.indexOf('/sync-validate'));
  });
  const invalidActors = [null, {}, { actor: null }, { actor: [] }, { actor: 'manager' },
    { actor: { email: 'other@northstar.example', role: 'manager', tenant: 'alpha' } },
    { actor: { email: 'manager@northstar.example', role: 'employee', tenant: 'alpha' } },
    { actor: { email: 'manager@northstar.example', role: 'MANAGER', tenant: 'alpha' } },
    { actor: { email: 'manager@northstar.example', tenant: 'alpha' } },
    { actor: { role: 'manager', tenant: 'alpha' } }];
  test(job + ': missing/malformed/wrong actor is rejected before request construction', () => {
    for (const document of invalidActors) assert.throws(() => binding(job, document));
  });
  test(job + ': malformed/missing tenant is rejected without coercion or default', () => {
    for (const value of [null, '', ' ', ' alpha', 'alpha ', 0, 123, true, [], ['alpha'], {},
      'a'.repeat(121), 'a\nb', 'a\rb', 'a\tb', 'a\0b', 'a\u001fb', 'a\u007fb']) {
      assert.throws(() => binding(job, actor(value)), 'invalid tenant: ' + JSON.stringify(value));
    }
    const document = actor(); delete document.actor.tenant;
    assert.throws(() => binding(job, document));
  });
  test(job + ': exact string boundaries and JSON quoting preserve tenant, never interpolate source', () => {
    for (const value of ['a', 'a'.repeat(120), 'alpha"\\suffix', 'alpha$(ignored)', 'alpha$ignored', 'alpha`ignored`', 'tenant-É']) {
      const json = binding(job, actor(value));
      assert.equal(json, JSON.stringify(value));
      assert.equal(syncBody(job, 'fixture-id', json).tenant, value);
    }
  });
  test(job + ': exact JSON tenant with quote/backslash reaches its own tenant connection', async () => {
    const scopedTenant = 'alpha"\\suffix', f = fixture(scopedTenant);
    try {
      const id = await readyConnection(f);
      const payload = syncBody(job, id, binding(job, actor(scopedTenant)));
      assert.equal(payload.tenant, scopedTenant);
      assert.equal((await call(f, 'POST', 'sync-validate', payload, f.token, true)).status, 200);
    } finally { f.close(); }
  });
  for (const [label, tenant, status] of [
    ['missing', undefined, 400], ['null', null, 400], ['empty', '', 400], ['numeric', 12, 403],
    ['foreign', 'bravo', 403], ['object', {}, 403], ['control', 'alpha\0extra', 403]
  ]) {
    test(job + ': real handler rejects ' + label + ' tenant without importing or activating', async () => {
      const f = fixture();
      try {
        const id = await readyConnection(f), payload = syncBody(job, id);
        if (tenant === undefined) delete payload.tenant; else payload.tenant = tenant;
        const result = await call(f, 'POST', 'sync-validate', payload, f.token, true);
        assert.equal(result.status, status, JSON.stringify(result.body));
        assertNotImported(f, id);
      } finally { f.close(); }
    });
  }
  test(job + ': wrong worker cannot validate a correctly scoped body', async () => {
    const f = fixture();
    try {
      const id = await readyConnection(f);
      assert.equal((await call(f, 'POST', 'sync-validate', syncBody(job, id), f.token, 'wrong-worker')).status, 403);
      assertNotImported(f, id);
    } finally { f.close(); }
  });
}
test('hosted bootstrap URL resolves from the actual job declared environment under set -u', () => {
  const source = jobSource('hosted-railway-proof');
  const line = source.split('\n').find(value => value.includes('/api/bootstrap'));
  const literal = line.match(/"(\$[A-Z_]+\/api\/bootstrap)"/)?.[1];
  assert.ok(literal, 'literal command target is present');
  const env = Object.fromEntries([...source.matchAll(/^ {6}([A-Z][A-Z0-9_]*): '([^']*)'$/gm)]
    .map(match => [match[1], match[2]]));
  const name = literal.match(/^\$([A-Z_]+)/)[1];
  assert.equal(Object.hasOwn(env, name), true, 'request target must bind a declared job variable: ' + name);
  assert.equal(name, 'HOSTED_BASE_URL', 'use the existing configured origin');
  assert.equal(literal.replace('$' + name, env[name]), new URL('/api/bootstrap', env.HOSTED_BASE_URL).href);
  assert.match(source, /set -euo pipefail/);
});
test('canonical manager/session authority remains tenant scoped and employee blocked', async () => {
  const f = fixture();
  try {
    const id = await readyConnection(f);
    assert.equal((await call(f, 'POST', 'mapping-activate', { connectionId: id, mappings: [] }, f.bravoToken)).status, 404);
    assert.equal((await call(f, 'GET', 'status', undefined, f.employeeToken)).status, 403);
    assert.equal((await call(f, 'GET', 'status', undefined, null)).status, 401);
    assertNotImported(f, id);
  } finally { f.close(); }
});
test('qualification: frozen worker handler coerces single-item tenant array; repaired caller rejects it', async () => {
  const f = fixture();
  try {
    const id = await readyConnection(f), payload = syncBody('local-proof', id);
    payload.tenant = ['alpha'];
    assert.equal((await call(f, 'POST', 'sync-validate', payload, f.token, true)).status, 200);
    assert.throws(() => binding('local-proof', actor(['alpha'])));
  } finally { f.close(); }
});
