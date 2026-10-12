'use strict';

const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const OWNER_ACCESS = Object.freeze({ role: 'manager', costs: 0, permissions: Object.freeze(['company.configure']) });
function fail(code, statusCode = 409) {
  const error = new Error(code); error.code = code; error.statusCode = statusCode; throw error;
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_SETUP_INPUT', 400);
  return value.trim();
}
function email(value) {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(result)) fail('INVALID_OWNER_EMAIL', 400);
  return result;
}
function profileFacts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['organisationName', 'industry', 'timeZone'].includes(key))) fail('INVALID_PROFILE_FACTS', 400);
  const result = { organisationName: text(input.organisationName, 160) };
  if (input.industry !== undefined) result.industry = text(input.industry, 120);
  if (input.timeZone !== undefined) {
    result.timeZone = text(input.timeZone, 80);
    try { new Intl.DateTimeFormat('en', { timeZone: result.timeZone }); } catch { fail('INVALID_TIME_ZONE', 400); }
  }
  return result;
}

/**
 * Internal orchestration API, never an HTTP authentication boundary.
 * The caller MUST verify signing-provider evidence and resolve tenant/run/owner
 * authorisation server-side before reserve(). A boolean here is not signature proof.
 * Uses the caller's canonical SQLite connection; savepoints participate in any
 * outer transaction. No invitations, passwords, credentials or sessions are issued.
 */
