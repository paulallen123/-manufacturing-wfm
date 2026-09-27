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
const password = 'Factory-local-demo-2026!';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(runtime, database, port, checkpoint = {}) {
  const output = [];
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: runtime,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      WFM_DB: database,
      ...checkpoint,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) return { child, origin, output, healthy: false };
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return { child, origin, output, healthy: true };
    } catch {}
    await delay(50);
  }
  return { child, origin, output, healthy: false };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2_000).then(() => child.kill('SIGKILL')),
  ]);
}

async function request(origin, requestPath, { method = 'GET', cookie, body } = {}) {
  const headers = { 'User-Agent': 'vector-stale-restore-proof/1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers.Origin = origin;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${origin}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    text,
    json: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
  };
}

async function login(origin, email) {
  const result = await request(origin, '/api/login', { method: 'POST', body: { email, password } });
  assert.equal(result.response.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

function updateState(database, mutate) {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  mutate(state);
  db.prepare('UPDATE tenants SET version=?,state=? WHERE id=?').run(state.version, JSON.stringify(state), 'northstar-demo');
  db.close();
}

async function command(origin, cookie, version, name, payload) {
  const result = await request(origin, '/api/command', {
    method: 'POST', cookie, body: { version, command: name, payload },
  });
  assert.equal(result.response.status, 200, result.text);
  return result.json;
}

test('stale database restore is detected before consequential payroll is served', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-stale-restore-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  const staleBackup = path.join(root, 'stale-backup.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  const port = await freePort();
  let running;
  t.after(async () => {
    if (running) await stopServer(running.child);
    fs.rmSync(root, { recursive: true, force: true });
  });

  running = await startServer(runtime, database, port);
  assert.equal(running.healthy, true, running.output.join(''));
  await stopServer(running.child);
  updateState(database, (state) => {
    const period = state.payrollControl.periods.find((item) => item.id === '2026-09-07');
    period.batches = [{ id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) }];
    state.version += 1;
  });
  fs.copyFileSync(database, staleBackup);

  running = await startServer(runtime, database, port);
  assert.equal(running.healthy, true, running.output.join(''));
  const payrollCookie = await login(running.origin, 'payroll@northstar.example');
  const approverCookie = await login(running.origin, 'superuser@northstar.example');
  const bootstrap = await request(running.origin, '/api/bootstrap', { cookie: payrollCookie });
  const proposed = await command(running.origin, payrollCookie, bootstrap.json.state.version, 'payroll-adjustment-propose', {
    period: '2026-09-07',
    record: 'wr-e0-2026-09-07',
    clockIn: '2026-09-07T05:00:00.000Z',
    clockOut: '2026-09-07T13:30:00.000Z',
    breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
    breaksConfirmed: true,
    reason: 'Synthetic stale-restore adversarial proof.',
  });
  const approved = await command(running.origin, approverCookie, proposed.version, 'payroll-adjustment-approve', {
    id: proposed.result.id,
    revision: 1,
    checked: true,
    decision: 'approve',
    reason: 'Independent synthetic approval.',
  });
  const exported = await command(running.origin, approverCookie, approved.version, 'payroll-adjustment-export', {
    period: '2026-09-07',
    checked: true,
  });
  const batchId = exported.result.id;
  const download = await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(batchId)}`, { cookie: approverCookie });
  assert.equal(download.response.status, 200, download.text);
  await stopServer(running.child);

  const latest = new DatabaseSync(database, { readOnly: true });
  const latestRow = latest.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  const latestAuditId = latest.prepare('SELECT max(id) AS id FROM audit_events WHERE tenant=?').get('northstar-demo').id;
  latest.close();
  const checkpoint = {
    WFM_EXPECTED_TENANT_STATE_VERSION: String(latestRow.version),
    WFM_EXPECTED_TENANT_STATE_SHA256: createHash('sha256').update(latestRow.state).digest('hex'),
    WFM_EXPECTED_AUDIT_EVENT_ID: String(latestAuditId),
  };

  fs.copyFileSync(staleBackup, database);
  running = await startServer(runtime, database, port, checkpoint);
  const stale = new DatabaseSync(database, { readOnly: true });
  const staleRow = stale.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  stale.close();
  let dashboardStatus = null;
  let exportStatus = null;
  if (running.healthy) {
    const cookie = await login(running.origin, 'superuser@northstar.example');
    dashboardStatus = (await request(running.origin, '/api/payroll-run?period=2026-09-07', { cookie })).response.status;
    exportStatus = (await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(batchId)}`, { cookie })).response.status;
  }

  console.log(JSON.stringify({
    expectedVersion: Number(checkpoint.WFM_EXPECTED_TENANT_STATE_VERSION),
    restoredVersion: staleRow.version,
    expectedStateSha256: checkpoint.WFM_EXPECTED_TENANT_STATE_SHA256,
    restoredStateSha256: createHash('sha256').update(staleRow.state).digest('hex'),
    expectedAuditEventId: Number(checkpoint.WFM_EXPECTED_AUDIT_EVENT_ID),
    runtimeHealthyAfterRollback: running.healthy,
    dashboardStatus,
    lostExportStatus: exportStatus,
  }, null, 2));

  assert.equal(
    running.healthy,
    false,
    'runtime must fail closed when restored payroll state is older than the independently retained checkpoint',
  );
});
