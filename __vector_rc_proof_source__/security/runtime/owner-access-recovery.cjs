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
  return {
    async handleRequest(req, res) {
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
