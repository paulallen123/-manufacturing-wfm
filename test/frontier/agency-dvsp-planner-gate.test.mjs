import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgencyLabourFulfilment } from '../../src/frontier/agency-labour-exchange.mjs';
import {
  createAgencyRightToWorkDvspEvidenceVersion,
  toAgencyRightToWorkDvspPolicySnapshot,
} from '../../src/frontier/agency-right-to-work-dvsp-evidence.mjs';

const NOW = '2026-10-04T12:00:00.000Z';
const START = '2026-10-05T06:00:00.000Z';
const END = '2026-10-05T14:00:00.000Z';

function request(count = 1) {
  return {
    requestId:'REQ-DVSP-PLAN-1', hirerName:'Synthetic Manufacturing Ltd', businessNature:'Manufacturing',
    roleId:'PACK-OP', roleName:'Packing Operative', duties:'Operate packing line', location:'Plant 1, Birmingham',
    startAt:START, endAt:END, expectedDuration:'1 shift', daysAndHours:'Monday 06:00-14:00', count,
    requiredSkills:[{id:'packing',level:1}], requiredQualifications:[{id:'food-safety',level:1}],
    healthSafetyRisks:[], controlMeasures:[], expenses:{}, payAndConditions:{}, maxChargePerHour:25,
    standardRole:true, industrialActionReplacement:false,
  };
}

function staticDvspPolicy(overrides = {}) {
  return {
    providerId:'DVSP-1', registryStatus:'registered', trustFrameworkCertified:true,
    rightToWorkSupplementaryCodeCertified:true, rightToWorkSupplementaryCodeVersion:'1.1',
    registryVerifiedAt:'2026-10-04T09:00:00.000Z', registryEvidenceRef:'legacy-static-register-config',
    exclusiveForAgencyRightToWork:false,
    ...overrides,
  };
}

function agency(rtwDvsp = staticDvspPolicy()) {
  return {
    agencyId:'A1', approved:true, active:true, responseSlaMinutes:5, performance:{fillReliability:0.92},
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations',
      responsibleParty:'employment_business',
      rtwDvsp,
    },
  };
}

function worker(id, { method='home_office_online', quality=0.8, rate=22 } = {}) {
  const rightToWork = {
    status:'verified', validUntil:'2027-12-31T23:59:59.000Z', engagementType:'workers_contract',
    employmentCommencedAt:'2026-10-02T09:00:00.000Z', checkedByAgencyId:'A1', checkMethod:method,
    checkedAt:'2026-10-04T10:00:00.000Z', evidenceRef:`private-${id}-right-to-work-record`,
    assignmentScope:{ roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true },
  };
  if (method === 'rtw_dvsp') rightToWork.dvspProviderId = 'DVSP-1';
  return {
    workerId:id, agencyId:'A1', consentToShare:true, available:true, siteReady:true, restCompliant:true,
    suitabilityStatus:'suitable', availability:{startAt:'2026-10-05T05:00:00.000Z',endAt:'2026-10-05T15:00:00.000Z'},
    inductionValidUntil:'2027-01-01T00:00:00.000Z', rightToWork,
    skills:[{id:'packing',level:2}], qualifications:[{id:'food-safety',level:1,status:'valid',validUntil:'2027-12-31T23:59:59.000Z'}],
    awr:{weeksInSameRole:4,equalTreatmentConfirmed:false}, chargeRatePerHour:rate,
    performance:{completedShifts:60,attendanceRate:quality,punctualityRate:quality,qualityScore:quality,productivityScore:quality,completedSiteShifts:20,completedRoleShifts:20},
  };
}

function versionedPolicy(overrides = {}) {
  const evidence = createAgencyRightToWorkDvspEvidenceVersion({
    tenantId:'T1', agencyId:'A1', providerId:'DVSP-1', registryStatus:'registered', trustFrameworkCertified:true,
    rightToWorkSupplementaryCodeCertified:true, rightToWorkSupplementaryCodeVersion:'1.1',
    exclusiveForAgencyRightToWork:false, effectiveAt:'2026-09-02T00:00:00.000Z', expiresAt:'2027-09-02T00:00:00.000Z',
    registryVerifiedAt:'2026-10-04T09:00:00.000Z', registryEvidenceRef:'private-ofdia-register-record',
    evidenceSource:'ofdia_statutory_dvs_register', recordedAt:'2026-10-04T09:01:00.000Z',
    ...overrides,
  });
  const snapshot = toAgencyRightToWorkDvspPolicySnapshot(evidence);
  return { evidence, policy:{ ...snapshot, registryEvidenceRef:`fingerprint:${snapshot.registryEvidenceFingerprint}` } };
}

