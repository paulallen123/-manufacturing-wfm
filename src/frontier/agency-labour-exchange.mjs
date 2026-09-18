import crypto from 'node:crypto';
import { evaluateAgencySupplierEligibility } from './agency-supplier-compliance.mjs';

export const AGENCY_LABOUR_ENGINE_VERSION = 'agency-labour-exchange-v0.2.0';

const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const c = value => Math.max(0, Math.min(1, n(value)));
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : (value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const SENSITIVE = new Set(['age','dateOfBirth','sex','gender','genderIdentity','race','ethnicity','religion','disability','maritalStatus','pregnancy','sexualOrientation','nationality','politicalOpinion']);

function requestFailures(request = {}) {
  const failures = [];
  for (const key of ['requestId','hirerName','businessNature','roleId','roleName','location','duties','expectedDuration','daysAndHours']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) failures.push('missing_request_field:' + key);
  }
  if (ms(request.startAt) === null || ms(request.endAt) === null || ms(request.endAt) <= ms(request.startAt)) failures.push('invalid_request_time');
  if (!Number.isInteger(Number(request.count)) || Number(request.count) <= 0) failures.push('invalid_request_count');
  for (const key of ['requiredSkills','requiredQualifications','healthSafetyRisks']) if (!Array.isArray(request[key])) failures.push('missing_request_field:' + key);
  if (request.expenses === undefined) failures.push('missing_request_field:expenses');
  if (request.industrialActionReplacement === true) failures.push('industrial_action_replacement_forbidden');
  return failures;
}

function skillOk(worker, required) {
  const actual = (worker.skills || []).find(skill => skill && skill.id === required.id);
  return !!actual && n(actual.level) >= n(required.level, 1);
}

function qualificationOk(worker, required, assignmentEnd) {
  const actual = (worker.qualifications || []).find(qualification => qualification && qualification.id === required.id);
  if (!actual || n(actual.level, -Infinity) < n(required.level, 1) || (actual.status && actual.status !== 'valid')) return false;
  return actual.noExpiry === true || (ms(actual.validUntil) !== null && ms(actual.validUntil) >= assignmentEnd);
}

function shrink(value, sample, prior = .5, weight = 10) {
  sample = Math.max(0, n(sample));
  return (c(value ?? prior) * sample + prior * weight) / (sample + weight);
}

function score(worker, agency, request) {
  const performance = worker.performance || {};
  const sample = Math.max(0, n(performance.completedShifts));
  const max = n(request.maxChargePerHour);
  const rate = n(worker.chargeRatePerHour, max || 0);
  const components = {
    attendance: shrink(performance.attendanceRate, sample),
    punctuality: shrink(performance.punctualityRate, sample),
    quality: shrink(performance.qualityScore, sample),
    productivity: shrink(performance.productivityScore, sample),
    siteExperience: Math.min(1, n(performance.completedSiteShifts) / 20),
    roleExperience: Math.min(1, n(performance.completedRoleShifts) / 20),
    supplierReliability: c(agency.performance?.fillReliability ?? .5),
    cost: max > 0 ? c(1 - Math.max(0, rate) / max) : .5,
  };
  const weights = { attendance:.22, punctuality:.18, quality:.18, productivity:.16, siteExperience:.10, roleExperience:.10, supplierReliability:.04, cost:.02 };
  return {
    score: Object.entries(weights).reduce((total, [key, weight]) => total + components[key] * weight, 0),
    components,
    weights,
    completedShifts: sample,
    evidenceConfidence: Math.min(1, sample / 20),
  };
}

