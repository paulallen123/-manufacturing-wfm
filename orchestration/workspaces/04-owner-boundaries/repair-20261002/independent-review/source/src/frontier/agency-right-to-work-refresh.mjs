import crypto from 'node:crypto';
import { evaluateAgencyRightToWork } from './agency-right-to-work.mjs';

export const AGENCY_RIGHT_TO_WORK_REFRESH_VERSION = 'agency-right-to-work-refresh-v0.1.0';
export const AGENCY_RIGHT_TO_WORK_REFRESH_STORE_VERSION = 'agency-right-to-work-refresh-store-v0.1.0';

export const AGENCY_RIGHT_TO_WORK_REFRESH_DDL = `
CREATE TABLE IF NOT EXISTS wfm_agency_right_to_work_refreshes (
  tenant_id text NOT NULL,
  token_id text NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  agency_id text NOT NULL,
  worker_id text NOT NULL,
  assignment_fingerprint varchar(24) NOT NULL,
  token_fingerprint varchar(24) NOT NULL,
  evidence_fingerprint varchar(24) NOT NULL,
  check_method text NOT NULL,
  checked_at timestamptz NOT NULL,
  coverage_until timestamptz,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, token_id)
);
CREATE INDEX IF NOT EXISTS wfm_agency_rtw_refresh_worker_idx
  ON wfm_agency_right_to_work_refreshes (tenant_id, agency_id, worker_id, checked_at DESC);
`;

const INSERT_SQL = `
INSERT INTO wfm_agency_right_to_work_refreshes
  (tenant_id, token_id, site_id, request_id, agency_id, worker_id,
   assignment_fingerprint, token_fingerprint, evidence_fingerprint,
   check_method, checked_at, coverage_until, received_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
ON CONFLICT (tenant_id, token_id) DO NOTHING
RETURNING tenant_id, token_id, received_at;
`;

const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const b64u = value => Buffer.from(value).toString('base64url');
const from64 = value => Buffer.from(value, 'base64url').toString('utf8');
const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const fingerprint = (value, length = 24) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
const equal = (a, b) => {
  try {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
};
const iso = value => {
  const parsed = ms(value);
  return parsed === null ? null : new Date(parsed).toISOString();
};

function assertSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new TypeError('right-to-work refresh signing secret must be at least 32 bytes');
  }
}

function required(value, name, max = 200) {
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function assignmentFingerprint(request = {}) {
  const scope = {
    roleId: required(request.roleId, 'request.roleId', 100),
    location: required(request.location, 'request.location', 200),
    startAt: iso(request.startAt),
    endAt: iso(request.endAt),
  };
  if (!scope.startAt || !scope.endAt || Date.parse(scope.endAt) <= Date.parse(scope.startAt)) {
    throw new TypeError('request assignment window is invalid');
  }
  return fingerprint(JSON.stringify(stable(scope)));
}

export function issueAgencyRightToWorkRefreshToken(input = {}, secret) {
  assertSecret(secret);
  const expiresAt = ms(input.expiresAt);
  if (expiresAt === null) throw new TypeError('expiresAt must be valid');
  const payload = {
    v: 1,
    purpose: 'agency_right_to_work_refresh',
    tenantId: required(input.tenantId, 'tenantId', 100),
    siteId: required(input.siteId, 'siteId', 100),
    requestId: required(input.requestId, 'requestId', 100),
    agencyId: required(input.agencyId, 'agencyId', 100),
    workerId: required(input.workerId, 'workerId', 100),
    tokenId: required(input.tokenId, 'tokenId', 200),
    assignmentFingerprint: assignmentFingerprint(input.request),
    exp: expiresAt,
  };
  const body = b64u(JSON.stringify(stable(payload)));
  return `${body}.${hmac(secret, body)}`;
}

export function verifyAgencyRightToWorkRefreshToken(token, expected = {}, secret, options = {}) {
  assertSecret(secret);
  const fail = reason => ({ valid:false, reason, claims:null, tokenFingerprint:fingerprint(token) });
  if (typeof token !== 'string') return fail('malformed_token');
  const parts = token.split('.');
  if (parts.length !== 2) return fail('malformed_token');
  const [body, signature] = parts;
  if (!equal(signature, hmac(secret, body))) return fail('invalid_signature');
  let claims;
  try { claims = JSON.parse(from64(body)); } catch { return fail('malformed_payload'); }
  if (claims?.v !== 1 || claims?.purpose !== 'agency_right_to_work_refresh') return fail('unsupported_token');
  const now = ms(options.now);
  if (now === null) return fail('invalid_now');
  if (!Number.isFinite(Number(claims.exp)) || now > Number(claims.exp)) return fail('expired_token');
  for (const key of ['tenantId','siteId','requestId','agencyId','workerId']) {
    if (!text(expected[key], 200)) return fail(`expected_scope_missing:${key}`);
    if (claims[key] !== expected[key]) return fail(`scope_mismatch:${key}`);
  }
  let currentAssignmentFingerprint;
  try { currentAssignmentFingerprint = assignmentFingerprint(options.request); }
  catch { return fail('invalid_assignment_scope'); }
  if (claims.assignmentFingerprint !== currentAssignmentFingerprint) return fail('assignment_scope_changed');
  return { valid:true, reason:null, claims, tokenFingerprint:fingerprint(token) };
}

function normalizePositiveVerificationNotice(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    status: text(value.status, 40),
    issuedAt: iso(value.issuedAt),
    validUntil: iso(value.validUntil),
    evidenceRef: text(value.evidenceRef, 200),
  };
}

