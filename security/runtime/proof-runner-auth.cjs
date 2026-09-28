'use strict';

const {
  createHash,
  createPublicKey,
  randomBytes,
  verify: verifySignature,
} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROOF_RUNNER_ISSUER = 'wfm-proof-runner';
const PROOF_RUNNER_AUDIENCE = 'wfm-proof-session';
const PROOF_RUNNER_PATH = '/api/proof-runner/session';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_ASSERTION_LIFETIME_MS = 60_000;
const CLOCK_SKEW_MS = 15_000;
const DEFAULT_SESSION_TTL_MS = 15 * 60_000;
const MIN_SESSION_TTL_MS = 60_000;
const MAX_SESSION_TTL_MS = 30 * 60_000;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function writeJson(res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
  return true;
}

function canonicalAssertion(input) {
  return [
    'VECTOR_PROOF_RUNNER_V1',
    PROOF_RUNNER_ISSUER,
    PROOF_RUNNER_AUDIENCE,
    String(input.email || '').trim().toLowerCase(),
    String(input.origin || '').replace(/\/$/, ''),
    String(input.nonce || ''),
    String(input.issuedAt || ''),
    String(input.expiresAt || ''),
  ].join('\n');
}

function normalizeAllowedEmails(value) {
  const values = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : String(value || '').split(',');
  return new Set(values.map(v => String(v).trim().toLowerCase()).filter(Boolean));
}

function decodePublicKey(value) {
  if (!value) throw new Error('Passwordless proof runner requires an Ed25519 public key.');
  if (typeof value === 'object' && value.asymmetricKeyType) {
    if (value.asymmetricKeyType !== 'ed25519') throw new Error('Proof runner public key must be Ed25519.');
    return value;
  }
  const raw = String(value).trim();
  const pem = raw.includes('BEGIN PUBLIC KEY')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Proof runner public key must be Ed25519.');
  return key;
}

