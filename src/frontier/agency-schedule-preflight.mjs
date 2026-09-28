import crypto from 'node:crypto';

export const AGENCY_SCHEDULE_PREFLIGHT_VERSION = 'agency-schedule-preflight-v0.1.0';
export const AGENCY_SCHEDULE_PREFLIGHT_STORE_VERSION = 'agency-schedule-preflight-store-v0.1.0';

const READ_ACCEPTED_BINDINGS_SQL = `
WITH accepted AS MATERIALIZED (
  SELECT tenant_id, token_id, site_id, request_id, agency_id, action, consumed_at, assurance_bindings
  FROM wfm_agency_portal_token_consumptions
  WHERE tenant_id = $1
    AND token_id = $2
    AND site_id = $3
    AND request_id = $4
    AND agency_id = $5
  LIMIT 1
), expected AS MATERIALIZED (
  SELECT
    binding->>'workerId' AS worker_id,
    lower(binding->>'assuranceVersionId') AS assurance_version_id
  FROM accepted
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(accepted.assurance_bindings) = 'array' THEN accepted.assurance_bindings
      ELSE '[]'::jsonb
    END
  ) AS entry(binding)
)
SELECT
  accepted.action,
  accepted.consumed_at,
  expected.worker_id,
  expected.assurance_version_id AS accepted_assurance_version_id,
  current.assurance_version_id AS current_assurance_version_id,
  current.site_id AS current_site_id,
  current.request_id AS current_request_id,
  current.assignment_fingerprint,
  current.checked_at,
  current.coverage_until,
  current.promoted_at,
  current.conflicted
FROM accepted
JOIN expected ON true
LEFT JOIN LATERAL (
  SELECT assurance_version_id, site_id, request_id, assignment_fingerprint,
         checked_at, coverage_until, promoted_at, conflicted
  FROM wfm_agency_rtw_assurance_current
  WHERE tenant_id = $1
    AND agency_id = $5
    AND worker_id = expected.worker_id
  LIMIT 1
  FOR SHARE
) AS current ON true
ORDER BY expected.worker_id;
`;

const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const iso = value => {
  const parsed = ms(value);
  return parsed === null ? null : new Date(parsed).toISOString();
};
const bool = value => value === true || value === 't' || value === 'true';
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const digest = (value, length = 24) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);

function required(value, name, max = 200) {
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

export function agencyScheduleAssignmentFingerprint(request = {}) {
  const scope = {
    roleId:required(request.roleId, 'request.roleId', 100),
    location:required(request.location, 'request.location', 200),
    startAt:iso(request.startAt),
    endAt:iso(request.endAt),
  };
  if (!scope.startAt || !scope.endAt || Date.parse(scope.endAt) <= Date.parse(scope.startAt)) {
    throw new TypeError('request assignment window is invalid');
  }
  return digest(JSON.stringify(stable(scope)));
}

function safeRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    action:text(row.action, 50),
    consumedAt:iso(row.consumed_at ?? row.consumedAt),
    workerId:text(row.worker_id ?? row.workerId, 100),
    acceptedAssuranceVersionId:text(row.accepted_assurance_version_id ?? row.acceptedAssuranceVersionId, 32).toLowerCase(),
    currentAssuranceVersionId:text(row.current_assurance_version_id ?? row.currentAssuranceVersionId, 32).toLowerCase(),
    currentSiteId:text(row.current_site_id ?? row.currentSiteId, 100),
    currentRequestId:text(row.current_request_id ?? row.currentRequestId, 100),
    assignmentFingerprint:text(row.assignment_fingerprint ?? row.assignmentFingerprint, 24).toLowerCase(),
    checkedAt:iso(row.checked_at ?? row.checkedAt),
    coverageUntil:(row.coverage_until ?? row.coverageUntil) == null ? null : iso(row.coverage_until ?? row.coverageUntil),
    promotedAt:iso(row.promoted_at ?? row.promotedAt),
    conflicted:bool(row.conflicted),
  };
}

export function createPostgresAgencySchedulePreflightStore({ query }) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_SCHEDULE_PREFLIGHT_STORE_VERSION,
    async readAcceptedBindings(scope = {}) {
      const values = [
        required(scope.tenantId, 'tenantId', 100),
        required(scope.tokenId, 'tokenId', 200),
        required(scope.siteId, 'siteId', 100),
        required(scope.requestId, 'requestId', 100),
        required(scope.agencyId, 'agencyId', 100),
      ];
      const result = await query(READ_ACCEPTED_BINDINGS_SQL, values);
      const rows = Array.isArray(result?.rows) ? result.rows.map(safeRow).filter(Boolean) : [];
      if (rows.length > 100) throw new Error('unexpected_schedule_preflight_binding_count');
      return { rows };
    },
  });
}

