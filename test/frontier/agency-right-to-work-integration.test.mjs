import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgencyLabourFulfilment } from '../../src/frontier/agency-labour-exchange.mjs';

function request() {
  return {
    requestId:'REQ-RTW-1', hirerName:'Synthetic Manufacturing Ltd', businessNature:'Manufacturing',
    roleId:'PACK-OP', roleName:'Packing Operative', duties:'Operate packing line', location:'Plant 1, Birmingham',
    startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z', expectedDuration:'1 shift',
    daysAndHours:'Monday 06:00-14:00', count:1, requiredSkills:[{id:'packing',level:1}],
    requiredQualifications:[{id:'food-safety',level:1}], healthSafetyRisks:[], controlMeasures:[], expenses:{}, payAndConditions:{},
    maxChargePerHour:25, standardRole:true, industrialActionReplacement:false,
  };
}

function agency(id, withRtwScheme) {
  return {
    agencyId:id, approved:true, active:true, responseSlaMinutes:5, performance:{fillReliability:0.9},
    ...(withRtwScheme ? { rightToWorkScheme:{ arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business' } } : {}),
  };
}

function worker(id, agencyId, quality, rate, completeRtw = true) {
  return {
    workerId:id, agencyId, consentToShare:true, available:true, siteReady:true, restCompliant:true, suitabilityStatus:'suitable',
    availability:{startAt:'2026-10-05T05:00:00.000Z',endAt:'2026-10-05T15:00:00.000Z'}, inductionValidUntil:'2027-01-01T00:00:00.000Z',
    rightToWork:{
      status:'verified', validUntil:'2027-12-31T23:59:59.000Z',
      ...(completeRtw ? {
        engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
        checkedByAgencyId:agencyId, checkMethod:'home_office_online', checkedAt:'2026-10-04T10:00:00.000Z',
        evidenceRef:`private-${agencyId}-${id}-rtw-record`,
        assignmentScope:{ roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true },
      } : {}),
    },
    skills:[{id:'packing',level:2}], qualifications:[{id:'food-safety',level:1,status:'valid',validUntil:'2027-12-31T23:59:59.000Z'}],
    awr:{weeksInSameRole:4,equalTreatmentConfirmed:false}, chargeRatePerHour:rate,
    performance:{completedShifts:60,attendanceRate:quality,punctualityRate:quality,qualityScore:quality,productivityScore:quality,completedSiteShifts:20,completedRoleShifts:20},
  };
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32);
}

test('post-1-October right-to-work assurance excludes stronger-scoring non-compliant worker before ranking', () => {
  const input = {
    tenantId:'tenant-1', siteId:'site-1', now:'2026-10-04T12:00:00.000Z', request:request(),
    agencies:[agency('A1', true), agency('A2', false)],
    candidates:[
      worker('W-COMPLIANT','A1',0.82,24,true),
      worker('W-PERFECT-BUT-NO-ASSURANCE','A2',1.0,15,false),
    ],
    policy:{parallelAgencies:2,responseSlaMinutes:5,autoDispatchApprovedAgencies:true},
  };

  const result = planAgencyLabourFulfilment(input);
  assert.equal(result.selectedWorkers.length, 1);
  assert.equal(result.selectedWorkers[0].workerId, 'W-COMPLIANT');
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.responsibleParty, 'employment_business');
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.assignmentScope.roleId, 'PACK-OP');
  assert.equal(result.selectedWorkers[0].rightToWorkEvidence.assignmentScope.location, 'Plant 1, Birmingham');

  const rejected = result.rejectedWorkers.find(item => item.workerId === 'W-PERFECT-BUT-NO-ASSURANCE');
  assert.ok(rejected);
  assert.equal(rejected.score, null);
  assert.ok(rejected.failures.includes('right_to_work_engagement_type_unclassified'));
  assert.ok(rejected.failures.includes('right_to_work_arrangement_unclassified'));
  assert.ok(rejected.failures.includes('right_to_work_responsible_party_mismatch'));
  assert.ok(rejected.failures.includes('right_to_work_check_method_not_prescribed'));

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-A1-W-COMPLIANT-rtw-record/);
  assert.equal(Object.hasOwn(result.selectedWorkers[0].rightToWorkEvidence, 'evidenceRef'), false);
  assert.match(result.authorityBoundary, /no_schedule_payroll_or_invoice_mutation/);
});

