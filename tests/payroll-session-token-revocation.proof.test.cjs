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
  const headers = { 'User-Agent': 'payroll-session-revocation-proof/1' };
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

async function login(origin) {
  const result = await request(origin, '/api/login', {
    method: 'POST',
    body: { email: 'payroll@northstar.example', password },
  });
  assert.equal(result.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

function tokenHash(cookie) {
  return createHash('sha256').update(cookie.split('=')[1]).digest('hex');
}

function sessionRows(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  const rows = db.prepare('SELECT token_hash,email FROM sessions WHERE email=? ORDER BY token_hash').all('payroll@northstar.example');
  db.close();
  return rows;
}

async function payrollDashboard(origin, cookie) {
  return request(origin, `/api/payroll-run?period=${period}`, { cookie });
}

test('logout revokes only the presented payroll session token immediately and after restart', async t => {
  // Removing the exact token deletion from logout would leave the revoked bearer usable and fail this proof.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-session-revocation-'));
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
  const revokedCookie = await login(running.origin);
  const retainedCookie = await login(running.origin);
  assert.notEqual(revokedCookie, retainedCookie, 'parallel logins must receive distinct bearer tokens');

  const beforeRevoked = await payrollDashboard(running.origin, revokedCookie);
  const beforeRetained = await payrollDashboard(running.origin, retainedCookie);
  assert.equal(beforeRevoked.status, 200, beforeRevoked.text);
  assert.equal(beforeRetained.status, 200, beforeRetained.text);
  assert.equal(sessionRows(database).length, 2);

  const logout = await request(running.origin, '/api/logout', {
    method: 'POST',
    cookie: revokedCookie,
    body: {},
  });
  assert.equal(logout.status, 200, logout.text);
  const setCookie = logout.response.headers.getSetCookie()[0];
  assert.match(setCookie, /^wfm_session=;/);
  assert.match(setCookie, /Max-Age=0/);

  const immediatelyRevoked = await payrollDashboard(running.origin, revokedCookie);
  const immediatelyRetained = await payrollDashboard(running.origin, retainedCookie);
  const rowsAfterLogout = sessionRows(database);
  assert.equal(immediatelyRevoked.status, 401, immediatelyRevoked.text);
  assert.equal(immediatelyRetained.status, 200, immediatelyRetained.text);
  assert.equal(rowsAfterLogout.some(row => row.token_hash === tokenHash(revokedCookie)), false);
  assert.equal(rowsAfterLogout.some(row => row.token_hash === tokenHash(retainedCookie)), true);

  await stop(running.child);
  running = await start(runtime, database, port);
  const afterRestartRevoked = await payrollDashboard(running.origin, revokedCookie);
  const afterRestartRetained = await payrollDashboard(running.origin, retainedCookie);
  assert.equal(afterRestartRevoked.status, 401, afterRestartRevoked.text);
  assert.equal(afterRestartRetained.status, 200, afterRestartRetained.text);

  console.log(JSON.stringify({
    beforeLogout: { revokedTokenStatus: beforeRevoked.status, retainedTokenStatus: beforeRetained.status, sessionCount: 2 },
    immediatelyAfterLogout: { revokedTokenStatus: immediatelyRevoked.status, retainedTokenStatus: immediatelyRetained.status, sessionCount: rowsAfterLogout.length },
    afterRestart: { revokedTokenStatus: afterRestartRevoked.status, retainedTokenStatus: afterRestartRetained.status },
    clearCookieHeaderObserved: true,
    revokedTokenRowDeleted: true,
    retainedTokenRowPreserved: true,
    exactArtifactSha256: expectedArtifactSha256,
  }, null, 2));
});
