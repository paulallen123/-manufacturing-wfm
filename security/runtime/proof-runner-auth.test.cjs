'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { generateKeyPairSync, sign } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  createProofRunnerAuth,
  canonicalAssertion,
  PROOF_RUNNER_ISSUER,
} = require('./proof-runner-auth.cjs');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const setup = new DatabaseSync(dbPath);
  setup.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE users(
      email TEXT PRIMARY KEY,
      tenant TEXT NOT NULL REFERENCES tenants(id),
      person_id TEXT NOT NULL,
      role TEXT NOT NULL,
      costs INTEGER NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);
  `);
  setup.prepare('INSERT INTO tenants VALUES(?,?,?)').run('northstar-demo', 1, '{}');
  setup.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
    .run('superuser@northstar.example','northstar-demo','su1','superuser',1,'s','00','[]');
  setup.close();

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const origin = 'https://proof.vector.test';
  const auth = createProofRunnerAuth({
    dbPath,
    hosted: true,
    nodeEnv: 'staging',
    enabled: true,
    publicOrigin: origin,
    publicKey,
    allowedEmails: ['superuser@northstar.example'],
    sessionTtlMs: 5 * 60_000,
  });

  return {
    dir,
    dbPath,
    origin,
    auth,
    privateKey,
    close() {
      try { auth.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function signedPayload(f, overrides = {}) {
  const issuedAt = overrides.issuedAt ?? Date.now();
  const payload = {
    email: overrides.email ?? 'superuser@northstar.example',
    origin: overrides.origin ?? f.origin,
    nonce: overrides.nonce ?? Buffer.from(`nonce-${Date.now()}-${Math.random()}`).toString('base64url'),
    issuedAt,
    expiresAt: overrides.expiresAt ?? issuedAt + 45_000,
  };
  const privateKey = overrides.privateKey || f.privateKey;
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalAssertion(payload), 'utf8'), privateKey).toString('base64url'),
  };
}

function request(body, origin) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = '/api/proof-runner/session';
  req.headers = {
    origin,
    'x-forwarded-proto': 'https',
    'content-type': 'application/json',
  };
  req.socket = { encrypted: false };
  return req;
}

function response() {
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    },
    headers,
  };
}

function cookieToken(res) {
  const raw = String(res.headers['set-cookie'] || '');
  const pair = raw.split(';', 1)[0];
  const [name, value] = pair.split('=');
  assert.equal(name, 'wfm_session');
  assert.ok(value);
  return value;
}

test('signed proof identity mints a short-lived audited session without a password', async () => {
  const f = fixture();
  try {
    const res = response();
    assert.equal(await f.auth.handleRequest(request(signedPayload(f), f.origin), res), true);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['set-cookie']), /HttpOnly/);
    assert.match(String(res.headers['set-cookie']), /Secure/);
    assert.match(String(res.headers['set-cookie']), /SameSite=Strict/);
    const token = cookieToken(res);

    const guard = createIdentitySurvivalGuard({ dbPath: f.dbPath });
    const control = guard.securityControlForTests();
    try {
      const guardRes = response();
      const handled = guard.beforeRequest({ method:'GET', url:'/api/bootstrap', headers:{ cookie:`wfm_session=${token}` } }, guardRes);
      assert.equal(handled, false);
      const binding = control.db.prepare('SELECT issuer,tenant FROM identity_session_bindings ORDER BY bound_at DESC LIMIT 1').get();
      assert.equal(binding.issuer, PROOF_RUNNER_ISSUER);
      assert.equal(binding.tenant, 'northstar-demo');

      const audit = control.db.prepare("SELECT event FROM proof_runner_auth_events WHERE event='passwordless-proof-session-minted' ORDER BY id DESC LIMIT 1").get();
      assert.equal(audit.event, 'passwordless-proof-session-minted');
    } finally {
      control.db.close();
    }
  } finally {
    f.close();
  }
});

test('signed assertion is single use and replay fails closed', async () => {
  const f = fixture();
  try {
    const payload = signedPayload(f);
    const first = response();
    await f.auth.handleRequest(request(payload, f.origin), first);
    assert.equal(first.statusCode, 200);

    const replay = response();
    await f.auth.handleRequest(request(payload, f.origin), replay);
    assert.equal(replay.statusCode, 409);
  } finally {
    f.close();
  }
});

test('tampered signature and expired assertion are rejected', async () => {
  const f = fixture();
  try {
    const tampered = signedPayload(f);
    tampered.signature = Buffer.alloc(64, 7).toString('base64url');
    const badSig = response();
    await f.auth.handleRequest(request(tampered, f.origin), badSig);
    assert.equal(badSig.statusCode, 401);

    const old = Date.now() - 180_000;
    const expiredPayload = signedPayload(f, { issuedAt: old, expiresAt: old + 45_000 });
    const expired = response();
    await f.auth.handleRequest(request(expiredPayload, f.origin), expired);
    assert.equal(expired.statusCode, 401);
  } finally {
    f.close();
  }
});

test('proof runner refuses non-staging activation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-proof-runner-refuse-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const { publicKey } = generateKeyPairSync('ed25519');
  try {
    assert.throws(() => createProofRunnerAuth({
      dbPath,
      hosted: true,
      nodeEnv: 'production',
      enabled: true,
      publicOrigin: 'https://proof.vector.test',
      publicKey,
      allowedEmails: ['superuser@northstar.example'],
    }), /staging-only/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
