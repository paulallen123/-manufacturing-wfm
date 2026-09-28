const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const artifact = path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT || 'sealed-runtime-4bd3.tar.gz');
const overlays = [
  path.resolve(process.env.WFM_LEAVE_AUDIT_HARDENER || 'scripts/harden-leave-audit-linkage.mjs'),
  path.resolve(process.env.WFM_PASSKEY_HARDENER || 'scripts/harden-passkey-auth.mjs'),
  path.resolve(process.env.WFM_PROOF_RUNNER_HARDENER || 'scripts/harden-proof-runner-identity.mjs'),
];
const expectedArtifactSha256 = 'dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function nextClockSecond() {
  const current = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === current) await delay(10);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start(runtime, database, port, key, enabled = true, limits = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: runtime,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      WFM_DB: database,
      WFM_PROOF_RUNNER_ENABLED: enabled ? 'true' : 'false',
      WFM_PROOF_RUNNER_AUDIENCE: origin,
      WFM_PROOF_RUNNER_KEYS_JSON: JSON.stringify([{
        kid: 'runner-local-1',
        publicKey: key.export({ type: 'spki', format: 'der' }).toString('base64url'),
        email: 'manager@northstar.example',
        tenant: 'northstar-demo',
        role: 'manager',
        costs: true,
        permissions: [],
        allowed: ['GET /api/bootstrap'],
        maxSessionSeconds: limits.maxSessionSeconds ?? 120,
        actionBudget: limits.actionBudget ?? 3,
        maxRequestsPerSecond: limits.maxRequestsPerSecond ?? 1,
      }]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
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
  const headers = { 'User-Agent': 'vector-proof-runner/1' };
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

function canonical(assertion) {
  return Buffer.from([
    'vector-proof-runner-v1',
    assertion.kid,
    assertion.challengeId,
    assertion.nonce,
    assertion.audience,
    String(assertion.issuedAt),
    String(assertion.expiresAt),
  ].join('\n'));
}

test('short-lived proof-runner identity atomically enforces rate and action budgets', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const port = await freePort();
  let running = await start(runtime, database, port, publicKey);
  t.after(() => stop(running.child));

  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  assert.equal(challenge.json.algorithm, 'Ed25519');

  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const signed = {
    assertion,
    signature: sign(null, canonical(assertion), privateKey).toString('base64url'),
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST', body: signed,
  });
  assert.equal(exchanged.status, 200, exchanged.text);
  assert.equal(exchanged.json.authMethod, 'proof-runner');
  assert.equal(exchanged.json.expiresInSeconds, 120);
  assert.equal(exchanged.json.actionBudget, 3);
  assert.equal(exchanged.json.maxRequestsPerSecond, 1);
  const cookie = exchanged.response.headers.getSetCookie()[0].split(';')[0];
  assert.match(cookie, /^wfm_session=[a-f0-9]{64}$/);

  while (Date.now() % 1000 > 700) await delay(10);
  const concurrent = await Promise.all([
    request(running.origin, '/api/bootstrap', { cookie }),
    request(running.origin, '/api/bootstrap', { cookie }),
  ]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 429]);
  const forbidden = await request(running.origin, '/api/command', {
    method: 'POST', cookie, body: { version: 1, command: 'leave-request', payload: {} },
  });
  assert.equal(forbidden.status, 403, forbidden.text);
  const rateLimitedAgain = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(rateLimitedAgain.status, 429, rateLimitedAgain.text);
  await nextClockSecond();
  const secondAllowed = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(secondAllowed.status, 200, secondAllowed.text);
  await nextClockSecond();
  const thirdAllowed = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(thirdAllowed.status, 200, thirdAllowed.text);
  await nextClockSecond();
  const exhausted = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(exhausted.status, 429, exhausted.text);

  const replay = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST', body: signed,
  });
  assert.notEqual(replay.status, 200, replay.text);

  const token = cookie.slice('wfm_session='.length);
  const db = new DatabaseSync(database, { readOnly: true });
  const session = db.prepare('SELECT expires,auth_method,auth_subject,proof_scope,proof_budget,proof_used,proof_budget_exhausted_at,proof_rate_limit,proof_rate_window,proof_rate_used,proof_rate_limited_window FROM sessions WHERE token_hash=?')
    .get(createHash('sha256').update(token).digest('hex'));
  assert.equal(session.auth_method, 'proof-runner');
  assert.equal(session.auth_subject, 'runner-local-1');
  assert.deepEqual(JSON.parse(session.proof_scope), ['GET /api/bootstrap']);
  assert.equal(session.proof_budget, 3);
  assert.equal(session.proof_used, 3);
  assert.ok(session.proof_budget_exhausted_at >= now);
  assert.equal(session.proof_rate_limit, 1);
  assert.equal(session.proof_rate_used, 1);
  assert.ok(Number.isInteger(session.proof_rate_window));
  assert.ok(Number.isInteger(session.proof_rate_limited_window));
  assert.ok(session.expires > now && session.expires <= now + 121_000);
  const audit = db.prepare("SELECT actor,detail FROM audit_events WHERE action='proof-runner-session-issued' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.actor, 'proof-runner:runner-local-1');
  const detail = JSON.parse(audit.detail);
  assert.equal(detail.email, 'manager@northstar.example');
  assert.equal(detail.scopeCount, 1);
  assert.equal(detail.actionBudget, 3);
  assert.equal(detail.maxRequestsPerSecond, 1);
  assert.match(detail.sessionRef, /^[a-f0-9]{24}$/);
  const rateAudit = db.prepare("SELECT actor,detail FROM audit_events WHERE action='proof-runner-rate-limited' ORDER BY id DESC LIMIT 1").get();
  assert.equal(rateAudit.actor, 'proof-runner:runner-local-1');
  assert.equal(JSON.parse(rateAudit.detail).maxRequestsPerSecond, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='proof-runner-rate-limited'").get().n, 1);
  const budgetAudit = db.prepare("SELECT actor,detail FROM audit_events WHERE action='proof-runner-budget-exhausted' ORDER BY id DESC LIMIT 1").get();
  assert.equal(budgetAudit.actor, 'proof-runner:runner-local-1');
  assert.equal(JSON.parse(budgetAudit.detail).actionBudget, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='proof-runner-budget-exhausted'").get().n, 1);
  db.close();

  await stop(running.child);
  running = await start(runtime, database, await freePort(), publicKey, false);
  const killed = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(killed.status, 503, killed.text);
});

test('an existing proof-runner session contracts to reduced server authority after restart', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-contract-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  t.after(() => stop(running.child));

  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST',
    body: { assertion, signature: sign(null, canonical(assertion), privateKey).toString('base64url') },
  });
  assert.equal(exchanged.status, 200, exchanged.text);
  const cookie = exchanged.response.headers.getSetCookie()[0].split(';')[0];
  const tokenHash = createHash('sha256').update(cookie.slice('wfm_session='.length)).digest('hex');

  await stop(running.child);
  running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 30,
    actionBudget: 1,
    maxRequestsPerSecond: 1,
  });
  while (Date.now() % 1000 > 700) await delay(10);
  const concurrent = await Promise.all([
    request(running.origin, '/api/bootstrap', { cookie }),
    request(running.origin, '/api/bootstrap', { cookie }),
  ]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 429]);
  await nextClockSecond();
  const exhausted = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(exhausted.status, 429, exhausted.text);

  const db = new DatabaseSync(database, { readOnly: true });
  const session = db.prepare('SELECT issued_at,expires,proof_budget,proof_used,proof_rate_limit FROM sessions WHERE token_hash=?').get(tokenHash);
  assert.equal(session.proof_budget, 1);
  assert.equal(session.proof_used, 1);
  assert.equal(session.proof_rate_limit, 1);
  assert.ok(session.expires <= session.issued_at + 30_000);
  const contractions = db.prepare("SELECT detail FROM audit_events WHERE action='proof-runner-session-contracted'").all();
  assert.equal(contractions.length, 1);
  assert.deepEqual(JSON.parse(contractions[0].detail), {
    sessionRef: tokenHash.slice(0, 24),
    previousMaxSessionSeconds: 120,
    maxSessionSeconds: 30,
    previousActionBudget: 3,
    actionBudget: 1,
    previousMaxRequestsPerSecond: 3,
    maxRequestsPerSecond: 1,
  });
  db.close();
});

