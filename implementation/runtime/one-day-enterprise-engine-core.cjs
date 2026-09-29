'use strict';

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createImplementationWorkController } = require('./implementation-work-controller.cjs');
const { createTenantEnvironmentProvisioner } = require('./tenant-environment-provisioner.cjs');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');

const PREFIX = '/api/implementation/autonomous';
const INTERNAL_HEADER = 'x-wfm-implementation-internal';
const CONTRACT_WEBHOOK_HEADER = 'x-wfm-contract-webhook';

const REQUIREMENTS = Object.freeze([
  { key: 'configuration-scope', label: 'Customer implementation scope', minConfidence: 1.0, budgetMinutes: 5, dependsOn: [] },
  { key: 'tenant-environment', label: 'Tenant environment', minConfidence: 0.99, budgetMinutes: 15, dependsOn: ['configuration-scope'] },
  { key: 'identity-access', label: 'Identity and access', minConfidence: 0.99, budgetMinutes: 20, dependsOn: ['tenant-environment'] },
  { key: 'source-systems', label: 'Authoritative source systems', minConfidence: 0.95, budgetMinutes: 45, dependsOn: ['identity-access'] },
  { key: 'people-data', label: 'People data and hierarchy', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['source-systems'] },
  { key: 'organisation-model', label: 'Sites, departments and cost structure', minConfidence: 0.98, budgetMinutes: 30, dependsOn: ['people-data'] },
  { key: 'time-policies', label: 'Time, break and overtime policies', minConfidence: 0.995, budgetMinutes: 45, dependsOn: ['people-data'] },
  { key: 'absence-policies', label: 'Absence and leave policies', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['people-data'] },
  { key: 'scheduling', label: 'Shift patterns and scheduling rules', minConfidence: 0.99, budgetMinutes: 45, dependsOn: ['organisation-model', 'time-policies'] },
  { key: 'approvals', label: 'Approval and delegation rules', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['organisation-model', 'identity-access'] },
  { key: 'clocking', label: 'Clocking and device rules', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['identity-access', 'time-policies'] },
  { key: 'payroll-mapping', label: 'Payroll mappings', minConfidence: 0.995, budgetMinutes: 45, dependsOn: ['source-systems', 'people-data', 'time-policies'] },
  { key: 'historical-replay', label: 'Historical replay and reconciliation', minConfidence: 0.995, budgetMinutes: 60, dependsOn: ['payroll-mapping', 'time-policies'] },
  { key: 'security-controls', label: 'Security and tenant isolation', minConfidence: 1.0, budgetMinutes: 30, dependsOn: ['tenant-environment', 'identity-access'] },
  { key: 'resilience', label: 'Recovery and failure handling', minConfidence: 0.99, budgetMinutes: 30, dependsOn: ['source-systems', 'security-controls'] },
  { key: 'scenario-validation', label: 'Rigorous end-to-end scenario testing', minConfidence: 1.0, budgetMinutes: 60, dependsOn: ['scheduling', 'approvals', 'clocking', 'historical-replay', 'security-controls', 'resilience'] },
  { key: 'test-data-cleanup', label: 'Test data removed and environment reset', minConfidence: 1.0, budgetMinutes: 20, dependsOn: ['scenario-validation'] },
  { key: 'live-data-import', label: 'Live data imported and reconciled', minConfidence: 1.0, budgetMinutes: 45, dependsOn: ['test-data-cleanup', 'people-data', 'organisation-model', 'payroll-mapping'] },
  { key: 'role-learning', label: 'Role learning journeys generated', minConfidence: 0.99, budgetMinutes: 15, dependsOn: ['people-data'] },
  { key: 'privileged-competency', label: 'Managers/admins certified for privileged tasks', minConfidence: 0.99, budgetMinutes: 90, dependsOn: ['role-learning', 'time-policies', 'scheduling', 'payroll-mapping', 'security-controls'] },
  { key: 'frontline-readiness', label: 'Frontline users certified for first use', minConfidence: 0.99, budgetMinutes: 20, dependsOn: ['role-learning', 'absence-policies', 'scheduling', 'clocking'] }
]);

const REQUIREMENT_BY_KEY = new Map(REQUIREMENTS.map(item => [item.key, item]));

function criticalPathRemainingMinutes(requirements) {
  const byKey = new Map(requirements.map(item => [item.key, item]));
  const memo = new Map();

  function remaining(key, visiting = new Set()) {
    const item = byKey.get(key);
    if (!item || item.satisfied) return 0;
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key)) throw new Error('Implementation requirement dependency cycle detected.');

    const nextVisiting = new Set(visiting);
    nextVisiting.add(key);
    const dependencyRemaining = (item.dependsOn || []).map(dep => remaining(dep, nextVisiting));
    const value = Number(item.budgetMinutes || 0) + Math.max(0, ...dependencyRemaining);
    memo.set(key, value);
    return value;
  }

  return Math.max(0, ...requirements.filter(item => !item.satisfied).map(item => remaining(item.key)));
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function recoveryKey(secret) {
  return createHash('sha256').update('wfm-implementation-invitation-recovery:v1:' + String(secret)).digest();
}

