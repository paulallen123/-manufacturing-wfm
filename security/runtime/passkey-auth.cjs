'use strict';

const { DatabaseSync } = require('node:sqlite');
const {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createPublicKey,
  verify: verifySignature
} = require('node:crypto');
const { URL } = require('node:url');

const BODY_LIMIT = 64 * 1024;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_ACTIVE_CHALLENGES = 500;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function sha256Hex(value) {
  return sha256(value).toString('hex');
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromB64url(value, field = 'value') {
  const text = String(value || '');
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) fail('Invalid ' + field + '.', 400);
  try {
    return Buffer.from(text, 'base64url');
  } catch {
    fail('Invalid ' + field + '.', 400);
  }
}

function equalBuffers(a, b) {
  const x = Buffer.from(a || []);
  const y = Buffer.from(b || []);
  return x.length === y.length && timingSafeEqual(x, y);
}

function requestPath(req) {
  return String(req && req.url || '/').split('?')[0] || '/';
}

function cookieValue(req, name) {
  const raw = String(req && req.headers && req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    const prefix = name + '=';
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return '';
}

function writeJson(res, status, body, headers = {}) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req) {
  const contentType = String(req.headers && req.headers['content-type'] || '');
  if (!contentType.startsWith('application/json')) fail('JSON required.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > BODY_LIMIT) fail('Request body too large.', 413);
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('JSON object required.', 400);
    return value;
  } catch (err) {
    if (err && err.status) throw err;
    fail('Invalid JSON.', 400);
  }
}

function readLength(buffer, state, additional) {
  if (additional < 24) return additional;
  if (additional === 24) {
    if (state.i + 1 > buffer.length) fail('Malformed credential public key.', 400);
    return buffer[state.i++];
  }
  if (additional === 25) {
    if (state.i + 2 > buffer.length) fail('Malformed credential public key.', 400);
    const n = buffer.readUInt16BE(state.i);
    state.i += 2;
    return n;
  }
  if (additional === 26) {
    if (state.i + 4 > buffer.length) fail('Malformed credential public key.', 400);
    const n = buffer.readUInt32BE(state.i);
    state.i += 4;
    return n;
  }
  fail('Unsupported credential public key encoding.', 400);
}

function readCbor(buffer, state) {
  if (state.i >= buffer.length) fail('Malformed credential public key.', 400);
  const initial = buffer[state.i++];
  const major = initial >> 5;
  const additional = initial & 31;
  if (additional === 31) fail('Indefinite CBOR is not accepted.', 400);
  const length = readLength(buffer, state, additional);

  if (major === 0) return length;
  if (major === 1) return -1 - length;
  if (major === 2) {
    if (state.i + length > buffer.length) fail('Malformed credential public key.', 400);
    const out = buffer.subarray(state.i, state.i + length);
    state.i += length;
    return out;
  }
  if (major === 3) {
    if (state.i + length > buffer.length) fail('Malformed credential public key.', 400);
    const out = buffer.subarray(state.i, state.i + length).toString('utf8');
    state.i += length;
    return out;
  }
  if (major === 4) {
    const out = [];
    for (let i = 0; i < length; i++) out.push(readCbor(buffer, state));
    return out;
  }
  if (major === 5) {
    const out = new Map();
    for (let i = 0; i < length; i++) out.set(readCbor(buffer, state), readCbor(buffer, state));
    return out;
  }
  if (major === 7) {
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22) return null;
  }
  fail('Unsupported credential public key type.', 400);
}

function parseAuthenticatorData(encoded, rpId, requireAttested) {
  const data = Buffer.isBuffer(encoded) ? encoded : fromB64url(encoded, 'authenticatorData');
  if (data.length < 37) fail('Authenticator data is too short.', 400);

  const expectedRpHash = sha256(Buffer.from(rpId, 'utf8'));
  if (!equalBuffers(data.subarray(0, 32), expectedRpHash)) fail('Passkey relying-party mismatch.', 401);

  const flags = data[32];
  if ((flags & 0x01) === 0) fail('Passkey user presence is required.', 401);
  if ((flags & 0x04) === 0) fail('Passkey user verification is required.', 401);

  const signCount = data.readUInt32BE(33);
  const result = { data, flags, signCount, credentialId: null, publicKeyJwk: null };

  if (requireAttested) {
    if ((flags & 0x40) === 0) fail('Attested credential data is required.', 400);
    let offset = 37;
    if (offset + 18 > data.length) fail('Malformed attested credential data.', 400);
    offset += 16;
    const credentialLength = data.readUInt16BE(offset);
    offset += 2;
    if (credentialLength < 16 || credentialLength > 1024 || offset + credentialLength > data.length) {
      fail('Invalid credential identifier.', 400);
    }
    result.credentialId = data.subarray(offset, offset + credentialLength);
    offset += credentialLength;

    const state = { i: offset };
    const cose = readCbor(data, state);
    if (!(cose instanceof Map)) fail('Credential public key is not a COSE map.', 400);

    const kty = cose.get(1);
    const alg = cose.get(3);
    const crv = cose.get(-1);
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (kty !== 2 || alg !== -7 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
      fail('Only verified ES256 platform passkeys are accepted.', 400);
    }
    result.publicKeyJwk = {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(x),
      y: b64url(y),
      ext: true,
      key_ops: ['verify']
    };
  }

  return result;
}