test('rotating a proof-runner key revokes sessions issued by the previous key', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-rotate-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const oldKey = generateKeyPairSync('ed25519');
  const newKey = generateKeyPairSync('ed25519');
  let running = await start(runtime, database, await freePort(), oldKey.publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  t.after(() => stop(running.child));

  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST',
    body: { assertion, signature: sign(null, canonical(assertion), oldKey.privateKey).toString('base64url') },
  });
  assert.equal(exchanged.status, 200, exchanged.text);
  const cookie = exchanged.response.headers.getSetCookie()[0].split(';')[0];
  const tokenHash = createHash('sha256').update(cookie.slice('wfm_session='.length)).digest('hex');

  await stop(running.child);
  running = await start(runtime, database, await freePort(), newKey.publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  const firstAttempt = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(firstAttempt.status, 401, firstAttempt.text);
  const secondAttempt = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(secondAttempt.status, 401, secondAttempt.text);

  const db = new DatabaseSync(database, { readOnly: true });
  const session = db.prepare('SELECT proof_credential_revoked_at FROM sessions WHERE token_hash=?').get(tokenHash);
  assert.ok(session.proof_credential_revoked_at >= now);
  const revocations = db.prepare("SELECT detail FROM audit_events WHERE action='proof-runner-credential-revoked'").all();
  assert.equal(revocations.length, 1);
  assert.deepEqual(JSON.parse(revocations[0].detail), {
    sessionRef: tokenHash.slice(0, 24),
    runnerId: 'runner-local-1',
  });
  db.close();
});

