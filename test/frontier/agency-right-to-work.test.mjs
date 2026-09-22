import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAgencyRightToWork,
  UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT,
  UK_RIGHT_TO_WORK_DVSP_SUPPLEMENTARY_CODE_VERSION,
} from '../../src/frontier/agency-right-to-work.mjs';

const PRE = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-09-21T06:00:00.000Z', endAt:'2026-09-21T14:00:00.000Z' };
const POST = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };
const NOW = '2026-10-04T12:00:00.000Z';
const DVSP_REGISTRY_EVIDENCE = 'server-side-ofdia-register-snapshot-2026-10-04';

function dvspPolicy(overrides = {}) {
  return {
    providerId:'DVSP-REGISTERED-1',
    registryStatus:'registered',
    trustFrameworkCertified:true,
    rightToWorkSupplementaryCodeCertified:true,
    rightToWorkSupplementaryCodeVersion:'1.1',
    registryVerifiedAt:'2026-10-04T09:00:00.000Z',
    registryEvidenceRef:DVSP_REGISTRY_EVIDENCE,
    exclusiveForAgencyRightToWork:true,
    ...overrides,
  };
}

function agency(overrides = {}) {
  return {
    agencyId:'A1',
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations',
      responsibleParty:'employment_business',
      rtwDvsp:dvspPolicy(),
    },
    ...overrides,
  };
}

function worker(overrides = {}) {
  return {
    workerId:'W1', agencyId:'A1',
    rightToWork:{
      status:'verified', validUntil:'2027-12-31T23:59:59.000Z',
      engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
      checkedByAgencyId:'A1', checkMethod:'home_office_online', checkedAt:'2026-10-04T10:00:00.000Z',
      evidenceRef:'rtw-evidence-internal-reference-123',
      assignmentScope:{ roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true },
      ...overrides,
    },
  };
}

const positiveNotice = () => ({
  status:'positive', issuedAt:'2026-10-04T09:00:00.000Z', validUntil:'2027-04-04T09:00:00.000Z',
  evidenceRef:'private-pvn-record-123',
});

test('preserves the existing pre-1-October eligibility contract', () => {
  const r = evaluateAgencyRightToWork({ workerId:'W1', agencyId:'A1', rightToWork:{ status:'verified', validUntil:'2027-01-01T00:00:00.000Z' } }, PRE, { agencyId:'A1' }, { now:'2026-09-18T12:00:00.000Z' });
  assert.equal(r.eligible, true);
  assert.equal(r.evidence.policyMode, 'legacy_pre_2026_10_01');
  assert.equal(UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT, '2026-10-01T00:00:00.000Z');
});

test('keeps legacy failure names for unchecked or expired evidence', () => {
  const unchecked = evaluateAgencyRightToWork({ workerId:'W1', agencyId:'A1', rightToWork:{ status:'unchecked' } }, PRE, { agencyId:'A1' });
  assert.ok(unchecked.failures.includes('right_to_work_not_verified'));
  const expired = evaluateAgencyRightToWork({ workerId:'W1', agencyId:'A1', rightToWork:{ status:'verified', validUntil:'2026-09-20T00:00:00.000Z' } }, PRE, { agencyId:'A1' });
  assert.ok(expired.failures.includes('right_to_work_expires_before_shift_end'));
});

test('post-effective-date agency supply requires explicit responsibility classification and worker evidence', () => {
  const missing = evaluateAgencyRightToWork(worker(), POST, { agencyId:'A1' }, { now:NOW });
  assert.equal(missing.eligible, false);
  assert.ok(missing.failures.includes('right_to_work_arrangement_unclassified'));
  assert.ok(missing.failures.includes('right_to_work_responsible_party_mismatch'));

  const pass = evaluateAgencyRightToWork(worker(), POST, agency(), { now:NOW });
  assert.equal(pass.eligible, true);
  assert.equal(pass.evidence.responsibleParty, 'employment_business');
  assert.equal(pass.evidence.hirerRole, 'assurance_only_not_statutory_check_owner');
  assert.equal(pass.evidence.evidenceFingerprint.length, 24);
  assert.equal(Object.hasOwn(pass.evidence, 'evidenceRef'), false);
  assert.doesNotMatch(JSON.stringify(pass), /rtw-evidence-internal-reference-123/);
});

