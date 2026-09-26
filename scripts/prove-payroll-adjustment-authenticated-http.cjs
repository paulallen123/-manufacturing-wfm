const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-authenticated-payroll-'));
const artifact = process.env.WFM_SEALED_RUNTIME_ARTIFACT
  ? path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT)
  : path.resolve(__dirname, '..', 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz');
const runtime = path.join(proofRoot, 'runtime');
fs.mkdirSync(runtime);
execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
const database = path.join(proofRoot, 'proof.sqlite');
const password = 'Factory-local-demo-2026!';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(port) {
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
  const headers = { 'User-Agent': 'vector-trust-proof/1' };
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
  if (!response.ok) throw new Error(`${method} ${requestPath} -> ${response.status}: ${text}`);
  return { response, text, json: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}

async function login(origin, email) {
  const result = await request(origin, '/api/login', {
    method: 'POST',
    body: { email, password },
  });
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

function addSyntheticReleasedBatch() {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT version,state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  const period = state.payrollControl.periods.find((item) => item.id === '2026-09-07');
  period.batches = [{ id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) }];
  state.version = Number(state.version) + 1;
  db.prepare('UPDATE tenants SET version=?,state=? WHERE id=?').run(state.version, JSON.stringify(state), 'northstar-demo');
  db.close();
}

async function main() {
  const port = await freePort();
  let running = await startServer(port);
  await stopServer(running.child);
  addSyntheticReleasedBatch();

  running = await startServer(port);
  const payrollCookie = await login(running.origin, 'payroll@northstar.example');
  const approverCookie = await login(running.origin, 'superuser@northstar.example');
  const bootstrap = await request(running.origin, '/api/bootstrap', { cookie: payrollCookie });
  const version = bootstrap.json.state.version;

  const proposed = await request(running.origin, '/api/command', {
    method: 'POST',
    cookie: payrollCookie,
    body: {
      version,
      command: 'payroll-adjustment-propose',
      payload: {
        period: '2026-09-07',
        record: 'wr-e0-2026-09-07',
        clockIn: '2026-09-07T05:00:00.000Z',
        clockOut: '2026-09-07T13:30:00.000Z',
        breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
        breaksConfirmed: true,
        reason: 'Authenticated synthetic test of a post-release payroll correction.',
      },
    },
  });

  const approved = await request(running.origin, '/api/command', {
    method: 'POST',
    cookie: approverCookie,
    body: {
      version: proposed.json.version,
      command: 'payroll-adjustment-approve',
      payload: {
        id: proposed.json.result.id,
        revision: 1,
        checked: true,
        decision: 'approve',
        reason: 'Independent authenticated reviewer inspected the synthetic evidence.',
      },
    },
  });

  const exported = await request(running.origin, '/api/command', {
    method: 'POST',
    cookie: approverCookie,
    body: {
      version: approved.json.version,
      command: 'payroll-adjustment-export',
      payload: { period: '2026-09-07', checked: true },
    },
  });
  const batchId = exported.json.result.id;
  const firstDownload = await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(batchId)}`, { cookie: approverCookie });
  await stopServer(running.child);

  running = await startServer(port);
  const restartCookie = await login(running.origin, 'superuser@northstar.example');
  const dashboard = await request(running.origin, '/api/payroll-run?period=2026-09-07', { cookie: restartCookie });
  const secondDownload = await request(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(batchId)}`, { cookie: restartCookie });
  await stopServer(running.child);

  const adjustment = dashboard.json.adjustments.find((item) => item.id === proposed.json.result.id);
  const batch = dashboard.json.adjustmentBatches.find((item) => item.id === batchId);
  const digest = createHash('sha256').update(secondDownload.text, 'utf8').digest('hex');
  console.log(JSON.stringify({
    authenticatedHttp: true,
    sqlitePersistence: true,
    safeRestartReadback: Boolean(adjustment && batch && secondDownload.text === firstDownload.text),
    proposed: proposed.json,
    approved: approved.json,
    exported: exported.json,
    storedFields: Object.keys(adjustment).sort(),
    hasCurrency: Object.hasOwn(adjustment, 'currency'),
    hasMinorUnitExponent: Object.hasOwn(adjustment, 'minorUnitExponent'),
    hasCurrencySource: Object.hasOwn(adjustment, 'currencySource'),
    exportSchema: batch.schema,
    exportSha256: digest,
    headerSha256: secondDownload.response.headers.get('x-export-sha256'),
    csv: secondDownload.text,
    auditTypes: dashboard.json.audit.slice(-3).map((item) => item.type),
  }, null, 2));
  fs.rmSync(proofRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
