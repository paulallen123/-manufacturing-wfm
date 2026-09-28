const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const expectedArtifactSha256 = 'dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da';
const artifact = path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT || 'sealed-runtime-4bd3.tar.gz');
const period = '2026-09-07';
const password = 'Factory-local-demo-2026!';
const reviewReason = 'Synthetic idempotency attack; no customer or provider action.';

const digest = value => createHash('sha256').update(value).digest('hex');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

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
    await wait(50);
  }
  throw Error(`runtime did not become healthy: ${output.join('')}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2_000).then(() => child.kill('SIGKILL'))]);
}

async function call(origin, requestPath, { method = 'GET', cookie, body } = {}) {
  const headers = { 'User-Agent': 'payroll-idempotency-attack/1' };
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

async function ok(origin, requestPath, options) {
  const result = await call(origin, requestPath, options);
  assert.equal(result.response.ok, true, `${options?.method || 'GET'} ${requestPath} -> ${result.status}: ${result.text}`);
  return result;
}

async function login(origin, email) {
  const result = await ok(origin, '/api/login', { method: 'POST', body: { email, password } });
  return result.response.headers.getSetCookie()[0].split(';')[0];
}

async function currentVersion(origin, cookie) {
  return (await ok(origin, '/api/bootstrap', { cookie })).json.state.version;
}

async function command(origin, cookie, name, payload, idempotencyKey) {
  return ok(origin, '/api/command', {
    method: 'POST',
    cookie,
    body: { command: name, payload, version: await currentVersion(origin, cookie), idempotencyKey },
  });
}

async function weekly(origin, cookie) {
  return (await ok(origin, `/api/weekly-review?period=${period}`, { cookie })).json;
}

async function prepareReleasedPayroll(origin, director, payroll) {
  const initial = await weekly(origin, director);
  for (const originalTeam of initial.teams) {
    for (const originalIssue of originalTeam.issues.filter(issue => issue.status === 'open')) {
      const team = (await weekly(origin, director)).teams.find(item => item.id === originalTeam.id);
      const issue = team.issues.find(item => item.id === originalIssue.id);
      const row = team.records.find(item => item.id === issue.row);
      const payload = { period, team: team.id, revision: team.revision, issue: issue.id, checked: true, reason: reviewReason };
      if (['missing', 'sync'].includes(issue.type)) Object.assign(payload, {
        outcome: 'worked', clockIn: `${row.date}T06:00`, clockOut: `${row.date}T14:00`,
        breakStart: `${row.date}T10:00`, breakEnd: `${row.date}T10:30`, breaksConfirmed: true,
      });
      if (issue.type === 'adjustment') payload.decision = 'accept';
      if (issue.type === 'overtime') payload.decision = 'approve';
      await command(origin, director, 'review-resolve', payload);
    }
  }
  for (const summary of (await weekly(origin, director)).teams) {
    let team = (await weekly(origin, director)).teams.find(item => item.id === summary.id);
    for (const category of team.categories) {
      await command(origin, director, 'review-check', { period, team: team.id, revision: team.revision, category: category.id, checked: true });
      team = (await weekly(origin, director)).teams.find(item => item.id === summary.id);
    }
    for (const employee of team.employees) {
      await command(origin, director, 'review-check', { period, team: team.id, revision: team.revision, employee: employee.id, checked: true });
      team = (await weekly(origin, director)).teams.find(item => item.id === summary.id);
    }
    await command(origin, director, 'review-sign', { period, team: team.id, revision: team.revision, checked: true, attestation: 'confirmed' });
  }
  await command(origin, payroll, 'payroll-release', { period, checked: true, schemaReviewed: true });
}

test('replaying one payroll proposal key cannot create a second authoritative adjustment', async () => {
  // This must fail if /api/command ignores idempotency keys for consequential payroll writes.
  assert.equal(digest(fs.readFileSync(artifact)), expectedArtifactSha256, 'sealed runtime artifact digest changed');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-idempotency-attack-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  const port = await freePort();
  let running;
  try {
    running = await start(runtime, database, port);
    const director = await login(running.origin, 'superuser@northstar.example');
    const payroll = await login(running.origin, 'payroll@northstar.example');
    await prepareReleasedPayroll(running.origin, director, payroll);

    const payload = {
      period,
      record: 'wr-e0-2026-09-07',
      clockIn: '2026-09-07T05:00:00.000Z',
      clockOut: '2026-09-07T13:30:00.000Z',
      breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
      breaksConfirmed: true,
      reason: 'Synthetic correction replay after an ambiguous network response.',
    };
    const idempotencyKey = 'payroll-proposal-replay-0001';
    const first = await command(running.origin, payroll, 'payroll-adjustment-propose', payload, idempotencyKey);

    // Simulate a client that lost the first response, refreshed, and safely retried the same operation.
    const replay = await command(running.origin, payroll, 'payroll-adjustment-propose', payload, idempotencyKey);
    const dashboard = await ok(running.origin, `/api/payroll-run?period=${period}`, { cookie: payroll });
    const matching = dashboard.json.adjustments.filter(item => item.record === payload.record && item.reason === payload.reason);
    for (const adjustment of matching) {
      await command(running.origin, director, 'payroll-adjustment-approve', {
        id: adjustment.id,
        revision: adjustment.revision,
        checked: true,
        decision: 'approve',
        reason: 'Synthetic independent review of the duplicated proposal.',
      }, `approve-${adjustment.id}`);
    }
    const adjustmentRelease = await command(running.origin, director, 'payroll-adjustment-export', {
      period,
      checked: true,
    }, 'export-replayed-proposal-0001');

    assert.deepEqual({
      replayed: replay.json.replayed === true,
      firstAdjustmentId: first.json.result.id,
      replayAdjustmentId: replay.json.result.id,
      matchingAdjustments: matching.length,
      exportedRows: adjustmentRelease.json.result.rows,
    }, {
      replayed: true,
      firstAdjustmentId: first.json.result.id,
      replayAdjustmentId: first.json.result.id,
      matchingAdjustments: 1,
      exportedRows: 1,
    }, 'one retried proposal must replay the first result without creating or exporting duplicate payroll state');
  } finally {
    await stop(running?.child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