export function evaluateAgencyCandidate(worker, request, agency, policy = {}) {
  const failures = [];
  const warnings = [];
  if (!worker || typeof worker !== 'object') return { eligible:false, failures:['candidate_missing'], warnings, score:null };

  const start = ms(request.startAt);
  const end = ms(request.endAt);
  const supplierEligibility = evaluateAgencySupplierEligibility(agency, request, { now: policy.now });
  failures.push(...supplierEligibility.failures);
  warnings.push(...supplierEligibility.warnings.map(warning => 'supplier:' + warning));

  if (agency && agency.agencyId !== worker.agencyId) failures.push('agency_not_found');
  if (worker.consentToShare !== true) failures.push('worker_profile_consent_missing');
  if (worker.available !== true) failures.push('worker_unavailable');
  if (worker.siteReady !== true) failures.push('worker_not_site_ready');
  if (['unsuitable','unresolved'].includes(worker.suitabilityStatus)) failures.push('worker_suitability_unresolved');
  if (worker.restCompliant !== true) failures.push('working_time_or_rest_not_confirmed');
  if (ms(worker.availability?.startAt) === null || ms(worker.availability.startAt) > start) failures.push('availability_does_not_cover_shift_start');
  if (ms(worker.availability?.endAt) === null || ms(worker.availability.endAt) < end) failures.push('availability_does_not_cover_shift_end');
  if (worker.inductionNoExpiry !== true && (ms(worker.inductionValidUntil) === null || ms(worker.inductionValidUntil) < end)) failures.push('site_induction_expired_or_missing');

  const rightToWork = worker.rightToWork || {};
  if (rightToWork.status !== 'verified') failures.push('right_to_work_not_verified');
  if (rightToWork.indefinite !== true && (ms(rightToWork.validUntil) === null || ms(rightToWork.validUntil) < end)) failures.push('right_to_work_expires_before_shift_end');

  for (const required of request.requiredSkills || []) if (!skillOk(worker, required)) failures.push('missing_skill:' + required.id);
  for (const required of request.requiredQualifications || []) if (!qualificationOk(worker, required, end)) failures.push('invalid_qualification:' + required.id);
  if (n(worker.awr?.weeksInSameRole) >= 12 && worker.awr?.equalTreatmentConfirmed !== true) failures.push('awr_equal_treatment_not_confirmed');
  if (request.maxChargePerHour !== undefined && n(worker.chargeRatePerHour, Infinity) > n(request.maxChargePerHour)) failures.push('charge_rate_above_cap');

  const ignored = Object.keys(worker).filter(key => SENSITIVE.has(key)).sort();
  if (ignored.length) warnings.push('ignored_sensitive_ranking_fields:' + ignored.join(','));

  const ranking = failures.length ? null : score(worker, agency, request);
  if (ranking && ranking.evidenceConfidence < c(policy.minimumEvidenceConfidence ?? 0)) warnings.push('low_performance_evidence_confidence');

  return {
    workerId: worker.workerId ?? null,
    agencyId: worker.agencyId ?? null,
    eligible: failures.length === 0,
    failures,
    warnings,
    ignoredSensitiveFields: ignored,
    supplierEligibility,
    score: ranking,
  };
}

export function buildAgencyRequestPack(input) {
  const request = input?.request || {};
  const failures = requestFailures(request);
  return {
    valid: failures.length === 0,
    failures,
    pack: {
      requestId: request.requestId ?? null,
      hirer: { name: request.hirerName ?? null, businessNature: request.businessNature ?? null },
      assignment: {
        roleId: request.roleId ?? null,
        roleName: request.roleName ?? null,
        duties: request.duties ?? null,
        location: request.location ?? null,
        startAt: request.startAt ?? null,
        endAt: request.endAt ?? null,
        expectedDuration: request.expectedDuration ?? null,
        daysAndHours: request.daysAndHours ?? null,
        count: Number(request.count || 0),
        requiredSkills: structuredClone(request.requiredSkills || []),
        requiredQualifications: structuredClone(request.requiredQualifications || []),
        healthSafetyRisks: structuredClone(request.healthSafetyRisks || []),
        controlMeasures: structuredClone(request.controlMeasures || []),
        expenses: structuredClone(request.expenses || {}),
        payAndConditions: structuredClone(request.payAndConditions || {}),
        industrialActionReplacement: request.industrialActionReplacement === true,
        fairWorkAgencyGangmasterLicenceRequired: request.fairWorkAgencyGangmasterLicenceRequired === true || request.glaaLicenceRequired === true,
      },
    },
  };
}

