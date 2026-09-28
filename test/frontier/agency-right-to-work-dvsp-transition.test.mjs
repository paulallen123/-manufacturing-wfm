import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAgencyRightToWork,
  UK_RIGHT_TO_WORK_DVSP_SUPPLEMENTARY_CODE_VERSION,
  UK_RIGHT_TO_WORK_DVSP_VALID_SUPPLEMENTARY_CODE_VERSIONS,
} from '../../src/frontier/agency-right-to-work.mjs';

const NOW = '2026-10-04T12:00:00.000Z';
const REQUEST = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };

function worker(providerId = 'DVSP-1') {
  return {
    workerId:'W1', agencyId:'A1',
    rightToWork:{
      status:'verified', indefinite:true,
      engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
      checkedByAgencyId:'A1', checkMethod:'rtw_dvsp', checkedAt:'2026-10-04T10:00:00.000Z',
      evidenceRef:'private-dvsp-output-1', dvspProviderId:providerId,
      assignmentScope:{ roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true },
    },
  };
}

function agency(version, overrides = {}) {
  return {
    agencyId:'A1',
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business',
      rtwDvsp:{
        providerId:'DVSP-1', registryStatus:'registered', trustFrameworkCertified:true,
        rightToWorkSupplementaryCodeCertified:true, rightToWorkSupplementaryCodeVersion:version,
        registryVerifiedAt:'2026-10-04T09:00:00.000Z', registryEvidenceRef:'server-register-snapshot-1',
        exclusiveForAgencyRightToWork:false,
        ...overrides,
      },
    },
  };
}

test('current 1.1 and transitionally valid 0.4 DVSP evidence pass, while superseded 1.0 fails closed', () => {
  const current = evaluateAgencyRightToWork(worker(), REQUEST, agency('1.1'), { now:NOW });
  const transitional = evaluateAgencyRightToWork(worker(), REQUEST, agency('0.4'), { now:NOW });
  const superseded = evaluateAgencyRightToWork(worker(), REQUEST, agency('1.0'), { now:NOW });

  assert.equal(current.eligible, true, current.failures.join(','));
  assert.equal(current.evidence.digitalVerificationService.supplementaryCodeVersionCurrent, true);
  assert.equal(current.evidence.digitalVerificationService.supplementaryCodeVersionTransitional, false);
  assert.equal(transitional.eligible, true, transitional.failures.join(','));
  assert.equal(transitional.evidence.digitalVerificationService.supplementaryCodeVersionCurrent, false);
  assert.equal(transitional.evidence.digitalVerificationService.supplementaryCodeVersionTransitional, true);
  assert.equal(superseded.eligible, false);
  assert.ok(superseded.failures.includes('right_to_work_dvsp_supplementary_code_version_not_current'));
  assert.equal(UK_RIGHT_TO_WORK_DVSP_SUPPLEMENTARY_CODE_VERSION, '1.1');
  assert.deepEqual(UK_RIGHT_TO_WORK_DVSP_VALID_SUPPLEMENTARY_CODE_VERSIONS, ['0.4','1.1']);
});

test('unregistered, uncertified, mismatched or post-check registry evidence stays ineligible', () => {
  const cases = [
    agency('1.1', { registryStatus:'unregistered' }),
    agency('1.1', { trustFrameworkCertified:false }),
    agency('1.1', { rightToWorkSupplementaryCodeCertified:false }),
    agency('1.1', { registryVerifiedAt:'2026-10-04T11:00:00.000Z' }),
  ];
  const expected = [
    'right_to_work_dvsp_provider_not_registered',
    'right_to_work_dvsp_trust_framework_certification_not_confirmed',
    'right_to_work_dvsp_supplementary_code_certification_not_confirmed',
    'right_to_work_dvsp_registry_evidence_after_worker_check',
  ];
  for (let i = 0; i < cases.length; i++) {
    const result = evaluateAgencyRightToWork(worker(), REQUEST, cases[i], { now:NOW });
    assert.equal(result.eligible, false);
    assert.ok(result.failures.includes(expected[i]), `${expected[i]} absent from ${result.failures.join(',')}`);
  }

  const mismatch = evaluateAgencyRightToWork(worker('DVSP-OTHER'), REQUEST, agency('1.1'), { now:NOW });
  assert.equal(mismatch.eligible, false);
  assert.ok(mismatch.failures.includes('right_to_work_dvsp_provider_mismatch'));
});

test('10,000 unregistered DVSP evaluations never become eligible and raw registry evidence never leaks', () => {
  const unsafe = agency('1.1', { registryStatus:'unregistered', registryEvidenceRef:'RAW-PRIVATE-REGISTER-EVIDENCE' });
  let accepted = 0;
  for (let i = 0; i < 10_000; i++) {
    const result = evaluateAgencyRightToWork(worker(), REQUEST, unsafe, { now:NOW });
    if (result.eligible) accepted++;
    assert.ok(result.failures.includes('right_to_work_dvsp_provider_not_registered'));
    assert.doesNotMatch(JSON.stringify(result), /RAW-PRIVATE-REGISTER-EVIDENCE/);
  }
  assert.equal(accepted, 0);
});