function planWith(agencyValue, candidates, count = 1) {
  return planAgencyLabourFulfilment({
    tenantId:'T1', siteId:'S1', now:NOW, request:request(count), agencies:[agencyValue], candidates,
    policy:{parallelAgencies:1,responseSlaMinutes:5,autoDispatchApprovedAgencies:true},
  });
}

test('candidate planner rejects plausible static DVSP policy before ranking', () => {
  const dvsp = worker('W-DVSP-STATIC', { method:'rtw_dvsp', quality:1, rate:15 });
  const compliant = worker('W-HO', { quality:0.7, rate:24 });
  const result = planWith(agency(), [dvsp, compliant]);

  assert.equal(result.selectedWorkers[0].workerId, 'W-HO');
  const rejected = result.rejectedWorkers.find(item => item.workerId === 'W-DVSP-STATIC');
  assert.ok(rejected);
  assert.equal(rejected.score, null);
  assert.ok(rejected.failures.includes('right_to_work_dvsp_provider_evidence_version_missing'));
  assert.ok(rejected.failures.includes('right_to_work_dvsp_provider_evidence_tenant_mismatch'));
  assert.ok(rejected.failures.includes('right_to_work_dvsp_registry_evidence_fingerprint_missing'));
  assert.equal(rejected.rightToWorkEligibility.evidence.digitalVerificationService.versionedProviderEvidenceRequiredForRanking, true);
});

test('planner accepts DVSP candidate only when durable point-in-time evidence metadata is present', () => {
  const { evidence, policy } = versionedPolicy();
  const dvsp = worker('W-DVSP-VERSIONED', { method:'rtw_dvsp', quality:1, rate:15 });
  const compliant = worker('W-HO', { quality:0.7, rate:24 });
  const result = planWith(agency(policy), [dvsp, compliant]);

  assert.equal(result.selectedWorkers[0].workerId, 'W-DVSP-VERSIONED');
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.digitalVerificationService.providerEvidenceVersionId, evidence.evidenceVersionId);
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.digitalVerificationService.providerEvidenceAgencyId, 'A1');
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.digitalVerificationService.versionedProviderEvidenceRequiredForRanking, true);
  assert.doesNotMatch(JSON.stringify(result), /private-ofdia-register-record/);
  assert.doesNotMatch(JSON.stringify(result), /private-W-DVSP-VERSIONED-right-to-work-record/);
});

test('wrong-tenant, wrong-agency or expired provider evidence cannot be rescued by price or performance', () => {
  const wrongAgency = versionedPolicy().policy;
  wrongAgency.evidenceAgencyId = 'A2';
  const wrongTenant = versionedPolicy().policy;
  wrongTenant.evidenceTenantId = 'T2';
  const expired = versionedPolicy().policy;
  expired.evidenceExpiresAt = '2026-10-04T10:00:00.000Z';
  const dvsp = worker('W-DVSP', { method:'rtw_dvsp', quality:1, rate:15 });

  const a = planWith(agency(wrongAgency), [dvsp]);
  assert.equal(a.selectedWorkers.length, 0);
  assert.equal(a.rejectedWorkers[0].score, null);
  assert.ok(a.rejectedWorkers[0].failures.includes('right_to_work_dvsp_provider_evidence_agency_mismatch'));

  const tenantMismatch = planWith(agency(wrongTenant), [dvsp]);
  assert.equal(tenantMismatch.selectedWorkers.length, 0);
  assert.equal(tenantMismatch.rejectedWorkers[0].score, null);
  assert.ok(tenantMismatch.rejectedWorkers[0].failures.includes('right_to_work_dvsp_provider_evidence_tenant_mismatch'));

  const b = planWith(agency(expired), [dvsp]);
  assert.equal(b.selectedWorkers.length, 0);
  assert.equal(b.rejectedWorkers[0].score, null);
  assert.ok(b.rejectedWorkers[0].failures.includes('right_to_work_dvsp_provider_evidence_expired_at_worker_check'));
});

test('5,000 high-scoring cheap workers with unversioned DVSP policy never enter ranking', () => {
  const compliant = worker('W-HO', { quality:0.65, rate:24 });
  let rejected = 0;
  for (let scenario = 0; scenario < 500; scenario += 1) {
    const candidates = [compliant];
    for (let index = 0; index < 10; index += 1) {
      candidates.push(worker(`S${scenario}-W${index}`, { method:'rtw_dvsp', quality:0.99, rate:15 }));
    }
    const result = planWith(agency(), candidates, 1);
    assert.equal(result.selectedWorkers[0].workerId, 'W-HO');
    for (const item of result.rejectedWorkers.filter(item => item.workerId !== 'W-HO')) {
      rejected += 1;
      assert.equal(item.score, null);
      assert.ok(item.failures.includes('right_to_work_dvsp_provider_evidence_version_missing'));
    }
  }
  assert.equal(rejected, 5_000);
});
