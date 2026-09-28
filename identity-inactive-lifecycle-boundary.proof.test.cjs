const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const artifact = path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT || 'sealed-runtime-4bd3.tar.gz');
const expectedArtifactSha256 = 'dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da';
const password = 'Factory-local-demo-2026!';
const connectorToken = 'identity-proof-connector-token-20260927';
const period = '2026-09-07';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start(runtime, database, port) {
  const output = [];
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: runtime,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      WFM_DB: database,
      WFM_INTEGRATIONS_JSON: JSON.stringify([{
        id: 'identity-proof',
        provider: 'synthetic-idp',
        tenant: 'northstar-demo',
        scope: 'd1',
        token: connectorToken,
        objectTypes: ['identity'],
      }]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw Error(`runtime exited before health: ${output.join('')}`);
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin }; } catch {}
    await delay(50);
  }
  throw Error(`runtime did not become healthy: ${output.join('')}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2_000).then(() => child.kill('SIGKILL'))]);
}

async function request(origin, requestPath, { method = 'GET', cookie, body, headers = {} } = {}) {
  const requestHeaders = { 'User-Agent': 'identity-lifecycle-boundary-proof/1', ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (body !== undefined) {
    requestHeaders.Origin = origin;
    requestHeaders['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${origin}${requestPath}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { response, status: response.status, text, json };
}

async function login(origin, email) {
  const result = await request(origin, '/api/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(result.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

async function payrollDashboard(origin, cookie) {
  return request(origin, `/api/payroll-run?period=${period}`, { cookie });
}

function inspectDatabase(database, batchId) {
  const db = new DatabaseSync(database, { readOnly: true });
  const batch = db.prepare('SELECT status,valid_count,held_count,applied_count FROM integration_batches WHERE id=?').get(batchId);
  const record = db.prepare('SELECT status,canonical_json FROM integration_records WHERE batch_id=?').get(batchId);
  const user = db.prepare('SELECT email,tenant,role,permissions FROM users WHERE email=?').get('payroll@northstar.example');
  const sessionCount = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE email=?').get('payroll@northstar.example').n;
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant='northstar-demo' AND action='integration-stage'").get().n;
  db.close();
  return { batch, record: { ...record, canonical: JSON.parse(record.canonical_json) }, user, sessionCount, audit };
}

test('inactive external identity reference is staged but cannot deprovision a local payroll identity', async t => {
  // Adding an explicit, reviewed identity application handler plus user/session enforcement would change this boundary proof.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-lifecycle-boundary-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  const port = await freePort();
  let running;
  t.after(async () => {
    await stop(running?.child);
    fs.rmSync(root, { recursive: true, force: true });
  });

  running = await start(runtime, database, port);
  const payrollCookie = await login(running.origin, 'payroll@northstar.example');
  const before = await payrollDashboard(running.origin, payrollCookie);
  assert.equal(before.status, 200, before.text);

  const staged = await request(running.origin, '/api/integrations/ingest', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connectorToken}`,
      'X-Connector-Id': 'identity-proof',
      'Idempotency-Key': 'identity-inactive-0001',
    },
    body: {
      objectType: 'identity',
      cursor: 'cursor-1',
      sourceVersion: 'identity-source-1',
      records: [{
        externalId: 'idp-payroll-1',
        revision: '1',
        operation: 'upsert',
        data: {
          email: 'payroll@northstar.example',
          username: 'payroll@northstar.example',
          name: 'Synthetic Payroll User',
          status: 'inactive',
        },
      }],
    },
  });
  assert.equal(staged.status, 200, staged.text);
  assert.equal(staged.json.status, 'staged');
  assert.equal(staged.json.valid, 1);
  assert.equal(staged.json.held, 0);

  const afterStage = await payrollDashboard(running.origin, payrollCookie);
  assert.equal(afterStage.status, 200, afterStage.text);
  const secondPayrollCookie = await login(running.origin, 'payroll@northstar.example');
  assert.equal((await payrollDashboard(running.origin, secondPayrollCookie)).status, 200);

  const superuserCookie = await login(running.origin, 'superuser@northstar.example');
  const bootstrap = await request(running.origin, '/api/bootstrap', { cookie: superuserCookie });
  assert.equal(bootstrap.status, 200, bootstrap.text);
  const apply = await request(running.origin, '/api/integrations/apply', {
    method: 'POST',
    cookie: superuserCookie,
    body: { id: staged.json.id, reviewed: true, version: bootstrap.json.state.version },
  });
  assert.equal(apply.status, 501, apply.text);
  assert.match(apply.text, /No application handler exists for this integration object type/i);

  const persisted = inspectDatabase(database, staged.json.id);
  assert.equal(persisted.batch.status, 'staged');
  assert.equal(persisted.batch.applied_count, 0);
  assert.equal(persisted.record.status, 'valid');
  assert.equal(persisted.record.canonical.status, 'inactive');
  assert.equal(persisted.record.canonical.authority, 'identity-reference-only');
  assert.equal(persisted.user.email, 'payroll@northstar.example');
  assert.ok(persisted.sessionCount >= 2);
  assert.equal(persisted.audit, 1);

  await stop(running.child);
  running = await start(runtime, database, port);
  const afterRestartExisting = await payrollDashboard(running.origin, payrollCookie);
  assert.equal(afterRestartExisting.status, 200, afterRestartExisting.text);
  const postRestartCookie = await login(running.origin, 'payroll@northstar.example');
  const afterRestartNew = await payrollDashboard(running.origin, postRestartCookie);
  assert.equal(afterRestartNew.status, 200, afterRestartNew.text);

  console.log(JSON.stringify({
    classification: 'BLOCKED',
    claim: 'enterprise identity lifecycle deprovisioning',
    evidenceBoundary: 'local synthetic connector + authenticated HTTP + SQLite on exact sealed artifact',
    beforeInactiveSignal: { existingSessionStatus: before.status },
    inactiveSignal: {
      ingestStatus: staged.status,
      batchStatus: staged.json.status,
      canonicalAuthority: persisted.record.canonical.authority,
      reviewedApplyStatus: apply.status,
      appliedCount: persisted.batch.applied_count,
    },
    afterInactiveSignal: { existingSessionStatus: afterStage.status, newLoginStatus: 200 },
    afterRestart: { existingSessionStatus: afterRestartExisting.status, newLoginStatus: afterRestartNew.status },
    exactArtifactSha256: expectedArtifactSha256,
  }, null, 2));
});
