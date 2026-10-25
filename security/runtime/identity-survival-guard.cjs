'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { ensurePasskeySchema } = require('./passkey-schema.cjs');

const DEFAULT_ISSUER = 'wfm-local-auth';
const DEFAULT_AUDIENCE = 'wfm-api';
const PROOF_RUNNER_ISSUER = 'wfm-proof-runner';
const FORBIDDEN_IDENTITY_HEADERS = Object.freeze([
  'x-wfm-tenant',
  'x-wfm-role',
  'x-wfm-permissions',
  'x-wfm-issuer',
  'x-wfm-audience',
  'x-wfm-session-epoch',
  'x-wfm-policy-version'
]);
const HIGH_RISK_PREFIXES = Object.freeze([
  '/api/company',
  '/api/payroll',
  '/api/integrations',
  '/api/implementation',
  '/api/onboarding',
  '/api/org',
  '/api/admin',
  '/api/command',
  '/api/passkeys/register',
  '/api/passkeys/revoke'
]);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function privilegedAction(req, role) {
  const method = String(req?.method || 'GET').toUpperCase();
  const path = requestPath(req);
  // This provider redirect exchanges an authorization code and stores credentials.
  if (method === 'GET' && path === '/api/integrations/autonomous/oauth/callback/gusto') return true;
  if (method === 'GET' || method === 'HEAD' || path === '/api/logout') return false;
  if (HIGH_RISK_PREFIXES.some(prefix => path.startsWith(prefix))) return true;
  return role !== 'employee';
}

function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

