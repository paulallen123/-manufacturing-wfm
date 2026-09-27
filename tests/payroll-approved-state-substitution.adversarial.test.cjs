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
    if (child.exitCode !== null) return { child, origin, output, healthy: false };
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin, output, healthy: true }; } catch {}
    await delay(50);
  }
  return { child, origin, output, healthy: false };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2_000).then(() => child.kill('SIGKILL'))]);
}

async function request(origin, requestPath, { method = 'GET', cookie, body } = {}) {
  const headers = { 'User-Agent': 'payroll-approved-state-substitution/1' };
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
  return { response, status: response.status, ok: response.ok, text, json };
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

async function command(origin, cookie, name, payload) {
  return request(origin, '/api/command', {
    method: 'POST', cookie, body: { version: await version(origin, cookie), command: name, payload },
  });
}

function rewriteTenantState(database, mutate) {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  mutate(state);
  db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state), 'northstar-demo');
  db.close();
}

test('approved payroll amount substitution is contained before export', async t => {
  // This must fail if export trusts a mutable approved amount instead of the reviewed proposal/evidence seal.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-approved-state-substitution-'));
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
  assert.equal(running.healthy, true, running.output.join(''));
  await stop(running.child);
  rewriteTenantState(database, state => {
    const payrollPeriod = state.payrollControl.periods.find(item => item.id === period);
    payrollPeriod.batches = [{ id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) }];
  });

  running = await start(runtime, database, port);
  const payroll = await login(running.origin, 'payroll@northstar.example');
  const approver = await login(running.origin, 'superuser@northstar.example');
  const proposed = await command(running.origin, payroll, 'payroll-adjustment-propose', {
    period,
    record: 'wr-e0-2026-09-07',
    clockIn: '2026-09-07T05:00:00.000Z',
    clockOut: '2026-09-07T13:30:00.000Z',
    breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
    breaksConfirmed: true,
    reason: 'Synthetic post-release correction for approval-seal testing.',
  });
  assert.equal(proposed.status, 200, proposed.text);
  const approved = await command(running.origin, approver, 'payroll-adjustment-approve', {
    id: proposed.json.result.id,
    revision: 1,
    checked: true,
    decision: 'approve',
    reason: 'Independent synthetic approval of the original calculated amount.',
  });
  assert.equal(approved.status, 200, approved.text);
  await stop(running.child);

  let originalGrossMinor;
  const substitutedGrossMinor = 123456;
  rewriteTenantState(database, state => {
    const adjustment = state.payrollControl.adjustments.find(item => item.id === proposed.json.result.id);
    originalGrossMinor = adjustment.grossMinorDelta;
    assert.notEqual(originalGrossMinor, substitutedGrossMinor);
    adjustment.grossMinorDelta = substitutedGrossMinor;
    adjustment.grossPenceDelta = substitutedGrossMinor;
  });

  running = await start(runtime, database, port);
  let exportStatus = null;
  let exportedRows = null;
  let exportedCsv = '';
  if (running.healthy) {
    const freshApprover = await login(running.origin, 'superuser@northstar.example');
    const exported = await command(running.origin, freshApprover, 'payroll-adjustment-export', { period, checked: true });
    exportStatus = exported.status;
    if (exported.status === 200) {
      exportedRows = exported.json.result.rows;
      const download = await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(exported.json.result.id)}`, { cookie: freshApprover });
      exportedCsv = download.text;
    }
  }
  const substitutedValueReachedExport = exportedCsv.includes(`\"${substitutedGrossMinor}\"`);
  const contained = !running.healthy || exportStatus === 409 || exportStatus === 503;

  console.log(JSON.stringify({
    originalGrossMinor,
    substitutedGrossMinor,
    runtimeHealthyAfterSubstitution: running.healthy,
    exportStatus,
    exportedRows,
    substitutedValueReachedExport,
    contained,
  }, null, 2));

  assert.equal(contained, true, 'an approved amount changed after review must fail closed before payroll export');
  assert.equal(substitutedValueReachedExport, false, 'unreviewed substituted minor units must never reach an export');
});