function parseClientData(encoded, expectedType, expectedOrigin) {
  const bytes = fromB64url(encoded, 'clientDataJSON');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('Invalid WebAuthn client data.', 400);
  }
  if (!value || typeof value !== 'object') fail('Invalid WebAuthn client data.', 400);
  if (value.type !== expectedType) fail('Unexpected WebAuthn ceremony type.', 400);
  if (value.origin !== expectedOrigin) fail('Passkey origin mismatch.', 401);
  if (value.crossOrigin === true) fail('Cross-origin passkey ceremonies are not accepted.', 401);
  if (!value.challenge || typeof value.challenge !== 'string') fail('WebAuthn challenge is missing.', 400);
  return { bytes, value };
}

function credentialCookie(token, secure) {
  return 'wfm_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600' + (secure ? '; Secure' : '');
}

function createPasskeyAuth(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  if (!dbPath) throw new Error('Passkey authentication requires WFM_DB.');

  const publicOrigin = String(
    options.publicOrigin ||
    process.env.WFM_PASSKEY_ORIGIN ||
    process.env.WFM_PUBLIC_ORIGIN ||
    ''
  ).replace(/\/$/, '');
  if (!publicOrigin) throw new Error('Passkey authentication requires an explicit origin.');

  const originUrl = new URL(publicOrigin);
  const hosted = process.env.WFM_HOSTED_STAGING === 'true';
  if (hosted && originUrl.protocol !== 'https:') throw new Error('Hosted passkeys require HTTPS.');

  const rpId = String(options.rpId || process.env.WFM_PASSKEY_RP_ID || originUrl.hostname).trim().toLowerCase();
  const host = originUrl.hostname.toLowerCase();
  if (!rpId || !(host === rpId || host.endsWith('.' + rpId))) {
    throw new Error('WFM_PASSKEY_RP_ID must equal or be a registrable parent of the public host.');
  }
  const rpName = String(options.rpName || process.env.WFM_PASSKEY_RP_NAME || 'Manufacturing WFM').trim().slice(0, 80) || 'Manufacturing WFM';

  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;" +
    "CREATE TABLE IF NOT EXISTS passkey_user_handles(" +
      "email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE," +
      "user_handle TEXT NOT NULL UNIQUE," +
      "created_at TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS passkey_credentials(" +
      "credential_id TEXT PRIMARY KEY," +
      "email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE," +
      "tenant TEXT NOT NULL," +
      "public_key_jwk TEXT NOT NULL," +
      "sign_count INTEGER NOT NULL DEFAULT 0 CHECK(sign_count>=0)," +
      "transports TEXT NOT NULL DEFAULT '[]'," +
      "label TEXT," +
      "created_at TEXT NOT NULL," +
      "last_used_at TEXT," +
      "revoked_at TEXT);" +
    "CREATE INDEX IF NOT EXISTS passkey_credentials_email ON passkey_credentials(email,revoked_at);" +
    "CREATE TABLE IF NOT EXISTS passkey_challenges(" +
      "challenge_hash TEXT PRIMARY KEY," +
      "purpose TEXT NOT NULL CHECK(purpose IN ('register','authenticate'))," +
      "email TEXT," +
      "expires INTEGER NOT NULL," +
      "consumed_at INTEGER," +
      "created_at TEXT NOT NULL);"
  );

  const userBySessionStmt = db.prepare(
    "SELECT u.email,u.tenant,u.person_id,u.role,u.costs,u.salt,u.password_hash " +
    "FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?"
  );
  const userByEmailStmt = db.prepare('SELECT email,tenant,salt,password_hash FROM users WHERE email=?');
  const passkeyByIdStmt = db.prepare('SELECT * FROM passkey_credentials WHERE credential_id=? AND revoked_at IS NULL');
  const passkeysForUserStmt = db.prepare(
    "SELECT credential_id,label,transports,created_at,last_used_at FROM passkey_credentials " +
    "WHERE email=? AND revoked_at IS NULL ORDER BY created_at DESC"
  );
  const challengeStmt = db.prepare('SELECT * FROM passkey_challenges WHERE challenge_hash=?');
  const activeChallengeCountStmt = db.prepare('SELECT COUNT(*) AS n FROM passkey_challenges WHERE consumed_at IS NULL AND expires>?');
  const auditStmt = db.prepare(
    'INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)'
  );

  function audit(tenant, actor, action, detail) {
    try {
      auditStmt.run(tenant, actor, action, JSON.stringify(detail || {}), new Date().toISOString());
    } catch {
      // Authentication correctness must not depend on secondary audit insertion.
    }
  }

  function sameOrigin(req) {
    const origin = String(req.headers && req.headers.origin || '').replace(/\/$/, '');
    if (origin) return origin === publicOrigin;
    const referer = String(req.headers && req.headers.referer || '');
    return referer === publicOrigin || referer.startsWith(publicOrigin + '/');
  }

  function requireSameOrigin(req) {
    if (!sameOrigin(req)) fail('Same-origin passkey request required.', 403);
  }

  function sessionUser(req) {
    const token = cookieValue(req, 'wfm_session');
    if (!token) fail('Sign in is required.', 401);
    const row = userBySessionStmt.get(sha256Hex(Buffer.from(token, 'utf8')), Date.now());
    if (!row) fail('Session expired. Sign in again.', 401);
    return row;
  }

  function checkPassword(user, password) {
    const raw = String(password || '');
    if (!raw || raw.length > 256) return false;
    const calculated = scryptSync(raw, user.salt, 64);
    const stored = Buffer.from(user.password_hash, 'hex');
    return calculated.length === stored.length && timingSafeEqual(calculated, stored);
  }

  function cleanupChallenges(now) {
    db.prepare('DELETE FROM passkey_challenges WHERE expires<? OR consumed_at IS NOT NULL AND consumed_at<?')
      .run(now - 60_000, now - 10 * 60_000);
  }

  function issueChallenge(purpose, email) {
    const now = Date.now();
    cleanupChallenges(now);
    const count = activeChallengeCountStmt.get(now);
    if (Number(count && count.n || 0) >= MAX_ACTIVE_CHALLENGES) fail('Too many active passkey challenges. Try again shortly.', 429);
    const challenge = b64url(randomBytes(32));
    db.prepare(
      'INSERT INTO passkey_challenges(challenge_hash,purpose,email,expires,consumed_at,created_at) VALUES(?,?,?,?,NULL,?)'
    ).run(sha256Hex(Buffer.from(challenge, 'utf8')), purpose, email || null, now + CHALLENGE_TTL_MS, new Date(now).toISOString());
    return challenge;
  }

  function consumeChallenge(challenge, purpose, email) {
    const hash = sha256Hex(Buffer.from(String(challenge || ''), 'utf8'));
    const row = challengeStmt.get(hash);
    const now = Date.now();
    if (!row || row.purpose !== purpose || row.consumed_at !== null || Number(row.expires) <= now) {
      fail('Passkey challenge expired or was already used.', 401);
    }
    if (purpose === 'register' && row.email !== email) fail('Passkey challenge account mismatch.', 401);
    const result = db.prepare(
      'UPDATE passkey_challenges SET consumed_at=? WHERE challenge_hash=? AND consumed_at IS NULL'
    ).run(now, hash);
    if (Number(result.changes) !== 1) fail('Passkey challenge was already used.', 401);
  }

  function userHandle(email) {
    const existing = db.prepare('SELECT user_handle FROM passkey_user_handles WHERE email=?').get(email);
    if (existing) return existing.user_handle;
    const handle = b64url(randomBytes(32));
    db.prepare('INSERT INTO passkey_user_handles(email,user_handle,created_at) VALUES(?,?,?)')
      .run(email, handle, new Date().toISOString());
    return handle;
  }

  function clientHash(req) {
    return sha256Hex(Buffer.from(String(req.headers && req.headers['user-agent'] || 'unknown-client')
      .trim().toLowerCase().slice(0, 256), 'utf8')).slice(0, 24);
  }

  function issueSession(req, email) {
    const token = randomBytes(32).toString('hex');
    const hash = sha256Hex(Buffer.from(token, 'utf8'));
    const now = Date.now();
    const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(x => x.name));
    const names = ['token_hash', 'email', 'expires'];
    const values = [hash, email, now + SESSION_TTL_MS];
    const optional = [
      ['issued_at', now],
      ['last_seen', now],
      ['source_hash', null],
      ['source_basis', 'passkey'],
      ['source_authoritative', 0],
      ['client_hash', clientHash(req)]
    ];
    for (const [name, value] of optional) {
      if (columns.has(name)) {
        names.push(name);
        values.push(value);
      }
    }
    const placeholders = names.map(() => '?').join(',');
    db.prepare('INSERT INTO sessions(' + names.join(',') + ') VALUES(' + placeholders + ')').run(...values);
    return token;
  }

  function listCredentials(email) {
    return passkeysForUserStmt.all(email).map(row => ({
      id: row.credential_id,
      label: row.label || 'Passkey',
      transports: JSON.parse(row.transports || '[]'),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null
    }));
  }

  async function handle(req, res) {
    const path = requestPath(req);
    const method = String(req.method || 'GET').toUpperCase();

    if (path === '/api/passkeys/config' && method === 'GET') {
      return writeJson(res, 200, {
        enabled: true,
        rpId,
        rpName,
        userVerification: 'required',
        discoverableCredentials: true
      });
    }

    if (path === '/api/passkeys' && method === 'GET') {
      const user = sessionUser(req);
      return writeJson(res, 200, { passkeys: listCredentials(user.email) });
    }

    if (path === '/api/passkeys/register/options' && method === 'POST') {
      requireSameOrigin(req);
      const user = sessionUser(req);
      const input = await readJson(req);
      if (!checkPassword(user, input.password)) {
        audit(user.tenant, user.email, 'passkey.enrolment-password-rejected', {});
        fail('Current password confirmation failed.', 401);
      }
      const challenge = issueChallenge('register', user.email);
      const excludeCredentials = listCredentials(user.email).map(item => ({
        type: 'public-key',
        id: item.id,
        transports: item.transports
      }));
      return writeJson(res, 200, {
        publicKey: {
          challenge,
          rp: { id: rpId, name: rpName },
          user: {
            id: userHandle(user.email),
            name: user.email,
            displayName: user.email
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          timeout: 60_000,
          attestation: 'none',
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required'
          },
          excludeCredentials
        }
      });
    }

    if (path === '/api/passkeys/register/verify' && method === 'POST') {
      requireSameOrigin(req);
      const user = sessionUser(req);
      const input = await readJson(req);
      const response = input.response || {};
      const client = parseClientData(response.clientDataJSON, 'webauthn.create', publicOrigin);
      consumeChallenge(client.value.challenge, 'register', user.email);
      const auth = parseAuthenticatorData(response.authenticatorData, rpId, true);
      const rawId = fromB64url(input.rawId || input.id, 'credential id');
      if (!equalBuffers(rawId, auth.credentialId)) fail('Credential identifier mismatch.', 400);
      const credentialId = b64url(rawId);
      const existing = db.prepare('SELECT email FROM passkey_credentials WHERE credential_id=?').get(credentialId);
      if (existing) {
        if (existing.email === user.email) return writeJson(res, 200, { ok: true, alreadyRegistered: true });
        fail('Credential is already registered.', 409);
      }
      const transports = Array.isArray(response.transports)
        ? response.transports.map(x => String(x).slice(0, 24)).filter(Boolean).slice(0, 8)
        : [];
      const label = String(input.label || 'Passkey').trim().slice(0, 80) || 'Passkey';
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO passkey_credentials(credential_id,email,tenant,public_key_jwk,sign_count,transports,label,created_at,last_used_at,revoked_at) ' +
        'VALUES(?,?,?,?,?,?,?,?,NULL,NULL)'
      ).run(
        credentialId,
        user.email,
        user.tenant,
        JSON.stringify(auth.publicKeyJwk),
        auth.signCount,
        JSON.stringify(transports),
        label,
        now
      );
      audit(user.tenant, user.email, 'passkey.registered', {
        credentialId: credentialId.slice(0, 18),
        transports,
        userVerified: true
      });
      return writeJson(res, 200, { ok: true, passkeys: listCredentials(user.email) });
    }

    if (path === '/api/passkeys/auth/options' && method === 'POST') {
      requireSameOrigin(req);
      await readJson(req);
      const challenge = issueChallenge('authenticate', null);
      return writeJson(res, 200, {
        publicKey: {
          challenge,
          rpId,
          timeout: 60_000,
          userVerification: 'required'
        }
      });
    }

    if (path === '/api/passkeys/auth/verify' && method === 'POST') {
      requireSameOrigin(req);
      const input = await readJson(req);
      const response = input.response || {};
      const client = parseClientData(response.clientDataJSON, 'webauthn.get', publicOrigin);
      consumeChallenge(client.value.challenge, 'authenticate', null);

      const credentialId = b64url(fromB64url(input.rawId || input.id, 'credential id'));
      const credential = passkeyByIdStmt.get(credentialId);
      if (!credential) fail('Passkey authentication failed.', 401);

      const auth = parseAuthenticatorData(response.authenticatorData, rpId, false);
      const signature = fromB64url(response.signature, 'signature');
      const signed = Buffer.concat([auth.data, sha256(client.bytes)]);
      let verified = false;
      try {
        const key = createPublicKey({ key: JSON.parse(credential.public_key_jwk), format: 'jwk' });
        verified = verifySignature('sha256', signed, key, signature);
      } catch {
        verified = false;
      }
      if (!verified) {
        audit(credential.tenant, credential.email, 'passkey.authentication-rejected', { reason: 'signature' });
        fail('Passkey authentication failed.', 401);
      }

      const storedCount = Number(credential.sign_count || 0);
      if (storedCount > 0 && auth.signCount > 0 && auth.signCount <= storedCount) {
        audit(credential.tenant, credential.email, 'passkey.authentication-rejected', {
          reason: 'signature-counter',
          storedCount,
          receivedCount: auth.signCount
        });
        fail('Passkey security counter check failed.', 401);
      }

      const user = userByEmailStmt.get(credential.email);
      if (!user || user.tenant !== credential.tenant) fail('Passkey account is unavailable.', 401);

      db.prepare(
        'UPDATE passkey_credentials SET sign_count=?,last_used_at=? WHERE credential_id=?'
      ).run(Math.max(storedCount, auth.signCount), new Date().toISOString(), credentialId);

      const token = issueSession(req, credential.email);
      audit(credential.tenant, credential.email, 'passkey.authenticated', {
        credentialId: credentialId.slice(0, 18),
        userVerified: true
      });
      return writeJson(res, 200, { ok: true }, {
        'Set-Cookie': credentialCookie(token, originUrl.protocol === 'https:')
      });
    }

    if (path === '/api/passkeys/revoke' && method === 'POST') {
      requireSameOrigin(req);
      const user = sessionUser(req);
      const input = await readJson(req);
      if (!checkPassword(user, input.password)) fail('Current password confirmation failed.', 401);
      const credentialId = String(input.credentialId || '');
      const credential = db.prepare(
        'SELECT credential_id FROM passkey_credentials WHERE credential_id=? AND email=? AND revoked_at IS NULL'
      ).get(credentialId, user.email);
      if (!credential) fail('Passkey was not found.', 404);
      db.prepare(
        'UPDATE passkey_credentials SET revoked_at=? WHERE credential_id=? AND email=? AND revoked_at IS NULL'
      ).run(new Date().toISOString(), credentialId, user.email);
      audit(user.tenant, user.email, 'passkey.revoked', { credentialId: credentialId.slice(0, 18) });
      return writeJson(res, 200, { ok: true, passkeys: listCredentials(user.email) });
    }

    return false;
  }

  async function beforeRequest(req, res) {
    const path = requestPath(req);
    if (!(path === '/api/passkeys' || path.startsWith('/api/passkeys/'))) return false;
    try {
      const handled = await handle(req, res);
      if (handled === false) return writeJson(res, 404, { error: 'Passkey route not found.' });
      return true;
    } catch (err) {
      const status = Number(err && err.status) || 500;
      const safeMessage = status >= 500 ? 'Passkey service unavailable.' : String(err && err.message || 'Passkey request failed.');
      return writeJson(res, status, { error: safeMessage });
    }
  }

  return {
    beforeRequest,
    config: { publicOrigin, rpId, rpName },
    securityControlForTests() {
      return { db, issueChallenge, consumeChallenge, parseAuthenticatorData, parseClientData };
    }
  };
}

module.exports = {
  createPasskeyAuth,
  parseAuthenticatorData,
  parseClientData,
  readCbor,
  b64url,
  fromB64url
};