function createIdentitySurvivalGuard(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  if (!dbPath) throw new Error('Identity survival guard requires WFM_DB.');
  const issuer = options.issuer || DEFAULT_ISSUER;
  const audience = options.audience || DEFAULT_AUDIENCE;
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS identity_tenant_control(
      tenant TEXT PRIMARY KEY,
      session_epoch INTEGER NOT NULL DEFAULT 1 CHECK(session_epoch >= 1),
      policy_version INTEGER NOT NULL DEFAULT 1 CHECK(policy_version >= 1),
      privileged_freeze INTEGER NOT NULL DEFAULT 0 CHECK(privileged_freeze IN (0,1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_session_bindings(
      token_hash TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      issuer TEXT NOT NULL,
      audience TEXT NOT NULL,
      session_epoch INTEGER NOT NULL,
      policy_version INTEGER NOT NULL,
      bound_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proof_runner_sessions(
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      tenant TEXT NOT NULL,
      role TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_guard_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT,
      token_hash_prefix TEXT,
      event TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS no_identity_guard_event_update
      BEFORE UPDATE ON identity_guard_events BEGIN SELECT RAISE(ABORT,'Identity guard events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_identity_guard_event_delete
      BEFORE DELETE ON identity_guard_events BEGIN SELECT RAISE(ABORT,'Identity guard events are append only.'); END;
  `);

  ensurePasskeySchema(db);
  const passkeySessionStmt = db.prepare('SELECT * FROM passkey_sessions WHERE token_hash=?');
  const passkeyCredentialStmt = db.prepare('SELECT id FROM passkey_credentials WHERE id=? AND tenant=? AND email=? AND revoked_at IS NULL');
  const ensureControlStmt = db.prepare(`INSERT OR IGNORE INTO identity_tenant_control
    (tenant,session_epoch,policy_version,privileged_freeze,updated_at) VALUES(?,1,1,0,?)`);
  const controlStmt = db.prepare('SELECT * FROM identity_tenant_control WHERE tenant=?');
  const sessionStmt = db.prepare(`SELECT s.token_hash,s.email,s.expires,u.tenant,u.role
    FROM sessions s JOIN users u ON u.email=s.email
    WHERE s.token_hash=? AND s.expires>?`);
  const bindingStmt = db.prepare('SELECT * FROM identity_session_bindings WHERE token_hash=?');
  const proofRunnerSessionStmt = db.prepare('SELECT * FROM proof_runner_sessions WHERE token_hash=?');
  const bindStmt = db.prepare(`INSERT INTO identity_session_bindings
    (token_hash,tenant,issuer,audience,session_epoch,policy_version,bound_at)
    VALUES(?,?,?,?,?,?,?)`);
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token_hash=?');
  const deleteBindingStmt = db.prepare('DELETE FROM identity_session_bindings WHERE token_hash=?');
  const eventStmt = db.prepare(`INSERT INTO identity_guard_events
    (tenant,token_hash_prefix,event,detail,created_at) VALUES(?,?,?,?,?)`);

  function record(tenant, tokenHash, event, detail) {
    try {
      eventStmt.run(tenant || null, tokenHash ? tokenHash.slice(0, 16) : null, event,
        JSON.stringify(detail || {}), new Date().toISOString());
    } catch {
      // Enforcement must not depend on secondary telemetry being writable.
    }
  }

  function containSession(row, tokenHash, event, detail) {
    try { deleteSessionStmt.run(tokenHash); } catch {}
    try { deleteBindingStmt.run(tokenHash); } catch {}
    record(row?.tenant || null, tokenHash, event, detail);
  }

  function rejectInjectedIdentity(req, res) {
    for (const name of FORBIDDEN_IDENTITY_HEADERS) {
      if (req?.headers?.[name] !== undefined) {
        record(null, null, 'identity-header-injection-blocked', { header: name, path: requestPath(req) });
        return writeJson(res, 400, { error: 'Client-supplied identity authority is not accepted.' });
      }
    }
    return false;
  }

  function beforeRequest(req, res) {
    if (rejectInjectedIdentity(req, res)) return true;
    const token = cookieSessionToken(req);
    if (!token) return false; // Public/integration routes remain governed by the sealed server.

    const tokenHash = sha256(token);
    const now = Date.now();
    const row = sessionStmt.get(tokenHash, now);
    if (!row) {
      record(null, tokenHash, 'unknown-or-expired-session', { path: requestPath(req) });
      return writeJson(res, 401, { error: 'Session expired. Sign in again.' });
    }

    const proofRunnerSession = proofRunnerSessionStmt.get(tokenHash);
    if (proofRunnerSession && (
      proofRunnerSession.email !== row.email ||
      proofRunnerSession.tenant !== row.tenant ||
      proofRunnerSession.role !== row.role ||
      Number(proofRunnerSession.expires) <= now
    )) {
      containSession(row, tokenHash, 'proof-session-scope-mismatch-contained', { path: requestPath(req) });
      return writeJson(res, 401, { error: 'Proof session security context changed. Authenticate again.' });
    }
    const passkeySession = passkeySessionStmt.get(tokenHash);
    if (passkeySession && (passkeySession.email !== row.email || passkeySession.tenant !== row.tenant ||
      passkeySession.role !== row.role || passkeySession.expires <= now ||
      !passkeyCredentialStmt.get(passkeySession.credential_id,row.tenant,row.email))) {
      containSession(row,tokenHash,'passkey-session-scope-mismatch-contained',{path:requestPath(req)});
      return writeJson(res,401,{error:'Passkey security context changed. Sign in again.'});
    }
    const federatedAuth = options.getFederatedAuth?.();
    const federatedSession = federatedAuth?.getSession(tokenHash);
    const priorBinding = bindingStmt.get(tokenHash);
    if ((federatedSession || priorBinding?.issuer === 'wfm-federated') &&
        (!federatedAuth || !federatedAuth.validateSession(tokenHash, row) || passkeySession || proofRunnerSession)) {
      containSession(row, tokenHash, 'federated-session-scope-mismatch-contained', {path: requestPath(req)});
      return writeJson(res, 401, {error: 'Sign-in security context changed. Sign in again.'});
    }
    const expectedIssuer = federatedSession ? 'wfm-federated' : passkeySession ? 'wfm-passkey' : proofRunnerSession ? PROOF_RUNNER_ISSUER : issuer;

    ensureControlStmt.run(row.tenant, new Date().toISOString());
    const control = controlStmt.get(row.tenant);
    let binding = bindingStmt.get(tokenHash);
    if (!binding) {
      bindStmt.run(tokenHash, row.tenant, expectedIssuer, audience,
        Number(control.session_epoch), Number(control.policy_version), new Date().toISOString());
      binding = bindingStmt.get(tokenHash);
      record(row.tenant, tokenHash, 'session-resource-bound', {
        issuer: expectedIssuer, audience, sessionEpoch: control.session_epoch, policyVersion: control.policy_version
      });
    }

    const mismatch =
      binding.tenant !== row.tenant ||
      binding.issuer !== expectedIssuer ||
      binding.audience !== audience ||
      Number(binding.session_epoch) !== Number(control.session_epoch) ||
      Number(binding.policy_version) !== Number(control.policy_version);

    if (mismatch) {
      containSession(row, tokenHash, 'session-binding-mismatch-contained', {
        path: requestPath(req),
        tenantMatch: binding.tenant === row.tenant,
        issuerMatch: binding.issuer === expectedIssuer,
        audienceMatch: binding.audience === audience,
        sessionEpochMatch: Number(binding.session_epoch) === Number(control.session_epoch),
        policyVersionMatch: Number(binding.policy_version) === Number(control.policy_version)
      });
      return writeJson(res, 401, { error: 'Session security context changed. Sign in again.' });
    }

    if (Number(control.privileged_freeze) === 1 && privilegedAction(req, row.role)) {
      record(row.tenant, tokenHash, 'privileged-action-frozen', {
        path: requestPath(req), method: req.method, role: row.role
      });
      return writeJson(res, 403, { error: 'Privileged actions are temporarily frozen for this customer security cell.' });
    }

    return false;
  }

  // Administrative methods are intentionally not exposed over HTTP by this module.
  // Broad tenant epoch rotation or freeze changes belong behind an independently
  // authorised security control plane, not inside the application request surface.
  function securityControlForTests() {
    return {
      db,
      setFreeze(tenant, frozen) {
        ensureControlStmt.run(tenant, new Date().toISOString());
        db.prepare('UPDATE identity_tenant_control SET privileged_freeze=?,updated_at=? WHERE tenant=?')
          .run(frozen ? 1 : 0, new Date().toISOString(), tenant);
      },
      bumpEpoch(tenant) {
        ensureControlStmt.run(tenant, new Date().toISOString());
        db.prepare('UPDATE identity_tenant_control SET session_epoch=session_epoch+1,updated_at=? WHERE tenant=?')
          .run(new Date().toISOString(), tenant);
      },
      bumpPolicy(tenant) {
        ensureControlStmt.run(tenant, new Date().toISOString());
        db.prepare('UPDATE identity_tenant_control SET policy_version=policy_version+1,updated_at=? WHERE tenant=?')
          .run(new Date().toISOString(), tenant);
      }
    };
  }

  return { beforeRequest, securityControlForTests };
}

module.exports = {
  createIdentitySurvivalGuard,
  cookieSessionToken,
  privilegedAction,
  FORBIDDEN_IDENTITY_HEADERS,
  DEFAULT_ISSUER,
  DEFAULT_AUDIENCE,
  PROOF_RUNNER_ISSUER
};
