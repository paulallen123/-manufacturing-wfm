'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROOF_RUNNER_ISSUER = 'wfm-proof-runner';
const DEFAULT_AUDIENCE = 'wfm-api';
const SAFE_FAULTS = Object.freeze([
  'synthetic-worker-unhealthy',
  'synthetic-verifier-unavailable',
  'synthetic-canary-verification-failure',
  'synthetic-rollback-containment',
]);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function deny(code, message, status = 403) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}
function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}
function bounded(value, pattern, max) {
  const text = String(value || '').trim();
  return text.length <= max && pattern.test(text) ? text : '';
}

function createRecoveryProofBoundary({
  dbPath,
  expected,
  buildSha,
  audience = DEFAULT_AUDIENCE,
  now = Date.now,
  allowedFaults = SAFE_FAULTS,
} = {}) {
  if (!dbPath) deny('WFM_RECOVERY_PROOF_DB', 'Recovery proof identity requires a durable database.', 500);
  const expectedBinding = Object.freeze({
    candidateSha: bounded(expected?.candidateSha, /^[0-9a-f]{40}$/, 40),
    deploymentId: bounded(expected?.deploymentId, /^[A-Za-z0-9-]{8,80}$/, 80),
    tenant: bounded(expected?.tenant, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/, 100),
    runId: bounded(expected?.runId, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/, 120),
  });
  if (Object.values(expectedBinding).some((value) => !value)) {
    deny('WFM_RECOVERY_PROOF_BINDING', 'Exact candidate, deployment, tenant and run binding are required.', 500);
  }
  if (String(buildSha || '').trim().toLowerCase() !== expectedBinding.candidateSha) {
    deny('WFM_RECOVERY_PROOF_BUILD', 'Recovery proof source does not match the sealed runtime build.', 500);
  }

  const allowed = new Set(Array.from(allowedFaults || [], (value) => String(value)));
  if (!allowed.size || [...allowed].some((value) => !SAFE_FAULTS.includes(value))) {
    deny('WFM_RECOVERY_PROOF_FAULTS', 'Recovery proof faults must be an explicit safe synthetic subset.', 500);
  }

  const db = new DatabaseSync(dbPath);
  const main = db.prepare('PRAGMA database_list').all().find((row) => row.name === 'main');
  if (!String(main?.file || '').trim()) {
    db.close();
    deny('WFM_RECOVERY_PROOF_DB', 'Recovery proof boundary refuses an in-memory authority database.', 500);
  }
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS recovery_proof_requests(
      proof_key TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      tenant TEXT NOT NULL,
      candidate_sha TEXT NOT NULL,
      deployment_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      fault TEXT NOT NULL,
      input_digest TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recovery_proof_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proof_key TEXT NOT NULL,
      tenant TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS recovery_proof_events_no_update
      BEFORE UPDATE ON recovery_proof_events BEGIN SELECT RAISE(ABORT,'Recovery proof events are append only'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_proof_events_no_delete
      BEFORE DELETE ON recovery_proof_events BEGIN SELECT RAISE(ABORT,'Recovery proof events are append only'); END;
  `);

  const session = db.prepare(`SELECT s.token_hash,s.email,s.expires,u.tenant,u.role,
      p.email AS proof_email,p.tenant AS proof_tenant,p.role AS proof_role,p.issued_at AS proof_issued_at,p.expires AS proof_expires,
      b.issuer,b.audience,b.session_epoch,b.policy_version
    FROM sessions s
    JOIN users u ON u.email=s.email
    JOIN proof_runner_sessions p ON p.token_hash=s.token_hash
    JOIN identity_session_bindings b ON b.token_hash=s.token_hash
    WHERE s.token_hash=?`);
  const existing = db.prepare('SELECT * FROM recovery_proof_requests WHERE proof_key=?');
  const insert = db.prepare(`INSERT INTO recovery_proof_requests(
    proof_key,token_hash,tenant,candidate_sha,deployment_id,run_id,fault,input_digest,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  const event = db.prepare(`INSERT INTO recovery_proof_events(
    proof_key,tenant,event_type,detail_json,created_at
  ) VALUES(?,?,?,?,?)`);

  function authorize(req, input = {}) {
    const token = cookieToken(req);
    if (!token) deny('WFM_RECOVERY_PROOF_SESSION', 'A signed proof-runner session is required.', 401);
    const tokenHash = sha256(token);
    const at = Number(now());
    const actor = session.get(tokenHash);
    if (!actor || Number(actor.expires) <= at || Number(actor.proof_expires) <= at) {
      deny('WFM_RECOVERY_PROOF_SESSION', 'Proof-runner session is missing or expired.', 401);
    }
    if (
      actor.proof_email !== actor.email ||
      actor.proof_tenant !== actor.tenant ||
      actor.proof_role !== actor.role ||
      actor.issuer !== PROOF_RUNNER_ISSUER ||
      actor.audience !== audience
    ) {
      deny('WFM_RECOVERY_PROOF_SESSION', 'Proof-runner identity binding is not current.', 401);
    }
    if (actor.tenant !== expectedBinding.tenant) {
      deny('WFM_RECOVERY_PROOF_TENANT', 'Proof session is not bound to the canonical tenant.', 403);
    }

    const supplied = {
      candidateSha: bounded(input.candidateSha, /^[0-9a-f]{40}$/, 40),
      deploymentId: bounded(input.deploymentId, /^[A-Za-z0-9-]{8,80}$/, 80),
      tenant: bounded(input.tenant, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/, 100),
      runId: bounded(input.runId, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/, 120),
    };
    for (const key of Object.keys(expectedBinding)) {
      if (supplied[key] !== expectedBinding[key]) {
        deny('WFM_RECOVERY_PROOF_BINDING', 'Recovery proof request does not match the exact canonical target.', 409);
      }
    }

    const proofKey = bounded(input.proofKey, /^[A-Za-z0-9][A-Za-z0-9_.:-]{15,119}$/, 120);
    const fault = String(input.fault || '');
    if (!proofKey) deny('WFM_RECOVERY_PROOF_INPUT', 'A stable proof key is required.', 400);
    if (!allowed.has(fault)) deny('WFM_RECOVERY_PROOF_FAULT', 'Only explicitly safe synthetic recovery faults are permitted.', 400);

    const requestDigest = digest({
      proofKey,
      fault,
      binding: expectedBinding,
      actor: { email: actor.email, tenant: actor.tenant, role: actor.role },
    });

    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = existing.get(proofKey);
      if (prior) {
        if (
          prior.input_digest !== requestDigest ||
          prior.tenant !== expectedBinding.tenant ||
          prior.candidate_sha !== expectedBinding.candidateSha ||
          prior.deployment_id !== expectedBinding.deploymentId ||
          prior.run_id !== expectedBinding.runId ||
          prior.fault !== fault
        ) {
          deny('WFM_RECOVERY_PROOF_CONFLICT', 'Proof key is already bound to a different request.', 409);
        }
        event.run(proofKey, expectedBinding.tenant, 'proof-request-replayed', JSON.stringify({
          inputDigest: requestDigest,
          tokenHashPrefix: tokenHash.slice(0, 16),
        }), at);
        db.exec('COMMIT');
        return Object.freeze({
          status: 'replay',
          proofKey,
          fault,
          binding: expectedBinding,
          actor: { email: actor.email, tenant: actor.tenant, role: actor.role },
          recoveryAuthorityGranted: false,
          productionAuthorityGranted: false,
          customerMutation: false,
        });
      }

      insert.run(
        proofKey,tokenHash,expectedBinding.tenant,expectedBinding.candidateSha,
        expectedBinding.deploymentId,expectedBinding.runId,fault,requestDigest,at
      );
      event.run(proofKey, expectedBinding.tenant, 'proof-request-authorized', JSON.stringify({
        fault,
        inputDigest: requestDigest,
        tokenHashPrefix: tokenHash.slice(0, 16),
        recoveryAuthorityGranted: false,
      }), at);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }

    return Object.freeze({
      status: 'authorized',
      proofKey,
      fault,
      binding: expectedBinding,
      actor: { email: actor.email, tenant: actor.tenant, role: actor.role },
      recoveryAuthorityGranted: false,
      productionAuthorityGranted: false,
      customerMutation: false,
    });
  }

  function close() {
    try { db.close(); } catch {}
  }

  return {
    authorize,
    close,
    expectedBinding,
    capabilities: () => ({
      proofRunnerIdentityRequired: true,
      exactCandidateBindingRequired: true,
      exactDeploymentBindingRequired: true,
      exactTenantBindingRequired: true,
      exactRunBindingRequired: true,
      syntheticFaultsOnly: true,
      recoveryAuthority: false,
      productionAuthority: false,
      customerMutation: false,
      modelCanGrantAuthority: false,
    }),
  };
}

module.exports = {
  createRecoveryProofBoundary,
  SAFE_FAULTS,
  PROOF_RUNNER_ISSUER,
};
