export const AGENCY_SUPPLIER_COMPLIANCE_VERSION = 'agency-supplier-compliance-v0.1.0';

const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function subtractUtcMonths(timestamp, months) {
  const source = new Date(timestamp);
  const day = source.getUTCDate();
  const result = new Date(timestamp);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.getTime();
}

function canonicalLicenceEvidence(entity = {}) {
  const modern = entity.fairWorkAgencyGangmasterLicence;
  if (modern && typeof modern === 'object') {
    return {
      source: 'fair_work_agency',
      status: text(modern.status, 40),
      evidenceRef: text(modern.evidenceRef, 200),
      providerReference: text(modern.providerReference, 100),
      checkedAt: modern.checkedAt ?? null,
      validUntil: modern.validUntil ?? null,
      authorisedPersonConfirmed: modern.authorisedPersonConfirmed === true,
    };
  }

  if (entity.glaaLicenceValid !== undefined || entity.glaaLicenceCheckedAt || entity.glaaLicenceEvidenceRef) {
    return {
      source: 'legacy_glaa_fields',
      status: entity.glaaLicenceValid === true ? 'licensed' : 'not_verified',
      evidenceRef: text(entity.glaaLicenceEvidenceRef, 200),
      providerReference: text(entity.glaaLicenceReference, 100),
      checkedAt: entity.glaaLicenceCheckedAt ?? null,
      validUntil: entity.glaaLicenceValidUntil ?? null,
      authorisedPersonConfirmed: entity.glaaAuthorisedPersonConfirmed === true,
    };
  }

  return null;
}

function checkLicenceEvidence(evidence, request, options = {}, prefix = '') {
  const failures = [];
  const warnings = [];
  const now = ms(options.now);
  const end = ms(request?.endAt);
  const contractNegotiation = request?.supplierContractNegotiation === true;

  if (!evidence) {
    failures.push(prefix + 'fwa_gangmaster_licence_evidence_missing');
    return { failures, warnings, evidence: null };
  }

  if (evidence.status !== 'licensed') failures.push(prefix + 'fwa_gangmaster_licence_not_verified');
  if (!evidence.evidenceRef) failures.push(prefix + 'fwa_gangmaster_licence_evidence_ref_missing');

  const checkedAt = ms(evidence.checkedAt);
  if (checkedAt === null) failures.push(prefix + 'fwa_gangmaster_licence_check_time_missing');
  if (now === null) failures.push(prefix + 'supplier_compliance_now_missing');

  let checkAgeDays = null;
  if (checkedAt !== null && now !== null) {
    if (checkedAt > now) {
      failures.push(prefix + 'fwa_gangmaster_licence_check_in_future');
    } else {
      checkAgeDays = (now - checkedAt) / 86_400_000;
      if (checkedAt < subtractUtcMonths(now, 3)) failures.push(prefix + 'fwa_gangmaster_licence_check_stale');
    }
  }

  const validUntil = ms(evidence.validUntil);
  if (evidence.validUntil !== null && evidence.validUntil !== undefined && validUntil === null) {
    failures.push(prefix + 'fwa_gangmaster_licence_valid_until_invalid');
  }
  if (validUntil !== null && end !== null && validUntil < end) {
    failures.push(prefix + 'fwa_gangmaster_licence_expires_before_assignment_end');
  }

  if (contractNegotiation && evidence.authorisedPersonConfirmed !== true) {
    failures.push(prefix + 'fwa_authorised_person_not_confirmed');
  }

  if (evidence.source === 'legacy_glaa_fields') {
    warnings.push(prefix + 'legacy_glaa_evidence_field_names_migrate_to_fwa');
  }

  return {
    failures,
    warnings,
    evidence: {
      source: evidence.source,
      status: evidence.status,
      evidenceRef: evidence.evidenceRef || null,
      providerReference: evidence.providerReference || null,
      checkedAt: evidence.checkedAt ?? null,
      validUntil: evidence.validUntil ?? null,
      authorisedPersonConfirmed: evidence.authorisedPersonConfirmed === true,
      checkAgeDays,
    },
  };
}

export function evaluateAgencySupplierEligibility(agency, request = {}, options = {}) {
  const failures = [];
  const warnings = [];

  if (!agency || typeof agency !== 'object') {
    return {
      version: AGENCY_SUPPLIER_COMPLIANCE_VERSION,
      agencyId: null,
      eligible: false,
      failures: ['agency_not_found'],
      warnings,
      evidence: null,
    };
  }

  if (agency.approved !== true) failures.push('agency_not_approved');
  if (agency.active === false) failures.push('agency_inactive');

  const licenceRequired = request.fairWorkAgencyGangmasterLicenceRequired === true || request.glaaLicenceRequired === true;
  let primaryLicence = null;
  const subcontractors = [];

  if (licenceRequired) {
    const checked = checkLicenceEvidence(canonicalLicenceEvidence(agency), request, options);
    failures.push(...checked.failures);
    warnings.push(...checked.warnings);
    primaryLicence = checked.evidence;

    const chain = Array.isArray(agency.subcontractors) ? agency.subcontractors : [];
    for (let index = 0; index < chain.length; index++) {
      const subcontractor = chain[index] || {};
      const id = text(subcontractor.agencyId || subcontractor.providerReference || `index-${index}`, 100);
      const result = checkLicenceEvidence(canonicalLicenceEvidence(subcontractor), request, options, `subcontractor:${id}:`);
      failures.push(...result.failures);
      warnings.push(...result.warnings);
      subcontractors.push({ agencyId: id || null, ...result.evidence });
    }
  }

  return {
    version: AGENCY_SUPPLIER_COMPLIANCE_VERSION,
    agencyId: agency.agencyId ?? null,
    eligible: failures.length === 0,
    failures,
    warnings,
    evidence: {
      licenceRequired,
      primaryLicence,
      subcontractors,
      subcontractorCount: subcontractors.length,
      evidenceRule: licenceRequired
        ? 'fwa_gangmaster_licence_must_be_verified_with_dated_evidence_checked_within_three_calendar_months'
        : 'gangmaster_licence_not_required_by_request_policy',
    },
  };
}
