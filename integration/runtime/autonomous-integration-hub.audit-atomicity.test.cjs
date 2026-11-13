'use strict';
// Disposable SQLite only. No listener, provider request, or customer credential.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('./autonomous-integration-hub.cjs');

const token = 'fictional-v089-atomic-worker';
const at = '2026-11-02T00:00:00.000Z';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v089-atomic-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const seed = new DatabaseSync(dbPath);
  seed.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  seed.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  seed.close();
  let providerCalls = 0;
  const hub = createAutonomousIntegrationHub({ dbPath, internalToken: token, env: {},
    fetchImpl: async () => { providerCalls++; throw Error('Unexpected provider call'); } });
  const db = new DatabaseSync(dbPath);
  db.prepare('INSERT INTO integration_connections(id,tenant,candidate_id,product_key,category,state,auth_method,semantic_scopes_json,granted_scopes_json,credential_ref,source_instance_id,mapping_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('conn-alpha', 'alpha', 'candidate-alpha', 'workday', 'hcm', 'VALIDATING', 'oauth2',
      '["people.read"]', '["people.read"]', 'vault://fictional/alpha', 'instance-alpha', 1, at, at);
  db.prepare('INSERT INTO integration_mappings VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('map-id', 'alpha', 'conn-alpha', 'Person', 'employee_id', 'employeeId', 1, 'ACTIVE', 1, at);
  t.after(() => { assert.equal(providerCalls, 0); db.close(); hub.close(); fs.rmSync(dir, {recursive:true}); });
  async function send(records = [{employee_id:'E-1'}], extra = {}) {
    const req = Readable.from([JSON.stringify({tenant:'alpha', connectionId:'conn-alpha', records, ...extra})]);
    req.method = 'POST'; req.url = '/api/integrations/autonomous/sync-validate';
    req.headers = {'x-wfm-integration-internal':token, 'content-type':'application/json'};
    const res = {statusCode:200, setHeader(){}, end(value){this.value=String(value);this.headersSent=true;this.writableEnded=true;}};
    assert.equal(await hub.handleRequest(req, res), true);
    return {status:res.statusCode, body:JSON.parse(res.value)};
  }
  const count = table => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
  const state = () => db.prepare("SELECT state FROM integration_connections WHERE id='conn-alpha'").get().state;
  const events = name => db.prepare('SELECT count(*) AS n FROM integration_events WHERE event=?').get(name).n;
  return {db,send,count,state,events};
}

for (const [name, trigger] of [
  ['completion audit', "CREATE TRIGGER deny_completion BEFORE INSERT ON integration_events WHEN NEW.event='sync-validation-completed' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;"],
  ['silently ignored completion audit', "CREATE TRIGGER ignore_completion BEFORE INSERT ON integration_events WHEN NEW.event='sync-validation-completed' BEGIN SELECT RAISE(IGNORE); END;"],
  ['silently ignored reconciliation', "CREATE TRIGGER ignore_reconciliation BEFORE INSERT ON integration_reconciliation_runs BEGIN SELECT RAISE(IGNORE); END;"],
  ['silently ignored canonical batch', "CREATE TRIGGER ignore_batch BEFORE INSERT ON integration_canonical_batches BEGIN SELECT RAISE(IGNORE); END;"],
  ['silently ignored canonical person', "CREATE TRIGGER ignore_person BEFORE INSERT ON integration_canonical_people BEGIN SELECT RAISE(IGNORE); END;"],
  ['canonical person', "CREATE TRIGGER deny_person BEFORE INSERT ON integration_canonical_people BEGIN SELECT RAISE(ABORT,'injected person failure'); END;"],
  ['connection state', "CREATE TRIGGER deny_state BEFORE UPDATE ON integration_connections WHEN NEW.state='ACTIVE' BEGIN SELECT RAISE(ABORT,'injected state failure'); END;"],
  ['silently ignored connection state', "CREATE TRIGGER ignore_state BEFORE UPDATE ON integration_connections WHEN NEW.state='ACTIVE' BEGIN SELECT RAISE(IGNORE); END;"]
]) test('required ' + name + ' failure rolls back the entire PASS sync', async t => {
  const f = fixture(t);
  f.db.exec(trigger);
  assert.equal((await f.send()).status, 500);
  assert.equal(f.state(), 'VALIDATING');
  for (const table of ['integration_reconciliation_runs','integration_canonical_batches','integration_canonical_people'])
    assert.equal(f.count(table), 0, table);
  assert.equal(f.events('sync-validation-completed'), 0);
});

test('required completion audit failure rolls back NEEDS_REVIEW state and reconciliation', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TRIGGER deny_completion BEFORE INSERT ON integration_events WHEN NEW.event='sync-validation-completed' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
  assert.equal((await f.send([{employee_id:'E-1'},{employee_id:'E-1'}])).status, 500);
  assert.equal(f.state(), 'VALIDATING');
  assert.equal(f.count('integration_reconciliation_runs'), 0);
  assert.equal(f.events('sync-validation-completed'), 0);
});

test('malformed expected checksum rejects before any write', async t => {
  const f = fixture(t);
  assert.equal((await f.send(undefined, {expectedCanonicalChecksum:'invalid'})).status, 400);
  assert.equal(f.state(), 'VALIDATING');
  assert.equal(f.count('integration_reconciliation_runs'), 0);
  assert.equal(f.count('integration_canonical_batches'), 0);
});

test('checksum mismatch and its required audit commit together or roll back together', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TRIGGER deny_mismatch BEFORE INSERT ON integration_events WHEN NEW.event='canonical-checksum-mismatch' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
  assert.equal((await f.send(undefined, {expectedCanonicalChecksum:'0'.repeat(64)})).status, 500);
  assert.equal(f.state(), 'VALIDATING');
  assert.equal(f.count('integration_reconciliation_runs'), 0);
  assert.equal(f.events('canonical-checksum-mismatch'), 0);
  f.db.exec('DROP TRIGGER deny_mismatch');
  assert.equal((await f.send(undefined, {expectedCanonicalChecksum:'0'.repeat(64)})).status, 409);
  assert.equal(f.state(), 'DEGRADED');
  assert.equal(f.count('integration_reconciliation_runs'), 1);
  assert.equal(f.events('canonical-checksum-mismatch'), 1);
  assert.equal(f.count('integration_canonical_batches'), 0);
});

test('PASS replay preserves one canonical batch and rolls back failed replay audit', async t => {
  const f = fixture(t);
  const first = await f.send();
  const second = await f.send();
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.canonicalImport.replayed, false);
  assert.equal(second.body.canonicalImport.replayed, true);
  assert.equal(f.count('integration_reconciliation_runs'), 2);
  assert.equal(f.count('integration_canonical_batches'), 1);
  assert.equal(f.count('integration_canonical_people'), 1);
  assert.equal(f.events('sync-validation-completed'), 2);
  f.db.exec("CREATE TRIGGER deny_completion BEFORE INSERT ON integration_events WHEN NEW.event='sync-validation-completed' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
  assert.equal((await f.send()).status, 500);
  assert.equal(f.state(), 'ACTIVE');
  assert.equal(f.count('integration_reconciliation_runs'), 2);
  assert.equal(f.count('integration_canonical_batches'), 1);
  assert.equal(f.count('integration_canonical_people'), 1);
  assert.equal(f.events('sync-validation-completed'), 2);
});