export function normalizeAgencyRightToWorkRefreshSubmission({ claims, request, submission = {} }) {
  const failures = [];
  if (!claims?.agencyId || !claims?.workerId) failures.push('refresh_scope_missing');
  const checkedAt = iso(submission.checkedAt);
  if (!checkedAt) failures.push('checked_at_invalid');
  const checkMethod = text(submission.checkMethod, 80);
  const evidenceRef = text(submission.evidenceRef, 200);
  if (!evidenceRef) failures.push('evidence_ref_missing');
  const engagementType = text(submission.engagementType, 80);
  if (!engagementType) failures.push('engagement_type_missing');
  const rightToWork = {
    status: text(submission.status, 40),
    indefinite: submission.indefinite === true,
    validUntil: submission.indefinite === true ? null : iso(submission.validUntil),
    engagementType,
    employmentCommencedAt: iso(submission.employmentCommencedAt),
    checkedByAgencyId: claims?.agencyId ?? null,
    checkMethod,
    checkedAt,
    evidenceRef,
    assignmentScope: {
      roleId: text(request?.roleId, 100),
      location: text(request?.location, 200),
      startAt: iso(request?.startAt),
      endAt: iso(request?.endAt),
      restrictionsSatisfied: submission.restrictionsSatisfied === true,
    },
  };
  if (checkMethod === 'employer_checking_service') {
    rightToWork.positiveVerificationNotice = normalizePositiveVerificationNotice(submission.positiveVerificationNotice);
  }
  return { valid:failures.length === 0, failures, rightToWork };
}

export async function captureAgencyRightToWorkRefresh({
  token,
  expected,
  secret,
  now,
  request,
  agency,
  submission,
  currentAssuranceCheckedAt = null,
  refreshStore,
  evaluateRightToWork = evaluateAgencyRightToWork,
}) {
  const verification = verifyAgencyRightToWorkRefreshToken(token, expected, secret, { now, request });
  if (!verification.valid) return rejected(verification.reason, verification, null, null, now);

  const normalized = normalizeAgencyRightToWorkRefreshSubmission({ claims:verification.claims, request, submission });
  if (!normalized.valid) return rejected('invalid_submission', verification, normalized, null, now);

  const candidateCheckedAt = ms(normalized.rightToWork.checkedAt);
  const currentCheckedAt = ms(currentAssuranceCheckedAt);
  if (currentAssuranceCheckedAt !== null && (candidateCheckedAt === null || currentCheckedAt === null || candidateCheckedAt <= currentCheckedAt)) {
    return rejected('stale_right_to_work_assurance', verification, normalized, null, now);
  }

  let assurance;
  try {
    assurance = evaluateRightToWork(
      { workerId:verification.claims.workerId, agencyId:verification.claims.agencyId, rightToWork:normalized.rightToWork },
      request,
      agency,
      { now },
    );
  } catch {
    return rejected('right_to_work_revalidation_failed', verification, normalized, null, now);
  }

  if (assurance?.eligible !== true) {
    return rejected('right_to_work_assurance_not_eligible', verification, normalized, assurance ?? null, now);
  }

  if (!refreshStore || typeof refreshStore.recordOnce !== 'function') {
    return rejected('refresh_store_unavailable', verification, normalized, assurance, now);
  }

  const record = {
    tenantId: verification.claims.tenantId,
    tokenId: verification.claims.tokenId,
    siteId: verification.claims.siteId,
    requestId: verification.claims.requestId,
    agencyId: verification.claims.agencyId,
    workerId: verification.claims.workerId,
    assignmentFingerprint: verification.claims.assignmentFingerprint,
    tokenFingerprint: verification.tokenFingerprint,
    evidenceFingerprint: assurance?.evidence?.evidenceFingerprint ?? fingerprint(normalized.rightToWork.evidenceRef),
    checkMethod: normalized.rightToWork.checkMethod,
    checkedAt: normalized.rightToWork.checkedAt,
    coverageUntil: assurance?.evidence?.lifecycle?.effectiveCoverageUntil ?? null,
    receivedAt: iso(now),
  };

  let storage;
  try { storage = await refreshStore.recordOnce(record); }
  catch { return rejected('refresh_store_unavailable', verification, normalized, assurance, now); }

  if (storage?.recorded !== true) {
    return rejected(storage?.reason === 'already_recorded' ? 'refresh_token_already_used' : 'refresh_store_rejected', verification, normalized, assurance, now, storage ?? null);
  }

  return {
    accepted: true,
    reason: null,
    assurance,
    receipt: refreshReceipt({ verification, normalized, assurance, storage, receivedAt:now }),
    authorityBoundary: 'right_to_work_evidence_capture_and_revalidation_only_no_worker_record_schedule_payroll_or_invoice_mutation',
  };
}

