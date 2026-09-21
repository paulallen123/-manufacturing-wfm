'use strict';

const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { FORBIDDEN_IDENTITY_HEADERS } = require('./identity-survival-guard.cjs');
const ACCOUNT = Object.freeze({ email: 'superuser@northstar.example', tenant: 'northstar-demo', personId: 'd1', role: 'director' });
const API_PATH = '/api/owner-access-recovery';
const PAGE_PATH = '/access-recovery';
const MAX_GRANT_MS = 30 * 60 * 1000;
// Retired access-link credentials must never become valid recovery credentials.
const RETIRED_HASHES = new Set([
  '206b067c57a91d14c0dedee7a717e907ada9b04b5d964a4b3aa2d94da7aa58b8',
  'a1a70f9319430281482a623d3453756ef8c0f279a243d9fe8d67fafcb5fc1c16'
]);
const hash = value => createHash('sha256').update(value).digest('hex');

function configuration(env, now) {
  if (!env.WFM_OWNER_RECOVERY_JSON) return null;
  if (env.WFM_HOSTED_STAGING !== 'true' || env.NODE_ENV !== 'staging' || !env.WFM_DB || env.WFM_IDENTITY_SURVIVAL_GUARD === 'off') throw Error('Recovery unavailable.');
  const origin = new URL(env.WFM_PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.WFM_PUBLIC_ORIGIN || origin.username || origin.password) throw Error('Recovery unavailable.');
  const grant = JSON.parse(env.WFM_OWNER_RECOVERY_JSON);
  const keys = ['id', 'tokenHash', 'issuedAt', 'expiresAt', 'sessionEpoch', 'policyVersion'];
  if (!grant || Array.isArray(grant) || Object.keys(grant).length !== keys.length || keys.some(key => !(key in grant)) ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(grant.id) || !/^[a-f0-9]{64}$/.test(grant.tokenHash) || RETIRED_HASHES.has(grant.tokenHash) ||
      !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt) ||
      grant.issuedAt > now || grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > MAX_GRANT_MS ||
      !Number.isSafeInteger(grant.sessionEpoch) || grant.sessionEpoch < 1 ||
      !Number.isSafeInteger(grant.policyVersion) || grant.policyVersion < 1) throw Error('Recovery unavailable.');
  return { ...grant, origin: origin.origin, host: origin.host, dbPath: env.WFM_DB };
}

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify(body));
  return true;
}

function denied(status = 403) {
  const error = Error('Recovery refused.');
  error.status = status;
  return error;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 4096) throw denied(413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw denied(400); }
}