function sealRecoveryValue(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', recoveryKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function openRecoveryValue(value, secret) {
  const parts = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
    throw new Error('Invalid invitation recovery payload.');
  }
  const decipher = createDecipheriv('aes-256-gcm', recoveryKey(secret), parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function compact(value, max = 200) {
  return String(value ?? '').slice(0, max);
}

function parseJsonSafe(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normaliseFact(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function ensureLegacyColumn(db, table, column, definition) {
  if (!/^[A-Za-z0-9_]+$/.test(table) || !/^[A-Za-z0-9_]+$/.test(column)) {
    throw new Error('Unsafe legacy schema identifier.');
  }
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(item => item.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function sqlIdentifier(value) {
  const name = String(value || '');
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('Unsafe SQLite identifier.');
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

function compatibilityDefaultSql(column) {
  const type = String(column?.type || '').toUpperCase();
  if (/INT|REAL|FLOA|DOUB|NUM|DEC|BOOL/.test(type)) return '0';
  if (/BLOB/.test(type)) return "X''";
  return "''";
}

function ensureImplementationEventsWriteCompatibility(db) {
  const table = 'implementation_events';
  const currentAuditColumns = new Set(['run_id', 'tenant', 'event', 'detail_json', 'created_at']);
  const columns = db.prepare('PRAGMA table_info(' + sqlIdentifier(table) + ')').all();
  const blockers = columns.filter(column =>
    Number(column.notnull) === 1 &&
    column.dflt_value == null &&
    Number(column.pk) === 0 &&
    !currentAuditColumns.has(column.name)
  );
  if (blockers.length === 0) return false;

  const blockerNames = new Set(blockers.map(column => column.name));
  const tableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table)?.sql || '';
  const triggers = db.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND sql IS NOT NULL ORDER BY name"
  ).all(table);
  const indexes = db.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name"
  ).all(table);
  const primaryKeyColumns = columns
    .filter(column => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk));
  const autoincrement = /\bAUTOINCREMENT\b/i.test(tableSql);
  const temporaryTable = 'implementation_events__compat_migration';

  const existingTemporary = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?"
  ).get(temporaryTable);
  if (existingTemporary) {
    throw new Error('Implementation audit compatibility migration found an unfinished temporary table.');
  }

  const columnDefinitions = columns.map(column => {
    let definition = sqlIdentifier(column.name);
    if (column.type) definition += ' ' + String(column.type);
    if (primaryKeyColumns.length === 1 && Number(column.pk) === 1) {
      definition += ' PRIMARY KEY';
      if (autoincrement && /INT/i.test(String(column.type || ''))) definition += ' AUTOINCREMENT';
    } else if (Number(column.notnull) === 1) {
      definition += ' NOT NULL';
    }
    if (column.dflt_value != null) {
      definition += ' DEFAULT ' + String(column.dflt_value);
    } else if (blockerNames.has(column.name)) {
      definition += ' DEFAULT ' + compatibilityDefaultSql(column);
    }
    return definition;
  });

  if (primaryKeyColumns.length > 1) {
    columnDefinitions.push(
      'PRIMARY KEY (' + primaryKeyColumns.map(column => sqlIdentifier(column.name)).join(',') + ')'
    );
  }

  const columnList = columns.map(column => sqlIdentifier(column.name)).join(',');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(
      'ALTER TABLE ' + sqlIdentifier(table) + ' RENAME TO ' + sqlIdentifier(temporaryTable) + ';' +
      'CREATE TABLE ' + sqlIdentifier(table) + '(' + columnDefinitions.join(',') + ');' +
      'INSERT INTO ' + sqlIdentifier(table) + '(' + columnList + ') SELECT ' + columnList +
        ' FROM ' + sqlIdentifier(temporaryTable) + ';' +
      'DROP TABLE ' + sqlIdentifier(temporaryTable) + ';'
    );
    for (const index of indexes) db.exec(index.sql);
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  }
  return true;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
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

async function readJson(req, maxBytes = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function createOneDayEnterpriseEngine(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const requireCandidateBinding = options.requireCandidateBinding === true || process.env.WFM_HOSTED_STAGING === 'true';
  const candidateSha = String(options.candidateSha ?? process.env.WFM_CANDIDATE_SHA ?? '').trim();
  const deploymentId = String(options.deploymentId ?? process.env.RAILWAY_DEPLOYMENT_ID ?? '').trim();

  function evidenceBindingFor(detail, run) {
    if (!requireCandidateBinding) return null;
    const item = detail && typeof detail === 'object' ? detail : {};
    const observedSha = String(item.exactCandidateSha || item.candidateSha || '');
    const observedDeployment = String(item.exactTargetDeploymentId || item.deploymentId || '');
    let reason = null;
    if (!/^[0-9a-f]{40}$/.test(candidateSha) || !deploymentId) reason = 'CURRENT_CANDIDATE_IDENTITY_UNAVAILABLE';
    else if (!observedSha || !observedDeployment) reason = 'EVIDENCE_CANDIDATE_IDENTITY_MISSING';
    else if (observedSha !== candidateSha || observedDeployment !== deploymentId) reason = 'EVIDENCE_CANDIDATE_IDENTITY_MISMATCH';
    else if (item.tenant && item.tenant !== run.tenant) reason = 'EVIDENCE_TENANT_MISMATCH';
    else if (item.runId && item.runId !== run.id) reason = 'EVIDENCE_RUN_MISMATCH';
    return {
      status: reason ? 'REVALIDATION_REQUIRED' : 'MATCHED', reason,
      expected: { candidateSha, deploymentId, tenant: run.tenant, runId: run.id },
      observed: { candidateSha: observedSha || null, deploymentId: observedDeployment || null }
    };
  }
  const internalToken = options.internalToken || process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '';
  const contractWebhookSecret = options.contractWebhookSecret || process.env.WFM_CONTRACT_WEBHOOK_SECRET || '';
  const dedicatedInvitationRecoverySecret = options.invitationRecoverySecret ||
    process.env.WFM_IMPLEMENTATION_INVITATION_SECRET || '';
  // Keep the historical internal-token fallback operational for compatibility,
  // but never present it as production-ready: rotating an access credential
  // must not silently make durable invitation recovery unreadable.
  const invitationRecoverySecret = dedicatedInvitationRecoverySecret || internalToken;
  const notificationRetryDelayMs = Math.max(0, Number(options.notificationRetryDelayMs ?? 5 * 60 * 1000));
  const notificationRetryPollMs = Math.max(0, Number(options.notificationRetryPollMs ?? 60 * 1000));
  const notificationAttemptLeaseMs = Math.max(1_000, Number(options.notificationAttemptLeaseMs ?? 60_000));
  const publicOrigin = String(options.publicOrigin || process.env.WFM_PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const hasCustomInvitationSender = typeof options.sendInvitation === 'function';
  const resendApiKey = process.env.RESEND_API_KEY || '';
  const invitationFromEmail = process.env.WFM_IMPLEMENTATION_FROM_EMAIL || '';
  const invitationTransportReady = hasCustomInvitationSender || Boolean(resendApiKey && invitationFromEmail);
  const invitationSender = hasCustomInvitationSender
    ? options.sendInvitation
    : async ({ to, startUrl, expiresAt, idempotencyKey }) => {
        if (!invitationTransportReady) {
          const error = new Error('Implementation invitation email transport is not configured.');
          error.statusCode = 503;
          throw error;
        }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + resendApiKey,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            from: invitationFromEmail,
            to: [to],
            subject: 'Your implementation workspace is open',
            text: [
              'Your workforce implementation workspace is ready.',
              '',
              'Open your secure implementation link:',
              startUrl,
              '',
              'Your implementation run opened when your contract was activated. Review progress and outstanding steps in the workspace.',
              'The link expires ' + expiresAt + '.'
            ].join('\n')
          })
        });
        if (!response.ok) {
          const error = new Error('Implementation invitation email could not be delivered.');
          error.statusCode = 503;
          error.permanent = [400, 401, 403, 404, 422].includes(Number(response.status));
          if (error.permanent) error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
          throw error;
        }
        const result = await response.json().catch(() => ({}));
        return { provider: 'resend', messageId: result.id || null };
      };
  const learningSummaryProvider = typeof options.learningSummaryProvider === 'function'
    ? options.learningSummaryProvider
    : null;
  if (!dbPath) throw new Error('One-day implementation engine requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS implementation_invitations(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, recipient_hash TEXT NOT NULL,' +
      'token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL, target_hours INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,' +
      'started_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,contract_ref_hash));' +
    'CREATE TABLE IF NOT EXISTS implementation_runs(' +
      'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, state TEXT NOT NULL,' +
      'started_at_ms INTEGER NOT NULL, deadline_at_ms INTEGER NOT NULL, target_hours INTEGER NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,contract_ref_hash));' +
    'CREATE TABLE IF NOT EXISTS implementation_notification_attempts(' +
      'tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, attempts INTEGER NOT NULL,' +
      'in_flight_until_ms INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(tenant,contract_ref_hash));' +
    'CREATE TABLE IF NOT EXISTS implementation_notification_outbox(' +
      'tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, invitation_id TEXT NOT NULL,' +
      'recipient_ciphertext TEXT NOT NULL, next_attempt_at_ms INTEGER NOT NULL, state TEXT NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant,contract_ref_hash));' +
    'CREATE TABLE IF NOT EXISTS implementation_evidence(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, tenant TEXT NOT NULL, kind TEXT NOT NULL,' +
      'status TEXT NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL, detail_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS implementation_scope(' +
      'run_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, scope_json TEXT NOT NULL, submitted_by_hash TEXT NOT NULL,' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS implementation_decisions(' +
      'id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tenant TEXT NOT NULL, decision_key TEXT NOT NULL,' +
      'question TEXT NOT NULL, proposal_json TEXT NOT NULL, confidence REAL NOT NULL, risk TEXT NOT NULL,' +
      'status TEXT NOT NULL, decision_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,' +
      'UNIQUE(run_id,decision_key));' +
    'CREATE TABLE IF NOT EXISTS implementation_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, tenant TEXT, event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_implementation_event_update BEFORE UPDATE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Implementation events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_implementation_event_delete BEFORE DELETE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Implementation events are append only.'); END;"
  );

  // Backward-compatible durable-state migration. Historical hosted candidates
  // used several implementation_events shapes. Add only the current audit
  // fields that are absent, as nullable compatibility columns, so existing
  // legacy columns, rows and append-only triggers remain untouched.
  for (const [column, definition] of [
    ['run_id', 'TEXT'],
    ['tenant', 'TEXT'],
    ['event', 'TEXT'],
    ['detail_json', 'TEXT'],
    ['created_at', 'TEXT']
  ]) {
    ensureLegacyColumn(db, 'implementation_events', column, definition);
  }
  ensureLegacyColumn(db, 'implementation_notification_attempts', 'in_flight_until_ms', 'INTEGER NOT NULL DEFAULT 0');

  // SQLite cannot add defaults to existing NOT NULL legacy columns in place.
  // Rebuild only when such columns would reject modern audit writes, preserving
  // every existing row plus explicit index/trigger definition.
  ensureImplementationEventsWriteCompatibility(db);

  const workController = createImplementationWorkController({
    db, requirements: REQUIREMENTS, candidateSha, deploymentId, requireCandidateBinding
  });
  const tenantEnvironmentProvisioner = createTenantEnvironmentProvisioner({ db });

  const authStmt = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const invitationByContract = db.prepare('SELECT * FROM implementation_invitations WHERE tenant=? AND contract_ref_hash=?');
  const invitationById = db.prepare('SELECT * FROM implementation_invitations WHERE id=? AND tenant=?');
  const invitationByToken = db.prepare('SELECT * FROM implementation_invitations WHERE token_hash=?');
  const latestInvitationForRecipient = db.prepare(
    'SELECT * FROM implementation_invitations WHERE tenant=? AND recipient_hash=? ORDER BY created_at DESC LIMIT 1'
  );
  const insertInvitation = db.prepare(
    'INSERT INTO implementation_invitations(id,tenant,contract_ref_hash,recipient_hash,token_hash,status,target_hours,expires_at_ms,started_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const reserveInvitationAttempt = db.prepare(
    'INSERT INTO implementation_notification_attempts(tenant,contract_ref_hash,attempts,in_flight_until_ms,updated_at) VALUES(?,?,1,?,?) ' +
    'ON CONFLICT(tenant,contract_ref_hash) DO UPDATE SET ' +
      'attempts=attempts+1,in_flight_until_ms=excluded.in_flight_until_ms,updated_at=excluded.updated_at ' +
    'WHERE attempts<3 AND COALESCE(in_flight_until_ms,0)<=?'
  );
  const notificationAttemptsByContract = db.prepare(
    'SELECT attempts,in_flight_until_ms,updated_at FROM implementation_notification_attempts WHERE tenant=? AND contract_ref_hash=?'
  );
  const completeInvitationAttempt = db.prepare(
    'UPDATE implementation_notification_attempts SET in_flight_until_ms=0,updated_at=? WHERE tenant=? AND contract_ref_hash=?'
  );
  const startInvitation = db.prepare(
    "UPDATE implementation_invitations SET status='STARTED',started_run_id=?,updated_at=? WHERE id=? AND status='PENDING'"
  );
  const deleteInvitation = db.prepare('DELETE FROM implementation_invitations WHERE id=? AND status=\'PENDING\'');
  const outboxByContract = db.prepare(
    'SELECT * FROM implementation_notification_outbox WHERE tenant=? AND contract_ref_hash=?'
  );
  const upsertNotificationOutbox = db.prepare(
    'INSERT INTO implementation_notification_outbox(' +
      'tenant,contract_ref_hash,invitation_id,recipient_ciphertext,next_attempt_at_ms,state,created_at,updated_at' +
    ') VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant,contract_ref_hash) DO UPDATE SET ' +
      'invitation_id=excluded.invitation_id,recipient_ciphertext=excluded.recipient_ciphertext,' +
      'next_attempt_at_ms=excluded.next_attempt_at_ms,state=excluded.state,updated_at=excluded.updated_at'
  );
  const dueNotificationOutbox = db.prepare(
    "SELECT * FROM implementation_notification_outbox WHERE state='PENDING' AND next_attempt_at_ms<=? ORDER BY next_attempt_at_ms LIMIT 25"
  );
  const dueNotificationOutboxForContract = db.prepare(
    "SELECT * FROM implementation_notification_outbox WHERE tenant=? AND contract_ref_hash=? " +
      "AND state='PENDING' AND next_attempt_at_ms<=? LIMIT 1"
  );
  const updateNotificationOutboxState = db.prepare(
    'UPDATE implementation_notification_outbox SET state=?,updated_at=? WHERE tenant=? AND contract_ref_hash=?'
  );
  const resumeProviderBlockedOutbox = db.prepare(
    "UPDATE implementation_notification_outbox SET state='PENDING',next_attempt_at_ms=?,updated_at=? " +
      "WHERE tenant=? AND contract_ref_hash=? AND state='PROVIDER_BLOCKED'"
  );
  const deleteNotificationOutbox = db.prepare(
    'DELETE FROM implementation_notification_outbox WHERE tenant=? AND contract_ref_hash=?'
  );
  const runById = db.prepare('SELECT * FROM implementation_runs WHERE id=? AND tenant=?');
  const runByIdAnyTenant = db.prepare('SELECT * FROM implementation_runs WHERE id=?');
  const currentRun = db.prepare(
    "SELECT * FROM implementation_runs WHERE tenant=? ORDER BY started_at_ms DESC LIMIT 1"
  );
  const runByContract = db.prepare(
    'SELECT * FROM implementation_runs WHERE tenant=? AND contract_ref_hash=?'
  );
  const insertRun = db.prepare(
    'INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  const updateRunState = db.prepare(
    'UPDATE implementation_runs SET state=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const insertEvidence = db.prepare(
    'INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const latestEvidence = db.prepare(
    'SELECT e.* FROM implementation_evidence e JOIN (' +
      'SELECT kind,MAX(id) AS max_id FROM implementation_evidence WHERE run_id=? AND tenant=? GROUP BY kind' +
    ') latest ON latest.max_id=e.id ORDER BY e.kind'
  );
  const evidenceByKind = db.prepare(
    'SELECT * FROM implementation_evidence WHERE run_id=? AND tenant=? AND kind=? ORDER BY id DESC LIMIT 1'
  );
  const scopeByRun = db.prepare('SELECT * FROM implementation_scope WHERE run_id=? AND tenant=?');
  const upsertScope = db.prepare(
    'INSERT INTO implementation_scope(run_id,tenant,scope_json,submitted_by_hash,created_at,updated_at) VALUES(?,?,?,?,?,?) ' +
    'ON CONFLICT(run_id) DO UPDATE SET scope_json=excluded.scope_json,submitted_by_hash=excluded.submitted_by_hash,updated_at=excluded.updated_at'
  );
  const insertDecision = db.prepare(
    'INSERT INTO implementation_decisions(id,run_id,tenant,decision_key,question,proposal_json,confidence,risk,status,decision_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const decisionByKey = db.prepare(
    'SELECT * FROM implementation_decisions WHERE run_id=? AND tenant=? AND decision_key=?'
  );
  const listDecisions = db.prepare(
    'SELECT * FROM implementation_decisions WHERE run_id=? AND tenant=? ORDER BY created_at'
  );
  const updateDecision = db.prepare(
    'UPDATE implementation_decisions SET status=?,decision_json=?,updated_at=? WHERE id=? AND tenant=?'
  );
  const eventStmt = db.prepare(
    'INSERT INTO implementation_events(run_id,tenant,event,detail_json,created_at) VALUES(?,?,?,?,?)'
  );

  function record(runId, tenant, event, detail = {}) {
    try {
      eventStmt.run(runId || null, tenant || null, event, JSON.stringify(detail), nowIso());
    } catch {}
  }

  function executeTenantEnvironmentEffect(run, scope, trigger = 'implementation-orchestrator') {
    if (!run || !scope || typeof scope !== 'object') return null;

    // Claim before provisioning and validate ownership at the same SQLite
    // transaction boundary as the configuration and effect receipt.
    let environment = tenantEnvironmentProvisioner.statusForTenant(run.tenant);
    const readiness = readinessForRun(run);
    let job = readiness.workPlan.jobs.find(item => item.requirementKey === 'tenant-environment') || null;
    let effectRecorded = false;
    if (job?.status === 'PENDING') {
      const claimed = workController.claim({
        runId: run.id, tenant: run.tenant, requirementKey: 'tenant-environment',
        ownerId: 'implementation-orchestrator'
      });
      if (claimed) {
        const completed = workController.executeLocalEffect({
          jobId: claimed.id, runId: run.id, tenant: run.tenant,
          intentDigest: claimed.intentDigest, ownerId: claimed.ownerId,
          fence: claimed.fence, leaseToken: claimed.leaseToken
        }, () => {
          environment = tenantEnvironmentProvisioner.provision({ tenant: run.tenant, runId: run.id, scope });
          return {
            environmentId: environment.environmentId,
            namespace: environment.namespace,
            configurationDigest: environment.configurationDigest,
            trigger: compact(trigger, 80)
          };
        });
        job = completed.job;
        effectRecorded = true;
      }
    }
    if (effectRecorded) {
      record(run.id, run.tenant, 'TENANT_ENVIRONMENT_EFFECT_RECORDED', {
        environmentId: environment.environmentId,
        configurationDigest: environment.configurationDigest,
        trigger: compact(trigger, 80), effectRecorded, evidenceRequired: true
      });
    }
    return { environment, job, effectRecorded };
  }

  function authContext(req) {
    const token = cookieSessionToken(req);
    if (!token) return null;
    return authStmt.get(sha256(token), Date.now()) || null;
  }

  function requireManager(req, res) {
    const ctx = authContext(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    if (String(ctx.role).toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Implementation control requires an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }

  function requireInternal(req, res) {
    if (!internalToken) {
      writeJson(res, 503, { error: 'Implementation worker credential is not configured.' });
      return false;
    }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted implementation worker is required.' });
      return false;
    }
    return true;
  }

  function requireContractWebhook(req, res) {
    if (!contractWebhookSecret) {
      writeJson(res, 503, { error: 'Contract webhook credential is not configured.' });
      return false;
    }
    if (!secureEqual(req?.headers?.[CONTRACT_WEBHOOK_HEADER], contractWebhookSecret)) {
      writeJson(res, 403, { error: 'Trusted contract event is required.' });
      return false;
    }
    return true;
  }

  async function handleContractSigned(req, res) {
    const body = await readJson(req);
    const state = compact(body.state || body.status || body.event, 40).trim().toUpperCase();
    if (!['SIGNED', 'COMPLETED', 'CONTRACT_SIGNED'].includes(state)) {
      return writeJson(res, 202, { ignored: true, reason: 'Contract is not in a signed/completed state.' });
    }
    return await activateContract({
      tenant: body.tenant,
      contractRef: body.contractRef || body.contractId,
      recipientEmail: body.recipientEmail || body.implementationContactEmail,
      targetHours: body.targetHours || 8
    }, res);
  }

  function parseDecision(row) {
    return {
      id: row.id,
      key: row.decision_key,
      question: row.question,
      proposal: JSON.parse(row.proposal_json),
      confidence: row.confidence,
      risk: row.risk,
      status: row.status,
      decision: row.decision_json ? JSON.parse(row.decision_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  const POLICY_DECISIONS = Object.freeze({
    'time-policy-authority': Object.freeze({
      kind: 'time-policies',
      question: 'Please confirm the authoritative source and effective rules for breaks, overtime, working-time limits and site timezone/DST handling.',
      requiredFields: Object.freeze([
        'authoritativeConfirmation','sourceRef','effectiveDate','unresolvedRules','unknownPolicyFields',
        'breakRulesVerified','overtimeRulesVerified','workingTimeRulesVerified','timeZoneVerified'
      ])
    }),
    'absence-policy-authority': Object.freeze({
      kind: 'absence-policies',
      question: 'Please confirm the authoritative source and effective rules for the leave year, entitlement method, approvals/delegation and absence types.',
      requiredFields: Object.freeze([
        'authoritativeConfirmation','sourceRef','effectiveDate','unresolvedRules','unknownPolicyFields',
        'leaveYearVerified','entitlementMethodVerified','approvalRulesVerified','absenceTypesVerified',
        'usesOpeningBalance','openingBalanceFictional','openingBalanceSourceVerified'
      ])
    })
  });
  const POLICY_REQUIREMENT_KINDS = new Set(
    Object.values(POLICY_DECISIONS).map(spec => spec.kind)
  );

  function tenantEnvironmentEvidenceError(run, row, requireAttestation = true, evidenceDetail = null, enforceFreshAdmission = false) {
    const detail = evidenceDetail || parseJsonSafe(row.detail_json, {});
    const error = validateStrictReadinessEvidence('tenant-environment', 'PASS', detail, {
      tenant: run.tenant, implementationRunId: run.id, candidateSha, deploymentId,
      source: row.source, evidenceCreatedAt: row.created_at, requireCandidateIdentity: true, enforceFreshAdmission
    });
    if (error) return error;
    if (!requireAttestation) return null;
    const attestation = detail._tenantEnvironmentValidation;
    const proof = { ...detail };
    delete proof._tenantEnvironmentValidation;
    if (!attestation || attestation.version !== 1 ||
        attestation.validator !== 'tenant-environment-v1' ||
        attestation.proofDigest !== sha256(JSON.stringify(proof)) ||
        attestation.tenant !== run.tenant || attestation.implementationRunId !== run.id ||
        attestation.candidateSha !== candidateSha || attestation.deploymentId !== deploymentId ||
        attestation.verifierRunId !== (detail.verifierRunId || detail.verifierDeploymentId) || attestation.acceptedAt !== row.created_at) {
      return 'Tenant-environment evidence lacks a current server validation receipt.';
    }
    return null;
  }

  function currentStoredPass(run, kind) {
    const row = evidenceByKind.get(run.id, run.tenant, kind);
    if (!row || row.status !== 'PASS') return false;
    const detail = parseJsonSafe(row.detail_json, {});
    const binding = evidenceBindingFor(detail, run);
    if (binding?.reason) return false;
    if (kind === 'tenant-environment') return !tenantEnvironmentEvidenceError(run, row, true, detail);
    if (POLICY_REQUIREMENT_KINDS.has(kind)) {
      return !validateStrictReadinessEvidence(kind, 'PASS', detail);
    }
    return true;
  }

  function ensurePolicyQuestions(run, scope = null) {
    if (!run) return [];
    const created = [];
    for (const [key, spec] of Object.entries(POLICY_DECISIONS)) {
      if (currentStoredPass(run, spec.kind) || decisionByKey.get(run.id, run.tenant, key)) continue;
      const id = randomUUID();
      const ts = nowIso();
      const proposal = {
        requirement: spec.kind,
        answerMode: 'AUTHORITATIVE_CONFIRMATION',
        requiredFields: [...spec.requiredFields],
        customerContext: {
          companyName: scope?.companyName || null,
          countries: Array.isArray(scope?.countries) ? scope.countries : [],
          sites: Array.isArray(scope?.sites) ? scope.sites : [],
          connectedSystems: Array.isArray(scope?.sourceSystems) ? scope.sourceSystems : []
        },
        safety: {
          doNotGuess: true,
          incompleteAnswerCannotPass: true,
          customerAuthorityRequired: true
        }
      };
      insertDecision.run(
        id, run.id, run.tenant, key, spec.question, JSON.stringify(proposal),
        0, 'HIGH', 'PENDING', null, ts, ts
      );
      record(run.id, run.tenant, 'DECISION_REQUIRED', {
        key, risk: 'HIGH', confidence: 0, requirement: spec.kind,
        reason: 'CUSTOMER_POLICY_AUTHORITY_REQUIRED'
      });
      created.push(key);
    }
    return created;
  }

  function customerPolicyEvidence(key, answer, run) {
    const spec = POLICY_DECISIONS[key];
    if (!spec) return null;
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      const error = new Error('Policy confirmation requires a structured answer.');
      error.statusCode = 409;
      throw error;
    }
    if (answer.authoritativeConfirmation !== true) {
      const error = new Error('Policy confirmation must explicitly confirm customer authority.');
      error.statusCode = 409;
      throw error;
    }
    const sourceRef = compact(answer.sourceRef, 300);
    const effectiveDate = compact(answer.effectiveDate, 40);
    if (!sourceRef || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(effectiveDate)) {
      const error = new Error('Policy confirmation requires a traceable sourceRef and effectiveDate.');
      error.statusCode = 409;
      throw error;
    }

    const detail = {
      exactCandidateSha: candidateSha,
      exactTargetDeploymentId: deploymentId,
      tenant: run.tenant,
      runId: run.id,
      fixtureOnly: false,
      evidenceClass: 'customer-authorised',
      sourceAuthoritative: true,
      sourceRef,
      effectiveDated: true,
      effectiveDate,
      unresolvedRules: Number(answer.unresolvedRules),
      unknownPolicyFields: Number(answer.unknownPolicyFields)
    };

    if (spec.kind === 'time-policies') {
      Object.assign(detail, {
        breakRulesVerified: answer.breakRulesVerified === true,
        overtimeRulesVerified: answer.overtimeRulesVerified === true,
        workingTimeRulesVerified: answer.workingTimeRulesVerified === true,
        timeZoneVerified: answer.timeZoneVerified === true
      });
    } else {
      Object.assign(detail, {
        leaveYearVerified: answer.leaveYearVerified === true,
        entitlementMethodVerified: answer.entitlementMethodVerified === true,
        approvalRulesVerified: answer.approvalRulesVerified === true,
        absenceTypesVerified: answer.absenceTypesVerified === true,
        usesOpeningBalance: answer.usesOpeningBalance === true,
        openingBalanceFictional: answer.openingBalanceFictional === true,
        openingBalanceSourceVerified: answer.openingBalanceSourceVerified === true
      });
    }

    const validationError = validateStrictReadinessEvidence(spec.kind, 'PASS', detail);
    if (validationError) {
      const error = new Error(validationError);
      error.statusCode = 409;
      throw error;
    }
    return { kind: spec.kind, detail };
  }

  function notificationRecoveryForRun(run) {
    const invitation = invitationByContract.get(run.tenant, run.contract_ref_hash);
    const outbox = outboxByContract.get(run.tenant, run.contract_ref_hash);
    const attemptRow = notificationAttemptsByContract.get(run.tenant, run.contract_ref_hash);
    const attempts = Math.max(0, Number(attemptRow?.attempts || 0));
    const remainingAttempts = Math.max(0, 3 - attempts);

    if (invitation?.status === 'STARTED') {
      return {
        state: 'STARTED', attempts, remainingAttempts,
        automaticActionAvailable: false, terminalAction: null
      };
    }
    if (!invitationTransportReady) {
      return {
        state: 'UNAVAILABLE', attempts, remainingAttempts,
        automaticActionAvailable: false,
        terminalAction: 'MESSAGE_PROVIDER_CONFIGURATION_REQUIRED'
      };
    }
    if (outbox?.state === 'PENDING') {
      return {
        state: 'RECOVERING', attempts, remainingAttempts,
        nextRetryAt: new Date(outbox.next_attempt_at_ms).toISOString(),
        automaticActionAvailable: remainingAttempts > 0,
        terminalAction: null
      };
    }
    if (outbox?.state === 'BLOCKED') {
      return {
        state: 'BLOCKED', attempts, remainingAttempts,
        automaticActionAvailable: false,
        terminalAction: 'RECOVERY_EVIDENCE_REPAIR_REQUIRED'
      };
    }
    if (outbox?.state === 'PROVIDER_BLOCKED') {
      return {
        state: 'BLOCKED', attempts, remainingAttempts,
        automaticActionAvailable: false,
        terminalAction: 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED'
      };
    }
    if (outbox?.state === 'EXHAUSTED' || attempts >= 3) {
      return {
        state: 'EXHAUSTED', attempts, remainingAttempts: 0,
        automaticActionAvailable: false,
        terminalAction: 'PROVIDER_OR_ADMIN_AUTHORIZATION_REQUIRED'
      };
    }
    if (invitation) {
      return {
        state: 'DELIVERED', attempts, remainingAttempts,
        automaticActionAvailable: false, terminalAction: null
      };
    }
    if (!publicOrigin || !/^https:\/\//i.test(publicOrigin)) {
      return {
        state: 'UNAVAILABLE', attempts, remainingAttempts,
        automaticActionAvailable: false,
        terminalAction: 'PUBLIC_ORIGIN_CONFIGURATION_REQUIRED'
      };
    }
    return {
      state: 'NOT_SENT', attempts, remainingAttempts,
      automaticActionAvailable: false, terminalAction: null
    };
  }

  function canonicalSourceSummaryForTenant(tenant) {
    const requiredTables = ['integration_canonical_batches', 'integration_canonical_people', 'integration_connections', 'integration_candidates'];
    const tableLookup = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
    if (!requiredTables.every(name => Boolean(tableLookup.get(name)))) return null;

    const batches = db.prepare(
      "SELECT b.*,c.product_key,c.state AS connection_state,c.granted_scopes_json,c.credential_ref," +
      "c.mapping_version AS connection_mapping_version,k.display_name,k.status AS candidate_status,k.authoritative_for_json " +
      "FROM integration_canonical_batches b " +
      "JOIN integration_connections c ON c.id=b.connection_id AND c.tenant=b.tenant " +
      "JOIN integration_candidates k ON k.id=c.candidate_id AND k.tenant=c.tenant " +
      "WHERE b.tenant=? AND b.status='PASS' ORDER BY b.rowid DESC"
    ).all(tenant);

    const batch = batches.find(item =>
      item.connection_state === 'ACTIVE' &&
      Boolean(item.credential_ref) &&
      parseJsonSafe(item.granted_scopes_json, []).includes('people.read') &&
      Number(item.mapping_version) === Number(item.connection_mapping_version) &&
      item.candidate_status === 'CONFIRMED' &&
      parseJsonSafe(item.authoritative_for_json, []).includes('people')
    );
    if (!batch) return null;

    const rows = db.prepare(
      'SELECT employee_key,record_checksum,canonical_json FROM integration_canonical_people WHERE batch_id=? AND tenant=? ORDER BY employee_key'
    ).all(batch.id, tenant);
    if (rows.length !== Number(batch.record_count) || rows.length < 1) return null;

    const sites = new Set();
    const departments = new Set();
    const employeeKeys = new Set();
    for (const row of rows) {
      const canonical = parseJsonSafe(row.canonical_json, {});
      if (!row.employee_key || employeeKeys.has(row.employee_key)) return null;
      employeeKeys.add(row.employee_key);
      const site = compact(canonical.location, 180).trim();
      const department = compact(canonical.department, 180).trim();
      if (site) sites.add(site);
      if (department) departments.add(department);
    }

    return {
      batchId: batch.id,
      connectionId: batch.connection_id,
      mappingVersion: Number(batch.mapping_version),
      checksum: batch.batch_checksum,
      systemKey: batch.product_key,
      systemName: batch.display_name,
      employeeCount: rows.length,
      siteCount: sites.size,
      departmentCount: departments.size,
      sites: [...sites].sort(),
      departments: [...departments].sort(),
      importedAt: batch.created_at,
      provenance: 'authorized-validated-canonical-import'
    };
  }

  function readinessForRun(run) {
    const latest = latestEvidence.all(run.id, run.tenant);
    const map = new Map(latest.map(row => [row.kind, row]));
    const scopeRow = scopeByRun.get(run.id, run.tenant);
    let customerScope = null;
    if (scopeRow) {
      try { customerScope = JSON.parse(scopeRow.scope_json); } catch {}
    }
    const sourceDataSummary = canonicalSourceSummaryForTenant(run.tenant);
    const tenantEnvironmentState = tenantEnvironmentProvisioner.statusForTenant(run.tenant);
    const tenantEnvironment = tenantEnvironmentState ? {
      environmentId: tenantEnvironmentState.environmentId,
      namespace: tenantEnvironmentState.namespace,
      runId: tenantEnvironmentState.runId,
      state: tenantEnvironmentState.state,
      configurationDigest: tenantEnvironmentState.configurationDigest,
      isolation: tenantEnvironmentState.isolation
    } : null;
    let learningSummary = null;
    if (learningSummaryProvider) {
      try { learningSummary = learningSummaryProvider(run.tenant); } catch {}
    }

    const requirements = REQUIREMENTS.map(requirement => {
      const row = map.get(requirement.key);
      let derived = null;

      if (requirement.key === 'configuration-scope') {
        const conflicts = [];
        if (customerScope && sourceDataSummary) {
          if (Number(customerScope.employeeCount) !== Number(sourceDataSummary.employeeCount)) {
            conflicts.push({
              field: 'employeeCount',
              declared: Number(customerScope.employeeCount),
              observed: Number(sourceDataSummary.employeeCount)
            });
          }
          const normalizedDeclaredSites = new Set((customerScope.sites || []).map(value => normaliseFact(value)).filter(Boolean));
          const unexpectedSites = sourceDataSummary.sites.filter(value => !normalizedDeclaredSites.has(normaliseFact(value)));
          if (unexpectedSites.length) {
            conflicts.push({ field: 'sites', observedNotDeclared: unexpectedSites });
          }
        }
        const ok = Boolean(customerScope) && conflicts.length === 0;
        derived = {
          status: conflicts.length ? 'FAIL' : (ok ? 'PASS' : 'MISSING'),
          confidence: conflicts.length || ok ? 1 : 0,
          source: sourceDataSummary ? 'customer-scope+validated-source' : 'customer-scope',
          detail: customerScope ? {
            companyName: customerScope.companyName,
            employeeCount: customerScope.employeeCount,
            countryCount: customerScope.countries.length,
            siteCount: customerScope.sites.length,
            systemCount: customerScope.sourceSystems.length,
            featureCount: customerScope.features.length,
            sourceValidation: sourceDataSummary ? {
              batchId: sourceDataSummary.batchId,
              checksum: sourceDataSummary.checksum,
              employeeCount: sourceDataSummary.employeeCount,
              siteCount: sourceDataSummary.siteCount,
              conflicts
            } : null
          } : (sourceDataSummary ? {
            missing: ['companyName', 'countries', 'customer-approved-scope'],
            observed: {
              employeeCount: sourceDataSummary.employeeCount,
              siteCount: sourceDataSummary.siteCount,
              systemName: sourceDataSummary.systemName
            }
          } : null)
        };
      } else if (requirement.key === 'source-systems' && sourceDataSummary) {
        derived = {
          status: 'PASS',
          confidence: 1,
          source: 'validated-canonical-import',
          detail: {
            systemKey: sourceDataSummary.systemKey,
            systemName: sourceDataSummary.systemName,
            connectionId: sourceDataSummary.connectionId,
            mappingVersion: sourceDataSummary.mappingVersion,
            batchId: sourceDataSummary.batchId,
            checksum: sourceDataSummary.checksum
          }
        };
      } else if (requirement.key === 'people-data' && sourceDataSummary) {
        derived = {
          status: sourceDataSummary.employeeCount > 0 ? 'PASS' : 'MISSING',
          confidence: sourceDataSummary.employeeCount > 0 ? 1 : 0,
          source: 'validated-canonical-import',
          detail: {
            batchId: sourceDataSummary.batchId,
            employeeCount: sourceDataSummary.employeeCount,
            checksum: sourceDataSummary.checksum
          }
        };
      } else if (requirement.key === 'organisation-model' && sourceDataSummary) {
        const ok = sourceDataSummary.siteCount > 0 && sourceDataSummary.departmentCount > 0;
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 0.99 : 0,
          source: 'validated-canonical-import',
          detail: {
            batchId: sourceDataSummary.batchId,
            siteCount: sourceDataSummary.siteCount,
            departmentCount: sourceDataSummary.departmentCount,
            missing: [
              ...(sourceDataSummary.siteCount > 0 ? [] : ['sites']),
              ...(sourceDataSummary.departmentCount > 0 ? [] : ['departments-or-cost-centres'])
            ]
          }
        };
      } else if (learningSummary && requirement.key === 'role-learning') {
        const ok = learningSummary.users > 0 && learningSummary.assignments >= learningSummary.users;
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      } else if (learningSummary && requirement.key === 'privileged-competency') {
        const ok = Boolean(learningSummary.privilegedReady);
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      } else if (learningSummary && requirement.key === 'frontline-readiness') {
        const ok = Boolean(learningSummary.fullyCertified);
        derived = {
          status: ok ? 'PASS' : 'MISSING',
          confidence: ok ? 1 : 0,
          source: 'adaptive-learning-engine',
          detail: learningSummary
        };
      }

      const detail = derived?.detail || (row ? JSON.parse(row.detail_json) : null);
      // Stored proof survives deployment for audit, but never retains authority
      // for a different candidate. Derived configuration is read from current state.
      const evidenceBinding = !derived && row?.status === 'PASS' ? evidenceBindingFor(detail, run) : null;
      const tenantValidationError = !derived && row?.status === 'PASS' && requirement.key === 'tenant-environment'
        ? tenantEnvironmentEvidenceError(run, row, true, detail || {})
        : null;
      const policyValidationError = !derived && row?.status === 'PASS' && POLICY_REQUIREMENT_KINDS.has(requirement.key)
        ? validateStrictReadinessEvidence(requirement.key, 'PASS', detail || {})
        : null;
      const status = evidenceBinding?.reason || tenantValidationError || policyValidationError
        ? 'REVALIDATION_REQUIRED'
        : (derived?.status || row?.status || 'MISSING');
      const confidence = derived ? derived.confidence : (row ? Number(row.confidence) : 0);
      return {
        ...requirement,
        status,
        confidence,
        satisfied: status === 'PASS' && confidence >= requirement.minConfidence,
        source: derived?.source || row?.source || null,
        observedAt: derived ? nowIso() : (row?.created_at || null),
        detail,
        ...(evidenceBinding ? { evidenceBinding } : {}),
        ...(tenantValidationError || policyValidationError ? { evidenceValidation: { reason: tenantValidationError || policyValidationError } } : {})
      };
    });

    const decisions = listDecisions.all(run.id, run.tenant).map(parseDecision);
    const satisfiedRequirementKeys = new Set(requirements.filter(item => item.satisfied).map(item => item.key));
    const blockingDecisions = decisions.filter(item => {
      const policyKind = POLICY_DECISIONS[item.key]?.kind || null;
      if (policyKind && satisfiedRequirementKeys.has(policyKind)) return false;
      return (item.risk === 'HIGH' || item.risk === 'CRITICAL') &&
        item.status !== 'ACCEPTED' &&
        item.status !== 'CHANGED';
    });

    const missing = requirements.filter(item => !item.satisfied);
    const elapsedMinutes = Math.max(0, (Date.now() - run.started_at_ms) / 60000);
    const remainingMinutes = Math.max(0, (run.deadline_at_ms - Date.now()) / 60000);
    const parallelWorkMinutes = missing.reduce((sum, item) => sum + item.budgetMinutes, 0);
    const remainingBudgetMinutes = criticalPathRemainingMinutes(requirements);
    const operationalReady = missing.length === 0 && blockingDecisions.length === 0;
    let state = operationalReady ? 'READY' : 'BUILDING';
    if (!operationalReady && Date.now() > run.deadline_at_ms) state = 'SLA_MISSED';
    else if (!operationalReady && remainingBudgetMinutes > remainingMinutes) state = 'AT_RISK';

    const readiness = {
      runId: run.id,
      tenant: run.tenant,
      state,
      operationalReady,
      targetHours: run.target_hours,
      startedAt: new Date(run.started_at_ms).toISOString(),
      deadlineAt: new Date(run.deadline_at_ms).toISOString(),
      elapsedMinutes: Math.round(elapsedMinutes),
      remainingMinutes: Math.round(remainingMinutes),
      remainingBudgetMinutes,
      criticalPathRemainingMinutes: remainingBudgetMinutes,
      parallelWorkMinutes,
      completedRequirements: requirements.filter(item => item.satisfied).length,
      totalRequirements: requirements.length,
      requirements,
      decisions,
      blockingDecisions,
      learningSummary,
      sourceDataSummary,
      scopeCaptured: Boolean(customerScope),
      customerScope,
      tenantEnvironment,
      notificationRecovery: notificationRecoveryForRun(run)
    };
    readiness.workPlan = workController.reconcile({ runId: run.id, tenant: run.tenant, readiness });
    return readiness;
  }

  function recompute(run) {
    const readiness = readinessForRun(run);
    if (readiness.state !== run.state) {
      updateRunState.run(readiness.state, nowIso(), run.id, run.tenant);
      record(run.id, run.tenant, 'STATE_CHANGED', { from: run.state, to: readiness.state });
      run.state = readiness.state;
    }
    return readiness;
  }

  function publicInvitation(row) {
    if (!row) return null;
    return {
      invitationId: row.id,
      state: row.status === 'STARTED' ? 'STARTED' : (Date.now() > row.expires_at_ms ? 'EXPIRED' : 'AWAITING_CUSTOMER_START'),
      targetHours: row.target_hours,
      expiresAt: new Date(row.expires_at_ms).toISOString(),
      startedRunId: row.started_run_id || null
    };
  }

  function recipientDigest(email) {
    return sha256(String(email || '').trim().toLowerCase());
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+$/.test(String(email || '').trim());
  }

  function deterministicInvitationToken(invitation) {
    if (!invitationRecoverySecret) return '';
    return createHmac('sha256', String(invitationRecoverySecret))
      .update([
        'wfm-implementation-invitation:v1', invitation.id, invitation.tenant,
        invitation.contract_ref_hash, invitation.recipient_hash
      ].join(':'))
      .digest('base64url');
  }

  function invitationDeliveryIdentity(invitation) {
    return 'implementation-invite/' + sha256(
      invitation.tenant + ':' + invitation.contract_ref_hash + ':' + invitation.id
    );
  }

  async function deliverInvitation(invitation, recipientEmail, rawToken) {
    const startUrl = publicOrigin + '/?implementation_invite=' + encodeURIComponent(rawToken);
    return await invitationSender({
      to: recipientEmail,
      startUrl,
      expiresAt: new Date(invitation.expires_at_ms).toISOString(),
      tenant: invitation.tenant,
      invitationId: invitation.id,
      idempotencyKey: invitationDeliveryIdentity(invitation)
    });
  }

  function scheduleNotificationRecovery(invitation, recipientEmail, nowMs = Date.now()) {
    if (!invitationRecoverySecret) return false;
    const ts = nowIso();
    upsertNotificationOutbox.run(
      invitation.tenant,
      invitation.contract_ref_hash,
      invitation.id,
      sealRecoveryValue(recipientEmail, invitationRecoverySecret),
      nowMs + notificationRetryDelayMs,
      'PENDING',
      ts,
      ts
    );
    return true;
  }

  function claimNotificationAttempt(tenant, contractHash) {
    const nowMs = Date.now();
    const result = reserveInvitationAttempt.run(
      tenant,
      contractHash,
      nowMs + notificationAttemptLeaseMs,
      nowIso(),
      nowMs
    );
    if (Number(result.changes) === 1) return { reserved: true, inProgress: false };
    const current = notificationAttemptsByContract.get(tenant, contractHash);
    return {
      reserved: false,
      inProgress: Number(current?.in_flight_until_ms || 0) > nowMs
    };
  }

  function finishNotificationAttempt(tenant, contractHash) {
    completeInvitationAttempt.run(nowIso(), tenant, contractHash);
  }

  async function retryDueNotifications({ nowMs = Date.now(), tenant = null, contractHash = null } = {}) {
    const result = { examined: 0, delivered: 0, exhausted: 0, blocked: 0, inProgress: 0 };
    if (!invitationRecoverySecret || !publicOrigin || !/^https:\/\//i.test(publicOrigin) || !invitationTransportReady) {
      return { ...result, unavailable: true };
    }

    const dueOutboxes = tenant && contractHash
      ? dueNotificationOutboxForContract.all(tenant, contractHash, Number(nowMs))
      : dueNotificationOutbox.all(Number(nowMs));
    for (const outbox of dueOutboxes) {
      result.examined += 1;
      const invitation = invitationById.get(outbox.invitation_id, outbox.tenant);
      const run = runByContract.get(outbox.tenant, outbox.contract_ref_hash);
      if (!invitation || !run || invitation.status !== 'PENDING' || Number(nowMs) > invitation.expires_at_ms) {
        updateNotificationOutboxState.run('BLOCKED', nowIso(), outbox.tenant, outbox.contract_ref_hash);
        result.blocked += 1;
        continue;
      }

      let recipientEmail;
      let rawToken;
      try {
        recipientEmail = openRecoveryValue(outbox.recipient_ciphertext, invitationRecoverySecret);
        rawToken = deterministicInvitationToken(invitation);
        if (!validEmail(recipientEmail) || !rawToken || !secureEqual(sha256(rawToken), invitation.token_hash)) {
          throw new Error('Invitation recovery evidence does not match the pending invitation.');
        }
      } catch {
        updateNotificationOutboxState.run('BLOCKED', nowIso(), outbox.tenant, outbox.contract_ref_hash);
        record(run.id, outbox.tenant, 'CONTRACT_INVITATION_RECOVERY_BLOCKED', {
          invitationId: invitation.id,
          contractRefDigest: outbox.contract_ref_hash.slice(0, 16)
        });
        result.blocked += 1;
        continue;
      }

      const claim = claimNotificationAttempt(outbox.tenant, outbox.contract_ref_hash);
      if (!claim.reserved) {
        if (claim.inProgress) {
          result.inProgress += 1;
          continue;
        }
        updateNotificationOutboxState.run('EXHAUSTED', nowIso(), outbox.tenant, outbox.contract_ref_hash);
        result.exhausted += 1;
        continue;
      }

      try {
        const delivery = await deliverInvitation(invitation, recipientEmail, rawToken);
        finishNotificationAttempt(outbox.tenant, outbox.contract_ref_hash);
        deleteNotificationOutbox.run(outbox.tenant, outbox.contract_ref_hash);
        record(run.id, outbox.tenant, 'CONTRACT_INVITATION_SENT', {
          invitationId: invitation.id,
          targetHours: invitation.target_hours,
          contractRefDigest: outbox.contract_ref_hash.slice(0, 16),
          provider: delivery?.provider || 'configured-sender',
          messageId: delivery?.messageId || null,
          recovered: true
        });
        result.delivered += 1;
      } catch (error) {
        finishNotificationAttempt(outbox.tenant, outbox.contract_ref_hash);
        if (error?.permanent === true) {
          const attempts = Number(
            notificationAttemptsByContract.get(outbox.tenant, outbox.contract_ref_hash)?.attempts || 0
          );
          const exhausted = attempts >= 3;
          updateNotificationOutboxState.run(
            exhausted ? 'EXHAUSTED' : 'PROVIDER_BLOCKED',
            nowIso(), outbox.tenant, outbox.contract_ref_hash
          );
          record(run.id, outbox.tenant, exhausted
            ? 'CONTRACT_INVITATION_RECOVERY_EXHAUSTED'
            : 'CONTRACT_INVITATION_PROVIDER_BLOCKED', {
            invitationId: invitation.id,
            contractRefDigest: outbox.contract_ref_hash.slice(0, 16)
          });
          if (exhausted) result.exhausted += 1;
          else result.blocked += 1;
          continue;
        }
        updateNotificationOutboxState.run('EXHAUSTED', nowIso(), outbox.tenant, outbox.contract_ref_hash);
        record(run.id, outbox.tenant, 'CONTRACT_INVITATION_FAILED', {
          invitationId: invitation.id,
          contractRefDigest: outbox.contract_ref_hash.slice(0, 16),
          recovered: true
        });
        result.exhausted += 1;
      }
    }
    return result;
  }

  async function activateContract(body, res) {
    const tenant = compact(body.tenant, 120);
    const contractRef = compact(body.contractRef, 300);
    const recipientEmail = compact(body.recipientEmail, 240).trim().toLowerCase();
    const targetHours = Math.max(1, Math.min(24, Number(body.targetHours || 8)));
    if (!tenant || !contractRef || !validEmail(recipientEmail)) {
      return writeJson(res, 400, { error: 'tenant, contractRef and a valid recipientEmail are required.' });
    }
    const contractHash = sha256(contractRef);
    // A trusted signed/activated contract is the implementation start signal.
    // Do not wait for an email click or other human acknowledgement before
    // provisioning the implementation run. Notification is advisory only.
    let autoStartedRun = runByContract.get(tenant, contractHash);
    const createdRun = !autoStartedRun;
    if (!autoStartedRun) {
      const started = Date.now();
      const deadline = started + targetHours * 60 * 60 * 1000;
      const runId = randomUUID();
      const runCreatedAt = nowIso();
      insertRun.run(runId, tenant, contractHash, 'BUILDING', started, deadline, targetHours, runCreatedAt, runCreatedAt);
      autoStartedRun = runById.get(runId, tenant);
      record(runId, tenant, 'CONTRACT_AUTO_STARTED', {
        targetHours,
        contractRefDigest: contractHash.slice(0, 16)
      });
    }

    const trustedScopeInput = body.scope && typeof body.scope === 'object'
      ? body.scope
      : (body.implementationScope && typeof body.implementationScope === 'object' ? body.implementationScope : null);
    if (trustedScopeInput) {
      const scope = normaliseScope(trustedScopeInput);
      const existingScope = scopeByRun.get(autoStartedRun.id, tenant);
      const ts = nowIso();
      upsertScope.run(
        autoStartedRun.id,
        tenant,
        JSON.stringify(scope),
        sha256('trusted-contract-scope:' + contractHash).slice(0, 16),
        existingScope?.created_at || ts,
        ts
      );
      record(autoStartedRun.id, tenant, existingScope ? 'TRUSTED_CONTRACT_SCOPE_UPDATED' : 'TRUSTED_CONTRACT_SCOPE_CAPTURED', {
        employees: scope.employeeCount,
        countries: scope.countries.length,
        sites: scope.sites.length,
        sourceSystems: scope.sourceSystems.length,
        features: scope.features.length,
        contractRefDigest: contractHash.slice(0, 16)
      });
      executeTenantEnvironmentEffect(autoStartedRun, scope, 'trusted-contract-scope');
      ensurePolicyQuestions(autoStartedRun, scope);
    }

    const recipientHash = recipientDigest(recipientEmail);
    let invitation = null;
    let recoveryOutbox = null;
    const existing = invitationByContract.get(tenant, contractHash);
    if (existing) {
      const expired = Date.now() > existing.expires_at_ms;
      const recipientChanged = !secureEqual(existing.recipient_hash, recipientHash);
      if (existing.status === 'PENDING' && (expired || recipientChanged)) {
        deleteInvitation.run(existing.id);
        deleteNotificationOutbox.run(tenant, contractHash);
      } else {
        recoveryOutbox = outboxByContract.get(tenant, contractHash);
        if (existing.status === 'PENDING' && recoveryOutbox?.state === 'PENDING') {
          invitation = existing;
        } else if (existing.status === 'PENDING' && recoveryOutbox?.state === 'PROVIDER_BLOCKED') {
          return writeJson(res, 200, {
            invitation: null,
            implementation: readinessForRun(autoStartedRun),
            notification: {
              delivered: false,
              blocked: true,
              reason: 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED'
            }
          });
        } else if (existing.status === 'PENDING' && recoveryOutbox?.state === 'EXHAUSTED') {
          return writeJson(res, 200, {
            invitation: null,
            implementation: readinessForRun(autoStartedRun),
            notification: { delivered: false, retryExhausted: true }
          });
        } else {
          return writeJson(res, 200, {
            invitation: publicInvitation(existing),
            implementation: readinessForRun(autoStartedRun)
          });
        }
      }
    }

    if (!publicOrigin || !/^https:\/\//i.test(publicOrigin)) {
      record(autoStartedRun.id, tenant, 'CONTRACT_INVITATION_UNAVAILABLE', {
        reason: 'PUBLIC_ORIGIN_UNCONFIGURED', contractRefDigest: contractHash.slice(0, 16)
      });
      return writeJson(res, createdRun ? 201 : 200, {
        invitation: null,
        implementation: readinessForRun(autoStartedRun),
        notification: { delivered: false, unavailable: true }
      });
    }
    if (!invitationTransportReady) {
      record(autoStartedRun.id, tenant, 'CONTRACT_INVITATION_UNAVAILABLE', {
        reason: 'MESSAGE_PROVIDER_NOT_CONFIGURED', contractRefDigest: contractHash.slice(0, 16)
      });
      return writeJson(res, createdRun ? 201 : 200, {
        invitation: null,
        implementation: readinessForRun(autoStartedRun),
        notification: {
          delivered: false,
          unavailable: true,
          reason: 'MESSAGE_PROVIDER_NOT_CONFIGURED'
        }
      });
    }
    let notificationDelivered = false;
    let retryExhausted = false;
    let retryInProgress = false;
    let providerBlocked = false;
    let id = invitation?.id || null;
    let rawToken = invitation ? deterministicInvitationToken(invitation) : null;
    let expiresAtMs = invitation?.expires_at_ms || null;
    const recoveringExisting = Boolean(invitation && recoveryOutbox);
    if (invitation && (!rawToken || !secureEqual(sha256(rawToken), invitation.token_hash))) {
      updateNotificationOutboxState.run('BLOCKED', nowIso(), tenant, contractHash);
      return writeJson(res, 200, {
        invitation: null,
        implementation: readinessForRun(autoStartedRun),
        notification: { delivered: false, recoveryBlocked: true }
      });
    }
    // Make one automatic recovery attempt within the trusted activation. A
    // third durable attempt remains available to a later provider replay or
    // restart, so a slow outage cannot create an unbounded mail loop.
    const localAttemptLimit = recoveringExisting ? 1 : 2;
    for (let localAttempt = 0; localAttempt < localAttemptLimit && !notificationDelivered; localAttempt += 1) {
      const claim = claimNotificationAttempt(tenant, contractHash);
      if (!claim.reserved) {
        if (claim.inProgress) {
          retryInProgress = true;
        } else {
          if (recoveryOutbox) updateNotificationOutboxState.run('EXHAUSTED', nowIso(), tenant, contractHash);
          else if (id) deleteInvitation.run(id);
          retryExhausted = true;
        }
        break;
      }
      if (!id) {
        id = randomUUID();
        expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const ts = nowIso();
        const pending = {
          id,
          tenant,
          contract_ref_hash: contractHash,
          recipient_hash: recipientHash,
          expires_at_ms: expiresAtMs
        };
        rawToken = invitationRecoverySecret
          ? deterministicInvitationToken(pending)
          : randomBytes(32).toString('base64url');
        insertInvitation.run(
          id, tenant, contractHash, recipientHash, sha256(rawToken), 'PENDING',
          autoStartedRun.target_hours, expiresAtMs, null, ts, ts
        );
        invitation = invitationById.get(id, tenant);
      }
      try {
        const delivery = await deliverInvitation(invitation, recipientEmail, rawToken);
        finishNotificationAttempt(tenant, contractHash);
        notificationDelivered = true;
        deleteNotificationOutbox.run(tenant, contractHash);
        record(autoStartedRun.id, tenant, 'CONTRACT_INVITATION_SENT', {
          invitationId: id,
          targetHours: autoStartedRun.target_hours,
          contractRefDigest: contractHash.slice(0, 16),
          provider: delivery?.provider || 'configured-sender',
          messageId: delivery?.messageId || null
        });
      } catch (error) {
        finishNotificationAttempt(tenant, contractHash);
        if (error?.permanent === true) {
          if (scheduleNotificationRecovery(invitation, recipientEmail)) {
            updateNotificationOutboxState.run('PROVIDER_BLOCKED', nowIso(), tenant, contractHash);
          } else {
            deleteInvitation.run(id);
          }
          providerBlocked = true;
          record(autoStartedRun.id, tenant, 'CONTRACT_INVITATION_PROVIDER_BLOCKED', {
            invitationId: id,
            contractRefDigest: contractHash.slice(0, 16)
          });
          break;
        }
        // Keep the same token and provider idempotency identity. After the
        // bounded in-request attempts, persist only an encrypted recipient and
        // reconstructible token identity so recovery survives a safe restart.
        if (localAttempt === localAttemptLimit - 1) {
          if (recoveringExisting) {
            updateNotificationOutboxState.run('EXHAUSTED', nowIso(), tenant, contractHash);
            retryExhausted = true;
          } else if (!scheduleNotificationRecovery(invitation, recipientEmail)) {
            deleteInvitation.run(id);
          }
        }
        record(autoStartedRun.id, tenant, 'CONTRACT_INVITATION_FAILED', {
          invitationId: id,
          contractRefDigest: contractHash.slice(0, 16)
        });
      }
    }

    return writeJson(res, createdRun ? 201 : 200, {
      invitation: notificationDelivered ? publicInvitation(invitationByContract.get(tenant, contractHash)) : null,
      implementation: readinessForRun(autoStartedRun),
      notification: {
        delivered: notificationDelivered,
        retryExhausted,
        retryInProgress,
        blocked: providerBlocked,
        reason: providerBlocked ? 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED' : undefined,
        pendingRetry: !notificationDelivered && outboxByContract.get(tenant, contractHash)?.state === 'PENDING'
      }
    });
  }

  async function handleContractActivated(req, res) {
    return await activateContract(await readJson(req), res);
  }

  async function handleProviderRecoveryResume(req, res) {
    const body = await readJson(req);
    const tenant = compact(body.tenant, 120);
    const contractRef = compact(body.contractRef, 300);
    if (!tenant || !contractRef) {
      return writeJson(res, 400, { error: 'tenant and contractRef are required.' });
    }

    const contractHash = sha256(contractRef);
    const run = runByContract.get(tenant, contractHash);
    const outbox = outboxByContract.get(tenant, contractHash);
    if (!run || outbox?.state !== 'PROVIDER_BLOCKED') {
      return writeJson(res, 409, { error: 'Provider-blocked invitation recovery is not available.' });
    }

    const resumedAt = Date.now();
    const resumed = resumeProviderBlockedOutbox.run(resumedAt, nowIso(), tenant, contractHash);
    if (Number(resumed.changes) !== 1) {
      return writeJson(res, 409, { error: 'Provider-blocked invitation recovery is no longer available.' });
    }
    record(run.id, tenant, 'CONTRACT_INVITATION_PROVIDER_RECOVERY_STARTED', {
      invitationId: outbox.invitation_id,
      contractRefDigest: contractHash.slice(0, 16)
    });

    const outcome = await retryDueNotifications({ nowMs: resumedAt, tenant, contractHash });
    if (outcome.delivered === 1) {
      record(run.id, tenant, 'CONTRACT_INVITATION_PROVIDER_RECOVERED', {
        invitationId: outbox.invitation_id,
        contractRefDigest: contractHash.slice(0, 16)
      });
      return writeJson(res, 200, {
        implementation: readinessForRun(run),
        notification: { delivered: true, recovered: true }
      });
    }

    const recovery = notificationRecoveryForRun(run);
    return writeJson(res, ['BLOCKED', 'EXHAUSTED'].includes(recovery.state) ? 409 : 202, {
      implementation: readinessForRun(run),
      notification: {
        delivered: false,
        recovered: false,
        state: recovery.state,
        terminalAction: recovery.terminalAction
      }
    });
  }

  function invitationForContext(ctx, token) {
    const digest = sha256(compact(token, 500));
    const invitation = invitationByToken.get(digest);
    if (!invitation) return null;
    if (invitation.tenant !== ctx.tenant) return null;
    if (!secureEqual(invitation.recipient_hash, recipientDigest(ctx.email))) return null;
    return invitation;
  }

  function handleInvitation(ctx, req, res) {
    let token = '';
    try { token = new URL(String(req.url || '/'), 'https://local.invalid').searchParams.get('token') || ''; } catch {}
    const invitation = invitationForContext(ctx, token);
    if (!invitation) return writeJson(res, 404, { error: 'Implementation invitation not found.' });
    return writeJson(res, 200, { invitation: publicInvitation(invitation) });
  }

  async function handleStart(ctx, req, res) {
    const body = await readJson(req);
    const invitation = invitationForContext(ctx, body.token);
    if (!invitation) return writeJson(res, 404, { error: 'Implementation invitation not found.' });
    if (Date.now() > invitation.expires_at_ms) {
      return writeJson(res, 410, { error: 'Implementation invitation has expired.' });
    }
    if (invitation.status === 'STARTED' && invitation.started_run_id) {
      const existing = runById.get(invitation.started_run_id, ctx.tenant);
      if (existing) return writeJson(res, 200, readinessForRun(existing));
    }
    if (invitation.status !== 'PENDING') {
      return writeJson(res, 409, { error: 'Implementation invitation is no longer available.' });
    }

    let run = runByContract.get(ctx.tenant, invitation.contract_ref_hash);
    if (!run) {
      const id = randomUUID();
      const started = Date.now();
      const deadline = started + Number(invitation.target_hours) * 60 * 60 * 1000;
      const ts = nowIso();
      insertRun.run(id, ctx.tenant, invitation.contract_ref_hash, 'BUILDING', started, deadline, invitation.target_hours, ts, ts);
      run = runById.get(id, ctx.tenant);
      record(id, ctx.tenant, 'CUSTOMER_START_CONFIRMED', {
        invitationId: invitation.id,
        targetHours: invitation.target_hours,
        by: sha256(ctx.email).slice(0, 16)
      });
    }

    const consumed = startInvitation.run(run.id, nowIso(), invitation.id);
    if (Number(consumed.changes) !== 1 && invitation.status !== 'STARTED') {
      const refreshed = invitationByToken.get(invitation.token_hash);
      if (refreshed?.started_run_id) {
        const existing = runById.get(refreshed.started_run_id, ctx.tenant);
        if (existing) return writeJson(res, 200, readinessForRun(existing));
      }
      return writeJson(res, 409, { error: 'Implementation start state changed. Refresh and try again.' });
    }
    return writeJson(res, 201, readinessForRun(run));
  }

  function cleanList(value, maxItems = 40, maxLength = 120) {
    const source = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(source.map(item => compact(item, maxLength)).filter(Boolean))].slice(0, maxItems);
  }

  function normaliseScope(body = {}) {
    const companyName = compact(body.companyName || body.organisationName, 160);
    const countries = cleanList(body.countries, 30, 80);
    const sites = cleanList(body.sites, 100, 120);
    const employeeCount = Number(body.employeeCount);
    const sourceSystems = cleanList(body.sourceSystems, 60, 120);
    const features = cleanList(body.features, 60, 120);
    const workPatterns = cleanList(body.workPatterns, 40, 120);
    const clockingMethods = cleanList(body.clockingMethods, 20, 120);
    const payrollSystem = compact(body.payrollSystem, 120);
    const hcmSystem = compact(body.hcmSystem, 120);
    const erpSystem = compact(body.erpSystem, 120);
    const priorities = compact(body.priorities, 1000);
    const notes = compact(body.notes, 2000);
    if (!companyName || countries.length === 0 || sites.length === 0 || !Number.isInteger(employeeCount) || employeeCount <= 0 || employeeCount > 1000000) {
      const error = new Error('companyName, at least one country, at least one site and a valid employeeCount are required.');
      error.statusCode = 400;
      throw error;
    }
    return {
      companyName,
      countries,
      sites,
      employeeCount,
      sourceSystems,
      features,
      workPatterns,
      clockingMethods,
      payrollSystem,
      hcmSystem,
      erpSystem,
      agencyLabour: Boolean(body.agencyLabour),
      priorities,
      notes
    };
  }

  function handleScopeGet(ctx, res) {
    const run = currentRun.get(ctx.tenant);
    if (!run) return writeJson(res, 409, { error: 'Start the implementation before providing configuration scope.' });
    const row = scopeByRun.get(run.id, ctx.tenant);
    return writeJson(res, 200, {
      runId: run.id,
      scopeCaptured: Boolean(row),
      scope: row ? JSON.parse(row.scope_json) : null,
      updatedAt: row?.updated_at || null
    });
  }

  async function handleScope(ctx, req, res) {
    const run = currentRun.get(ctx.tenant);
    if (!run) return writeJson(res, 409, { error: 'Start the implementation before providing configuration scope.' });
    const scope = normaliseScope(await readJson(req));
    const existing = scopeByRun.get(run.id, ctx.tenant);
    const ts = nowIso();
    upsertScope.run(run.id, ctx.tenant, JSON.stringify(scope), sha256(ctx.email).slice(0, 16), existing?.created_at || ts, ts);
    record(run.id, ctx.tenant, existing ? 'CUSTOMER_SCOPE_UPDATED' : 'CUSTOMER_SCOPE_SUBMITTED', {
      by: sha256(ctx.email).slice(0, 16),
      employees: scope.employeeCount,
      countries: scope.countries.length,
      sites: scope.sites.length,
      sourceSystems: scope.sourceSystems.length,
      features: scope.features.length
    });
    executeTenantEnvironmentEffect(run, scope, existing ? 'customer-scope-update' : 'customer-scope-submit');
    ensurePolicyQuestions(run, scope);
    return writeJson(res, existing ? 200 : 201, recompute(run));
  }

  async function handleEvidence(req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const kind = compact(body.kind, 100);
    const status = compact(body.status, 20).toUpperCase();
    const confidence = Number(body.confidence);
    const source = compact(body.source || 'trusted-worker', 100);
    const run = runByIdAnyTenant.get(runId);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    if (!REQUIREMENT_BY_KEY.has(kind)) {
      return writeJson(res, 400, { error: 'Unknown implementation evidence kind.' });
    }
    if (!['PASS', 'WARN', 'FAIL'].includes(status)) {
      return writeJson(res, 400, { error: 'status must be PASS, WARN or FAIL.' });
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return writeJson(res, 400, { error: 'confidence must be between 0 and 1.' });
    }

    const detail = body.detail && typeof body.detail === 'object' ? body.detail : {};
    const evidenceBinding = status === 'PASS' ? evidenceBindingFor(detail, run) : null;
    if (evidenceBinding?.reason) {
      return writeJson(res, 409, {
        error: 'Implementation evidence must be revalidated on the current candidate and deployment.',
        readinessEvidenceAccepted: false, kind, evidenceBinding
      });
    }
    const evidenceRecordedAt = nowIso();
    if (status === 'PASS' && (kind === 'tenant-environment' || POLICY_REQUIREMENT_KINDS.has(kind))) {
      const policyValidationError = kind === 'tenant-environment'
        ? tenantEnvironmentEvidenceError(run, { source, created_at: evidenceRecordedAt }, false, detail, true)
        : validateStrictReadinessEvidence(kind, status, detail);
      if (policyValidationError) {
        return writeJson(res, 409, { error: policyValidationError, readinessEvidenceAccepted: false, kind });
      }
    }
    if (status === 'PASS' && kind === 'tenant-environment') {
      if (Object.prototype.hasOwnProperty.call(detail, '_tenantEnvironmentValidation')) {
        return writeJson(res, 409, { error: 'Tenant-environment validation receipts are server-issued only.', readinessEvidenceAccepted: false, kind });
      }
      const previous = db.prepare('SELECT detail_json FROM implementation_evidence WHERE run_id=? AND tenant=? AND kind=?')
        .all(run.id, run.tenant, kind);
      if (previous.some(item => { const prior = parseJsonSafe(item.detail_json, {}); return (prior.verifierRunId || prior.verifierDeploymentId) === (detail.verifierRunId || detail.verifierDeploymentId); })) {
        return writeJson(res, 409, { error: 'Tenant-environment verifier-run evidence cannot be replayed.', readinessEvidenceAccepted: false, kind });
      }
    }
    if (status === 'PASS' && kind === 'scenario-validation') {
      const total = Number(detail.totalScenarios);
      const passed = Number(detail.passedScenarios);
      const criticalFailures = Number(detail.criticalFailures);
      if (!Number.isInteger(total) || total <= 0 || passed !== total || criticalFailures !== 0) {
        return writeJson(res, 409, { error: 'Scenario validation PASS requires every scenario to pass with zero critical failures.' });
      }
    }
    if (status === 'PASS' && kind === 'test-data-cleanup') {
      if (Number(detail.remainingTestRows) !== 0 || Number(detail.liveRowsTouched) !== 0) {
        return writeJson(res, 409, { error: 'Cleanup PASS requires zero remaining test rows and zero live rows touched.' });
      }
    }
    if (status === 'PASS' && kind === 'live-data-import') {
      const sourceCount = Number(detail.sourceCount);
      const importedCount = Number(detail.importedCount);
      if (!Number.isInteger(sourceCount) || sourceCount < 0 || importedCount !== sourceCount || Number(detail.invalidCount) !== 0 || detail.checksumMatch !== true) {
        return writeJson(res, 409, { error: 'Live import PASS requires reconciled counts, zero invalid rows and a matching checksum.' });
      }
    }

    let storedDetail = detail;
    if (status === 'PASS' && kind === 'tenant-environment') {
      storedDetail = { ...detail, _tenantEnvironmentValidation: {
        version: 1, validator: 'tenant-environment-v1',
        proofDigest: sha256(JSON.stringify(detail)),
        tenant: run.tenant, implementationRunId: run.id,
        candidateSha, deploymentId, verifierRunId: detail.verifierRunId || detail.verifierDeploymentId,
        acceptedAt: evidenceRecordedAt
      }};
    }
    insertEvidence.run(run.id, run.tenant, kind, status, confidence, source, JSON.stringify(storedDetail), evidenceRecordedAt);
    record(run.id, run.tenant, 'EVIDENCE_RECORDED', { kind, status, confidence, source });
    return writeJson(res, 200, recompute(run));
  }

  function runForInternalWork(body = {}) {
    const runId = compact(body.runId, 100);
    const tenant = compact(body.tenant, 120);
    let run = null;
    if (runId) run = runByIdAnyTenant.get(runId);
    else if (tenant) run = currentRun.get(tenant);
    if (!run) return null;
    if (tenant && run.tenant !== tenant) return null;
    return run;
  }

  async function handleWorkStatus(req, res) {
    const body = await readJson(req);
    const run = runForInternalWork(body);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    return writeJson(res, 200, recompute(run));
  }

  // The shared evidence/status credential is not an execution identity. Only
  // the configured existing worker receives this additional scoped credential.
  const workOwnerId = String(options.workOwnerId || process.env.WFM_IMPLEMENTATION_WORKER_ID || '');
  const workOwnerToken = String(options.workOwnerToken || process.env.WFM_IMPLEMENTATION_WORKER_TOKEN || '');
  const workOwnerTenant = String(options.workOwnerTenant || process.env.WFM_IMPLEMENTATION_WORKER_TENANT || '');
  const workOwnerRunId = String(options.workOwnerRunId || process.env.WFM_IMPLEMENTATION_WORKER_RUN_ID || '');
  function requireWorkOwner(req, res, body) {
    if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(workOwnerId) || workOwnerToken.length < 32 || !workOwnerTenant || !workOwnerRunId) {
      writeJson(res, 503, {error: 'No exclusive implementation worker is registered.'});
      return null;
    }
    if (!secureEqual(req.headers?.['x-wfm-implementation-worker'], workOwnerToken)) {
      writeJson(res, 403, {error: 'Implementation worker credential rejected.'});
      return null;
    }
    if (body.tenant !== workOwnerTenant || body.runId !== workOwnerRunId ||
        (body.ownerId !== undefined && body.ownerId !== workOwnerId)) {
      writeJson(res, 409, {error: 'Implementation worker tenant/run/owner binding mismatch.'});
      return null;
    }
    if (requireCandidateBinding && (body.candidateSha !== candidateSha || body.deploymentId !== deploymentId)) {
      writeJson(res, 409, {error: 'Implementation worker candidate/deployment binding mismatch.'});
      return null;
    }
    return workOwnerId;
  }

  async function handleWorkClaim(req, res) {
    const body = await readJson(req);
    const ownerId = requireWorkOwner(req, res, body);
    if (!ownerId) return true;
    const run = runForInternalWork(body);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    const readiness = recompute(run);
    const requirementKey = compact(body.requirementKey, 100) || null;
    const job = workController.claim({ runId: run.id, tenant: run.tenant, requirementKey, ownerId });
    if (!job) {
      return writeJson(res, 200, {
        job: null,
        workPlan: readiness.workPlan,
        reason: readiness.workPlan.runnable.length ? 'CLAIM_RACE_OR_FILTER_MISMATCH' : 'NO_RUNNABLE_WORK'
      });
    }
    record(run.id, run.tenant, 'IMPLEMENTATION_WORK_CLAIMED', {
      requirementKey: job.requirementKey,
      intentDigest: job.intentDigest.slice(0, 16),
      attempts: job.attempts
    });
    return writeJson(res, 200, { job, workPlan: workController.plan(run.id, run.tenant) });
  }

  async function handleWorkResult(req, res) {
    const body = await readJson(req);
    const ownerId = requireWorkOwner(req, res, body);
    if (!ownerId) return true;
    const fence = body.fence;
    const leaseToken = body.leaseToken;
    const run = runForInternalWork(body);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    const jobId = compact(body.jobId, 100);
    const intentDigest = compact(body.intentDigest, 80);
    const outcome = compact(body.outcome || body.status, 80).toUpperCase();
    if (!jobId || !/^[0-9a-f]{64}$/.test(intentDigest)) {
      return writeJson(res, 400, { error: 'jobId and exact intentDigest are required.' });
    }

    let result;
    if (outcome === 'BLOCKED_RESUMABLE') {
      result = workController.block({
        jobId, runId: run.id, tenant: run.tenant, intentDigest, ownerId, fence, leaseToken,
        reason: compact(body.reason, 160) || 'AUTHORITY_OR_CONFIGURATION_REQUIRED'
      });
    } else if (outcome === 'RETRYABLE') {
      result = workController.fail({
        jobId, runId: run.id, tenant: run.tenant, intentDigest, ownerId, fence, leaseToken,
        error: compact(body.error || body.reason, 300) || 'Transient implementation failure.',
        retryable: true
      });
    } else if (outcome === 'FAILED_CLOSED') {
      result = workController.fail({
        jobId, runId: run.id, tenant: run.tenant, intentDigest, ownerId, fence, leaseToken,
        error: compact(body.error || body.reason, 300) || 'Implementation work failed closed.',
        retryable: false
      });
    } else if (['EFFECT_RECORDED', 'PASS_EFFECT', 'COMPLETED'].includes(outcome)) {
      result = workController.complete({
        jobId, runId: run.id, tenant: run.tenant, intentDigest, ownerId, fence, leaseToken,
        outcome: 'EFFECT_RECORDED',
        detail: body.detail && typeof body.detail === 'object' ? body.detail : {}
      });
    } else {
      return writeJson(res, 400, {
        error: 'outcome must be EFFECT_RECORDED, BLOCKED_RESUMABLE, RETRYABLE or FAILED_CLOSED.'
      });
    }

    record(run.id, run.tenant, 'IMPLEMENTATION_WORK_RESULT', {
      jobId,
      outcome,
      replayed: result?.replayed === true,
      requirementKey: result?.job?.requirementKey || result?.requirementKey || null
    });
    return writeJson(res, 200, {
      result,
      readiness: recompute(run),
      evidenceRequired: outcome === 'EFFECT_RECORDED' || outcome === 'PASS_EFFECT' || outcome === 'COMPLETED'
    });
  }

  async function handleProposal(req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const key = compact(body.key, 120);
    const question = compact(body.question, 500);
    const risk = compact(body.risk || 'MEDIUM', 20).toUpperCase();
    const confidence = Number(body.confidence);
    const run = runByIdAnyTenant.get(runId);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    if (!key || !question || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(risk)) {
      return writeJson(res, 400, { error: 'Valid key, question and risk are required.' });
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return writeJson(res, 400, { error: 'confidence must be between 0 and 1.' });
    }

    const existing = decisionByKey.get(run.id, run.tenant, key);
    if (existing) return writeJson(res, 200, { decision: parseDecision(existing) });

    const id = randomUUID();
    const ts = nowIso();
    insertDecision.run(
      id, run.id, run.tenant, key, question, JSON.stringify(body.proposal || {}),
      confidence, risk, 'PENDING', null, ts, ts
    );
    record(run.id, run.tenant, 'DECISION_REQUIRED', { key, risk, confidence });
    return writeJson(res, 201, { decision: parseDecision(decisionByKey.get(run.id, run.tenant, key)) });
  }

  async function handleDecision(ctx, req, res) {
    const body = await readJson(req);
    const runId = compact(body.runId, 80);
    const key = compact(body.key, 120);
    const action = compact(body.action, 20).toUpperCase();
    const run = runById.get(runId, ctx.tenant);
    if (!run) return writeJson(res, 404, { error: 'Implementation run not found.' });
    const decision = decisionByKey.get(run.id, run.tenant, key);
    if (!decision) return writeJson(res, 404, { error: 'Decision not found.' });
    if (!['ACCEPTED', 'CHANGED', 'REJECTED'].includes(action)) {
      return writeJson(res, 400, { error: 'action must be ACCEPTED, CHANGED or REJECTED.' });
    }

    const detail = action === 'CHANGED' ? body.value : body.detail;
    let policyEvidence = null;
    if (action !== 'REJECTED' && POLICY_DECISIONS[key]) {
      policyEvidence = customerPolicyEvidence(key, detail, run);
    }

    updateDecision.run(action, JSON.stringify(detail ?? null), nowIso(), decision.id, run.tenant);
    record(run.id, run.tenant, 'DECISION_RESOLVED', {
      key,
      action,
      by: sha256(ctx.email).slice(0, 16)
    });

    if (policyEvidence) {
      insertEvidence.run(
        run.id,
        run.tenant,
        policyEvidence.kind,
        'PASS',
        1,
        'customer-authorised-policy-confirmation',
        JSON.stringify(policyEvidence.detail),
        nowIso()
      );
      record(run.id, run.tenant, 'CUSTOMER_POLICY_AUTHORITY_CONFIRMED', {
        key,
        kind: policyEvidence.kind,
        sourceRefDigest: sha256(policyEvidence.detail.sourceRef).slice(0, 16),
        effectiveDate: policyEvidence.detail.effectiveDate,
        by: sha256(ctx.email).slice(0, 16)
      });
    }
    return writeJson(res, 200, recompute(run));
  }

  function handleStatus(ctx, res) {
    const run = currentRun.get(ctx.tenant);
    if (run) return writeJson(res, 200, recompute(run));
    const invitation = latestInvitationForRecipient.get(ctx.tenant, recipientDigest(ctx.email));
    if (invitation) return writeJson(res, 200, {
      state: Date.now() > invitation.expires_at_ms ? 'INVITATION_EXPIRED' : 'AWAITING_CUSTOMER_START',
      operationalReady: false,
      targetHours: invitation.target_hours,
      invitation: publicInvitation(invitation),
      requirements: REQUIREMENTS
    });
    return writeJson(res, 200, {
      state: 'NOT_STARTED',
      operationalReady: false,
      targetHours: 8,
      requirements: REQUIREMENTS
    });
  }

  function handleEntryPreflight(res) {
    const checks = {
      contractAuthentication: Boolean(contractWebhookSecret),
      secureCustomerOrigin: Boolean(publicOrigin && /^https:\/\//i.test(publicOrigin)),
      invitationProvider: invitationTransportReady,
      restartRecovery: Boolean(dedicatedInvitationRecoverySecret)
    };
    const requiredActions = [];
    if (!checks.contractAuthentication) requiredActions.push('CONTRACT_AUTHENTICATION_CONFIGURATION_REQUIRED');
    if (!checks.secureCustomerOrigin) requiredActions.push('SECURE_CUSTOMER_ORIGIN_CONFIGURATION_REQUIRED');
    if (!checks.invitationProvider) requiredActions.push('MESSAGE_PROVIDER_CONFIGURATION_REQUIRED');
    if (!checks.restartRecovery) requiredActions.push('INVITATION_RECOVERY_SECRET_CONFIGURATION_REQUIRED');
    return writeJson(res, 200, {
      state: requiredActions.length === 0 ? 'READY' : 'BLOCKED',
      ready: requiredActions.length === 0,
      checks,
      requiredActions
    });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;

    try {
      if (req.method === 'GET' && path === PREFIX + '/preflight') {
        if (!requireInternal(req, res)) return true;
        return handleEntryPreflight(res);
      }
      if (req.method === 'POST' && path === PREFIX + '/contract-signed') {
        if (!requireContractWebhook(req, res)) return true;
        return await handleContractSigned(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/contract-activated') {
        if (!requireInternal(req, res)) return true;
        return await handleContractActivated(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/notification-recovery/resume') {
        if (!requireInternal(req, res)) return true;
        return await handleProviderRecoveryResume(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/evidence') {
        if (!requireInternal(req, res)) return true;
        return await handleEvidence(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/proposal') {
        if (!requireInternal(req, res)) return true;
        return await handleProposal(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/work/status') {
        if (!requireInternal(req, res)) return true;
        return await handleWorkStatus(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/work/claim') {
        if (!requireInternal(req, res)) return true;
        return await handleWorkClaim(req, res);
      }
      if (req.method === 'POST' && path === PREFIX + '/work/result') {
        if (!requireInternal(req, res)) return true;
        return await handleWorkResult(req, res);
      }

      const ctx = requireManager(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/status') return handleStatus(ctx, res);
      if (req.method === 'GET' && path === PREFIX + '/invitation') return handleInvitation(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/start') return await handleStart(ctx, req, res);
      if (req.method === 'GET' && path === PREFIX + '/scope') return handleScopeGet(ctx, res);
      if (req.method === 'POST' && path === PREFIX + '/scope') return await handleScope(ctx, req, res);
      if (req.method === 'POST' && path === PREFIX + '/decision') return await handleDecision(ctx, req, res);
      return writeJson(res, 404, { error: 'Autonomous implementation endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), {
        error: error?.statusCode ? error.message : 'Implementation control plane failed safely.'
      });
    }
  }

  // Resume safe in-process implementation effects for an existing canonical run
  // after deployment/restart. The effect is idempotent; readiness remains blocked
  // until an independent verifier records exact-candidate evidence.
  for (const recoverableRun of db.prepare(
    "SELECT * FROM implementation_runs WHERE state IN ('BUILDING','AT_RISK','SLA_MISSED') ORDER BY started_at_ms"
  ).all()) {
    const scopeRow = scopeByRun.get(recoverableRun.id, recoverableRun.tenant);
    if (!scopeRow) continue;
    try {
      const scope = JSON.parse(scopeRow.scope_json);
      executeTenantEnvironmentEffect(recoverableRun, scope, 'runtime-recovery');
      ensurePolicyQuestions(recoverableRun, scope);
    } catch (error) {
      record(recoverableRun.id, recoverableRun.tenant, 'TENANT_ENVIRONMENT_EFFECT_FAILED', {
        reason: compact(error?.message || 'tenant-environment-effect-failed', 160)
      });
    }
  }

  let notificationRetryTimer = null;
  if (invitationRecoverySecret && notificationRetryPollMs > 0) {
    notificationRetryTimer = setInterval(() => {
      retryDueNotifications().catch(() => {});
    }, notificationRetryPollMs);
    notificationRetryTimer.unref?.();
  }

  return {
    handleRequest,
    retryDueNotifications,
    statusForTenant(tenant) {
      const run = currentRun.get(tenant);
      return run ? recompute(run) : null;
    },
    close() {
      if (notificationRetryTimer) clearInterval(notificationRetryTimer);
      try { tenantEnvironmentProvisioner.close(); } catch {}
      try { workController.close(); } catch {}
      try { db.close(); } catch {}
    }
  };
}

module.exports = {
  createOneDayEnterpriseEngine,
  REQUIREMENTS,
  criticalPathRemainingMinutes
};

