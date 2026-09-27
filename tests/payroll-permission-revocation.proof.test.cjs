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
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', WFM_DB: database },
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

async function request(origin, requestPath, { method = 'GET', cookie, body } = {}) {
  const headers = { 'User-Agent': 'payroll-permission-revocation-proof/1' };
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
  let json;
  try { json = JSON.parse(text); } catch {}
  return { response, status: response.status, text, json };
}

async function login(origin, email) {
  const result = await request(origin, '/api/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

async function version(origin, cookie) {
  const result = await request(origin, '/api/bootstrap', { cookie });
  assert.equal(result.status, 200, result.text);
  return result.json.state.version;
}

async function propose(origin, cookie) {
  return request(origin, '/api/command', {
    method: 'POST',
    cookie,
    body: {
      version: await version(origin, cookie),
      command: 'payroll-adjustment-propose',
      payload: {
        period,
        record: 'wr-e0-2026-09-07',
        clockIn: '2026-09-07T05:00:00.000Z',
        clockOut: '2026-09-07T13:30:00.000Z',
        breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
        breaksConfirmed: true,
        reason: 'Synthetic permission-revocation proof.',
      },
    },
  });
}

function seedReleasedBatch(database) {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  state.payrollControl.periods.find(item => item.id === period).batches = [
    { id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) },
  ];
  db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state), 'northstar-demo');
  db.close();
}

test('revoked payroll permissions stop an existing session immediately and after restart', async t => {
  // Removing the live user lookup or caching permissions in the session would make this transition fail.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-permission-revocation-'));
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
  await stop(running.child);
  seedReleasedBatch(database);
  running = await start(runtime, database, port);

  const payrollCookie = await login(running.origin, 'payroll@northstar.example');
  const adminCookie = await login(running.origin, 'superuser@northstar.example');
  const beforeDashboard = await request(running.origin, `/api/payroll-run?period=${period}`, { cookie: payrollCookie });
  assert.equal(beforeDashboard.status, 200, beforeDashboard.text);

  const revoked = await request(running.origin, '/api/company-admin/command', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      version: await version(running.origin, adminCookie),
      command: 'account-permissions',
      payload: { email: 'payroll@northstar.example', permissions: [] },
    },
  });
  assert.equal(revoked.status, 200, revoked.text);

  const afterDashboard = await request(running.origin, `/api/payroll-run?period=${period}`, { cookie: payrollCookie });
  const afterPropose = await propose(running.origin, payrollCookie);
  assert.equal(afterDashboard.status, 403, afterDashboard.text);
  assert.equal(afterPropose.status, 403, afterPropose.text);

  await stop(running.child);
  running = await start(runtime, database, port);
  const afterRestartDashboard = await request(running.origin, `/api/payroll-run?period=${period}`, { cookie: payrollCookie });
  const afterRestartPropose = await propose(running.origin, payrollCookie);
  assert.equal(afterRestartDashboard.status, 403, afterRestartDashboard.text);
  assert.equal(afterRestartPropose.status, 403, afterRestartPropose.text);

  const db = new DatabaseSync(database, { readOnly: true });
  const permissions = JSON.parse(db.prepare('SELECT permissions FROM users WHERE email=?').get('payroll@northstar.example').permissions);
  const audit = db.prepare("SELECT actor,detail FROM audit_events WHERE tenant=? AND action='account-permissions' ORDER BY id DESC LIMIT 1").get('northstar-demo');
  db.close();
  assert.deepEqual(permissions, []);
  assert.ok(audit, 'permission revocation must leave an audit event');
  assert.deepEqual(JSON.parse(audit.detail), { email: 'payroll@northstar.example', permissions: [] });

  console.log(JSON.stringify({
    beforeRevocation: { dashboardStatus: beforeDashboard.status },
    immediateAfterRevocation: { dashboardStatus: afterDashboard.status, proposalStatus: afterPropose.status },
    afterRestart: { dashboardStatus: afterRestartDashboard.status, proposalStatus: afterRestartPropose.status },
    persistedPermissions: permissions,
    auditActor: audit.actor,
    sameSessionCookieReused: true,
  }, null, 2));
});
