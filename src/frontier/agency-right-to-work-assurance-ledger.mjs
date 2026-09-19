import crypto from 'node:crypto';
import { evaluateAgencyRightToWork } from './agency-right-to-work.mjs';

export const AGENCY_RIGHT_TO_WORK_ASSURANCE_LEDGER_VERSION = 'agency-right-to-work-assurance-ledger-v0.1.0';
export const AGENCY_RIGHT_TO_WORK_ASSURANCE_STORE_VERSION = 'agency-right-to-work-assurance-store-v0.1.1';

export const AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL = `
CREATE TABLE IF NOT EXISTS wfm_agency_rtw_assurance_history (
  tenant_id text NOT NULL,
  agency_id text NOT NULL,
  worker_id text NOT NULL,
  assurance_version_id varchar(32) NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  assignment_fingerprint varchar(24) NOT NULL,
  evidence_fingerprint varchar(24) NOT NULL,
  check_method text NOT NULL,
  checked_at timestamptz NOT NULL,
  coverage_until timestamptz,
  promoted_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, agency_id, worker_id, assurance_version_id)
);
CREATE INDEX IF NOT EXISTS wfm_agency_rtw_assurance_history_checked_idx
  ON wfm_agency_rtw_assurance_history (tenant_id, agency_id, worker_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS wfm_agency_rtw_assurance_current (
  tenant_id text NOT NULL,
  agency_id text NOT NULL,
  worker_id text NOT NULL,
  assurance_version_id varchar(32) NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  assignment_fingerprint varchar(24) NOT NULL,
  evidence_fingerprint varchar(24) NOT NULL,
  check_method text NOT NULL,
  checked_at timestamptz NOT NULL,
  coverage_until timestamptz,
  promoted_at timestamptz NOT NULL,
  conflicted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, agency_id, worker_id)
);
`;

const PROMOTE_SQL = `
WITH candidate (
  tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
  assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
  coverage_until, promoted_at
) AS (
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz)
), history_insert AS (
  INSERT INTO wfm_agency_rtw_assurance_history
    (tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
     assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
     coverage_until, promoted_at)
  SELECT * FROM candidate
  ON CONFLICT (tenant_id, agency_id, worker_id, assurance_version_id) DO NOTHING
), current_upsert AS (
  INSERT INTO wfm_agency_rtw_assurance_current
    (tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
     assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
     coverage_until, promoted_at, conflicted)
  SELECT tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
         assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
         coverage_until, promoted_at, false
  FROM candidate
  ON CONFLICT (tenant_id, agency_id, worker_id) DO UPDATE SET
    assurance_version_id = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.assurance_version_id
      ELSE wfm_agency_rtw_assurance_current.assurance_version_id
    END,
    site_id = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.site_id
      ELSE wfm_agency_rtw_assurance_current.site_id
    END,
    request_id = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.request_id
      ELSE wfm_agency_rtw_assurance_current.request_id
    END,
    assignment_fingerprint = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.assignment_fingerprint
      ELSE wfm_agency_rtw_assurance_current.assignment_fingerprint
    END,
    evidence_fingerprint = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.evidence_fingerprint
      ELSE wfm_agency_rtw_assurance_current.evidence_fingerprint
    END,
    check_method = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.check_method
      ELSE wfm_agency_rtw_assurance_current.check_method
    END,
    checked_at = GREATEST(EXCLUDED.checked_at, wfm_agency_rtw_assurance_current.checked_at),
    coverage_until = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.coverage_until
      ELSE wfm_agency_rtw_assurance_current.coverage_until
    END,
    promoted_at = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN EXCLUDED.promoted_at
      ELSE wfm_agency_rtw_assurance_current.promoted_at
    END,
    conflicted = CASE
      WHEN EXCLUDED.checked_at > wfm_agency_rtw_assurance_current.checked_at THEN false
      WHEN EXCLUDED.checked_at = wfm_agency_rtw_assurance_current.checked_at
        AND EXCLUDED.assurance_version_id <> wfm_agency_rtw_assurance_current.assurance_version_id THEN true
      ELSE wfm_agency_rtw_assurance_current.conflicted
    END
  WHERE EXCLUDED.checked_at >= wfm_agency_rtw_assurance_current.checked_at
  RETURNING tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
            assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
            coverage_until, promoted_at, conflicted
), current_existing AS (
  SELECT current.tenant_id, current.agency_id, current.worker_id,
         current.assurance_version_id, current.site_id, current.request_id,
         current.assignment_fingerprint, current.evidence_fingerprint,
         current.check_method, current.checked_at, current.coverage_until,
         current.promoted_at, current.conflicted
  FROM wfm_agency_rtw_assurance_current AS current
  JOIN candidate AS c
    ON c.tenant_id = current.tenant_id
   AND c.agency_id = current.agency_id
   AND c.worker_id = current.worker_id
  WHERE NOT EXISTS (SELECT 1 FROM current_upsert)
)
SELECT * FROM current_upsert
UNION ALL
SELECT * FROM current_existing
LIMIT 1;
`;

