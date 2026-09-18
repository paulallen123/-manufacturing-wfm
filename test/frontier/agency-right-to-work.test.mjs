import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAgencyRightToWork,
  UK_RIGHT_TO_WORK_2026_EFFECTIVE_AT,
} from '../../src/frontier/agency-right-to-work.mjs';

const PRE = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-09-21T06:00:00.000Z', endAt:'2026-09-21T14:00:00.000Z' };
const POST = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };
const NOW = '2026-10-04T12:00:00.000Z';

function agency(overrides = {}) {
  return {
    agencyId:'A1',
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations',
      responsibleParty:'employment_business',
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

test('all prescribed check routes are treated neutrally while unrecognised methods fail', () => {
  for (const checkMethod of ['home_office_online','manual_document','rtw_dvsp','employer_checking_service']) {
    const r = evaluateAgencyRightToWork(worker({ checkMethod }), POST, agency(), { now:NOW });
    assert.equal(r.eligible, true, checkMethod);
  }
  const bad = evaluateAgencyRightToWork(worker({ checkMethod:'passport_copy_only' }), POST, agency(), { now:NOW });
  assert.ok(bad.failures.includes('right_to_work_check_method_not_prescribed'));
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
