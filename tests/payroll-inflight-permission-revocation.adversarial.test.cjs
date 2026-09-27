const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin, output }; } catch {}
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
  const headers = { 'User-Agent': 'payroll-inflight-revocation-proof/1' };
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

function sessionTokenHash(cookie) {
  return createHash('sha256').update(cookie.split('=')[1]).digest('hex');
}

function markSessionUnseen(database, cookie) {
  const db = new DatabaseSync(database);
  const changed = db.prepare('UPDATE sessions SET last_seen=0 WHERE token_hash=?').run(sessionTokenHash(cookie));
  db.close();
  assert.equal(changed.changes, 1);
}

async function waitForAuthorizationCheck(database, cookie) {
  const tokenHash = sessionTokenHash(cookie);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const db = new DatabaseSync(database, { readOnly: true });
    const row = db.prepare('SELECT last_seen FROM sessions WHERE token_hash=?').get(tokenHash);
    db.close();
    if (Number(row?.last_seen) > 0) return Number(row.last_seen);
    await delay(10);
  }
  throw Error('held request did not complete its authorization check');
}

function heldJsonRequest(origin, cookie, payload) {
  const body = JSON.stringify(payload);
  const split = Math.max(1, Math.floor(body.length / 2));
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const target = new URL('/api/command', origin);
  const req = http.request({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'payroll-inflight-revocation-proof/1',
    },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      let json;
      try { json = JSON.parse(text); } catch {}
      resolveResult({ status: response.statusCode, text, json });
    });
  });
  req.on('error', rejectResult);
  req.write(body.slice(0, split));
  return {
    result,
    release: () => req.end(body.slice(split)),
  };
}

function adjustmentCount(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  const state = JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get('northstar-demo').state);
  const count = state.payrollControl.adjustments?.length || 0;
  db.close();
  return count;
}

test('revoking payroll permissions cancels a request authorized before its body completes', async t => {
  // Removing the live-authority recheck immediately before mutation would allow this held request to commit.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-inflight-revocation-'));
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
  const initialVersion = await version(running.origin, payrollCookie);
  const beforeCount = adjustmentCount(database);
  markSessionUnseen(database, payrollCookie);

  const held = heldJsonRequest(running.origin, payrollCookie, {
    version: initialVersion,
    command: 'payroll-adjustment-propose',
    payload: {
      period,
      record: 'wr-e0-2026-09-07',
      clockIn: '2026-09-07T05:00:00.000Z',
      clockOut: '2026-09-07T13:30:00.000Z',
      breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
      breaksConfirmed: true,
      reason: 'Synthetic in-flight permission-revocation proof.',
    },
  });
  const authorizationObservedAt = await waitForAuthorizationCheck(database, payrollCookie);

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

  held.release();
  const completed = await held.result;
  const afterCount = adjustmentCount(database);

  console.log(JSON.stringify({
    authorizationObservedAt,
    permissionRevocationStatus: revoked.status,
    heldRequestStatus: completed.status,
    adjustmentCountBefore: beforeCount,
    adjustmentCountAfter: afterCount,
    exactArtifactSha256: expectedArtifactSha256,
  }, null, 2));

  assert.equal(completed.status, 403, `held request crossed revocation and returned ${completed.status}: ${completed.text}`);
  assert.equal(afterCount, beforeCount, 'revoked in-flight request must not create a payroll adjustment');
});