const SELECT_CURRENT_SQL = `
SELECT tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
       assignment_fingerprint, evidence_fingerprint, check_method, checked_at,
       coverage_until, promoted_at, conflicted
FROM wfm_agency_rtw_assurance_current
WHERE tenant_id = $1 AND agency_id = $2 AND worker_id = $3
LIMIT 1;
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
const fingerprint = (value, length = 24) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;

function required(value, name, max = 200) {
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function bool(value) {
  return value === true || value === 't' || value === 'true';
}

function assuranceVersionId(record) {
  const identity = {
    tenantId:record.tenantId,
    agencyId:record.agencyId,
    workerId:record.workerId,
    assignmentFingerprint:record.assignmentFingerprint,
    evidenceFingerprint:record.evidenceFingerprint,
    checkMethod:record.checkMethod,
    checkedAt:record.checkedAt,
    coverageUntil:record.coverageUntil,
  };
  return fingerprint(JSON.stringify(stable(identity)), 32);
}

function safeCurrent(row) {
  if (!row) return null;
  return {
    tenantId:row.tenant_id ?? row.tenantId ?? null,
    agencyId:row.agency_id ?? row.agencyId ?? null,
    workerId:row.worker_id ?? row.workerId ?? null,
    assuranceVersionId:row.assurance_version_id ?? row.assuranceVersionId ?? null,
    siteId:row.site_id ?? row.siteId ?? null,
    requestId:row.request_id ?? row.requestId ?? null,
    assignmentFingerprint:row.assignment_fingerprint ?? row.assignmentFingerprint ?? null,
    evidenceFingerprint:row.evidence_fingerprint ?? row.evidenceFingerprint ?? null,
    checkMethod:row.check_method ?? row.checkMethod ?? null,
    checkedAt:iso(row.checked_at ?? row.checkedAt),
    coverageUntil:(row.coverage_until ?? row.coverageUntil) == null ? null : iso(row.coverage_until ?? row.coverageUntil),
    promotedAt:iso(row.promoted_at ?? row.promotedAt),
    conflicted:bool(row.conflicted),
  };
}

export function createAgencyRightToWorkAssuranceVersion({
  acceptedRefresh,
  rightToWork,
  request,
  agency,
  now,
  evaluateRightToWork = evaluateAgencyRightToWork,
}) {
  const receipt = acceptedRefresh?.receipt && typeof acceptedRefresh.receipt === 'object' ? acceptedRefresh.receipt : {};
  if (acceptedRefresh?.accepted !== true || receipt.refreshRecorded !== true || receipt.eligibleAfterRefresh !== true) {
    return { valid:false, reason:'refresh_not_accepted_and_recorded', version:null, assurance:null };
  }
  if (!rightToWork || typeof rightToWork !== 'object') {
    return { valid:false, reason:'right_to_work_candidate_missing', version:null, assurance:null };
  }
  if (text(rightToWork.checkedByAgencyId, 100) !== text(receipt.agencyId, 100)) {
    return { valid:false, reason:'candidate_agency_scope_mismatch', version:null, assurance:null };
  }
  let assurance;
  try {
    assurance = evaluateRightToWork(
      { workerId:receipt.workerId, agencyId:receipt.agencyId, rightToWork },
      request,
      agency,
      { now },
    );
  } catch {
    return { valid:false, reason:'right_to_work_revalidation_failed', version:null, assurance:null };
  }
  if (assurance?.eligible !== true) {
    return { valid:false, reason:'right_to_work_assurance_not_eligible', version:null, assurance:assurance ?? null };
  }

  const evidenceFingerprint = text(assurance?.evidence?.evidenceFingerprint, 24);
  const checkedAt = iso(assurance?.evidence?.checkedAt ?? rightToWork.checkedAt);
  const checkMethod = text(assurance?.evidence?.checkMethod ?? rightToWork.checkMethod, 80);
  const coverageUntil = assurance?.evidence?.lifecycle?.effectiveCoverageUntil == null
    ? null
    : iso(assurance.evidence.lifecycle.effectiveCoverageUntil);

  if (!/^[0-9a-f]{24}$/i.test(evidenceFingerprint)) {
    return { valid:false, reason:'assurance_evidence_fingerprint_missing', version:null, assurance };
  }
  if (receipt.evidenceFingerprint !== evidenceFingerprint) {
    return { valid:false, reason:'refresh_evidence_fingerprint_mismatch', version:null, assurance };
  }
  if (iso(receipt.checkedAt) !== checkedAt) {
    return { valid:false, reason:'refresh_checked_at_mismatch', version:null, assurance };
  }
  if (text(receipt.checkMethod, 80) !== checkMethod) {
    return { valid:false, reason:'refresh_check_method_mismatch', version:null, assurance };
  }

  const promotedAt = iso(now);
  const assignmentFingerprint = text(receipt.assignmentFingerprint, 24);
  if (!promotedAt || !/^[0-9a-f]{24}$/i.test(assignmentFingerprint)) {
    return { valid:false, reason:'refresh_scope_invalid', version:null, assurance };
  }

  const version = {
    version:AGENCY_RIGHT_TO_WORK_ASSURANCE_LEDGER_VERSION,
    tenantId:required(receipt.tenantId, 'tenantId', 100),
    siteId:required(receipt.siteId, 'siteId', 100),
    requestId:required(receipt.requestId, 'requestId', 100),
    agencyId:required(receipt.agencyId, 'agencyId', 100),
    workerId:required(receipt.workerId, 'workerId', 100),
    assignmentFingerprint,
    evidenceFingerprint,
    checkMethod,
    checkedAt,
    coverageUntil,
    promotedAt,
  };
  version.assuranceVersionId = assuranceVersionId(version);
  return { valid:true, reason:null, version:Object.freeze(version), assurance };
}

export async function promoteAgencyRightToWorkRefreshAssurance({
  acceptedRefresh,
  rightToWork,
  request,
  agency,
  now,
  assuranceStore,
  evaluateRightToWork = evaluateAgencyRightToWork,
}) {
  const built = createAgencyRightToWorkAssuranceVersion({
    acceptedRefresh, rightToWork, request, agency, now, evaluateRightToWork,
  });
  const reject = reason => ({
    authoritative:false,
    promotedToCurrent:false,
    reason,
    version:built.version,
    current:null,
    assurance:built.assurance,
    authorityBoundary:'right_to_work_assurance_ledger_only_no_worker_master_schedule_payroll_or_invoice_mutation',
  });
  if (!built.valid) return reject(built.reason);
  if (!assuranceStore || typeof assuranceStore.promote !== 'function') return reject('assurance_store_unavailable');

  let storage;
  try { storage = await assuranceStore.promote(built.version); }
  catch { return reject('assurance_store_unavailable'); }
  const current = storage?.current ? safeCurrent(storage.current) : null;
  if (!current) return reject('assurance_store_rejected');
  if (current.conflicted) {
    return {
      authoritative:false,
      promotedToCurrent:false,
      reason:'ambiguous_same_check_time',
      version:built.version,
      current,
      assurance:built.assurance,
      authorityBoundary:'right_to_work_assurance_ledger_only_no_worker_master_schedule_payroll_or_invoice_mutation',
    };
  }
  const isCurrent = current.assuranceVersionId === built.version.assuranceVersionId;
  return {
    authoritative:isCurrent,
    promotedToCurrent:isCurrent,
    reason:isCurrent ? null : 'newer_assurance_already_current',
    version:built.version,
    current,
    assurance:built.assurance,
    authorityBoundary:'right_to_work_assurance_ledger_only_no_worker_master_schedule_payroll_or_invoice_mutation',
  };
}

export function createPostgresAgencyRightToWorkAssuranceStore({ query }) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_RIGHT_TO_WORK_ASSURANCE_STORE_VERSION,
    async promote(record = {}) {
      const checkedAt = iso(record.checkedAt);
      const promotedAt = iso(record.promotedAt);
      const coverageUntil = record.coverageUntil == null ? null : iso(record.coverageUntil);
      if (!checkedAt || !promotedAt || (record.coverageUntil != null && !coverageUntil)) {
        throw new TypeError('assurance timestamps must be valid');
      }
      const values = [
        required(record.tenantId, 'tenantId', 100),
        required(record.agencyId, 'agencyId', 100),
        required(record.workerId, 'workerId', 100),
        required(record.assuranceVersionId, 'assuranceVersionId', 32),
        required(record.siteId, 'siteId', 100),
        required(record.requestId, 'requestId', 100),
        required(record.assignmentFingerprint, 'assignmentFingerprint', 24),
        required(record.evidenceFingerprint, 'evidenceFingerprint', 24),
        required(record.checkMethod, 'checkMethod', 80),
        checkedAt,
        coverageUntil,
        promotedAt,
      ];
      const result = await query(PROMOTE_SQL, values);
      let rows = Array.isArray(result?.rows) ? result.rows : [];
      if (rows.length === 0) {
        const fresh = await query(SELECT_CURRENT_SQL, values.slice(0, 3));
        rows = Array.isArray(fresh?.rows) ? fresh.rows : [];
      }
      if (rows.length !== 1) throw new Error('unexpected_right_to_work_assurance_store_result');
      return { current:safeCurrent(rows[0]) };
    },
  });
}
