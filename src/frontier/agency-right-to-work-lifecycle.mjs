import crypto from 'node:crypto';

export const AGENCY_RIGHT_TO_WORK_LIFECYCLE_VERSION = 'agency-right-to-work-lifecycle-v0.1.0';
export const DEFAULT_RIGHT_TO_WORK_REFRESH_LEAD_DAYS = 14;

const DAY_MS = 86_400_000;
const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fingerprint = value => text(value) ? crypto.createHash('sha256').update(text(value)).digest('hex').slice(0, 24) : null;
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

function refreshLeadDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RIGHT_TO_WORK_REFRESH_LEAD_DAYS;
  return Math.max(1, Math.min(90, Math.floor(parsed)));
}

export function evaluateAgencyRightToWorkLifecycle(rightToWork = {}, request = {}, options = {}) {
  const failures = [];
  const warnings = [];
  const now = ms(options.now);
  const assignmentEnd = ms(request.endAt);
  const method = text(rightToWork.checkMethod, 80);
  const indefinite = rightToWork.indefinite === true;
  const leadDays = refreshLeadDays(options.refreshLeadDays);

  let evidenceSource = indefinite ? 'continuous_permission' : 'time_limited_permission';
  let coverageUntil = indefinite ? null : ms(rightToWork.validUntil);
  let pvnEvidence = null;

  if (method === 'employer_checking_service') {
    evidenceSource = 'positive_verification_notice';
    const notice = rightToWork.positiveVerificationNotice && typeof rightToWork.positiveVerificationNotice === 'object'
      ? rightToWork.positiveVerificationNotice
      : null;

    if (!notice) {
      failures.push('right_to_work_ecs_positive_verification_notice_missing');
      coverageUntil = null;
    } else {
      const status = text(notice.status, 40);
      const issuedAt = ms(notice.issuedAt);
      const validUntil = ms(notice.validUntil);
      const evidenceRef = text(notice.evidenceRef, 200);

      if (status !== 'positive') failures.push('right_to_work_ecs_positive_verification_notice_not_positive');
      if (issuedAt === null) failures.push('right_to_work_ecs_positive_verification_notice_issued_at_missing');
      if (validUntil === null || (issuedAt !== null && validUntil <= issuedAt)) {
        failures.push('right_to_work_ecs_positive_verification_notice_expiry_invalid');
      }
      if (!evidenceRef) failures.push('right_to_work_ecs_positive_verification_notice_evidence_ref_missing');
      if (issuedAt !== null && now !== null && issuedAt > now) {
        failures.push('right_to_work_ecs_positive_verification_notice_in_future');
      }

      coverageUntil = validUntil;
      pvnEvidence = {
        status: status === 'positive' ? 'positive' : null,
        issuedAt: notice.issuedAt ?? null,
        validUntil: notice.validUntil ?? null,
        evidenceFingerprint: fingerprint(evidenceRef),
      };
    }
  }

  if (!indefinite) {
    if (coverageUntil === null) {
      failures.push('right_to_work_lifecycle_expiry_missing');
    } else if (assignmentEnd === null || coverageUntil < assignmentEnd) {
      failures.push('right_to_work_expires_before_shift_end');
    }
  }

  const refreshWindowStartsAt = !indefinite && coverageUntil !== null
    ? coverageUntil - leadDays * DAY_MS
    : null;

  let status = indefinite ? 'continuous' : 'current';
  if (!indefinite && coverageUntil !== null && now !== null) {
    if (now > coverageUntil) {
      status = 'expired';
    } else if (refreshWindowStartsAt !== null && now >= refreshWindowStartsAt) {
      status = 'refresh_due';
      warnings.push('follow_up_due_soon');
    }
  }
  if (failures.length) status = 'invalid';

  const refreshAction = status === 'refresh_due'
    ? {
        type: 'request_updated_right_to_work_assurance_from_supplying_agency',
        dueBy: iso(coverageUntil),
        scope: 'agency_right_to_work_evidence_only',
        authorityBoundary: 'no_worker_contact_schedule_payroll_or_invoice_mutation',
      }
    : null;

  return {
    version: AGENCY_RIGHT_TO_WORK_LIFECYCLE_VERSION,
    eligible: failures.length === 0,
    failures,
    warnings,
    evidence: {
      status,
      evidenceSource,
      followUpRequired: !indefinite,
      effectiveCoverageUntil: iso(coverageUntil),
      refreshWindowStartsAt: iso(refreshWindowStartsAt),
      refreshLeadDays: leadDays,
      positiveVerificationNotice: pvnEvidence,
      refreshAction,
      operationalRule: 'refresh_lead_window_is_operational_not_a_statutory_deadline',
      legalRule: indefinite
        ? 'continuous_evidence_does_not_require_repeat_check_unless_status_changes'
        : 'repeat_check_must_be_completed_on_or_before_current_permission_or_positive_verification_notice_expiry',
      privacyBoundary: 'no_share_code_date_of_birth_document_number_or_raw_positive_verification_notice_in_lifecycle_output',
      unsupportedContinuationRule: 'no_28_day_continuation_is_inferred_without_fresh_prescribed_evidence',
    },
  };
}