function rejected(reason, verification, normalized, assurance, receivedAt, storage = null) {
  return {
    accepted:false,
    reason,
    assurance,
    receipt:refreshReceipt({ verification, normalized, assurance, storage, receivedAt }),
    authorityBoundary:'right_to_work_evidence_capture_and_revalidation_only_no_worker_record_schedule_payroll_or_invoice_mutation',
  };
}

export function refreshReceipt({ verification, normalized, assurance, storage, receivedAt }) {
  return {
    version: AGENCY_RIGHT_TO_WORK_REFRESH_VERSION,
    receivedAt: iso(receivedAt),
    tokenFingerprint: verification?.tokenFingerprint ?? null,
    tokenId: verification?.claims?.tokenId ?? null,
    tenantId: verification?.claims?.tenantId ?? null,
    siteId: verification?.claims?.siteId ?? null,
    requestId: verification?.claims?.requestId ?? null,
    agencyId: verification?.claims?.agencyId ?? null,
    workerId: verification?.claims?.workerId ?? null,
    assignmentFingerprint: verification?.claims?.assignmentFingerprint ?? null,
    checkMethod: normalized?.rightToWork?.checkMethod ?? null,
    checkedAt: normalized?.rightToWork?.checkedAt ?? null,
    evidenceFingerprint: assurance?.evidence?.evidenceFingerprint ?? null,
    eligibleAfterRefresh: assurance?.eligible === true,
    refreshRecorded: storage?.recorded === true,
    rawEvidenceStoredInReceipt: false,
    privacyBoundary: 'no_share_code_date_of_birth_document_number_raw_evidence_reference_or_positive_verification_notice_reference_in_receipt',
  };
}

export function createPostgresAgencyRightToWorkRefreshStore({ query }) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version: AGENCY_RIGHT_TO_WORK_REFRESH_STORE_VERSION,
    async recordOnce(record = {}) {
      const values = [
        required(record.tenantId, 'tenantId', 100),
        required(record.tokenId, 'tokenId', 200),
        required(record.siteId, 'siteId', 100),
        required(record.requestId, 'requestId', 100),
        required(record.agencyId, 'agencyId', 100),
        required(record.workerId, 'workerId', 100),
        required(record.assignmentFingerprint, 'assignmentFingerprint', 24),
        required(record.tokenFingerprint, 'tokenFingerprint', 24),
        required(record.evidenceFingerprint, 'evidenceFingerprint', 24),
        required(record.checkMethod, 'checkMethod', 80),
        iso(record.checkedAt),
        record.coverageUntil == null ? null : iso(record.coverageUntil),
        iso(record.receivedAt),
      ];
      if (!values[10] || !values[12]) throw new TypeError('checkedAt and receivedAt must be valid timestamps');
      if (record.coverageUntil != null && !values[11]) throw new TypeError('coverageUntil must be a valid timestamp');
      const result = await query(INSERT_SQL, values);
      const rowCount = Number(result?.rowCount ?? (Array.isArray(result?.rows) ? result.rows.length : 0));
      if (rowCount === 1) return { recorded:true, reason:null, tokenId:values[1], receivedAt:values[12] };
      if (rowCount === 0) return { recorded:false, reason:'already_recorded', tokenId:values[1], receivedAt:null };
      throw new Error('unexpected_right_to_work_refresh_store_result');
    },
  });
}