export function planAgencyLabourFulfilment(input) {
  if (!input?.tenantId || !input?.siteId) throw new TypeError('tenantId and siteId are required');

  const requestResult = buildAgencyRequestPack(input);
  const request = input.request || {};
  const agencies = Array.isArray(input.agencies) ? input.agencies : [];
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const policy = input.policy || {};

  if (!requestResult.valid) {
    const blocked = {
      engineVersion: AGENCY_LABOUR_ENGINE_VERSION,
      status: 'request_blocked',
      requestFailures: requestResult.failures,
      requestPack: requestResult.pack,
      selectedWorkers: [],
      eligibleWorkers: [],
      rejectedWorkers: [],
      supplierEligibility: [],
      dispatchPlan: null,
      authorityBoundary: 'agency_request_handoff_only_no_schedule_payroll_or_invoice_mutation',
    };
    blocked.reproducibilityHash = hash(blocked);
    return blocked;
  }

  const byAgency = new Map(agencies.map(agency => [agency.agencyId, agency]));
  const candidatePolicy = { ...policy, now: input.now ?? policy.now ?? null };
  const evaluations = candidates.map(worker => evaluateAgencyCandidate(worker, request, byAgency.get(worker.agencyId), candidatePolicy));
  const workerById = new Map(candidates.map(worker => [worker.workerId, worker]));
  const supplierEligibility = agencies
    .map(agency => evaluateAgencySupplierEligibility(agency, request, { now: candidatePolicy.now }))
    .sort((a, b) => String(a.agencyId).localeCompare(String(b.agencyId)));
  const supplierById = new Map(supplierEligibility.map(result => [result.agencyId, result]));

  const eligible = evaluations
    .filter(result => result.eligible)
    .sort((a, b) =>
      b.score.score - a.score.score ||
      b.score.evidenceConfidence - a.score.evidenceConfidence ||
      n(workerById.get(a.workerId)?.chargeRatePerHour, Infinity) - n(workerById.get(b.workerId)?.chargeRatePerHour, Infinity) ||
      String(a.workerId).localeCompare(String(b.workerId)));

  const count = Number(request.count);
  const selected = eligible.slice(0, count).map((result, index) => ({
    rank: index + 1,
    workerId: result.workerId,
    agencyId: result.agencyId,
    score: result.score,
    rationale: [
      'supplier_compliance_eligible_before_ranking',
      'eligible_and_site_ready',
      'right_to_work_verified',
      'skills_and_qualifications_valid',
      'rest_and_assignment_rules_confirmed',
      'job_relevant_ranking_only',
    ],
  }));

  const summaries = agencies
    .filter(agency => supplierById.get(agency.agencyId)?.eligible === true)
    .map(agency => {
      const preferred = eligible.filter(worker => worker.agencyId === agency.agencyId);
      return {
        agencyId: agency.agencyId,
        preferredWorkerIds: preferred.slice(0, count).map(worker => worker.workerId),
        preferredCount: preferred.length,
        bestPreferredScore: preferred[0]?.score?.score ?? 0,
        fillReliability: c(agency.performance?.fillReliability ?? .5),
        responseSlaMinutes: n(agency.responseSlaMinutes, policy.responseSlaMinutes ?? 5),
        supplierEligibility: supplierById.get(agency.agencyId),
      };
    })
    .sort((a, b) =>
      b.bestPreferredScore - a.bestPreferredScore ||
      b.preferredCount - a.preferredCount ||
      b.fillReliability - a.fillReliability ||
      a.agencyId.localeCompare(b.agencyId));

  const parallel = Math.max(1, Math.min(10, Math.floor(n(policy.parallelAgencies, 2))));
  const defaultSla = Math.max(1, Math.floor(n(policy.responseSlaMinutes, 5)));
  const phases = [];
  for (let index = 0; index < summaries.length; index += parallel) {
    const group = summaries.slice(index, index + parallel);
    const delay = phases.reduce((total, phase) => total + phase.responseSlaMinutes, 0);
    const sla = Math.max(defaultSla, ...group.map(agency => Math.max(1, Math.floor(agency.responseSlaMinutes))));
    phases.push({
      phase: phases.length + 1,
      startsAfterMinutes: delay,
      responseSlaMinutes: sla,
      agencies: group.map(agency => ({
        agencyId: agency.agencyId,
        preferredWorkerIds: agency.preferredWorkerIds,
        requestedCount: count,
        supplierEligibilityEvidence: agency.supplierEligibility.evidence,
      })),
    });
  }

  const highRisk = request.highRisk === true || (request.healthSafetyRisks || []).some(risk => risk?.severity === 'high');
  const autoDispatch = policy.autoDispatchApprovedAgencies === true && !highRisk && request.standardRole === true;
  const dispatchPlan = {
    mode: autoDispatch ? 'approved_agency_auto_dispatch' : 'manager_approval_then_dispatch',
    phases,
    responseContract: {
      acceptedActions: ['confirm_preferred_worker','propose_alternative','partial_fill','decline_request'],
      staleResponseRule: 'revalidate_worker_request_and_supplier_compliance_before_acceptance',
    },
    actionContract: {
      type: 'external_agency_request_handoff',
      requiresManagerApproval: !autoDispatch,
      forbids: ['direct_schedule_write','direct_payroll_write','direct_invoice_approval','bypass_worker_compliance','bypass_supplier_compliance'],
    },
  };

  const chosen = new Set(selected.map(worker => worker.workerId));
  const status = selected.length >= count
    ? 'preferred_workers_identified'
    : eligible.length
      ? 'partial_preferred_coverage_cascade_required'
      : 'no_precleared_worker_available_cascade_required';

  const output = {
    engineVersion: AGENCY_LABOUR_ENGINE_VERSION,
    status,
    requestFailures: [],
    requestPack: requestResult.pack,
    requestedCount: count,
    preferredCoverageCount: selected.length,
    gapCount: Math.max(0, count - selected.length),
    selectedWorkers: selected,
    eligibleWorkers: eligible.filter(result => !chosen.has(result.workerId)),
    rejectedWorkers: evaluations.filter(result => !result.eligible),
    supplierEligibility,
    dispatchPlan,
    fairnessBoundary: 'sensitive_or_protected_attributes_are_not_ranking_inputs',
    authorityBoundary: 'agency_request_handoff_only_no_schedule_payroll_or_invoice_mutation',
  };

  output.reproducibilityHash = hash({
    engineVersion: AGENCY_LABOUR_ENGINE_VERSION,
    tenantId: input.tenantId,
    siteId: input.siteId,
    requestPack: requestResult.pack,
    policy,
    supplierEligibility,
    agencyEvidence: summaries,
    candidateEvidence: evaluations.map(result => ({
      workerId: result.workerId,
      agencyId: result.agencyId,
      eligible: result.eligible,
      failures: result.failures,
      supplierEligibility: result.supplierEligibility,
      score: result.score,
    })),
    result: { ...output, reproducibilityHash: undefined },
  });
  return output;
}

