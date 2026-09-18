import crypto from 'node:crypto';
import { evaluateAgencyRightToWorkLifecycle } from './agency-right-to-work-lifecycle.mjs';

export const AGENCY_RIGHT_TO_WORK_ASSURANCE_VERSION = 'agency-right-to-work-assurance-v0.2.0';
export const UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT = '2026-10-01T00:00:00.000Z';

const SUPPORTED_ARRANGEMENT = 'employment_business_supply_to_hirer_own_operations';
const ALLOWED_METHODS = new Set([
  'home_office_online',
  'manual_document',
  'rtw_dvsp',
  'employer_checking_service',
]);

const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fingerprint = value => text(value) ? crypto.createHash('sha256').update(text(value)).digest('hex').slice(0, 24) : null;

function baseRightToWorkFailures(rightToWork) {
  const failures = [];
  if (rightToWork.status !== 'verified') failures.push('right_to_work_not_verified');
  return failures;
}

export function evaluateAgencyRightToWork(worker, request = {}, agency = {}, options = {}) {
  const failures = [];
  const warnings = [];
  const rightToWork = worker?.rightToWork && typeof worker.rightToWork === 'object' ? worker.rightToWork : {};
  const assignmentStart = ms(request.startAt);
  const effectiveAt = ms(UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT);

  failures.push(...baseRightToWorkFailures(rightToWork));
  const lifecycle = evaluateAgencyRightToWorkLifecycle(rightToWork, request, {
    now: options.now,
    refreshLeadDays: options.refreshLeadDays,
  });
  failures.push(...lifecycle.failures);
  warnings.push(...lifecycle.warnings);

  const assignmentAfterCutover = assignmentStart !== null && effectiveAt !== null && assignmentStart >= effectiveAt;
  if (!assignmentAfterCutover) {
    return {
      version: AGENCY_RIGHT_TO_WORK_ASSURANCE_VERSION,
      workerId: worker?.workerId ?? null,
      agencyId: worker?.agencyId ?? agency?.agencyId ?? null,
      eligible: failures.length === 0,
      failures,
      warnings,
      evidence: {
        policyMode: 'legacy_pre_2026_10_01',
        status: rightToWork.status ?? null,
        indefinite: rightToWork.indefinite === true,
        validUntil: rightToWork.validUntil ?? null,
        lifecycle: lifecycle.evidence,
        evidenceRule: 'existing_right_to_work_gate_preserved_before_uk_2026_policy_effective_date',
      },
    };
  }

  const engagementType = text(rightToWork.engagementType, 80);
  const employmentCommencedAt = ms(rightToWork.employmentCommencedAt);
  if (!engagementType) {
    failures.push('right_to_work_engagement_type_unclassified');
  } else if (!['contract_of_employment','workers_contract'].includes(engagementType)) {
    failures.push('right_to_work_engagement_type_requires_policy_review');
  }

  if (engagementType === 'workers_contract') {
    if (employmentCommencedAt === null) {
      failures.push('right_to_work_employment_commenced_at_missing');
    } else if (employmentCommencedAt >= effectiveAt) {
      // New worker-contract scope applies from 1 October 2026 where that employment commenced on/after the cutover.
    } else {
      return {
        version: AGENCY_RIGHT_TO_WORK_ASSURANCE_VERSION,
        workerId: worker?.workerId ?? null,
        agencyId: worker?.agencyId ?? agency?.agencyId ?? null,
        eligible: failures.length === 0,
        failures,
        warnings,
        evidence: {
          policyMode: 'legacy_worker_contract_pre_2026_10_01_commencement',
          status: rightToWork.status ?? null,
          engagementType,
          employmentCommencedAt: rightToWork.employmentCommencedAt ?? null,
          indefinite: rightToWork.indefinite === true,
          validUntil: rightToWork.validUntil ?? null,
          lifecycle: lifecycle.evidence,
          evidenceRule: 'new_2026_worker_contract_scope_not_inferred_from_assignment_date_when_engagement_commenced_before_cutover',
        },
      };
    }
  }

  const scheme = agency?.rightToWorkScheme && typeof agency.rightToWorkScheme === 'object'
    ? agency.rightToWorkScheme
    : {};
  const requestArrangement = text(request.rightToWorkArrangement, 100);
  const supplierArrangement = text(scheme.arrangement, 100);
  const arrangement = requestArrangement || supplierArrangement;

  if (!arrangement) {
    failures.push('right_to_work_arrangement_unclassified');
  } else if (requestArrangement && supplierArrangement && requestArrangement !== supplierArrangement) {
    failures.push('right_to_work_arrangement_mismatch');
  } else if (arrangement !== SUPPORTED_ARRANGEMENT) {
    failures.push('right_to_work_arrangement_requires_policy_review');
  }

  if (text(scheme.responsibleParty, 80) !== 'employment_business') {
    failures.push('right_to_work_responsible_party_mismatch');
  }

  if (!agency?.agencyId || text(rightToWork.checkedByAgencyId, 100) !== String(agency.agencyId)) {
    failures.push('right_to_work_checker_agency_mismatch');
  }

  const method = text(rightToWork.checkMethod, 80);
  if (!ALLOWED_METHODS.has(method)) failures.push('right_to_work_check_method_not_prescribed');

  const evidenceRef = text(rightToWork.evidenceRef, 200);
  if (!evidenceRef) failures.push('right_to_work_evidence_ref_missing');

  const checkedAt = ms(rightToWork.checkedAt);
  const now = ms(options.now);
  if (checkedAt === null) failures.push('right_to_work_check_time_missing');
  if (now === null) failures.push('right_to_work_now_missing');
  if (checkedAt !== null && now !== null && checkedAt > now) failures.push('right_to_work_check_in_future');
  if (checkedAt !== null && assignmentStart !== null && checkedAt > assignmentStart) failures.push('right_to_work_check_after_assignment_start');

  const assignmentScope = rightToWork.assignmentScope && typeof rightToWork.assignmentScope === 'object'
    ? rightToWork.assignmentScope
    : {};
  if (text(assignmentScope.roleId, 100) !== text(request.roleId, 100)) failures.push('right_to_work_assignment_role_mismatch');
  if (text(assignmentScope.location, 200) !== text(request.location, 200)) failures.push('right_to_work_assignment_location_mismatch');

  const scopeStart = ms(assignmentScope.startAt);
  const scopeEnd = ms(assignmentScope.endAt);
  const assignmentEnd = ms(request.endAt);
  if (scopeStart === null || assignmentStart === null || scopeStart > assignmentStart) failures.push('right_to_work_assignment_scope_start_not_covered');
  if (scopeEnd === null || assignmentEnd === null || scopeEnd < assignmentEnd) failures.push('right_to_work_assignment_scope_end_not_covered');
  if (assignmentScope.restrictionsSatisfied !== true) failures.push('right_to_work_assignment_restrictions_not_confirmed');

  return {
    version: AGENCY_RIGHT_TO_WORK_ASSURANCE_VERSION,
    workerId: worker?.workerId ?? null,
    agencyId: worker?.agencyId ?? agency?.agencyId ?? null,
    eligible: failures.length === 0,
    failures,
    warnings,
    evidence: {
      policyMode: 'uk_2026_assignment_assurance',
      effectiveAt: UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT,
      engagementType: engagementType || null,
      employmentCommencedAt: rightToWork.employmentCommencedAt ?? null,
      arrangement: arrangement || null,
      arrangementSource: requestArrangement ? 'request' : supplierArrangement ? 'supplier_policy' : null,
      responsibleParty: text(scheme.responsibleParty, 80) || null,
      hirerRole: arrangement === SUPPORTED_ARRANGEMENT ? 'assurance_only_not_statutory_check_owner' : 'unresolved_requires_policy_review',
      checkMethod: ALLOWED_METHODS.has(method) ? method : null,
      checkedAt: rightToWork.checkedAt ?? null,
      indefinite: rightToWork.indefinite === true,
      validUntil: rightToWork.validUntil ?? null,
      evidenceFingerprint: fingerprint(evidenceRef),
      lifecycle: lifecycle.evidence,
      assignmentScope: {
        roleId: text(assignmentScope.roleId, 100) || null,
        location: text(assignmentScope.location, 200) || null,
        startAt: assignmentScope.startAt ?? null,
        endAt: assignmentScope.endAt ?? null,
        restrictionsSatisfied: assignmentScope.restrictionsSatisfied === true,
      },
      privacyBoundary: 'no_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_engine_output',
      evidenceRule: 'employment_business_assurance_must_be_assignment_scoped_and_use_a_prescribed_check_method_before_work_starts',
    },
  };
}