export async function preflightAgencyScheduleHandoff({
  tenantId,
  siteId,
  agencyId,
  tokenId,
  request,
  now,
  preflightStore,
} = {}) {
  const fail = (reason, failures = [reason], evidence = []) => ({
    version:AGENCY_SCHEDULE_PREFLIGHT_VERSION,
    readyForScheduleHandoff:false,
    reason,
    failures:[...new Set(failures)],
    requestId:text(request?.requestId, 100) || null,
    siteId:text(siteId, 100) || null,
    agencyId:text(agencyId, 100) || null,
    acceptedResponseFingerprint:tokenId ? digest(tokenId, 16) : null,
    workerAssuranceBindings:evidence,
    scheduleHandoffFingerprint:null,
    checkedAt:iso(now),
    authorityBoundary:'schedule_preflight_only_no_schedule_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_preflight_output',
  });

  let scope;
  try {
    scope = {
      tenantId:required(tenantId, 'tenantId', 100),
      siteId:required(siteId, 'siteId', 100),
      requestId:required(request?.requestId, 'request.requestId', 100),
      agencyId:required(agencyId, 'agencyId', 100),
      tokenId:required(tokenId, 'tokenId', 200),
    };
  } catch {
    return fail('schedule_preflight_scope_invalid');
  }

  const nowMs = ms(now);
  const assignmentEndMs = ms(request?.endAt);
  if (nowMs === null || assignmentEndMs === null || assignmentEndMs <= nowMs) {
    return fail('schedule_preflight_time_window_invalid');
  }

  let assignmentFingerprint;
  try { assignmentFingerprint = agencyScheduleAssignmentFingerprint(request); }
  catch { return fail('schedule_preflight_assignment_invalid'); }

  if (!preflightStore || typeof preflightStore.readAcceptedBindings !== 'function') {
    return fail('schedule_preflight_store_unavailable');
  }

  let read;
  try { read = await preflightStore.readAcceptedBindings(scope); }
  catch { return fail('schedule_preflight_store_unavailable'); }
  const rows = Array.isArray(read?.rows) ? read.rows.map(safeRow).filter(Boolean) : [];
  if (rows.length === 0) return fail('accepted_response_missing_or_unbound');

  const actions = new Set(rows.map(row => row.action));
  if (actions.size !== 1 || !['confirm_preferred_worker', 'partial_fill'].includes(rows[0].action)) {
    return fail('accepted_response_not_scheduleable');
  }

  const failures = [];
  const byWorker = new Map();
  for (const row of rows) {
    if (!row.workerId || byWorker.has(row.workerId)) {
      failures.push('accepted_response_assurance_bindings_invalid');
      continue;
    }
    byWorker.set(row.workerId, row);
    if (!/^[0-9a-f]{32}$/.test(row.acceptedAssuranceVersionId)) failures.push('accepted_response_assurance_version_invalid');
    if (!/^[0-9a-f]{32}$/.test(row.currentAssuranceVersionId)) failures.push('current_assurance_missing');
    if (row.currentAssuranceVersionId && row.acceptedAssuranceVersionId !== row.currentAssuranceVersionId) failures.push('accepted_worker_assurance_changed');
    if (row.currentSiteId !== scope.siteId) failures.push('current_assurance_site_mismatch');
    if (row.currentRequestId !== scope.requestId) failures.push('current_assurance_request_mismatch');
    if (row.conflicted) failures.push('current_assurance_conflicted');
    if (row.assignmentFingerprint !== assignmentFingerprint) failures.push('current_assurance_assignment_mismatch');
    const checkedAtMs = ms(row.checkedAt);
    const promotedAtMs = ms(row.promotedAt);
    if (checkedAtMs === null || checkedAtMs > nowMs) failures.push('current_assurance_checked_at_invalid');
    if (promotedAtMs === null || promotedAtMs > nowMs) failures.push('current_assurance_promoted_at_invalid');
    const coverageUntilMs = row.coverageUntil == null ? null : ms(row.coverageUntil);
    if (row.coverageUntil != null && (coverageUntilMs === null || coverageUntilMs < assignmentEndMs || coverageUntilMs < nowMs)) {
      failures.push('current_assurance_does_not_cover_assignment');
    }
  }

  const evidence = [...byWorker.values()].map(row => ({
    workerId:row.workerId,
    assuranceVersionId:row.currentAssuranceVersionId || row.acceptedAssuranceVersionId || null,
    assignmentFingerprint:row.assignmentFingerprint || null,
    checkedAt:row.checkedAt,
    coverageUntil:row.coverageUntil,
    promotedAt:row.promotedAt,
    conflicted:row.conflicted,
  })).sort((a, b) => a.workerId.localeCompare(b.workerId));

  if (failures.length > 0) return fail(failures[0], failures, evidence);

  const handoffEvidence = {
    tenantId:scope.tenantId,
    siteId:scope.siteId,
    requestId:scope.requestId,
    agencyId:scope.agencyId,
    acceptedResponseFingerprint:digest(scope.tokenId, 16),
    assignmentFingerprint,
    bindings:evidence.map(({ workerId, assuranceVersionId }) => ({ workerId, assuranceVersionId })),
  };
  return {
    version:AGENCY_SCHEDULE_PREFLIGHT_VERSION,
    readyForScheduleHandoff:true,
    reason:null,
    failures:[],
    requestId:scope.requestId,
    siteId:scope.siteId,
    agencyId:scope.agencyId,
    acceptedResponseFingerprint:handoffEvidence.acceptedResponseFingerprint,
    workerAssuranceBindings:evidence,
    scheduleHandoffFingerprint:digest(JSON.stringify(stable(handoffEvidence)), 32),
    checkedAt:new Date(nowMs).toISOString(),
    authorityBoundary:'schedule_preflight_only_no_schedule_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_preflight_output',
    evidenceRule:'durably_accepted_preferred_worker_binding_and_current_authoritative_assurance_must_still_match_immediately_before_schedule_handoff',
  };
}