test('worker-contract scope uses employment commencement rather than assignment date', () => {
  const legacyWorkerContract = {
    workerId:'W1', agencyId:'A1',
    rightToWork:{
      status:'verified', validUntil:'2027-12-31T23:59:59.000Z',
      engagementType:'workers_contract', employmentCommencedAt:'2026-09-30T09:00:00.000Z',
    },
  };
  const r = evaluateAgencyRightToWork(legacyWorkerContract, POST, { agencyId:'A1' }, { now:NOW });
  assert.equal(r.eligible, true);
  assert.equal(r.evidence.policyMode, 'legacy_worker_contract_pre_2026_10_01_commencement');

  const missing = evaluateAgencyRightToWork({ workerId:'W2', agencyId:'A1', rightToWork:{ status:'verified', validUntil:'2027-12-31T23:59:59.000Z' } }, POST, agency(), { now:NOW });
  assert.equal(missing.eligible, false);
  assert.ok(missing.failures.includes('right_to_work_engagement_type_unclassified'));

  const missingCommencement = evaluateAgencyRightToWork(worker({ employmentCommencedAt:null }), POST, agency(), { now:NOW });
  assert.ok(missingCommencement.failures.includes('right_to_work_employment_commenced_at_missing'));

  const traditionalEmployment = evaluateAgencyRightToWork(worker({ engagementType:'contract_of_employment', employmentCommencedAt:null }), POST, agency(), { now:NOW });
  assert.equal(traditionalEmployment.eligible, true);
  assert.equal(traditionalEmployment.evidence.engagementType, 'contract_of_employment');
});

test('non-standard or conflicting contractual arrangements fail closed for policy review', () => {
  const nonStandard = agency({ rightToWorkScheme:{ arrangement:'managed_service_contract_chain', responsibleParty:'employment_business' } });
  const a = evaluateAgencyRightToWork(worker(), POST, nonStandard, { now:NOW });
  assert.ok(a.failures.includes('right_to_work_arrangement_requires_policy_review'));

  const b = evaluateAgencyRightToWork(worker(), { ...POST, rightToWorkArrangement:'employment_business_supply_to_hirer_own_operations' }, nonStandard, { now:NOW });
  assert.ok(b.failures.includes('right_to_work_arrangement_mismatch'));
});

test('all prescribed check routes are treated neutrally when route-specific evidence is complete', () => {
  for (const checkMethod of ['home_office_online','manual_document','rtw_dvsp','employer_checking_service']) {
    const overrides = { checkMethod };
    if (checkMethod === 'rtw_dvsp') overrides.dvspProviderId = 'DVSP-REGISTERED-1';
    if (checkMethod === 'employer_checking_service') {
      overrides.validUntil = '2026-09-30T23:59:59.000Z';
      overrides.positiveVerificationNotice = positiveNotice();
    }
    const r = evaluateAgencyRightToWork(worker(overrides), POST, agency(), { now:NOW });
    assert.equal(r.eligible, true, `${checkMethod}: ${r.failures.join(',')}`);
  }
  const bad = evaluateAgencyRightToWork(worker({ checkMethod:'passport_copy_only' }), POST, agency(), { now:NOW });
  assert.ok(bad.failures.includes('right_to_work_check_method_not_prescribed'));
});