export function validateAgencyResponse(plan, response, alternative = null) {
  const failures = [];
  const allowed = new Set(plan?.dispatchPlan?.responseContract?.acceptedActions || []);
  if (!response || typeof response !== 'object') return { valid:false, failures:['response_missing'] };
  if (!allowed.has(response.action)) failures.push('response_action_not_allowed');
  if (response.requestId !== plan?.requestPack?.requestId) failures.push('response_request_mismatch');

  const agencies = new Set((plan?.dispatchPlan?.phases || []).flatMap(phase => phase.agencies.map(agency => agency.agencyId)));
  if (!agencies.has(response.agencyId)) failures.push('response_agency_not_in_dispatch_plan');

  if (response.action === 'confirm_preferred_worker') {
    const agency = (plan?.dispatchPlan?.phases || []).flatMap(phase => phase.agencies).find(item => item.agencyId === response.agencyId);
    if (!(agency?.preferredWorkerIds || []).includes(response.workerId)) failures.push('worker_not_in_preferred_list');
  }

  if (response.action === 'propose_alternative') {
    if (!alternative) {
      failures.push('alternative_worker_requires_revalidation');
    } else {
      const evaluation = evaluateAgencyCandidate(alternative.candidate, alternative.request, alternative.agency, alternative.policy);
      if (!evaluation.eligible) failures.push(...evaluation.failures.map(failure => 'alternative_' + failure));
    }
  }

  return { valid: failures.length === 0, failures };
}

