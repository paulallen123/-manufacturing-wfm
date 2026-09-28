import crypto from 'node:crypto';
import { buildAgencyRequestPack, planAgencyLabourFulfilment } from './agency-labour-exchange.mjs';
import { evaluateAgencyRightToWork } from './agency-right-to-work.mjs';

export const AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION = 'agency-right-to-work-authoritative-planner-v0.1.0';
export const AGENCY_RIGHT_TO_WORK_ASSURANCE_READER_VERSION = 'agency-right-to-work-assurance-reader-v0.1.0';

const GET_CURRENT_SQL = `
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
const bool = value => value === true || value === 't' || value === 'true';
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const digest = (value, length = 24) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function required(value, name, max = 200) {
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function safeCurrent(row) {
  if (!row || typeof row !== 'object') return null;
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

export function agencyRightToWorkAssignmentFingerprint(request = {}) {
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

export function evaluateAuthoritativeAgencyRightToWorkAssurance({
  current,
  tenantId,
  siteId,
  request,
  worker,
  agency,
  now,
  evaluateRightToWork = evaluateAgencyRightToWork,
}) {
  const failures = [];
  let rightToWorkEligibility;
  try {
    rightToWorkEligibility = evaluateRightToWork(worker, request, agency, {
      now,
      requireVersionedDvspEvidence:true,
      tenantId,
    });
  } catch {
    rightToWorkEligibility = { eligible:false, failures:['right_to_work_revalidation_failed'], warnings:[], evidence:null };
  }
  if (rightToWorkEligibility?.eligible !== true) {
    failures.push(...(rightToWorkEligibility?.failures || ['right_to_work_not_eligible']));
  }

  const authoritative = safeCurrent(current);
  if (!authoritative) {
    failures.push('right_to_work_authoritative_assurance_missing');
  } else {
    if (authoritative.conflicted) failures.push('right_to_work_authoritative_assurance_conflicted');
    if (!/^[0-9a-f]{32}$/i.test(text(authoritative.assuranceVersionId, 32))) failures.push('right_to_work_authoritative_assurance_version_invalid');
    if (text(authoritative.tenantId, 100) !== text(tenantId, 100)) failures.push('right_to_work_authoritative_assurance_tenant_mismatch');
    if (text(authoritative.siteId, 100) !== text(siteId, 100)) failures.push('right_to_work_authoritative_assurance_site_mismatch');
    if (text(authoritative.requestId, 100) !== text(request?.requestId, 100)) failures.push('right_to_work_authoritative_assurance_request_mismatch');
    if (text(authoritative.agencyId, 100) !== text(worker?.agencyId ?? agency?.agencyId, 100)) failures.push('right_to_work_authoritative_assurance_agency_mismatch');
    if (text(authoritative.workerId, 100) !== text(worker?.workerId, 100)) failures.push('right_to_work_authoritative_assurance_worker_mismatch');

    let assignmentFingerprint = null;
    try { assignmentFingerprint = agencyRightToWorkAssignmentFingerprint(request); }
    catch { failures.push('right_to_work_authoritative_assurance_assignment_invalid'); }
    if (assignmentFingerprint && text(authoritative.assignmentFingerprint, 24) !== assignmentFingerprint) {
      failures.push('right_to_work_authoritative_assurance_assignment_mismatch');
    }

    const evidence = rightToWorkEligibility?.evidence || {};
    if (text(authoritative.evidenceFingerprint, 24) !== text(evidence.evidenceFingerprint, 24)) {
      failures.push('right_to_work_authoritative_assurance_evidence_mismatch');
    }
    if (text(authoritative.checkMethod, 80) !== text(evidence.checkMethod, 80)) {
      failures.push('right_to_work_authoritative_assurance_check_method_mismatch');
    }
    if (iso(authoritative.checkedAt) !== iso(evidence.checkedAt)) {
      failures.push('right_to_work_authoritative_assurance_checked_at_mismatch');
    }
    const expectedCoverage = evidence?.lifecycle?.effectiveCoverageUntil == null
      ? null
      : iso(evidence.lifecycle.effectiveCoverageUntil);
    if (authoritative.coverageUntil !== expectedCoverage) {
      failures.push('right_to_work_authoritative_assurance_coverage_mismatch');
    }
  }

  return {
    version:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
    workerId:worker?.workerId ?? null,
    agencyId:worker?.agencyId ?? agency?.agencyId ?? null,
    authoritative:failures.length === 0,
    failures:[...new Set(failures)],
    rightToWorkEligibility,
    evidence:authoritative ? {
      assuranceVersionId:authoritative.assuranceVersionId,
      tenantId:authoritative.tenantId,
      siteId:authoritative.siteId,
      requestId:authoritative.requestId,
      agencyId:authoritative.agencyId,
      workerId:authoritative.workerId,
      assignmentFingerprint:authoritative.assignmentFingerprint,
      evidenceFingerprint:authoritative.evidenceFingerprint,
      checkMethod:authoritative.checkMethod,
      checkedAt:authoritative.checkedAt,
      coverageUntil:authoritative.coverageUntil,
      promotedAt:authoritative.promotedAt,
      conflicted:authoritative.conflicted,
      evidenceRule:'current_authoritative_assurance_must_match_exact_worker_agency_assignment_and_right_to_work_evidence_before_ranking',
      privacyBoundary:'no_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_planner_gate_output',
    } : null,
  };
}

export function createPostgresAgencyRightToWorkAssuranceReader({ query }) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_RIGHT_TO_WORK_ASSURANCE_READER_VERSION,
    async getCurrent(scope = {}) {
      const values = [
        required(scope.tenantId, 'tenantId', 100),
        required(scope.agencyId, 'agencyId', 100),
        required(scope.workerId, 'workerId', 100),
      ];
      const result = await query(GET_CURRENT_SQL, values);
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      if (rows.length > 1) throw new Error('unexpected_right_to_work_assurance_reader_result');
      return { current:rows.length === 1 ? safeCurrent(rows[0]) : null };
    },
  });
}

export async function planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input = {}) {
  if (!input?.tenantId || !input?.siteId) throw new TypeError('tenantId and siteId are required');
  const requestResult = buildAgencyRequestPack(input);
  const { rightToWorkAssuranceStore, ...baseInput } = input;

  if (!requestResult.valid) {
    const blocked = planAgencyLabourFulfilment({ ...baseInput, candidates:[] });
    return {
      ...blocked,
      authoritativePlannerVersion:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
      rightToWorkAuthoritativeGate:{ required:true, evaluated:false, reason:'request_invalid_before_assurance_resolution', candidateCount:0, authoritativeCount:0, rejectedCount:0 },
      authorityBoundary:'agency_request_handoff_only_no_worker_master_schedule_payroll_or_invoice_mutation',
    };
  }

  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const agencies = Array.isArray(input.agencies) ? input.agencies : [];
  const byAgency = new Map(agencies.map(agency => [agency.agencyId, agency]));
  const gateResults = await Promise.all(candidates.map(async worker => {
    if (!rightToWorkAssuranceStore || typeof rightToWorkAssuranceStore.getCurrent !== 'function') {
      return {
        version:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
        workerId:worker?.workerId ?? null,
        agencyId:worker?.agencyId ?? null,
        authoritative:false,
        failures:['right_to_work_authoritative_assurance_store_unavailable'],
        rightToWorkEligibility:null,
        evidence:null,
      };
    }
    let read;
    try {
      read = await rightToWorkAssuranceStore.getCurrent({ tenantId:input.tenantId, agencyId:worker?.agencyId, workerId:worker?.workerId });
    } catch {
      return {
        version:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
        workerId:worker?.workerId ?? null,
        agencyId:worker?.agencyId ?? null,
        authoritative:false,
        failures:['right_to_work_authoritative_assurance_store_unavailable'],
        rightToWorkEligibility:null,
        evidence:null,
      };
    }
    return evaluateAuthoritativeAgencyRightToWorkAssurance({
      current:read?.current ?? null,
      tenantId:input.tenantId,
      siteId:input.siteId,
      request:input.request || {},
      worker,
      agency:byAgency.get(worker?.agencyId),
      now:input.now ?? input.policy?.now ?? null,
    });
  }));

  const gateByWorker = new Map(gateResults.map(result => [result.workerId, result]));
  const authoritativeCandidates = candidates.filter(worker => gateByWorker.get(worker?.workerId)?.authoritative === true);
  const basePlan = planAgencyLabourFulfilment({ ...baseInput, candidates:authoritativeCandidates });

  const withGateEvidence = item => ({
    ...item,
    authoritativeRightToWorkAssurance:gateByWorker.get(item.workerId)?.evidence ?? null,
  });
  const ledgerRejected = gateResults
    .filter(result => !result.authoritative)
    .map(result => ({
      workerId:result.workerId,
      agencyId:result.agencyId,
      eligible:false,
      failures:result.failures,
      warnings:[],
      rightToWorkEligibility:result.rightToWorkEligibility,
      authoritativeRightToWorkAssurance:result.evidence,
      score:null,
    }));

  const output = {
    ...basePlan,
    authoritativePlannerVersion:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
    selectedWorkers:basePlan.selectedWorkers.map(withGateEvidence),
    eligibleWorkers:basePlan.eligibleWorkers.map(withGateEvidence),
    rejectedWorkers:[...basePlan.rejectedWorkers.map(withGateEvidence), ...ledgerRejected]
      .sort((a, b) => String(a.workerId).localeCompare(String(b.workerId))),
    rightToWorkAuthoritativeGate:{
      required:true,
      evaluated:true,
      candidateCount:candidates.length,
      authoritativeCount:gateResults.filter(result => result.authoritative).length,
      rejectedCount:gateResults.filter(result => !result.authoritative).length,
      eligibilityBeforeRanking:true,
      storeReadBoundary:'read_only_current_assurance_resolution_no_worker_master_schedule_payroll_or_invoice_mutation',
    },
    authorityBoundary:'agency_request_handoff_only_no_worker_master_schedule_payroll_or_invoice_mutation',
  };
  output.reproducibilityHash = hash({
    authoritativePlannerVersion:AGENCY_RIGHT_TO_WORK_AUTHORITATIVE_PLANNER_VERSION,
    basePlanHash:basePlan.reproducibilityHash,
    gates:gateResults.map(result => ({
      workerId:result.workerId,
      agencyId:result.agencyId,
      authoritative:result.authoritative,
      failures:result.failures,
      evidence:result.evidence,
    })),
    result:{ ...output, reproducibilityHash:undefined },
  });
  return output;
}