function applyReset(grant, input, now) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'password,token' ||
      typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token) ||
      Buffer.from(input.token, 'base64url').toString('base64url') !== input.token) throw denied();
  if (!timingSafeEqual(Buffer.from(hash(input.token), 'hex'), Buffer.from(grant.tokenHash, 'hex'))) throw denied();
  if (typeof input.password !== 'string' || input.password.length < 20 || input.password.length > 256 ||
      input.password === input.token || input.password === 'Factory-local-demo-2026!') throw denied(400);
  // Expensive password hashing only follows successful high-entropy token verification.
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(input.password, salt, 64).toString('hex');
  const db = new DatabaseSync(grant.dbPath);
  let transaction = false;
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
      CREATE TABLE IF NOT EXISTS owner_recovery_ledger(
        token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE,
        event TEXT NOT NULL CHECK(event IN ('consumed','revoked')), created_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS owner_recovery_no_update BEFORE UPDATE ON owner_recovery_ledger
        BEGIN SELECT RAISE(ABORT,'Recovery ledger is append only.'); END;
      CREATE TRIGGER IF NOT EXISTS owner_recovery_no_delete BEFORE DELETE ON owner_recovery_ledger
        BEGIN SELECT RAISE(ABORT,'Recovery ledger is append only.'); END;`);
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    // Re-evaluate expiration while holding the write lock, after hashing and lock wait.
    const at = now();
    if (at < grant.issuedAt || at >= grant.expiresAt) throw denied();
    if (db.prepare('SELECT 1 FROM owner_recovery_ledger WHERE token_hash=? OR grant_id=?').get(grant.tokenHash, grant.id)) throw denied();
    const account = db.prepare('SELECT email,tenant,person_id,role FROM users WHERE email=?').get(ACCOUNT.email);
    if (!account || account.tenant !== ACCOUNT.tenant || account.person_id !== ACCOUNT.personId || account.role !== ACCOUNT.role) throw denied();
    const control = db.prepare('SELECT session_epoch,policy_version,privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(ACCOUNT.tenant);
    // Recovery cannot remove a security freeze or authorize against a changed security context.
    if (!control || control.privileged_freeze !== 0 || control.session_epoch !== grant.sessionEpoch || control.policy_version !== grant.policyVersion) throw denied();
    db.prepare('INSERT INTO owner_recovery_ledger(token_hash,grant_id,event,created_at) VALUES(?,?,?,?)')
      .run(grant.tokenHash, grant.id, 'consumed', new Date(at).toISOString());
    db.prepare('UPDATE users SET salt=?,password_hash=? WHERE email=? AND tenant=?').run(salt, passwordHash, ACCOUNT.email, ACCOUNT.tenant);
    db.prepare('DELETE FROM identity_session_bindings WHERE token_hash IN (SELECT token_hash FROM sessions WHERE email=?)').run(ACCOUNT.email);
    db.prepare('DELETE FROM sessions WHERE email=?').run(ACCOUNT.email);
    db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(
      ACCOUNT.tenant, 'owner-authorized-recovery', 'owner-password-recovered',
      JSON.stringify({ grantId: grant.id, email: ACCOUNT.email, sessionsRevoked: true, sessionEpoch: control.session_epoch, policyVersion: control.policy_version }),
      new Date(at).toISOString());
    db.exec('COMMIT');
    transaction = false;
  } finally {
    if (transaction) { try { db.exec('ROLLBACK'); } catch {} }
    db.close();
  }
}

function recoveryPage(res) {
  const nonce = randomBytes(24).toString('base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recover Vector access</title>
<style nonce="${nonce}">body{font:17px system-ui;max-width:32rem;margin:4rem auto;padding:1rem;color:#17302b}label{display:block;margin-top:1rem}input,button{box-sizing:border-box;width:100%;font:inherit;padding:.7rem;margin-top:.4rem}button{margin-top:1.5rem}#status{min-height:3rem}</style>
<h1>Recover your Vector access</h1><p>Use the one-time recovery code provided by your environment owner. This changes the password for superuser@northstar.example.</p>
<form id="recovery"><label>Recovery code<input id="token" type="password" autocomplete="off" required maxlength="43"></label><label>New password (20–256 characters)<input id="password" type="password" autocomplete="new-password" required minlength="20" maxlength="256"></label><label>Confirm new password<input id="confirm" type="password" autocomplete="new-password" required minlength="20" maxlength="256"></label><button>Set new password</button></form><p id="status" role="status"></p><a href="/">Return to sign in</a>
<script nonce="${nonce}">'use strict';const form=document.getElementById('recovery'),token=document.getElementById('token'),password=document.getElementById('password'),confirm=document.getElementById('confirm'),status=document.getElementById('status');form.addEventListener('submit',async event=>{event.preventDefault();if(password.value!==confirm.value){status.textContent='Passwords must match.';return;}const button=form.querySelector('button');button.disabled=true;try{const response=await fetch('${API_PATH}',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({token:token.value,password:password.value})});token.value='';password.value='';confirm.value='';status.textContent=response.ok?'Password updated. Return to sign in with your new password.':'Recovery could not be completed. Ask your environment owner to check the code and security status.';if(response.ok)form.hidden=true;}catch{status.textContent='No result was confirmed. Try signing in with your new password before requesting a new code.';}finally{button.disabled=false;}});</script></html>`);
  return true;
}