function createOrganisationAccessSetup({ db, provisionInitialOwner } = {}) {
  if (!db) throw new Error('Canonical SQLite connection required.');
  if (provisionInitialOwner?.constructor?.name === 'AsyncFunction') fail('ASYNC_ACCOUNT_ADAPTER_FORBIDDEN');
  db.exec(`CREATE TABLE IF NOT EXISTS organisation_access_setup(
    tenant TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, contract_hash TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE, owner_email TEXT NOT NULL UNIQUE,
    authority_hash TEXT NOT NULL, profile_json TEXT NOT NULL, revision INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS organisation_access_setup_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, run_id TEXT NOT NULL,
    action TEXT NOT NULL, revision INTEGER NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS organisation_setup_no_update BEFORE UPDATE ON organisation_access_setup_events
    BEGIN SELECT RAISE(ABORT,'Organisation setup events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS organisation_setup_no_delete BEFORE DELETE ON organisation_access_setup_events
    BEGIN SELECT RAISE(ABORT,'Organisation setup events are append only.'); END;
    CREATE TABLE IF NOT EXISTS organisation_access_initial_authority(
    tenant TEXT PRIMARY KEY, run_id TEXT NOT NULL, owner_email TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('RESERVED','CONSUMED','REVOKED')));
    CREATE TRIGGER IF NOT EXISTS organisation_initial_authority_no_delete BEFORE DELETE ON organisation_access_initial_authority
    BEGIN SELECT RAISE(ABORT,'Initial access authority cannot be reset.'); END;
    CREATE TRIGGER IF NOT EXISTS organisation_initial_authority_monotonic BEFORE UPDATE ON organisation_access_initial_authority
    WHEN NEW.tenant<>OLD.tenant OR NEW.run_id<>OLD.run_id OR NEW.owner_email<>OLD.owner_email OR
      NOT ((OLD.state='RESERVED' AND NEW.state IN ('CONSUMED','REVOKED')) OR
           (OLD.state='CONSUMED' AND NEW.state='REVOKED'))
    BEGIN SELECT RAISE(ABORT,'Initial access authority cannot be reset.'); END;`);
  const get = tenant => db.prepare('SELECT * FROM organisation_access_setup WHERE tenant=?').get(tenant);
  const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  // Profiles from an earlier version lack a reliable first-creation receipt.
  // Close that ambiguous historical authority; never infer "unused" from a
  // missing account. This migration and its audit are atomic and idempotent.
  transaction(() => {
    for (const row of db.prepare('SELECT s.* FROM organisation_access_setup s LEFT JOIN organisation_access_initial_authority a ON a.tenant=s.tenant WHERE a.tenant IS NULL').all()) {
      db.prepare('INSERT INTO organisation_access_initial_authority VALUES(?,?,?,?)').run(row.tenant,row.run_id,row.owner_email,'CONSUMED');
      audit(row, 'LEGACY_INITIAL_AUTHORITY_CLOSED');
    }
  });
  function transaction(action) {
    db.exec('SAVEPOINT organisation_access_setup_write');
    try {
      const result = action();
      if (result && typeof result.then === 'function') fail('ASYNC_SETUP_TRANSACTION_FORBIDDEN');
      db.exec('RELEASE organisation_access_setup_write'); return result;
    } catch (error) {
      db.exec('ROLLBACK TO organisation_access_setup_write; RELEASE organisation_access_setup_write'); throw error;
    }
  }
  function audit(row, action, detail = {}) {
    db.prepare('INSERT INTO organisation_access_setup_events(tenant,run_id,action,revision,detail_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(row.tenant, row.run_id, action, row.revision, JSON.stringify(detail), new Date().toISOString());
  }
  function initialAuthority(row) {
    const receipt = db.prepare('SELECT * FROM organisation_access_initial_authority WHERE tenant=?').get(row.tenant);
    if (!receipt || receipt.run_id !== row.run_id || receipt.owner_email !== row.owner_email) fail('INITIAL_OWNER_AUTHORITY_UNAVAILABLE');
    return receipt.state;
  }
  function canonicalRun(row) {
    const run = db.prepare('SELECT tenant,contract_ref_hash FROM implementation_runs WHERE id=?').get(row.run_id);
    if (!run || run.tenant !== row.tenant || run.contract_ref_hash !== row.contract_hash) fail('SETUP_RUN_BINDING_CONFLICT');
    if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(row.tenant)) fail('CANONICAL_TENANT_REQUIRED');
    if (hasTable('tenant_environments')) {
      const env = db.prepare('SELECT run_id FROM tenant_environments WHERE tenant=?').get(row.tenant);
      if (env && env.run_id !== row.run_id) fail('SETUP_ENVIRONMENT_BINDING_CONFLICT');
    }
  }
  function owner(row) {
    const users = db.prepare('SELECT email,tenant,role,costs,permissions FROM users WHERE lower(email)=?').all(row.owner_email);
    if (users.length > 1 || users.some(user => user.tenant !== row.tenant)) fail('SETUP_OWNER_BINDING_CONFLICT');
    return users[0] || null;
  }
  function allowed(user) {
    let permissions; try { permissions = JSON.parse(user?.permissions || '[]'); } catch { return false; }
    return !!user && ['manager', 'director', 'supervisor', 'company-admin'].includes(user.role) &&
      Array.isArray(permissions) && permissions.includes('company.configure');
  }
  function frozen(tenant) {
    return hasTable('identity_tenant_control') && Boolean(db.prepare('SELECT privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(tenant)?.privileged_freeze);
  }
  function scoped(tenant, runId, revision) {
    const row = get(tenant);
    if (!row || row.run_id !== runId) fail('SETUP_NOT_FOUND', 404);
    canonicalRun(row);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || row.revision !== revision)) fail('STALE_SETUP_REVISION');
    return row;
  }
  function view(row) {
    const user = owner(row);
    const initialAccessState = initialAuthority(row);
    let access = !user ? 'ACCOUNT_SETUP_REQUIRED' : !allowed(user) ? 'AUTHORISED_ROLE_SETUP_REQUIRED' : 'SECURE_ENROLMENT_REQUIRED';
    if (allowed(user) && hasTable('passkey_credentials') && db.prepare('SELECT 1 FROM passkey_credentials WHERE tenant=? AND email=? AND revoked_at IS NULL').get(row.tenant, user.email)) access = 'ENROLLED';
    if (initialAccessState === 'REVOKED' || (initialAccessState === 'CONSUMED' && !user)) access = 'ACCESS_RESTORATION_REQUIRED';
    if (frozen(row.tenant)) access = 'ACCESS_FROZEN';
    let invitation = 'NOT_AVAILABLE';
    if (hasTable('implementation_invitations')) {
      const invite = db.prepare('SELECT * FROM implementation_invitations WHERE tenant=? AND contract_ref_hash=?').get(row.tenant, row.contract_hash);
      if (invite) {
        if (invite.recipient_hash !== digest(row.owner_email) || (invite.started_run_id && invite.started_run_id !== row.run_id)) fail('SETUP_INVITATION_BINDING_CONFLICT');
        invitation = invite.status === 'STARTED' ? 'STARTED' : invite.expires_at_ms <= Date.now() ? 'EXPIRED' : invite.status;
      }
    }
    return { tenant: row.tenant, runId: row.run_id, revision: row.revision,
      profile: JSON.parse(row.profile_json), initialOwner: { email: row.owner_email, role: user?.role || null },
      access, initialAccessState, invitation, setupState: 'SETUP_INCOMPLETE', operationalReady: false,
      workspace: { route: 'onboarding', authenticationRequired: true },
      credentialEnrolment: 'EXISTING_PASSKEY_USER_ACTION', permissionsFromQuestionnaire: false };
  }
  function reserve({ binding, profile }) {
    if (binding?.verified !== true || binding.ownerAuthorized !== true) fail('VERIFIED_OWNER_AUTHORITY_REQUIRED', 403);
    const tenant = text(binding.tenant, 120), runId = text(binding.runId, 80);
    const provider = text(binding.provider, 120), eventId = text(binding.eventId, 300);
    const contractHash = digest(text(binding.contractRef, 300));
    const ownerEmail = email(binding.ownerEmail), authorityHash = digest(text(binding.ownerAuthorityRef, 300));
    const facts = profileFacts(profile), eventHash = digest(JSON.stringify([provider, eventId]));
    return transaction(() => {
      const row = { tenant, run_id: runId, contract_hash: contractHash, provider, event_hash: eventHash,
        owner_email: ownerEmail, authority_hash: authorityHash, revision: 1 };
      canonicalRun(row); const existingOwner = owner(row);
      // Canonical users.email is globally unique and belongs to one tenant.
      const collisions = db.prepare('SELECT * FROM organisation_access_setup WHERE tenant=? OR run_id=? OR contract_hash=? OR event_hash=? OR owner_email=?').all(tenant, runId, contractHash, eventHash, ownerEmail);
      if (collisions.length) {
        const existing = collisions[0];
        if (collisions.length !== 1 || Object.keys(row).filter(key => key !== 'revision').some(key => existing[key] !== row[key])) fail('SETUP_BINDING_CONFLICT');
        // Replayed events never overwrite questionnaire edits or emit another grant.
        return view(existing);
      }
      const now = new Date().toISOString();
      db.prepare('INSERT INTO organisation_access_setup VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(tenant, runId, contractHash, provider, eventHash, ownerEmail, authorityHash, JSON.stringify(facts), 1, now, now);
      const initialState = existingOwner ? 'CONSUMED' : 'RESERVED';
      db.prepare('INSERT INTO organisation_access_initial_authority VALUES(?,?,?,?)').run(tenant,runId,ownerEmail,initialState);
      audit(row, 'INITIAL_OWNER_BOUND', { provider, authorityHash, initialAccessState: initialState });
      return view(get(tenant));
    });
  }
  function ensureAccess({ tenant, runId, expectedRevision }) {
    return transaction(() => {
      const row = scoped(tenant, runId, expectedRevision);
      if (!Number.isSafeInteger(expectedRevision)) fail('STALE_SETUP_REVISION');
      if (frozen(tenant)) fail('SETUP_ACCESS_FROZEN', 403);
      const existing = owner(row);
      const initialState = initialAuthority(row);
      if (initialState === 'REVOKED' || (initialState === 'CONSUMED' && !existing)) {
        fail('INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY', 403);
      }
      // Existing identities and their permissions are never silently rewritten.
      if (existing) {
        if (initialState === 'RESERVED') {
          db.prepare("UPDATE organisation_access_initial_authority SET state='CONSUMED' WHERE tenant=?").run(tenant);
          audit(row, 'INITIAL_OWNER_ACCOUNT_OBSERVED');
        }
        return view(row);
      }
      if (typeof provisionInitialOwner !== 'function') return view(row);
      // Adapter must be synchronous, use this connection only, and neither commit
      // nor issue credentials/send invitations. It owns canonical account creation.
      const result = provisionInitialOwner({ db, tenant, runId, email: row.owner_email,
        role: OWNER_ACCESS.role, costs: OWNER_ACCESS.costs, permissions: [...OWNER_ACCESS.permissions], authorityHash: row.authority_hash });
      if (result && typeof result.then === 'function') fail('ASYNC_ACCOUNT_ADAPTER_FORBIDDEN');
      const created = owner(row);
      if (!created || created.email !== row.owner_email || created.role !== OWNER_ACCESS.role || created.costs !== OWNER_ACCESS.costs ||
          JSON.stringify(JSON.parse(created.permissions)) !== JSON.stringify(OWNER_ACCESS.permissions)) fail('ACCOUNT_ADAPTER_POSTCONDITION_FAILED');
      db.prepare("UPDATE organisation_access_initial_authority SET state='CONSUMED' WHERE tenant=?").run(tenant);
      db.prepare('UPDATE organisation_access_setup SET revision=revision+1,updated_at=? WHERE tenant=?').run(new Date().toISOString(), tenant);
      const updated = get(tenant);
      audit(updated, 'INITIAL_OWNER_ACCOUNT_CREATED', { role: OWNER_ACCESS.role, costs: OWNER_ACCESS.costs, permissions: OWNER_ACCESS.permissions });
      return view(updated);
    });
  }
  // Deny-only integration hook: the owner calls this on the same connection and
  // inside its canonical deletion/revocation transaction. It cannot restore or
  // rearm initial authority, even if the same signing event is replayed later.
  function revokeInitialAccess({ tenant, runId, reasonRef }) {
    const reasonHash = digest(text(reasonRef, 300));
    return transaction(() => {
      const row = scoped(tenant, runId);
      if (initialAuthority(row) !== 'REVOKED') {
        db.prepare("UPDATE organisation_access_initial_authority SET state='REVOKED' WHERE tenant=?").run(tenant);
        db.prepare('UPDATE organisation_access_setup SET revision=revision+1,updated_at=? WHERE tenant=?').run(new Date().toISOString(),tenant);
        audit(get(tenant), 'INITIAL_OWNER_ACCESS_REVOKED', { reasonHash });
      }
      if(hasTable('implementation_invitations')){
        db.prepare("UPDATE implementation_invitations SET status='REVOKED' WHERE tenant=? AND contract_ref_hash=? AND status='PENDING'").run(tenant,row.contract_hash);
        if(hasTable('implementation_notification_outbox'))db.prepare("UPDATE implementation_notification_outbox SET state='BLOCKED' WHERE tenant=? AND contract_ref_hash=?").run(tenant,row.contract_hash);
      }
      return view(get(tenant));
    });
  }
  function updateProfile({ tenant, runId, expectedRevision, actor, profile }) {
    const facts = profileFacts(profile);
    return transaction(() => {
      const row = scoped(tenant, runId, expectedRevision);
      if (!Number.isSafeInteger(expectedRevision)) fail('STALE_SETUP_REVISION');
      // actor comes from the existing authenticated session. Re-read authorisation
      // to reject revocation/stale role claims; caller still owns session validation.
      if (!actor || actor.tenant !== tenant || frozen(tenant)) fail('SETUP_PERMISSION_REQUIRED', 403);
      const user = db.prepare('SELECT email,tenant,role,permissions FROM users WHERE email=? AND tenant=?').get(actor.email, tenant);
      if (!allowed(user)) fail('SETUP_PERMISSION_REQUIRED', 403);
      db.prepare('UPDATE organisation_access_setup SET profile_json=?,revision=revision+1,updated_at=? WHERE tenant=?')
        .run(JSON.stringify(facts), new Date().toISOString(), tenant);
      const updated = get(tenant); audit(updated, 'ORGANISATION_PROFILE_UPDATED', { actorHash: digest(user.email) });
      return view(updated);
    });
  }
  // Internal read projection; the orchestration layer must enforce session/tenant
  // access before exposing it. No raw token, credential or signing event is returned.
  return { reserve, ensureAccess, updateProfile, revokeInitialAccess, status: ({ tenant, runId }) => view(scoped(tenant, runId)) };
}

module.exports = { createOrganisationAccessSetup, OWNER_ACCESS };