test('digital verification route fails closed without server-authoritative registered and certified provider evidence', () => {
  const noConfig = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'DVSP-REGISTERED-1' }), POST, agency({
    rightToWorkScheme:{ arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business' },
  }), { now:NOW });
  assert.equal(noConfig.eligible, false);
  assert.ok(noConfig.failures.includes('right_to_work_dvsp_provider_configuration_missing'));
  assert.ok(noConfig.failures.includes('right_to_work_dvsp_trust_framework_certification_not_confirmed'));
  assert.ok(noConfig.failures.includes('right_to_work_dvsp_provider_not_registered'));
  assert.ok(noConfig.failures.includes('right_to_work_dvsp_supplementary_code_certification_not_confirmed'));
});

test('digital verification route requires the current 1.1 supplementary code and exact provider provenance', () => {
  const oldCode = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'DVSP-REGISTERED-1' }), POST, agency({
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business',
      rtwDvsp:dvspPolicy({ rightToWorkSupplementaryCodeVersion:'1.0' }),
    },
  }), { now:NOW });
  assert.ok(oldCode.failures.includes('right_to_work_dvsp_supplementary_code_version_not_current'));
  assert.equal(UK_RIGHT_TO_WORK_DVSP_SUPPLEMENTARY_CODE_VERSION, '1.1');

  const mismatch = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'DVSP-OTHER' }), POST, agency(), { now:NOW });
  assert.ok(mismatch.failures.includes('right_to_work_dvsp_provider_mismatch'));

  const nonExclusiveMissingProvenance = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'' }), POST, agency({
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business',
      rtwDvsp:dvspPolicy({ exclusiveForAgencyRightToWork:false }),
    },
  }), { now:NOW });
  assert.ok(nonExclusiveMissingProvenance.failures.includes('right_to_work_dvsp_provider_provenance_missing'));
});

test('digital verification registry evidence must predate the worker check and raw register evidence is never returned', () => {
  const futureEvidence = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'DVSP-REGISTERED-1' }), POST, agency({
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business',
      rtwDvsp:dvspPolicy({ registryVerifiedAt:'2026-10-04T11:00:00.000Z' }),
    },
  }), { now:NOW });
  assert.ok(futureEvidence.failures.includes('right_to_work_dvsp_registry_evidence_after_worker_check'));

  const pass = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'DVSP-REGISTERED-1' }), POST, agency(), { now:NOW });
  assert.equal(pass.eligible, true);
  assert.equal(pass.evidence.digitalVerificationService.providerId, 'DVSP-REGISTERED-1');
  assert.equal(pass.evidence.digitalVerificationService.registryEvidenceFingerprint.length, 24);
  assert.equal(pass.evidence.digitalVerificationService.rawRegistryEvidenceReturned, false);
  assert.doesNotMatch(JSON.stringify(pass), new RegExp(DVSP_REGISTRY_EVIDENCE));
});

test('Employer Checking Service without a Positive Verification Notice fails closed and does not leak the notice reference', () => {
  const missing = evaluateAgencyRightToWork(worker({ checkMethod:'employer_checking_service' }), POST, agency(), { now:NOW });
  assert.ok(missing.failures.includes('right_to_work_ecs_positive_verification_notice_missing'));

  const pass = evaluateAgencyRightToWork(worker({
    checkMethod:'employer_checking_service', validUntil:'2026-09-30T23:59:59.000Z', positiveVerificationNotice:positiveNotice(),
  }), POST, agency(), { now:NOW });
  assert.equal(pass.eligible, true);
  assert.equal(pass.evidence.lifecycle.evidenceSource, 'positive_verification_notice');
  assert.doesNotMatch(JSON.stringify(pass), /private-pvn-record-123/);
});

test('check provenance is bound to the supplying employment business and cannot be future dated', () => {
  const wrongAgency = evaluateAgencyRightToWork(worker({ checkedByAgencyId:'A2' }), POST, agency(), { now:NOW });
  assert.ok(wrongAgency.failures.includes('right_to_work_checker_agency_mismatch'));

  const future = evaluateAgencyRightToWork(worker({ checkedAt:'2026-10-04T13:00:00.000Z' }), POST, agency(), { now:NOW });
  assert.ok(future.failures.includes('right_to_work_check_in_future'));

  const afterStart = evaluateAgencyRightToWork(worker({ checkedAt:'2026-10-05T07:00:00.000Z' }), POST, agency(), { now:'2026-10-05T08:00:00.000Z' });
  assert.ok(afterStart.failures.includes('right_to_work_check_after_assignment_start'));
});