function createOwnerAccessRecovery({ env = process.env, clock = Date.now } = {}) {
  const emailSignIn = createEmailSignIn({ env, clock });
  return {
    async handleRequest(req, res) {
      if (await emailSignIn.handleRequest(req, res)) return true;
      const path = String(req.url || '').split('?')[0];
      if (path !== API_PATH && path !== PAGE_PATH) return false;
      try {
        const grant = configuration(env, clock());
        if (!grant || clock() >= grant.expiresAt) return respond(res, 404, { error: 'Not Found' });
        if (req.url !== path || req.headers.host !== grant.host || req.headers['x-forwarded-proto'] !== 'https' ||
            FORBIDDEN_IDENTITY_HEADERS.some(name => req.headers[name] !== undefined)) throw denied();
        if (path === PAGE_PATH) {
          if (req.method !== 'GET') throw denied(405);
          return recoveryPage(res);
        }
        if (req.method !== 'POST') throw denied(405);
        if (req.headers.origin !== grant.origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) throw denied();
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw denied(415);
        if (Number(req.headers['content-length'] || 0) > 4096) throw denied(413);
        const input = await readBody(req);
        // Environment revocation/rotation during an in-flight body read must also fail closed.
        const current = configuration(env, clock());
        if (!current || JSON.stringify(current) !== JSON.stringify(grant)) throw denied();
        applyReset(current, input, clock);
        res.setHeader('Set-Cookie', [
          'wfm_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
          'wfm_staging_restore=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
        ]);
        return respond(res, 200, { ok: true });
      } catch (error) {
        return respond(res, error.status || 503, { error: 'Recovery unavailable or refused.' });
      }
    }
  };
}

module.exports = { createOwnerAccessRecovery, ACCOUNT, API_PATH, PAGE_PATH };

