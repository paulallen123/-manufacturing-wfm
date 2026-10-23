'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { generateKeyPairSync, sign } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
let proofRunnerModule = null;
try {
  proofRunnerModule = require('./proof-runner-auth.cjs');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}
const {
  createProofRunnerAuth,
  canonicalAssertion,
  PROOF_RUNNER_ISSUER,
} = proofRunnerModule || {};
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');

test('exact candidate exposes the signed proof runner authentication boundary', () => {
  assert.ok(proofRunnerModule, 'exact candidate is missing security/runtime/proof-runner-auth.cjs');
  assert.equal(typeof createProofRunnerAuth, 'function');
  assert.equal(typeof canonicalAssertion, 'function');
});

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

test('ambiguous normalized proof identity fails closed before session issuance', async () => {
  const f = fixture();
  const db = new DatabaseSync(f.dbPath);
  try {
    db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('other-tenant', 1, '{}');
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run('SUPERUSER@NORTHSTAR.EXAMPLE','other-tenant','su2','payroll',0,'s','00','[]');

    const res = response();
    assert.equal(await f.auth.handleRequest(request(signedPayload(f), f.origin), res), true);
    assert.equal(res.statusCode, 409);
    assert.equal(res.headers['set-cookie'], undefined);
    for (const table of ['sessions', 'proof_runner_sessions', 'proof_runner_nonces']) {
      assert.equal(db.prepare('SELECT count(*) AS count FROM ' + table).get().count, 0);
    }
    const audit = db.prepare("SELECT event FROM proof_runner_auth_events WHERE event='ambiguous-normalized-email' ORDER BY id DESC LIMIT 1").get();
    assert.equal(audit.event, 'ambiguous-normalized-email');
  } finally {
    db.close();
    f.close();
  }
});

for (const mutation of ['add-ambiguous-user', 'change-tenant', 'change-role']) {
  test('principal selection locks out concurrent ' + mutation + ' until issuance commits', async () => {
    const f = fixture();
    const rival = new DatabaseSync(f.dbPath);
    rival.exec('PRAGMA busy_timeout=0');
    rival.prepare('INSERT INTO tenants VALUES(?,?,?)').run('rival-tenant', 1, '{}');
    const statementPrototype = Object.getPrototypeOf(rival.prepare('SELECT 1'));
    const originalAll = statementPrototype.all;
    let attempted = false;
    let mutationError;
    try {
      // Deterministically interleave another real connection immediately after
      // principal lookup, at the historical lookup/transaction race boundary.
      statementPrototype.all = function (...args) {
        const rows = originalAll.apply(this, args);
        if (!attempted && args[0] === 'superuser@northstar.example' && rows[0]?.email) {
          attempted = true;
          try {
            if (mutation === 'add-ambiguous-user') {
              rival.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
                .run('SUPERUSER@NORTHSTAR.EXAMPLE','rival-tenant','rival','payroll',0,'s','00','[]');
            } else if (mutation === 'change-tenant') {
              rival.prepare('UPDATE users SET tenant=? WHERE email=?')
                .run('rival-tenant', 'superuser@northstar.example');
            } else {
              rival.prepare('UPDATE users SET role=? WHERE email=?')
                .run('payroll', 'superuser@northstar.example');
            }
          } catch (error) { mutationError = error; }
        }
        return rows;
      };
      const res = response();
      await f.auth.handleRequest(request(signedPayload(f), f.origin), res);
      assert.equal(attempted, true);
      assert.match(String(mutationError?.message), /locked|busy/i);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body).actor, {
        email: 'superuser@northstar.example', tenant: 'northstar-demo', role: 'superuser',
      });
      const stored = rival.prepare('SELECT tenant,role FROM proof_runner_sessions').get();
      assert.equal(stored.tenant, 'northstar-demo');
      assert.equal(stored.role, 'superuser');
      // The lock is released at commit, not held for the lifetime of auth.
      rival.prepare('UPDATE users SET costs=0 WHERE email=?').run('superuser@northstar.example');
    } finally {
      statementPrototype.all = originalAll;
      rival.close();
      f.close();
    }
  });
}

test('principal lookup failure rolls back and refuses without issuing credentials', async () => {
  const f = fixture();
  const db = new DatabaseSync(f.dbPath);
  const statementPrototype = Object.getPrototypeOf(db.prepare('SELECT 1'));
  const originalAll = statementPrototype.all;
  try {
    statementPrototype.all = function (...args) {
      if (args[0] === 'superuser@northstar.example') throw new Error('injected lookup failure');
      return originalAll.apply(this, args);
    };
    const payload = signedPayload(f);
    const refused = response();
    await f.auth.handleRequest(request(payload, f.origin), refused);
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.headers['set-cookie'], undefined);
    for (const table of ['sessions', 'proof_runner_sessions', 'proof_runner_nonces']) {
      assert.equal(db.prepare('SELECT count(*) AS count FROM ' + table).get().count, 0);
    }
    statementPrototype.all = originalAll;
    const retry = response();
    await f.auth.handleRequest(request(payload, f.origin), retry);
    assert.equal(retry.statusCode, 200);
  } finally {
    statementPrototype.all = originalAll;
    db.close();
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

test('audit failure rolls back session issuance and permits a clean retry after repair', async () => {
  const f = fixture();
  const db = new DatabaseSync(f.dbPath);
  try {
    db.exec("CREATE TRIGGER fail_proof_audit BEFORE INSERT ON proof_runner_auth_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    const payload = signedPayload(f);
    const refused = response();
    await f.auth.handleRequest(request(payload, f.origin), refused);
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.headers['set-cookie'], undefined);
    for (const table of ['sessions', 'proof_runner_sessions', 'proof_runner_nonces']) {
      assert.equal(db.prepare('SELECT count(*) AS count FROM ' + table).get().count, 0);
    }

    db.exec('DROP TRIGGER fail_proof_audit');
    const retry = response();
    await f.auth.handleRequest(request(payload, f.origin), retry);
    assert.equal(retry.statusCode, 200);
    assert.equal(db.prepare("SELECT count(*) AS count FROM proof_runner_auth_events WHERE event='passwordless-proof-session-minted'").get().count, 1);
    const replay = response();
    await f.auth.handleRequest(request(payload, f.origin), replay);
    assert.equal(replay.statusCode, 409);
  } finally {
    db.close();
    f.close();
  }
});

for (const changedAuthority of ['tenant', 'role']) {
  test('proof session refuses ' + changedAuthority + ' drift before first product request', async () => {
    const f = fixture();
    const db = new DatabaseSync(f.dbPath);
    let control;
    try {
      const minted = response();
      await f.auth.handleRequest(request(signedPayload(f), f.origin), minted);
      assert.equal(minted.statusCode, 200);
      const token = cookieToken(minted);
      if (changedAuthority === 'tenant') {
        db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('another-tenant', 1, '{}');
        db.prepare('UPDATE users SET tenant=? WHERE email=?').run('another-tenant', 'superuser@northstar.example');
      } else {
        db.prepare('UPDATE users SET role=? WHERE email=?').run('payroll', 'superuser@northstar.example');
      }
      const guard = createIdentitySurvivalGuard({ dbPath: f.dbPath });
      control = guard.securityControlForTests();
      const denied = response();
      assert.equal(guard.beforeRequest({ method:'GET', url:'/api/bootstrap', headers:{ cookie:`wfm_session=${token}` } }, denied), true);
      assert.equal(denied.statusCode, 401);
      assert.equal(db.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
    } finally {
      control?.db.close();
      db.close();
      f.close();
    }
  });
}
