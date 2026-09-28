import crypto from 'node:crypto';
import { evaluateAgencyRightToWork } from './agency-right-to-work.mjs';

export const AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_VERSION = 'agency-right-to-work-dvsp-provider-evidence-v0.1.0';
export const AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_STORE_VERSION = 'agency-right-to-work-dvsp-provider-evidence-store-v0.1.0';

export const AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL = `
CREATE TABLE IF NOT EXISTS wfm_agency_rtw_dvsp_provider_evidence (
  tenant_id text NOT NULL,
  agency_id text NOT NULL,
  provider_id text NOT NULL,
  evidence_version_id varchar(32) NOT NULL,
  registry_status text NOT NULL,
  trust_framework_certified boolean NOT NULL,
  right_to_work_supplementary_code_certified boolean NOT NULL,
  right_to_work_supplementary_code_version text NOT NULL,
  exclusive_for_agency_right_to_work boolean NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  registry_verified_at timestamptz NOT NULL,
  registry_evidence_fingerprint varchar(24) NOT NULL,
  evidence_source text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, agency_id, provider_id, evidence_version_id),
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);
CREATE INDEX IF NOT EXISTS wfm_agency_rtw_dvsp_provider_evidence_lookup_idx
  ON wfm_agency_rtw_dvsp_provider_evidence
    (tenant_id, agency_id, provider_id, registry_verified_at DESC, effective_at DESC);
`;

const INSERT_SQL = `
INSERT INTO wfm_agency_rtw_dvsp_provider_evidence
  (tenant_id, agency_id, provider_id, evidence_version_id, registry_status,
   trust_framework_certified, right_to_work_supplementary_code_certified,
   right_to_work_supplementary_code_version, exclusive_for_agency_right_to_work,
   effective_at, expires_at, registry_verified_at, registry_evidence_fingerprint,
   evidence_source, recorded_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (tenant_id, agency_id, provider_id, evidence_version_id) DO NOTHING
RETURNING tenant_id, agency_id, provider_id, evidence_version_id, recorded_at;
`;

