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
const hardener = path.resolve(process.env.WFM_LEAVE_AUDIT_HARDENER || 'candidate-bc4/scripts/harden-leave-audit-linkage.mjs');
const expectedArtifactSha256 = 'dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da';
const password = 'Factory-local-demo-2026!';
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
  const headers = { 'User-Agent': 'leave-audit-correlation-attack/1' };
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
  const result = await request(origin, '/api/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(result.status, 200, result.text);
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

function command(origin, cookie, version, name, payload) {
  return request(origin, '/api/command', {
    method: 'POST',
    cookie,
    body: { command: name, payload, version },
  });
}

function rewriteLeaveDecision(database, requestId) {
  const db = new DatabaseSync(database);
  const row = db.prepare('SELECT state FROM tenants WHERE id=?').get('northstar-demo');
  const state = JSON.parse(row.state);
  const leave = state.requests.find(item => item.id === requestId);
  const audit = state.audit.find(item => item.type === 'leave-decision' && item.note === `${requestId}; declined`);
  assert.ok(leave, 'leave request must exist before the attack');
  assert.ok(audit, 'request-bound domain audit must exist before the attack');
  leave.status = 'approved';
  leave.decisionReason = 'Coverage and balance checks passed';
  audit.note = `${requestId}; approved`;
  db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state), 'northstar-demo');
  const commandAudit = db.prepare("SELECT id,action,detail FROM audit_events WHERE tenant=? AND action='leave-decision' ORDER BY id DESC LIMIT 1").get('northstar-demo');
  db.close();
  return commandAudit;
}

test('restart refuses jointly rewritten leave state and domain audit without immutable decision linkage', async t => {
  // A startup/read invariant that correlates the exact decision with immutable audit evidence would make this pass.
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-audit-correlation-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  execFileSync(process.execPath, [hardener, path.join(runtime, 'public')]);
  const port = await freePort();
  let running;
  t.after(async () => {
    await stop(running?.child);
    fs.rmSync(root, { recursive: true, force: true });
  });

  running = await start(runtime, database, port);
  const employeeCookie = await login(running.origin, 'maya@northstar.example');
  const managerCookie = await login(running.origin, 'manager@northstar.example');
  const employeeBootstrap = await request(running.origin, '/api/bootstrap', { cookie: employeeCookie });
  const personal = await request(running.origin, '/api/personal', { cookie: employeeCookie });
  assert.equal(employeeBootstrap.status, 200, employeeBootstrap.text);
  assert.equal(personal.status, 200, personal.text);
  const requestedDates = new Set(employeeBootstrap.json.state.requests.map(item => item.date));
  const shift = personal.json.shifts.find(item => item.start && !requestedDates.has(item.start.slice(0, 10)));
  assert.ok(shift, 'a synthetic unrequested shift is required');

  const submitted = await command(
    running.origin,
    employeeCookie,
    employeeBootstrap.json.state.version,
    'leave-request',
    { date: shift.start.slice(0, 10), hours: 7.5 },
  );
  assert.equal(submitted.status, 200, submitted.text);
  const requestId = submitted.json.result.id;

  const managerBootstrap = await request(running.origin, '/api/bootstrap', { cookie: managerCookie });
  assert.equal(managerBootstrap.status, 200, managerBootstrap.text);
  const declined = await command(
    running.origin,
    managerCookie,
    managerBootstrap.json.state.version,
    'leave-decision',
    { id: requestId, decision: 'declined', reviewed: true, reason: 'Synthetic coverage review evidence.' },
  );
  assert.equal(declined.status, 200, declined.text);
  assert.equal(declined.json.result.status, 'declined');

  await stop(running.child);
  const immutableAudit = rewriteLeaveDecision(database, requestId);
  assert.ok(immutableAudit, 'the append-only command audit must remain present');
  assert.deepEqual(JSON.parse(immutableAudit.detail), { version: declined.json.version, resultId: requestId });

  running = await start(runtime, database, port);
  const afterRestart = await request(running.origin, '/api/bootstrap', { cookie: managerCookie });
  const rewrittenRequest = afterRestart.json?.state?.requests?.find(item => item.id === requestId);
  const rewrittenAudit = afterRestart.json?.state?.audit?.find(item => item.type === 'leave-decision' && item.note === `${requestId}; approved`);
  console.log(JSON.stringify({
    afterRestartStatus: afterRestart.status,
    requestId,
    storedDecisionAfterAttack: rewrittenRequest?.status,
    domainAuditAfterAttack: rewrittenAudit?.note,
    immutableCommandAudit: immutableAudit,
    exactArtifactSha256: expectedArtifactSha256,
  }, null, 2));

  assert.notEqual(
    afterRestart.status,
    200,
    'service accepted a rewritten leave decision and matching mutable domain audit without immutable decision correlation',
  );
});