test('evidence reference is mandatory but raw evidence is not returned', () => {
  const r = evaluateAgencyRightToWork(worker({ evidenceRef:'' }), POST, agency(), { now:NOW });
  assert.ok(r.failures.includes('right_to_work_evidence_ref_missing'));
  assert.equal(r.evidence.evidenceFingerprint, null);
});

test('right-to-work assurance is role, location and assignment-window specific', () => {
  const role = evaluateAgencyRightToWork(worker({ assignmentScope:{ roleId:'FORKLIFT', location:'Plant 1', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true } }), POST, agency(), { now:NOW });
  assert.ok(role.failures.includes('right_to_work_assignment_role_mismatch'));

  const location = evaluateAgencyRightToWork(worker({ assignmentScope:{ roleId:'PACK-OP', location:'Plant 2', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true } }), POST, agency(), { now:NOW });
  assert.ok(location.failures.includes('right_to_work_assignment_location_mismatch'));

  const window = evaluateAgencyRightToWork(worker({ assignmentScope:{ roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T07:00:00.000Z', endAt:'2026-10-05T13:00:00.000Z', restrictionsSatisfied:true } }), POST, agency(), { now:NOW });
  assert.ok(window.failures.includes('right_to_work_assignment_scope_start_not_covered'));
  assert.ok(window.failures.includes('right_to_work_assignment_scope_end_not_covered'));
});

test('assignment restrictions must be affirmatively confirmed and responsibility cannot be shifted to hirer', () => {
  const restrictions = evaluateAgencyRightToWork(worker({ assignmentScope:{ roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:false } }), POST, agency(), { now:NOW });
  assert.ok(restrictions.failures.includes('right_to_work_assignment_restrictions_not_confirmed'));

  const hirerOwned = agency({ rightToWorkScheme:{ arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'hirer' } });
  const responsibility = evaluateAgencyRightToWork(worker(), POST, hirerOwned, { now:NOW });
  assert.ok(responsibility.failures.includes('right_to_work_responsible_party_mismatch'));
});

test('covered time-limited evidence nearing expiry produces an operational refresh warning without becoming a ranking penalty', () => {
  const r = evaluateAgencyRightToWork(worker({ validUntil:'2026-10-10T23:59:59.000Z' }), POST, agency(), { now:NOW, refreshLeadDays:14 });
  assert.equal(r.eligible, true);
  assert.ok(r.warnings.includes('follow_up_due_soon'));
  assert.equal(r.evidence.lifecycle.status, 'refresh_due');
  assert.equal(r.evidence.lifecycle.refreshAction.type, 'request_updated_right_to_work_assurance_from_supplying_agency');
});

test('10,000 cheap high-performance DVSP candidates without compliant provider proof remain ineligible before ranking can consider them', () => {
  let eligible = 0;
  for (let i = 0; i < 10_000; i++) {
    const r = evaluateAgencyRightToWork(worker({ checkMethod:'rtw_dvsp', dvspProviderId:'UNVERIFIED-DVSP' }), POST, agency({
      rightToWorkScheme:{
        arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business',
        rtwDvsp:dvspPolicy({ providerId:'UNVERIFIED-DVSP', registryStatus:'unregistered', trustFrameworkCertified:false, rightToWorkSupplementaryCodeCertified:false }),
      },
    }), { now:NOW });
    if (r.eligible) eligible++;
    assert.ok(r.failures.includes('right_to_work_dvsp_provider_not_registered'));
  }
  assert.equal(eligible, 0);
});
