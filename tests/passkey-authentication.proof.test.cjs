const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const artifact = path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT || 'sealed-runtime-4bd3.tar.gz');
const leaveHardener = path.resolve(process.env.WFM_LEAVE_AUDIT_HARDENER || 'scripts/harden-leave-audit-linkage.mjs');
const hardener = path.resolve(process.env.WFM_PASSKEY_HARDENER || 'scripts/harden-passkey-auth.mjs');
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

function runtimeFixture(t) {
  assert.equal(createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), expectedArtifactSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-passkey-'));
  const runtime = path.join(root, 'runtime');
  const database = path.join(root, 'state.sqlite');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', runtime]);
  if (fs.existsSync(leaveHardener)) execFileSync(process.execPath, [leaveHardener, path.join(runtime, 'public')]);
  if (fs.existsSync(hardener)) execFileSync(process.execPath, [hardener, path.join(runtime, 'public')]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, runtime, database };
}

async function serverFixture(t) {
  const { runtime, database } = runtimeFixture(t);
  const port = await freePort();
  const running = await start(runtime, database, port);
  t.after(() => stop(running.child));
  return running;
}

async function request(origin, requestPath, { method = 'GET', cookie, body, requestOrigin = origin } = {}) {
  const headers = { 'User-Agent': 'vector-passkey-proof/1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers.Origin = requestOrigin;
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

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

test('normal sign-in presents a passkey without exposing a password field', t => {
  const { runtime } = runtimeFixture(t);
  const root = { innerHTML: '' };
  const context = {
    WFMWorkRules: { has: () => false },
    identities: {},
    payrollActor: () => ({ role: 'employee', permissions: [] }),
    PR: { has: () => false },
    command: async () => {},
    shell: value => value,
    payrollShell: value => value,
    footer: () => '',
    render: async () => {},
    approveRequest: async () => {},
    openRequest: () => {},
    newLeave: () => {},
    F: { ready: true },
    OFFLINE: false,
    ui: { page: 'overview' },
    document: { getElementById: id => id === 'root' ? root : null, addEventListener: () => {} },
    window: {},
    Intl,
    Date,
    structuredClone,
    console,
  };
  context.showLogin = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(runtime, 'public/company-ui.js'), 'utf8'), vm.createContext(context));
  context.showLogin();
  assert.doesNotMatch(root.innerHTML, /type=["']password["']/i);
  assert.doesNotMatch(root.innerHTML, /password/i);
  assert.match(root.innerHTML, />Continue with passkey</);
});

test('a registered passkey binds origin and user verification, creates one session and rejects replay', async t => {
  const { origin } = await serverFixture(t);
  const legacy = await request(origin, '/api/login', {
    method: 'POST',
    body: { email: 'manager@northstar.example', password },
  });
  assert.equal(legacy.status, 200, legacy.text);
  const legacyCookie = legacy.response.headers.getSetCookie()[0].split(';')[0];

  const hostileOrigin = await request(origin, '/api/passkeys/register/options', {
    method: 'POST', cookie: legacyCookie, body: {}, requestOrigin: 'https://attacker.invalid',
  });
  assert.equal(hostileOrigin.status, 403, hostileOrigin.text);

  const options = await request(origin, '/api/passkeys/register/options', {
    method: 'POST', cookie: legacyCookie, body: {},
  });
  assert.equal(options.status, 200, options.text);
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = base64url(randomBytes(32));
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.create',
    challenge: options.json.publicKey.challenge,
    origin,
  }));
  const registrationAuthenticatorData = Buffer.alloc(37);
  createHash('sha256').update(options.json.publicKey.rp.id).digest()
    .copy(registrationAuthenticatorData, 0);
  registrationAuthenticatorData[32] = 0x05;
  registrationAuthenticatorData.writeUInt32BE(0, 33);
  const registered = await request(origin, '/api/passkeys/register/verify', {
    method: 'POST',
    cookie: legacyCookie,
    body: {
      challengeId: options.json.challengeId,
      credential: {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(registrationAuthenticatorData),
          publicKey: base64url(publicKey.export({ type: 'spki', format: 'der' })),
          publicKeyAlgorithm: -7,
          transports: ['internal'],
        },
      },
    },
  });
  assert.equal(registered.status, 200, registered.text);

  const logout = await request(origin, '/api/logout', { method: 'POST', cookie: legacyCookie, body: {} });
  assert.equal(logout.status, 200, logout.text);
  const unverifiedOptions = await request(origin, '/api/passkeys/login/options', {
    method: 'POST', body: { email: 'manager@northstar.example' },
  });
  assert.equal(unverifiedOptions.status, 200, unverifiedOptions.text);
  const unverifiedClientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: unverifiedOptions.json.publicKey.challenge,
    origin,
  }));
  const unverifiedAuthenticatorData = Buffer.concat([
    createHash('sha256').update(unverifiedOptions.json.publicKey.rpId).digest(),
    Buffer.from([0x01]),
    Buffer.alloc(4),
  ]);
  const unverifiedSigned = Buffer.concat([
    unverifiedAuthenticatorData,
    createHash('sha256').update(unverifiedClientData).digest(),
  ]);
  const unverified = await request(origin, '/api/passkeys/login/verify', {
    method: 'POST',
    body: {
      challengeId: unverifiedOptions.json.challengeId,
      email: 'manager@northstar.example',
      credential: {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(unverifiedClientData),
          authenticatorData: base64url(unverifiedAuthenticatorData),
          signature: base64url(sign('sha256', unverifiedSigned, privateKey)),
          userHandle: null,
        },
      },
    },
  });
  assert.equal(unverified.status, 403, unverified.text);

  const loginOptions = await request(origin, '/api/passkeys/login/options', {
    method: 'POST', body: { email: 'manager@northstar.example' },
  });
  assert.equal(loginOptions.status, 200, loginOptions.text);
  const loginClientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: loginOptions.json.publicKey.challenge,
    origin,
  }));
  const rpIdHash = createHash('sha256').update(loginOptions.json.publicKey.rpId).digest();
  const flags = Buffer.from([0x05]);
  const counter = Buffer.alloc(4); counter.writeUInt32BE(1);
  const authenticatorData = Buffer.concat([rpIdHash, flags, counter]);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(loginClientData).digest()]);
  const assertion = {
    challengeId: loginOptions.json.challengeId,
    email: 'manager@northstar.example',
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: base64url(loginClientData),
        authenticatorData: base64url(authenticatorData),
        signature: base64url(sign('sha256', signed, privateKey)),
        userHandle: null,
      },
    },
  };
  const verified = await request(origin, '/api/passkeys/login/verify', { method: 'POST', body: assertion });
  assert.equal(verified.status, 200, verified.text);
  const passkeyCookie = verified.response.headers.getSetCookie()[0].split(';')[0];
  const bootstrap = await request(origin, '/api/bootstrap', { cookie: passkeyCookie });
  assert.equal(bootstrap.status, 200, bootstrap.text);
  const replay = await request(origin, '/api/passkeys/login/verify', { method: 'POST', body: assertion });
  assert.notEqual(replay.status, 200, replay.text);
});
