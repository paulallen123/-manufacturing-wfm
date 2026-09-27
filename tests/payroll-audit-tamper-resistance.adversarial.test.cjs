const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
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

async function startServer(runtime, database, port) {
  const output = [];
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: runtime,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', WFM_DB: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited before health: ${output.join('')}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return { child, origin, output };
    } catch {}
    await delay(50);
  }
  child.kill('SIGTERM');
  throw new Error(`server did not become healthy: ${output.join('')}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2_000).then(() => child.kill('SIGKILL')),
  ]);
}

async function request(origin, requestPath, { method = 'GET', cookie, body } = {}) {
  const headers = { 'User-Agent': 'vector-audit-tamper-proof/1' };
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
  const result = await request(origin, '/api/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(result.response.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

function alterState(database, mutate) {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  mutate(state);
  db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state), 'northstar-demo');
  db.close();
}

async function createReleasedAdjustment(origin) {
  const payrollCookie = await login(origin, 'payroll@northstar.example');
  const approverCookie = await login(origin, 'superuser@northstar.example');
  const bootstrap = await request(origin, '/api/bootstrap', { cookie: payrollCookie });
  assert.equal(bootstrap.response.status, 200, bootstrap.text);
  const proposed = await request(origin, '/api/command', {
    method: 'POST', cookie: payrollCookie,
    body: {
      version: bootstrap.json.state.version,
      command: 'payroll-adjustment-propose',
      payload: {
        period: '2026-09-07',
        record: 'wr-e0-2026-09-07',
        clockIn: '2026-09-07T05:00:00.000Z',
        clockOut: '2026-09-07T13:30:00.000Z',
        breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
        breaksConfirmed: true,
        reason: 'Synthetic audit-tamper adversarial proof.',
      },
    },
  });
  assert.equal(proposed.response.status, 200, proposed.text);
  const approved = await request(origin, '/api/command', {
    method: 'POST', cookie: approverCookie,
    body: {
      version: proposed.json.version,
      command: 'payroll-adjustment-approve',
      payload: { id: proposed.json.result.id, revision: 1, checked: true, decision: 'approve', reason: 'Independent synthetic approval.' },
    },
  });
  assert.equal(approved.response.status, 200, approved.text);
  const exported = await request(origin, '/api/command', {
    method: 'POST', cookie: approverCookie,
    body: {
      version: approved.json.version,
      command: 'payroll-adjustment-export',
      payload: { period: '2026-09-07', checked: true },
    },
  });
  assert.equal(exported.response.status, 200, exported.text);
  return { approverCookie, batchId: exported.json.result.id };
}

test('consequential payroll state fails closed when its business audit history is erased', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-audit-tamper-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'proof.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  const port = await freePort();
  let running;
  t.after(async () => {
    if (running) await stopServer(running.child);
    fs.rmSync(root, { recursive: true, force: true });
  });

  running = await startServer(runtime, database, port);
  await stopServer(running.child);
  alterState(database, (state) => {
    const period = state.payrollControl.periods.find((item) => item.id === '2026-09-07');
    period.batches = [{ id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) }];
    state.version += 1;
  });
  running = await startServer(runtime, database, port);
  const journey = await createReleasedAdjustment(running.origin);
  await stopServer(running.child);

  const db = new DatabaseSync(database);
  const eventCount = db.prepare("SELECT count(*) AS n FROM audit_events WHERE tenant=? AND action LIKE 'payroll-adjustment-%'").get('northstar-demo').n;
  assert.ok(eventCount >= 3, 'separate append-only command audit must exist before tampering');
  assert.throws(() => db.prepare("UPDATE audit_events SET detail='{}' WHERE tenant=?").run('northstar-demo'), /append only/);
  assert.throws(() => db.prepare('DELETE FROM audit_events WHERE tenant=?').run('northstar-demo'), /append only/);
  db.close();

  alterState(database, (state) => {
    state.payrollControl.audit = [];
  });

  running = await startServer(runtime, database, port);
  const cookie = await login(running.origin, 'superuser@northstar.example');
  const dashboard = await request(running.origin, '/api/payroll-run?period=2026-09-07', { cookie });
  const download = await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(journey.batchId)}`, { cookie });

  console.log(JSON.stringify({
    separateAuditEventsBeforeTamper: eventCount,
    appendOnlyUpdateRejected: true,
    appendOnlyDeleteRejected: true,
    erasedBusinessAuditRowsReturned: dashboard.json?.audit?.length,
    adjustmentStatusAfterRestart: dashboard.json?.adjustments?.[0]?.status || null,
    dashboardStatus: dashboard.response.status,
    exportStatus: download.response.status,
    exportStillServed: download.response.ok,
  }, null, 2));

  assert.equal(
    dashboard.response.ok || download.response.ok,
    false,
    'runtime must detect erased payroll business audit before serving consequential payroll state or export',
  );
});