function parseSessionTtl(value) {
  const ttl = Number(value || DEFAULT_SESSION_TTL_MS);
  if (!Number.isInteger(ttl) || ttl < MIN_SESSION_TTL_MS || ttl > MAX_SESSION_TTL_MS) {
    throw new Error(`Proof runner session TTL must be between ${MIN_SESSION_TTL_MS} and ${MAX_SESSION_TTL_MS} ms.`);
  }
  return ttl;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.setEncoding?.('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        const error = new Error('request-too-large');
        error.code = 'REQUEST_TOO_LARGE';
        reject(error);
        req.destroy?.();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (bytes > MAX_BODY_BYTES) return;
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        const error = new Error('invalid-json');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createProofRunnerAuth(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const hosted = options.hosted ?? process.env.WFM_HOSTED_STAGING === 'true';
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || '';
  const publicOrigin = String(options.publicOrigin || process.env.WFM_PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const enabled = options.enabled ?? process.env.WFM_PROOF_RUNNER_AUTH === 'enabled';
  const publicKey = decodePublicKey(options.publicKey || process.env.WFM_PROOF_RUNNER_PUBLIC_KEY_B64);
  const publicKeyFingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex').slice(0, 16);
  const allowedEmails = normalizeAllowedEmails(options.allowedEmails || process.env.WFM_PROOF_RUNNER_ALLOWED_EMAILS);
  const sessionTtlMs = parseSessionTtl(options.sessionTtlMs || process.env.WFM_PROOF_RUNNER_SESSION_TTL_MS);
  const auditStdout = options.auditStdout ?? process.env.WFM_PROOF_RUNNER_AUDIT_STDOUT === 'enabled';

  if (!enabled) throw new Error('Proof runner auth must be explicitly enabled.');
  if (!hosted || nodeEnv !== 'staging') {
    throw new Error('Proof runner auth is staging-only and refuses to start outside hosted staging.');
  }
  if (!dbPath) throw new Error('Proof runner auth requires WFM_DB.');
  if (!publicOrigin.startsWith('https://')) throw new Error('Proof runner auth requires an HTTPS WFM_PUBLIC_ORIGIN.');
  if (allowedEmails.size === 0) throw new Error('Proof runner auth requires an explicit email allowlist.');

  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS proof_runner_sessions(
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      tenant TEXT NOT NULL,
      role TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proof_runner_nonces(
      nonce_hash TEXT PRIMARY KEY,
      expires INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proof_runner_auth_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      tenant TEXT,
      event TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS no_proof_runner_event_update
      BEFORE UPDATE ON proof_runner_auth_events BEGIN SELECT RAISE(ABORT,'Proof runner auth events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_proof_runner_event_delete
      BEFORE DELETE ON proof_runner_auth_events BEGIN SELECT RAISE(ABORT,'Proof runner auth events are append only.'); END;
  `);

  const userStmt = db.prepare('SELECT email,tenant,role FROM users WHERE lower(email)=lower(?)');
  const sessionStmt = db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)');
  const proofSessionStmt = db.prepare(`INSERT INTO proof_runner_sessions
    (token_hash,email,tenant,role,issued_at,expires) VALUES(?,?,?,?,?,?)`);
  const nonceStmt = db.prepare('INSERT INTO proof_runner_nonces(nonce_hash,expires,created_at) VALUES(?,?,?)');
  const cleanupNonceStmt = db.prepare('DELETE FROM proof_runner_nonces WHERE expires<=?');
  const cleanupProofSessionStmt = db.prepare('DELETE FROM proof_runner_sessions WHERE expires<=?');
  const eventStmt = db.prepare(`INSERT INTO proof_runner_auth_events
    (email,tenant,event,detail,created_at) VALUES(?,?,?,?,?)`);

  function record(email, tenant, event, detail) {
    try {
      eventStmt.run(email || null, tenant || null, event, JSON.stringify(detail || {}), new Date().toISOString());
    } catch {
      // Authentication enforcement must not depend on secondary telemetry writes.
    }
  }

  function reject(res, status, event, detail = {}, email = null, tenant = null) {
    record(email, tenant, event, detail);
    if (auditStdout) console.warn(`WFM_PROOF_RUNNER_AUTH_EVENT=${event}|status=${status}`);
    return writeJson(res, status, { error: 'Proof runner authentication refused.' });
  }

  async function handleRequest(req, res) {
    if (requestPath(req) !== PROOF_RUNNER_PATH) return false;

    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      return writeJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    }

    if (String(req.headers?.cookie || '').includes('wfm_session=')) {
      return reject(res, 409, 'existing-session-refused', { path: PROOF_RUNNER_PATH });
    }

    const origin = String(req.headers?.origin || '').replace(/\/$/, '');
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const transportSecure = forwardedProto === 'https' || req.socket?.encrypted === true;
    if (!transportSecure || origin !== publicOrigin) {
      return reject(res, 403, 'origin-or-transport-refused', {
        originMatch: origin === publicOrigin,
        secureTransport: transportSecure,
      });
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      const status = error?.code === 'REQUEST_TOO_LARGE' ? 413 : 400;
      return reject(res, status, 'malformed-assertion-request', { code: error?.code || 'READ_ERROR' });
    }

    const email = String(body?.email || '').trim().toLowerCase();
    const nonce = String(body?.nonce || '');
    const assertionOrigin = String(body?.origin || '').replace(/\/$/, '');
    const issuedAt = Number(body?.issuedAt);
    const expiresAt = Number(body?.expiresAt);
    const signatureText = String(body?.signature || '');

    if (!allowedEmails.has(email)) {
      return reject(res, 403, 'email-not-allowlisted', {}, email);
    }
    if (assertionOrigin !== publicOrigin) {
      return reject(res, 403, 'assertion-origin-mismatch', {}, email);
    }
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(nonce)) {
      return reject(res, 400, 'invalid-nonce', {}, email);
    }

    const now = Date.now();
    const timestampsValid =
      Number.isSafeInteger(issuedAt) &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > issuedAt &&
      expiresAt - issuedAt <= MAX_ASSERTION_LIFETIME_MS &&
      issuedAt <= now + CLOCK_SKEW_MS &&
      issuedAt >= now - MAX_ASSERTION_LIFETIME_MS - CLOCK_SKEW_MS &&
      expiresAt >= now - CLOCK_SKEW_MS;

    if (!timestampsValid) {
      return reject(res, 401, 'expired-or-invalid-assertion-time', {}, email);
    }

    let signature;
    try {
      signature = Buffer.from(signatureText, 'base64url');
    } catch {
      return reject(res, 401, 'invalid-signature-encoding', {}, email);
    }
    if (signature.length !== 64) {
      return reject(res, 401, 'invalid-signature-length', {}, email);
    }

    const message = Buffer.from(canonicalAssertion({ email, origin: assertionOrigin, nonce, issuedAt, expiresAt }), 'utf8');
    if (auditStdout) {
      const messageFingerprint = createHash('sha256').update(message).digest('hex').slice(0, 16);
      console.warn(`WFM_PROOF_RUNNER_AUTH_VERIFY=key:${publicKeyFingerprint}|message:${messageFingerprint}|signatureBytes:${signature.length}`);
    }
    if (!verifySignature(null, message, publicKey, signature)) {
      return reject(res, 401, 'signature-verification-failed', {}, email);
    }

    const user = userStmt.get(email);
    if (!user) {
      return reject(res, 403, 'allowlisted-user-missing', {}, email);
    }

    const nonceHash = sha256(nonce);
    const sessionExpires = now + sessionTtlMs;
    const token = randomBytes(32).toString('hex');
    const tokenHash = sha256(token);

    try {
      db.exec('BEGIN IMMEDIATE');
      cleanupNonceStmt.run(now);
      cleanupProofSessionStmt.run(now);
      nonceStmt.run(nonceHash, expiresAt + CLOCK_SKEW_MS, new Date(now).toISOString());
      sessionStmt.run(tokenHash, user.email, sessionExpires);
      proofSessionStmt.run(tokenHash, user.email, user.tenant, user.role, now, sessionExpires);
      // Issuance and its durable audit record must succeed or roll back together.
      eventStmt.run(user.email, user.tenant, 'passwordless-proof-session-minted', JSON.stringify({
        role: user.role,
        issuer: PROOF_RUNNER_ISSUER,
        audience: PROOF_RUNNER_AUDIENCE,
        sessionExpires,
        nonceHashPrefix: nonceHash.slice(0, 16),
        tokenHashPrefix: tokenHash.slice(0, 16),
      }), new Date(now).toISOString());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      const replay = String(error?.message || '').toLowerCase().includes('proof_runner_nonces');
      return reject(res, replay ? 409 : 503, replay ? 'assertion-replay-refused' : 'session-mint-failed', {
        replay,
      }, user.email, user.tenant);
    }

    const maxAge = Math.floor(sessionTtlMs / 1000);
    res.setHeader('Set-Cookie', `wfm_session=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`);
    return writeJson(res, 200, {
      ok: true,
      authMethod: 'proof-runner-signed',
      expiresAt: sessionExpires,
      actor: { email: user.email, tenant: user.tenant, role: user.role },
    });
  }

  function close() {
    try { db.close(); } catch {}
  }

  return { handleRequest, close };
}

module.exports = {
  createProofRunnerAuth,
  canonicalAssertion,
  PROOF_RUNNER_ISSUER,
  PROOF_RUNNER_AUDIENCE,
  PROOF_RUNNER_PATH,
  MAX_ASSERTION_LIFETIME_MS,
};