test('a proof-runner session cannot inherit later account privilege escalation', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-authority-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  t.after(() => stop(running.child));

  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST',
    body: { assertion, signature: sign(null, canonical(assertion), privateKey).toString('base64url') },
  });
  assert.equal(exchanged.status, 200, exchanged.text);
  const cookie = exchanged.response.headers.getSetCookie()[0].split(';')[0];
  const tokenHash = createHash('sha256').update(cookie.slice('wfm_session='.length)).digest('hex');

  await stop(running.child);
  const writable = new DatabaseSync(database);
  const changed = writable.prepare('UPDATE users SET role=?,costs=?,permissions=? WHERE email=?')
    .run('admin', 1, JSON.stringify(['system.admin']), 'manager@northstar.example');
  assert.equal(changed.changes, 1);
  writable.close();

  running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  const firstAttempt = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(firstAttempt.status, 401, firstAttempt.text);
  const secondAttempt = await request(running.origin, '/api/bootstrap', { cookie });
  assert.equal(secondAttempt.status, 401, secondAttempt.text);

  const db = new DatabaseSync(database, { readOnly: true });
  const session = db.prepare('SELECT proof_authority_revoked_at FROM sessions WHERE token_hash=?').get(tokenHash);
  assert.ok(session.proof_authority_revoked_at >= now);
  const revocations = db.prepare("SELECT detail FROM audit_events WHERE action='proof-runner-authority-revoked'").all();
  assert.equal(revocations.length, 1);
  assert.deepEqual(JSON.parse(revocations[0].detail), {
    sessionRef: tokenHash.slice(0, 24),
    runnerId: 'runner-local-1',
  });
  db.close();
});

test('a proof-runner identity cannot mint a session for an unexpectedly privileged account', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-issuance-role-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  t.after(() => stop(running.child));
  await stop(running.child);

  const writable = new DatabaseSync(database);
  const changed = writable.prepare('UPDATE users SET role=?,costs=?,permissions=? WHERE email=?')
    .run('admin', 1, JSON.stringify(['system.admin']), 'manager@northstar.example');
  assert.equal(changed.changes, 1);
  writable.close();

  running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST',
    body: { assertion, signature: sign(null, canonical(assertion), privateKey).toString('base64url') },
  });
  assert.equal(exchanged.status, 503, exchanged.text);

  const db = new DatabaseSync(database, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE auth_method='proof-runner'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='proof-runner-session-issued'").get().n, 0);
  db.close();
});

test('a proof-runner identity cannot mint a session with unexpected permissions', async t => {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-issuance-capabilities-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  for (const overlay of overlays) if (fs.existsSync(overlay)) execFileSync(process.execPath, [overlay, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  t.after(() => stop(running.child));
  await stop(running.child);

  const writable = new DatabaseSync(database);
  const changed = writable.prepare('UPDATE users SET permissions=? WHERE email=?')
    .run(JSON.stringify(['system.admin']), 'manager@northstar.example');
  assert.equal(changed.changes, 1);
  assert.equal(writable.prepare('SELECT role FROM users WHERE email=?').get('manager@northstar.example').role, 'manager');
  writable.close();

  running = await start(runtime, database, await freePort(), publicKey, true, {
    maxSessionSeconds: 120,
    actionBudget: 3,
    maxRequestsPerSecond: 3,
  });
  const challenge = await request(running.origin, '/api/proof-runner/challenge', {
    method: 'POST', body: { kid: 'runner-local-1' },
  });
  assert.equal(challenge.status, 200, challenge.text);
  const now = Date.now();
  const assertion = {
    kid: 'runner-local-1',
    challengeId: challenge.json.challengeId,
    nonce: challenge.json.nonce,
    audience: running.origin,
    issuedAt: now,
    expiresAt: now + 20_000,
  };
  const exchanged = await request(running.origin, '/api/proof-runner/session', {
    method: 'POST',
    body: { assertion, signature: sign(null, canonical(assertion), privateKey).toString('base64url') },
  });
  assert.equal(exchanged.status, 503, exchanged.text);

  const db = new DatabaseSync(database, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE auth_method='proof-runner'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='proof-runner-session-issued'").get().n, 0);
  db.close();
});