test('expired ECS Positive Verification Notice cannot be outranked by price or performance', () => {
  const compliant = worker('W-COMPLIANT','A1',0.72,24,true);
  const cheaper = worker('W-CHEAPER-EXPIRED-PVN','A1',1.0,15,true);
  cheaper.rightToWork.checkMethod = 'employer_checking_service';
  cheaper.rightToWork.validUntil = '2027-12-31T23:59:59.000Z';
  cheaper.rightToWork.positiveVerificationNotice = {
    status:'positive', issuedAt:'2026-04-04T09:00:00.000Z', validUntil:'2026-10-05T13:00:00.000Z',
    evidenceRef:'private-expired-pvn-reference',
  };

  const result = planAgencyLabourFulfilment({
    tenantId:'tenant-1', siteId:'site-1', now:'2026-10-04T12:00:00.000Z', request:request(),
    agencies:[agency('A1', true)], candidates:[compliant, cheaper],
    policy:{parallelAgencies:1,responseSlaMinutes:5,autoDispatchApprovedAgencies:true},
  });

  assert.equal(result.selectedWorkers[0].workerId, 'W-COMPLIANT');
  const rejected = result.rejectedWorkers.find(item => item.workerId === 'W-CHEAPER-EXPIRED-PVN');
  assert.ok(rejected);
  assert.equal(rejected.score, null);
  assert.ok(rejected.failures.includes('right_to_work_expires_before_shift_end'));
  assert.equal(rejected.rightToWorkEligibility.evidence.lifecycle.evidenceSource, 'positive_verification_notice');
  assert.doesNotMatch(JSON.stringify(result), /private-expired-pvn-reference/);
});

test('5,000 post-effective-date candidates never let performance or price outrank missing right-to-work assurance', () => {
  const random = lcg(0x51a77e11);
  let selected = 0;
  let rejectedWithoutAssurance = 0;

  for (let scenario = 0; scenario < 500; scenario++) {
    const req = request();
    req.requestId = `REQ-RTW-STRESS-${scenario}`;
    req.count = 4;
    const truth = new Map();
    const candidates = [];

    for (let index = 0; index < 10; index++) {
      const completeRtw = random() > 0.40;
      const quality = completeRtw ? 0.60 + random() * 0.25 : 0.95 + random() * 0.05;
      const rate = completeRtw ? 20 + random() * 5 : 15 + random() * 3;
      const candidate = worker(`S${scenario}-W${index}`, 'A1', quality, rate, completeRtw);
      truth.set(candidate.workerId, completeRtw);
      candidates.push(candidate);
    }

    const result = planAgencyLabourFulfilment({
      tenantId:'tenant-1', siteId:'site-1', now:'2026-10-04T12:00:00.000Z', request:req,
      agencies:[agency('A1', true)], candidates,
      policy:{parallelAgencies:1,responseSlaMinutes:5,autoDispatchApprovedAgencies:true},
    });

    for (const chosen of result.selectedWorkers) {
      selected++;
      assert.equal(truth.get(chosen.workerId), true, chosen.workerId);
    }
    for (const rejected of result.rejectedWorkers) {
      if (!truth.get(rejected.workerId)) {
        rejectedWithoutAssurance++;
        assert.equal(rejected.score, null);
        assert.ok(rejected.failures.includes('right_to_work_check_method_not_prescribed'));
      }
    }
  }

  assert.ok(selected > 1_000);
  assert.ok(rejectedWithoutAssurance > 1_500);
});
