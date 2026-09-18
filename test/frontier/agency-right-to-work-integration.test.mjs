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
  assert.ok(rejected.failures.includes('right_to_work_arrangement_unclassified'));
  assert.ok(rejected.failures.includes('right_to_work_responsible_party_mismatch'));
  assert.ok(rejected.failures.includes('right_to_work_check_method_not_prescribed'));

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-A1-W-COMPLIANT-rtw-record/);
  assert.equal(Object.hasOwn(result.selectedWorkers[0].rightToWorkEvidence, 'evidenceRef'), false);
  assert.match(result.authorityBoundary, /no_schedule_payroll_or_invoice_mutation/);
});