export function reconcileAgencyInvoiceLine(input) {
  if (!input?.shiftId || !input?.workerId || !input?.agencyId) throw new TypeError('shiftId, workerId and agencyId are required');
  const failures = [];
  const clocked = Math.max(0, n(input.clockedHours));
  const claimed = Math.max(0, n(input.agencyClaimedHours));
  const billed = Math.max(0, n(input.billedHours, claimed));
  const contractRate = n(input.contractRatePerHour, NaN);
  const invoiceRate = n(input.invoiceRatePerHour, NaN);
  const approvedExpenses = Math.max(0, n(input.approvedExpenses));
  const invoicedExpenses = Math.max(0, n(input.invoicedExpenses, approvedExpenses));
  const tolerance = Math.max(0, n(input.hoursToleranceMinutes, 6));

  if (!Number.isFinite(contractRate) || contractRate < 0) failures.push('invalid_contract_rate');
  if (!Number.isFinite(invoiceRate) || invoiceRate < 0) failures.push('invalid_invoice_rate');
  if (input.clockEvidenceComplete !== true) failures.push('clock_evidence_incomplete');
  if (Math.abs(claimed - clocked) * 60 > tolerance) failures.push('agency_claim_vs_clock_variance');
  if (Math.abs(billed - clocked) * 60 > tolerance) failures.push('billed_hours_vs_clock_variance');
  if (Number.isFinite(contractRate) && Number.isFinite(invoiceRate) && Math.abs(invoiceRate - contractRate) > .0001) failures.push('invoice_rate_mismatch');
  if (invoicedExpenses > approvedExpenses + .0001) failures.push('unapproved_expense_variance');
  if (input.duplicateInvoiceReference === true) failures.push('duplicate_invoice_reference');

  const expected = Number.isFinite(contractRate) ? clocked * contractRate + approvedExpenses : null;
  const total = Number.isFinite(invoiceRate) ? billed * invoiceRate + invoicedExpenses : null;
  return {
    shiftId: input.shiftId,
    workerId: input.workerId,
    agencyId: input.agencyId,
    status: failures.length ? 'manufacturer_invoice_review_required' : 'manufacturer_invoice_line_matched',
    failures,
    scheduledHours: Math.max(0, n(input.scheduledHours)),
    clockedHours: clocked,
    agencyClaimedHours: claimed,
    billedHours: billed,
    contractRatePerHour: Number.isFinite(contractRate) ? contractRate : null,
    invoiceRatePerHour: Number.isFinite(invoiceRate) ? invoiceRate : null,
    approvedExpenses,
    invoicedExpenses,
    expectedManufacturerInvoice: expected,
    invoiceTotal: total,
    variance: expected !== null && total !== null ? total - expected : null,
    boundary: 'hirer_invoice_validation_only_never_worker_wage_withholding',
  };
}