// Passwordless sign-in extends this already-packaged authentication boundary.
// It is OFF until explicitly enrolled accounts, a sending domain and a secret key
// have been configured. It never creates users, changes passwords or lifts holds.
function createEmailSignIn({ env = process.env, clock = Date.now, deliver, autoSend = true } = {}) {
  const { createHmac, createCipheriv, createDecipheriv, randomInt, randomUUID } = require('node:crypto');
  const { existsSync } = require('node:fs');
  const { DEFAULT_ISSUER, DEFAULT_AUDIENCE } = require('./identity-survival-guard.cjs');
  const REQUEST = '/api/auth/email/request', VERIFY = '/api/auth/email/verify', PAGE = '/sign-in';
  const COOKIE = '__Host-vector_login', TTL = 600000;
  const GENERIC = { ok: true, message: 'If this email has access, a sign-in link and code will arrive shortly. Use the code in this browser.' };
  let db, boundDbPath, timer, processing = false;
  const emailPattern = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
  const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === keys.sort().join(',');
  const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const hmac = (c, value) => createHmac('sha256', c.key).update(value).digest('hex');
  function config() {
    if (env.WFM_EMAIL_SIGNIN_ENABLED !== 'true') return null;
    if (!env.WFM_DB || env.WFM_IDENTITY_SURVIVAL_GUARD === 'off' || !/^[a-f0-9]{64}$/.test(env.WFM_EMAIL_SIGNIN_KEY || '') || !env.RESEND_API_KEY) throw denied(503);
    const origin = new URL(env.WFM_PUBLIC_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.WFM_PUBLIC_ORIGIN || origin.username || origin.password) throw denied(503);
    const value = JSON.parse(env.WFM_EMAIL_SIGNIN_CONFIG_JSON || 'null');
    if (!exact(value, ['sender', 'accounts']) || !emailPattern.test(value.sender || '') || !Array.isArray(value.accounts) || !value.accounts.length || value.accounts.length > 10000) throw denied(503);
    const seen = new Set();
    for (const account of value.accounts) {
      if (!exact(account, ['recipient', 'email', 'tenant', 'personId', 'role']) || !emailPattern.test(account.recipient || '') ||
          !['email', 'tenant', 'personId', 'role'].every(k => typeof account[k] === 'string' && account[k].length > 0 && account[k].length <= 254) ||
          account.recipient !== account.recipient.toLowerCase() || seen.has(account.recipient)) throw denied(503);
      seen.add(account.recipient);
    }
    return { ...value, origin: origin.origin, host: origin.host, key: Buffer.from(env.WFM_EMAIL_SIGNIN_KEY, 'hex'),
      stamp: hash(JSON.stringify([origin.origin, env.WFM_DB, value, hash(env.WFM_EMAIL_SIGNIN_KEY)])) };
  }
  function database() {
    if (db) {
      if (boundDbPath !== env.WFM_DB) throw denied(503);
      return db;
    }
    if (!existsSync(env.WFM_DB)) throw denied(503);
    const next = new DatabaseSync(env.WFM_DB);
    try {
      // Set the lock wait before schema reads: another worker may be committing.
      next.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON;');
      // The sealed server and existing identity guard own these schemas.
      for (const table of ['users', 'sessions', 'identity_tenant_control', 'identity_session_bindings', 'audit_events']) next.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
      next.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
        CREATE TABLE IF NOT EXISTS email_signin_challenges(
          id TEXT PRIMARY KEY,browser_hash TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,code_hash TEXT NOT NULL,
          account_email TEXT,identity_stamp TEXT,config_stamp TEXT NOT NULL,created_at INTEGER NOT NULL,
          expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used_at INTEGER,remember INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS email_signin_outbox(
          id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
          lease_until INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,config_stamp TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS email_signin_rates(rate_key TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(rate_key,bucket));`);
      db = next; boundDbPath = env.WFM_DB;
      return db;
    } catch (error) { next.close(); throw error; }
  }
  function transaction(fn) {
    const d = database(); d.exec('BEGIN IMMEDIATE');
    try { const value = fn(d); d.exec('COMMIT'); return value; }
    catch (error) { try { d.exec('ROLLBACK'); } catch {} throw error; }
  }
  function cookie(req, name) {
    const parts = String(req.headers.cookie || '').split(';').map(p => p.trim()).filter(p => p.startsWith(name + '='));
    return parts.length === 1 ? parts[0].slice(name.length + 1) : '';
  }
  function identity(d, account) {
    if (!account) return null;
    const user = d.prepare('SELECT * FROM users WHERE email=?').get(account.email);
    const control = d.prepare('SELECT session_epoch,policy_version,privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(account.tenant);
    if (!user || user.tenant !== account.tenant || user.person_id !== account.personId || user.role !== account.role || !control || control.privileged_freeze !== 0) return null;
    return { user, control, stamp: hash(JSON.stringify({ user, control })) };
  }
  function encrypt(c, message) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', c.key, iv);
    cipher.setAAD(Buffer.from(c.stamp));
    const data = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
  }
  function decrypt(c, payload) {
    const [iv, tag, data] = payload.split('.').map(v => Buffer.from(v, 'base64url'));
    const cipher = createDecipheriv('aes-256-gcm', c.key, iv); cipher.setAAD(Buffer.from(c.stamp)); cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString());
  }
  function rate(d, c, recipient, req, at) {
    const specs = [['global', 60000, 200], [hmac(c, 'ip:' + String(req.socket?.remoteAddress || 'unknown')), 60000, 50], [hmac(c, 'email:' + recipient), 900000, 5]];
    d.prepare('DELETE FROM email_signin_rates WHERE bucket<?').run(at - 1800000);
    for (const [key, size, limit] of specs) {
      const bucket = Math.floor(at / size) * size;
      d.prepare('INSERT INTO email_signin_rates VALUES(?,?,1) ON CONFLICT(rate_key,bucket) DO UPDATE SET count=count+1').run(key, bucket);
      if (d.prepare('SELECT count FROM email_signin_rates WHERE rate_key=? AND bucket=?').get(key, bucket).count > limit) return false;
    }
    return true;
  }
  function requestCode(c, input, req, res) {
    if (!exact(input, ['email', 'remember']) || typeof input.email !== 'string' || input.email.length > 254 || !emailPattern.test(input.email.trim()) || typeof input.remember !== 'boolean') throw denied(400);
    const recipient = input.email.trim().toLowerCase(), browser = randomBytes(32).toString('base64url');
    const browserHash = hash(browser), token = randomBytes(32).toString('base64url'), code = String(randomInt(100000000)).padStart(8, '0'), id = randomUUID();
    const issued = transaction(d => {
      const at = clock();
      d.prepare('DELETE FROM email_signin_challenges WHERE expires<?').run(at - 86400000);
      d.prepare('DELETE FROM email_signin_outbox WHERE expires<?').run(at - 86400000);
      if (!rate(d, c, recipient, req, at)) return false;
      const account = c.accounts.find(a => a.recipient === recipient), authority = identity(d, account);
      const message = { to: [recipient], from: c.sender, subject: 'Your VECTOR sign-in',
        text: `Your VECTOR sign-in code is ${code}. It expires in 10 minutes. Enter it in the browser where you requested it.\n\nOr open this link in the same browser, then choose Continue securely:\n${c.origin}${PAGE}#token=${token}\n\nDo not share this code or link. If you did not request access, ignore this message.`,
        idempotencyKey: 'vector-signin/' + id };
      d.prepare('INSERT INTO email_signin_challenges VALUES(?,?,?,?,?,?,?,?,?,0,NULL,?)').run(id, browserHash, hash(token), hmac(c, browserHash + ':' + code), authority ? account.email : null, authority?.stamp || null, c.stamp, at, at + TTL, input.remember ? 1 : 0);
      d.prepare('INSERT INTO email_signin_outbox(id,payload,status,expires,config_stamp) VALUES(?,?,?,?,?)').run(id, encrypt(c, message), authority ? 'pending' : 'discarded', at + TTL, c.stamp);
      return true;
    });
    if (issued) res.setHeader('Set-Cookie', `${COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return respond(res, 202, GENERIC);
  }
  function verifyCode(c, input, req, res) {
    const tokenInput = exact(input, ['token']) && typeof input.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.token);
    const codeInput = exact(input, ['code']) && typeof input.code === 'string' && /^\d{8}$/.test(input.code);
    if (!tokenInput && !codeInput) throw denied(400);
    const browser = cookie(req, COOKIE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(browser)) throw denied();
    const result = transaction(d => {
      const at = clock(), row = d.prepare('SELECT * FROM email_signin_challenges WHERE browser_hash=?').get(hash(browser));
      if (!row || row.used_at !== null || row.attempts >= 5 || at < row.created_at || at >= row.expires || row.config_stamp !== c.stamp || !row.account_email) return null;
      d.prepare('UPDATE email_signin_challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
      if (!(tokenInput ? equal(hash(input.token), row.token_hash) : equal(hmac(c, row.browser_hash + ':' + input.code), row.code_hash))) return null;
      const account = c.accounts.find(a => a.email === row.account_email), authority = identity(d, account);
      if (!authority || authority.stamp !== row.identity_stamp) return null;
      const session = randomBytes(32).toString('base64url'), sessionHash = hash(session), seconds = row.remember ? 43200 : 14400;
      d.prepare('UPDATE email_signin_challenges SET used_at=? WHERE id=? AND used_at IS NULL').run(at, row.id);
      // Rotate only the browser's presented session. Other devices keep their sessions.
      const previous = cookie(req, 'wfm_session');
      if (previous) {
        d.prepare('DELETE FROM identity_session_bindings WHERE token_hash=?').run(hash(previous));
        d.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(previous));
      }
      d.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sessionHash, account.email, at + seconds * 1000);
      d.prepare('INSERT INTO identity_session_bindings(token_hash,tenant,issuer,audience,session_epoch,policy_version,bound_at) VALUES(?,?,?,?,?,?,?)')
        .run(sessionHash, account.tenant, DEFAULT_ISSUER, DEFAULT_AUDIENCE, authority.control.session_epoch, authority.control.policy_version, new Date(at).toISOString());
      d.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)')
        .run(account.tenant, account.email, 'email-signin', JSON.stringify({ challengeId: row.id, remembered: Boolean(row.remember), sessionEpoch: authority.control.session_epoch, policyVersion: authority.control.policy_version }), new Date(at).toISOString());
      return { session, seconds };
    });
    if (!result) throw denied();
    res.setHeader('Set-Cookie', [`wfm_session=${result.session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${result.seconds}`, `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, 'wfm_staging_restore=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0']);
    return respond(res, 200, { ok: true });
  }
  async function deliverWithResend(message) {
    const { idempotencyKey, ...body } = message;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) });
    if (!r.ok) throw Error('Email delivery unavailable.');
    const receipt = await r.json(); if (typeof receipt.id !== 'string' || !receipt.id) throw Error('No email receipt.');
    return { id: receipt.id };
  }
  async function processOutbox() {
    if (processing) return;
    processing = true;
    try {
      const c = config(); if (!c) return;
      for (let i = 0; i < 5; i++) {
        const row = transaction(d => {
          const at = clock();
          d.prepare("UPDATE email_signin_outbox SET status='discarded',payload='' WHERE status IN ('pending','sending') AND (expires<=? OR config_stamp<>? OR attempts>=3)").run(at, c.stamp);
          const item = d.prepare("SELECT * FROM email_signin_outbox WHERE status IN ('pending','sending') AND lease_until<=? AND expires>? AND config_stamp=? AND attempts<3 ORDER BY rowid LIMIT 1").get(at, at, c.stamp);
          if (item) d.prepare("UPDATE email_signin_outbox SET status='sending',attempts=attempts+1,lease_until=? WHERE id=?").run(at + 30000, item.id);
          return item;
        });
        if (!row) break;
        try {
          const current = config(); if (!current || current.stamp !== c.stamp) throw Error('Configuration changed.');
          await (deliver || deliverWithResend)(decrypt(c, row.payload));
          database().prepare("UPDATE email_signin_outbox SET status='sent',payload='' WHERE id=?").run(row.id);
        } catch {
          // Do not log credentials, recipient addresses or raw provider errors.
          database().prepare("UPDATE email_signin_outbox SET status='pending',lease_until=? WHERE id=?").run(clock() + 30000, row.id);
        }
      }
    } finally { processing = false; }
  }
  function activeSession(req) {
    const token = cookie(req, 'wfm_session'); if (!token) return false;
    const d = database(), s = d.prepare('SELECT s.token_hash,u.tenant FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?').get(hash(token), clock());
    if (!s) return false;
    const b = d.prepare('SELECT * FROM identity_session_bindings WHERE token_hash=?').get(s.token_hash);
    if (!b) return true; // Existing password sessions are bound by the existing guard.
    const c = d.prepare('SELECT * FROM identity_tenant_control WHERE tenant=?').get(s.tenant);
    return Boolean(c && b.tenant === s.tenant && b.issuer === DEFAULT_ISSUER && b.audience === DEFAULT_AUDIENCE && b.session_epoch === c.session_epoch && b.policy_version === c.policy_version);
  }
  async function handleRequest(req, res) {
    const path = String(req.url || '').split('?')[0];
    const root = req.method === 'GET' && (path === '/' || path === '/index.html');
    if (![REQUEST, VERIFY, PAGE].includes(path) && !root) return false;
    try {
      const c = config();
      if (!c) return root ? false : respond(res, 404, { error: 'Not Found' });
      if (req.headers.host !== c.host || req.headers['x-forwarded-proto'] !== 'https' || FORBIDDEN_IDENTITY_HEADERS.some(k => req.headers[k] !== undefined)) throw denied();
      if (root) {
        if (activeSession(req)) return false;
        // Clear the stale browser cookie without granting any authenticated state.
        res.setHeader('Set-Cookie', 'wfm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
        if (req.url === '/?password=1') {
          req.headers.cookie = String(req.headers.cookie || '').split(';').filter(v => !v.trim().startsWith('wfm_session=')).join(';');
          return false;
        }
        res.statusCode = 303; res.setHeader('Location', PAGE); res.setHeader('Cache-Control', 'no-store'); res.end(); return true;
      }
      if (req.url !== path) throw denied();
      if (path === PAGE) { if (req.method !== 'GET') throw denied(405); return emailSignInPage(res); }
      if (req.method !== 'POST') throw denied(405);
      if (req.headers.origin !== c.origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) throw denied();
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw denied(415);
      if (Number(req.headers['content-length'] || 0) > 4096) throw denied(413);
      const input = await readBody(req), current = config();
      if (!current || current.stamp !== c.stamp) throw denied();
      return path === REQUEST ? requestCode(current, input, req, res) : verifyCode(current, input, req, res);
    } catch (error) { return respond(res, error.status || 503, { error: 'Sign-in unavailable, expired or refused. Request a new code in this browser, or use your existing password.' }); }
  }
  if (autoSend && env.WFM_EMAIL_SIGNIN_ENABLED === 'true') {
    timer = setInterval(() => { processOutbox().catch(() => {}); }, 2000); timer.unref();
  }
  return { handleRequest, processOutbox, close() { if (timer) clearInterval(timer); if (db) { db.close(); db = null; } } };
}