const RESOLVE_SQL = `
SELECT tenant_id, agency_id, provider_id, evidence_version_id, registry_status,
       trust_framework_certified, right_to_work_supplementary_code_certified,
       right_to_work_supplementary_code_version, exclusive_for_agency_right_to_work,
       effective_at, expires_at, registry_verified_at, registry_evidence_fingerprint,
       evidence_source, recorded_at
FROM wfm_agency_rtw_dvsp_provider_evidence
WHERE tenant_id = $1
  AND agency_id = $2
  AND provider_id = $3
  AND effective_at <= $4::timestamptz
  AND registry_verified_at <= $4::timestamptz
  AND (expires_at IS NULL OR expires_at > $4::timestamptz)
ORDER BY registry_verified_at DESC, effective_at DESC, recorded_at DESC, evidence_version_id ASC
LIMIT 2;
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
const hash = (value, length) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
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

function bool(value, name) {
  if (value !== true && value !== false) throw new TypeError(`${name} must be boolean`);
  return value;
}

function normalizeStoredRow(row = {}) {
  return {
    version: AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_VERSION,
    tenantId: row.tenant_id ?? row.tenantId ?? null,
    agencyId: row.agency_id ?? row.agencyId ?? null,
    providerId: row.provider_id ?? row.providerId ?? null,
    evidenceVersionId: row.evidence_version_id ?? row.evidenceVersionId ?? null,
    registryStatus: row.registry_status ?? row.registryStatus ?? null,
    trustFrameworkCertified: row.trust_framework_certified ?? row.trustFrameworkCertified === true,
    rightToWorkSupplementaryCodeCertified: row.right_to_work_supplementary_code_certified ?? row.rightToWorkSupplementaryCodeCertified === true,
    rightToWorkSupplementaryCodeVersion: row.right_to_work_supplementary_code_version ?? row.rightToWorkSupplementaryCodeVersion ?? null,
    exclusiveForAgencyRightToWork: row.exclusive_for_agency_right_to_work ?? row.exclusiveForAgencyRightToWork === true,
    effectiveAt: iso(row.effective_at ?? row.effectiveAt),
    expiresAt: (row.expires_at ?? row.expiresAt) == null ? null : iso(row.expires_at ?? row.expiresAt),
    registryVerifiedAt: iso(row.registry_verified_at ?? row.registryVerifiedAt),
    registryEvidenceFingerprint: row.registry_evidence_fingerprint ?? row.registryEvidenceFingerprint ?? null,
    evidenceSource: row.evidence_source ?? row.evidenceSource ?? null,
    recordedAt: iso(row.recorded_at ?? row.recordedAt),
  };
}

export function createAgencyRightToWorkDvspEvidenceVersion(input = {}) {
  const tenantId = required(input.tenantId, 'tenantId', 100);
  const agencyId = required(input.agencyId, 'agencyId', 100);
  const providerId = required(input.providerId, 'providerId', 120);
  const registryStatus = required(input.registryStatus, 'registryStatus', 40);
  const rightToWorkSupplementaryCodeVersion = required(input.rightToWorkSupplementaryCodeVersion, 'rightToWorkSupplementaryCodeVersion', 20);
  const registryEvidenceRef = required(input.registryEvidenceRef, 'registryEvidenceRef', 500);
  const evidenceSource = required(input.evidenceSource, 'evidenceSource', 120);
  const effectiveAt = iso(input.effectiveAt);
  const expiresAt = input.expiresAt == null ? null : iso(input.expiresAt);
  const registryVerifiedAt = iso(input.registryVerifiedAt);
  const recordedAt = iso(input.recordedAt);
  if (!effectiveAt) throw new TypeError('effectiveAt must be a valid timestamp');
  if (input.expiresAt != null && !expiresAt) throw new TypeError('expiresAt must be a valid timestamp');
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveAt)) throw new TypeError('expiresAt must be after effectiveAt');
  if (!registryVerifiedAt) throw new TypeError('registryVerifiedAt must be a valid timestamp');
  if (!recordedAt) throw new TypeError('recordedAt must be a valid timestamp');
  if (Date.parse(registryVerifiedAt) > Date.parse(recordedAt)) throw new TypeError('registryVerifiedAt cannot be after recordedAt');

  const record = {
    version: AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_VERSION,
    tenantId,
    agencyId,
    providerId,
    registryStatus,
    trustFrameworkCertified: bool(input.trustFrameworkCertified, 'trustFrameworkCertified'),
    rightToWorkSupplementaryCodeCertified: bool(input.rightToWorkSupplementaryCodeCertified, 'rightToWorkSupplementaryCodeCertified'),
    rightToWorkSupplementaryCodeVersion,
    exclusiveForAgencyRightToWork: bool(input.exclusiveForAgencyRightToWork, 'exclusiveForAgencyRightToWork'),
    effectiveAt,
    expiresAt,
    registryVerifiedAt,
    registryEvidenceFingerprint: hash(registryEvidenceRef, 24),
    evidenceSource,
    recordedAt,
  };
  record.evidenceVersionId = hash(JSON.stringify(stable({
    ...record,
    version: undefined,
    recordedAt: undefined,
  })), 32);
  return Object.freeze(record);
}

export function toAgencyRightToWorkDvspPolicySnapshot(record = {}) {
  const normalized = normalizeStoredRow(record);
  for (const [name, value] of Object.entries({
    tenantId: normalized.tenantId,
    agencyId: normalized.agencyId,
    providerId: normalized.providerId,
    evidenceVersionId: normalized.evidenceVersionId,
    registryEvidenceFingerprint: normalized.registryEvidenceFingerprint,
    effectiveAt: normalized.effectiveAt,
    registryVerifiedAt: normalized.registryVerifiedAt,
  })) {
    if (!text(value, 300)) throw new TypeError(`${name} is required on DVS provider evidence`);
  }
  if (!/^[0-9a-f]{24}$/i.test(normalized.registryEvidenceFingerprint)) throw new TypeError('registryEvidenceFingerprint must be a 24-character hex fingerprint');
  return Object.freeze({
    providerId: normalized.providerId,
    registryStatus: normalized.registryStatus,
    trustFrameworkCertified: normalized.trustFrameworkCertified === true,
    rightToWorkSupplementaryCodeCertified: normalized.rightToWorkSupplementaryCodeCertified === true,
    rightToWorkSupplementaryCodeVersion: normalized.rightToWorkSupplementaryCodeVersion,
    exclusiveForAgencyRightToWork: normalized.exclusiveForAgencyRightToWork === true,
    registryVerifiedAt: normalized.registryVerifiedAt,
    registryEvidenceFingerprint: normalized.registryEvidenceFingerprint,
    evidenceVersionId: normalized.evidenceVersionId,
    evidenceTenantId: normalized.tenantId,
    evidenceAgencyId: normalized.agencyId,
    evidenceEffectiveAt: normalized.effectiveAt,
    evidenceExpiresAt: normalized.expiresAt,
    evidenceSource: normalized.evidenceSource,
  });
}

export function createPostgresAgencyRightToWorkDvspEvidenceStore({ query }) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version: AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_STORE_VERSION,
    async recordOnce(record = {}) {
      const normalized = normalizeStoredRow(record);
      const values = [
        required(normalized.tenantId, 'tenantId', 100),
        required(normalized.agencyId, 'agencyId', 100),
        required(normalized.providerId, 'providerId', 120),
        required(normalized.evidenceVersionId, 'evidenceVersionId', 32),
        required(normalized.registryStatus, 'registryStatus', 40),
        normalized.trustFrameworkCertified === true,
        normalized.rightToWorkSupplementaryCodeCertified === true,
        required(normalized.rightToWorkSupplementaryCodeVersion, 'rightToWorkSupplementaryCodeVersion', 20),
        normalized.exclusiveForAgencyRightToWork === true,
        normalized.effectiveAt,
        normalized.expiresAt,
        normalized.registryVerifiedAt,
        required(normalized.registryEvidenceFingerprint, 'registryEvidenceFingerprint', 24),
        required(normalized.evidenceSource, 'evidenceSource', 120),
        normalized.recordedAt,
      ];
      if (!values[9] || !values[11] || !values[14]) throw new TypeError('effectiveAt, registryVerifiedAt and recordedAt must be valid timestamps');
      if (!/^[0-9a-f]{24}$/i.test(values[12])) throw new TypeError('registryEvidenceFingerprint must be a 24-character hex fingerprint');
      const result = await query(INSERT_SQL, values);
      const rowCount = Number(result?.rowCount ?? (Array.isArray(result?.rows) ? result.rows.length : 0));
      if (rowCount === 1) return { recorded:true, reason:null, evidenceVersionId:values[3] };
      if (rowCount === 0) return { recorded:false, reason:'already_recorded', evidenceVersionId:values[3] };
      throw new Error('unexpected_dvsp_provider_evidence_store_result');
    },
    async resolveForCheck({ tenantId, agencyId, providerId, checkedAt } = {}) {
      const at = iso(checkedAt);
      if (!at) return { found:false, reason:'invalid_check_time', evidence:null };
      const result = await query(RESOLVE_SQL, [
        required(tenantId, 'tenantId', 100),
        required(agencyId, 'agencyId', 100),
        required(providerId, 'providerId', 120),
        at,
      ]);
      const rows = Array.isArray(result?.rows) ? result.rows.map(normalizeStoredRow) : [];
      if (rows.length === 0) return { found:false, reason:'no_provider_evidence_for_check', evidence:null };
      if (rows.length > 1) {
        const [a, b] = rows;
        if (a.registryVerifiedAt === b.registryVerifiedAt && a.effectiveAt === b.effectiveAt && a.evidenceVersionId !== b.evidenceVersionId) {
          return { found:false, reason:'ambiguous_provider_evidence_for_check', evidence:null };
        }
      }
      return { found:true, reason:null, evidence:rows[0] };
    },
  });
}

export async function resolveAgencyRightToWorkDvspEvidenceForCheck({
  tenantId,
  worker,
  agency,
  checkedAt,
  evidenceStore,
} = {}) {
  const agencyId = required(agency?.agencyId, 'agency.agencyId', 100);
  const workerAgencyId = required(worker?.agencyId, 'worker.agencyId', 100);
  const providerId = required(worker?.rightToWork?.dvspProviderId, 'worker.rightToWork.dvspProviderId', 120);
  if (workerAgencyId !== agencyId) return { found:false, reason:'agency_scope_mismatch', policySnapshot:null, evidence:null };
  if (!evidenceStore || typeof evidenceStore.resolveForCheck !== 'function') {
    return { found:false, reason:'dvsp_evidence_store_unavailable', policySnapshot:null, evidence:null };
  }
  let resolved;
  try {
    resolved = await evidenceStore.resolveForCheck({ tenantId, agencyId, providerId, checkedAt });
  } catch {
    return { found:false, reason:'dvsp_evidence_store_unavailable', policySnapshot:null, evidence:null };
  }
  if (resolved?.found !== true || !resolved.evidence) {
    return { found:false, reason:resolved?.reason || 'dvsp_evidence_not_resolved', policySnapshot:null, evidence:null };
  }
  const evidence = normalizeStoredRow(resolved.evidence);
  if (evidence.tenantId !== tenantId || evidence.agencyId !== agencyId || evidence.providerId !== providerId) {
    return { found:false, reason:'dvsp_evidence_scope_mismatch', policySnapshot:null, evidence:null };
  }
  const checkMs = ms(checkedAt);
  if (checkMs === null || ms(evidence.effectiveAt) === null || ms(evidence.effectiveAt) > checkMs) {
    return { found:false, reason:'dvsp_evidence_not_effective_at_check', policySnapshot:null, evidence:null };
  }
  if (ms(evidence.registryVerifiedAt) === null || ms(evidence.registryVerifiedAt) > checkMs) {
    return { found:false, reason:'dvsp_registry_evidence_after_worker_check', policySnapshot:null, evidence:null };
  }
  if (evidence.expiresAt && (ms(evidence.expiresAt) === null || ms(evidence.expiresAt) <= checkMs)) {
    return { found:false, reason:'dvsp_evidence_expired_at_check', policySnapshot:null, evidence:null };
  }
  return {
    found:true,
    reason:null,
    evidence,
    policySnapshot:toAgencyRightToWorkDvspPolicySnapshot(evidence),
  };
}

export async function evaluateAgencyRightToWorkWithDvspEvidence({
  tenantId,
  worker,
  request,
  agency,
  now,
  evidenceStore,
  evaluateRightToWork = evaluateAgencyRightToWork,
} = {}) {
  if (typeof evaluateRightToWork !== 'function') throw new TypeError('evaluateRightToWork must be a function');
  if (worker?.rightToWork?.checkMethod !== 'rtw_dvsp') {
    return evaluateRightToWork(worker, request, agency, { now });
  }

  const resolved = await resolveAgencyRightToWorkDvspEvidenceForCheck({
    tenantId,
    worker,
    agency,
    checkedAt:worker?.rightToWork?.checkedAt,
    evidenceStore,
  });

  if (!resolved.found) {
    let base;
    try {
      base = evaluateRightToWork(worker, request, {
        ...agency,
        rightToWorkScheme:{ ...(agency?.rightToWorkScheme || {}), rtwDvsp:{} },
      }, { now });
    } catch {
      base = { eligible:false, failures:[], warnings:[], evidence:{} };
    }
    return {
      ...base,
      eligible:false,
      failures:[
        `right_to_work_dvsp_versioned_provider_evidence_unavailable:${resolved.reason}`,
        ...(Array.isArray(base?.failures) ? base.failures : []),
      ],
      evidence:{
        ...(base?.evidence || {}),
        digitalVerificationService:{
          providerId:worker?.rightToWork?.dvspProviderId ?? null,
          providerEvidenceVersionId:null,
          providerEvidenceResolved:false,
          providerEvidenceReason:resolved.reason,
          rawRegistryEvidenceReturned:false,
        },
      },
    };
  }

  const snapshot = resolved.policySnapshot;
  const agencyWithEvidence = {
    ...agency,
    rightToWorkScheme:{
      ...(agency?.rightToWorkScheme || {}),
      rtwDvsp:{
        ...snapshot,
        // The legacy evaluator needs a non-empty evidence reference to fingerprint.
        // Feed it only the already-one-way registry fingerprint, never the raw register record/reference.
        registryEvidenceRef:`fingerprint:${snapshot.registryEvidenceFingerprint}`,
      },
    },
  };
  const result = evaluateRightToWork(worker, request, agencyWithEvidence, { now });
  return {
    ...result,
    evidence:{
      ...(result?.evidence || {}),
      digitalVerificationService:{
        ...(result?.evidence?.digitalVerificationService || {}),
        providerEvidenceVersionId:resolved.evidence.evidenceVersionId,
        providerEvidenceResolved:true,
        providerEvidenceEffectiveAt:resolved.evidence.effectiveAt,
        providerEvidenceExpiresAt:resolved.evidence.expiresAt,
        providerEvidenceRegistryFingerprint:resolved.evidence.registryEvidenceFingerprint,
        providerEvidenceStoreVersion:AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_STORE_VERSION,
        rawRegistryEvidenceReturned:false,
      },
    },
  };
}
