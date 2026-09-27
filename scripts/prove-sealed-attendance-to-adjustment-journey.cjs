const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const expectedArtifactSha256 = 'dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da';
const artifact = path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT || path.join(__dirname, '..', 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz'));
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-sealed-payroll-journey-'));
const runtime = path.join(proofRoot, 'runtime');
const database = path.join(proofRoot, 'state.sqlite');
const period = '2026-09-07';
const password = 'Factory-local-demo-2026!';
const reason = 'Synthetic sealed-runtime journey only; no customer or provider action.';
const checks = [];

const digest = value => createHash('sha256').update(value).digest('hex');
assert.equal(digest(fs.readFileSync(artifact)), expectedArtifactSha256, 'sealed runtime artifact digest changed');
fs.mkdirSync(runtime);
execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start(port) {
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
  const headers = { 'User-Agent': 'vector-sealed-journey/1' };
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

async function command(origin, cookie, name, payload) {
  const bootstrap = await ok(origin, '/api/bootstrap', { cookie });
  return ok(origin, '/api/command', {
    method: 'POST', cookie, body: { command: name, payload, version: bootstrap.json.state.version },
  });
}

async function weekly(origin, cookie) {
  return (await ok(origin, `/api/weekly-review?period=${period}`, { cookie })).json;
}

async function main() {
  const port = await freePort();
  let running = await start(port);
  try {
    const director = await login(running.origin, 'superuser@northstar.example');
    const payroll = await login(running.origin, 'payroll@northstar.example');
    const otherTenant = await login(running.origin, 'otherpayroll@isolation.example');

    const initial = await weekly(running.origin, director);
    assert.equal(initial.teams.length, 4);
    let resolved = 0;
    for (const originalTeam of initial.teams) {
      for (const originalIssue of originalTeam.issues.filter(issue => issue.status === 'open')) {
        const team = (await weekly(running.origin, director)).teams.find(item => item.id === originalTeam.id);
        const issue = team.issues.find(item => item.id === originalIssue.id);
        const row = team.records.find(item => item.id === issue.row);
        const payload = { period, team: team.id, revision: team.revision, issue: issue.id, checked: true, reason };
        if (['missing', 'sync'].includes(issue.type)) Object.assign(payload, {
          outcome: 'worked', clockIn: `${row.date}T06:00`, clockOut: `${row.date}T14:00`,
          breakStart: `${row.date}T10:00`, breakEnd: `${row.date}T10:30`, breaksConfirmed: true,
        });
        if (issue.type === 'adjustment') payload.decision = 'accept';
        if (issue.type === 'overtime') payload.decision = 'approve';
        await command(running.origin, director, 'review-resolve', payload);
        resolved += 1;
      }
    }
    assert.equal(resolved, 7);
    checks.push('seven attendance exceptions resolved through authenticated rules');

    for (const summary of (await weekly(running.origin, director)).teams) {
      let team = (await weekly(running.origin, director)).teams.find(item => item.id === summary.id);
      for (const category of team.categories) {
        await command(running.origin, director, 'review-check', { period, team: team.id, revision: team.revision, category: category.id, checked: true });
        team = (await weekly(running.origin, director)).teams.find(item => item.id === summary.id);
      }
      for (const employee of team.employees) {
        await command(running.origin, director, 'review-check', { period, team: team.id, revision: team.revision, employee: employee.id, checked: true });
        team = (await weekly(running.origin, director)).teams.find(item => item.id === summary.id);
      }
      await command(running.origin, director, 'review-sign', { period, team: team.id, revision: team.revision, checked: true, attestation: 'confirmed' });
    }
    assert.ok((await weekly(running.origin, director)).teams.every(team => team.status === 'signed'));
    checks.push('four teams signed only after category and employee checks');

    const preparation = await ok(running.origin, `/api/payroll-run?period=${period}`, { cookie: payroll });
    assert.equal(preparation.json.canRelease, true, JSON.stringify(preparation.json.blockers));
    assert.equal(preparation.json.reconciliation.ok, true);
    const released = await command(running.origin, payroll, 'payroll-release', { period, checked: true, schemaReviewed: true });
    const payrollBatch = released.json.result.id;
    const payrollCsv = await ok(running.origin, `/api/payroll-export/${encodeURIComponent(payrollBatch)}`, { cookie: payroll });
    const payrollSha256 = digest(payrollCsv.text);
    assert.equal(payrollCsv.response.headers.get('x-export-sha256'), payrollSha256);
    assert.equal(payrollCsv.text.trim().split('\r\n').length - 1, 172);
    checks.push('172-row payroll export reconciled with an integrity checksum');

    const proposed = await command(running.origin, payroll, 'payroll-adjustment-propose', {
      period, record: 'wr-e0-2026-09-07',
      clockIn: '2026-09-07T05:00:00.000Z', clockOut: '2026-09-07T13:30:00.000Z',
      breaks: [{ start: '2026-09-07T09:00:00.000Z', end: '2026-09-07T09:30:00.000Z', paid: false }],
      breaksConfirmed: true, reason: 'Synthetic post-release correction after a reconciled payroll export.',
    });
    assert.deepEqual({
      currency: proposed.json.result.currency,
      minorUnitExponent: proposed.json.result.minorUnitExponent,
      currencySource: proposed.json.result.currencySource,
    }, { currency: 'GBP', minorUnitExponent: 2, currencySource: 'reviewed_cost_evidence' });
    const approved = await command(running.origin, director, 'payroll-adjustment-approve', {
      id: proposed.json.result.id, revision: 1, checked: true, decision: 'approve',
      reason: 'Independent reviewer checked the released source and proposed correction.',
    });
    assert.equal(approved.json.result.status, 'approved');
    const adjustmentRelease = await command(running.origin, director, 'payroll-adjustment-export', { period, checked: true });
    const adjustmentBatch = adjustmentRelease.json.result.id;
    const adjustmentCsv = await ok(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(adjustmentBatch)}`, { cookie: director });
    const adjustmentSha256 = digest(adjustmentCsv.text);
    assert.equal(adjustmentCsv.response.headers.get('x-export-sha256'), adjustmentSha256);
    assert.match(adjustmentCsv.text, /"gross_amount_delta_minor","currency","minor_unit_exponent","currency_source"/);
    checks.push('post-release adjustment used independently approved exact monetary provenance');

    assert.equal((await call(running.origin, `/api/payroll-export/${encodeURIComponent(payrollBatch)}`, { cookie: otherTenant })).status, 404);
    assert.equal((await call(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(adjustmentBatch)}`, { cookie: otherTenant })).status, 404);
    checks.push('both exports remained tenant-isolated');

    await stop(running.child);
    running = await start(port);
    const freshPayroll = await login(running.origin, 'payroll@northstar.example');
    const freshDirector = await login(running.origin, 'superuser@northstar.example');
    const saved = await ok(running.origin, `/api/payroll-run?period=${period}`, { cookie: freshDirector });
    assert.ok(saved.json.batches.some(item => item.id === payrollBatch));
    assert.ok(saved.json.adjustmentBatches.some(item => item.id === adjustmentBatch));
    assert.equal((await ok(running.origin, `/api/payroll-export/${encodeURIComponent(payrollBatch)}`, { cookie: freshPayroll })).text, payrollCsv.text);
    assert.equal((await ok(running.origin, `/api/payroll-adjustment-export/${encodeURIComponent(adjustmentBatch)}`, { cookie: freshDirector })).text, adjustmentCsv.text);
    assert.ok(saved.json.audit.some(item => item.type === 'payroll-adjustment-batch-released'));
    checks.push('fresh login after safe restart returned both exact exports and adjustment audit');

    const result = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      status: 'PASS',
      repository: 'paulallen123/-manufacturing-wfm',
      pullRequest: 225,
      candidateSourceSha: '4bd3ebcd51809d5190187b47a87e7f88f5beec0b',
      scope: 'Exact sealed runtime; local synthetic authenticated HTTP and SQLite only. No hosted browser, provider, customer or production proof.',
      node: process.version,
      exactNode22Executed: process.version === 'v22.23.2',
      artifact: {
        path: 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz',
        sha256: expectedArtifactSha256,
      },
      checks,
      attendanceExceptionsResolved: resolved,
      teamsSigned: 4,
      payrollExport: {
        id: payrollBatch,
        rows: 172,
        sha256: payrollSha256,
        checksumHeaderMatched: true,
      },
      adjustmentExport: {
        id: adjustmentBatch,
        rows: 1,
        sha256: adjustmentSha256,
        schema: 'reviewed-pay-adjustment-v2-minor-units',
        currency: 'GBP',
        minorUnitExponent: 2,
        currencySource: 'reviewed_cost_evidence',
        independentlyApproved: true,
        checksumHeaderMatched: true,
      },
      claims: {
        continuousAttendanceToAdjustmentJourney: 'BUILT',
        exactNode22DockerAdmission: process.version === 'v22.23.2' ? 'BUILT' : 'BLOCKED',
        hostedBrowserJourney: 'BLOCKED',
        providerReconciliation: 'BLOCKED',
        customerRelease: 'BLOCKED',
      },
    };
    if (process.env.WFM_PROOF_OUTPUT) fs.writeFileSync(path.resolve(process.env.WFM_PROOF_OUTPUT), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await stop(running.child);
    fs.rmSync(proofRoot, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