function emailSignInPage(res) {
  const nonce = randomBytes(24).toString('base64');
  res.statusCode = 200;
  for (const [k,v] of Object.entries({ 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', 'Strict-Transport-Security':'max-age=31536000', 'X-WFM-UI':'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1', 'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` })) res.setHeader(k,v);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to VECTOR</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f3f7fc;color:#122b4a;font:16px/1.6 system-ui,sans-serif}main{max-width:460px;margin:7vh auto;padding:32px;background:white;border:1px solid #d9e4f2;border-radius:16px}.brand{font-weight:850;letter-spacing:.2em;color:#145adc}h1{font-size:27px;margin:18px 0 8px}label{display:block;margin-top:18px}input:not([type=checkbox]),button{width:100%;font:inherit;padding:12px;margin-top:6px;border:1px solid #9bb2d0;border-radius:8px}button{background:#145adc;color:white;font-weight:650;cursor:pointer}button:disabled{opacity:.55}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #78a6ff;outline-offset:3px}.small{font-size:13px;color:#415a77}a{color:#145adc}#status{min-height:48px;margin-top:20px}[hidden]{display:none!important}hr{border:0;border-top:1px solid #d9e4f2;margin:26px 0}@media(max-width:500px){main{margin:16px;padding:24px}}</style></head><body><main><div class="brand">VECTOR</div><h1>Welcome back</h1><p>No password to remember. Get a one-time link and code in your email.</p>
<form id="request"><label for="email">Your authorised email address</label><input id="email" type="email" autocomplete="email" maxlength="254" required><label class="small"><input id="remember" type="checkbox"> Keep me signed in for 12 hours on this private device.</label><button>Send sign-in email</button></form>
<form id="confirm" hidden><p>Your sign-in link is ready. Continue only if you requested it in this browser.</p><button>Continue securely</button></form>
<hr><form id="verify"><label for="code">Already have a code?</label><input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" placeholder="8-digit code" required><button>Sign in with code</button></form><p id="status" role="status" aria-live="polite"></p><a href="/?password=1">Use existing password instead</a><p class="small">Never share a sign-in code or link. On a shared device, leave the private-device option unticked and sign out when finished.</p></main>
<script nonce="${nonce}">'use strict';const status=document.getElementById('status'),request=document.getElementById('request'),verify=document.getElementById('verify'),confirm=document.getElementById('confirm');let token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'','/sign-in');if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)){confirm.hidden=false;request.hidden=true;}
async function submit(form,path,body){const button=form.querySelector('button');button.disabled=true;try{const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok){status.textContent='That sign-in could not be completed. Request a fresh code here, or use your existing password.';request.hidden=false;return;}if(path.endsWith('/verify')){token=null;location.replace('/');}else{status.textContent=data.message;document.getElementById('code').focus();}}catch{status.textContent='No result was confirmed. Return to VECTOR to check your sign-in before requesting another code.';}finally{button.disabled=false;}}
request.addEventListener('submit',e=>{e.preventDefault();submit(request,'/api/auth/email/request',{email:document.getElementById('email').value,remember:document.getElementById('remember').checked});});verify.addEventListener('submit',e=>{e.preventDefault();submit(verify,'/api/auth/email/verify',{code:document.getElementById('code').value});});confirm.addEventListener('submit',e=>{e.preventDefault();submit(confirm,'/api/auth/email/verify',{token});});</script></body></html>`);
  return true;
}

module.exports.createEmailSignIn = createEmailSignIn;
