import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgencyLabourFulfilment } from '../../src/frontier/agency-labour-exchange.mjs';

const NOW = '2026-09-18T12:00:00.000Z';
const START = '2026-09-21T06:00:00.000Z';
const END = '2026-09-21T14:00:00.000Z';

function candidate(workerId, agencyId, performance) {
  return {
    workerId, agencyId, consentToShare: true, available: true, siteReady: true, restCompliant: true,
    suitabilityStatus: 'suitable', availability: { startAt: '2026-09-21T05:00:00.000Z', endAt: '2026-09-21T15:00:00.000Z' },
    inductionValidUntil: '2026-12-31T23:59:59.000Z',
    rightToWork: { status: 'verified', validUntil: '2027-12-31T23:59:59.000Z' },
    skills: [{ id: 'packing', level: 2 }],
    qualifications: [{ id: 'food-safety', level: 1, status: 'valid', validUntil: '2027-12-31T23:59:59.000Z' }],
    awr: { weeksInSameRole: 4, equalTreatmentConfirmed: false }, chargeRatePerHour: agencyId === 'BAD' ? 10 : 22,
    performance,
  };
}

test('non-compliant covered supplier cannot reach worker ranking or dispatch even with stronger worker metrics', () => {
  const goodPerformance = { completedShifts: 20, attendanceRate: .9, punctualityRate: .9, qualityScore: .9, productivityScore: .9, completedSiteShifts: 10, completedRoleShifts: 12 };
  const perfectPerformance = { completedShifts: 100, attendanceRate: 1, punctualityRate: 1, qualityScore: 1, productivityScore: 1, completedSiteShifts: 100, completedRoleShifts: 100 };
  const result = planAgencyLabourFulfilment({
    now: NOW,
    tenantId: 'tenant-1',
    siteId: 'site-1',
    request: {
      requestId: 'REQ-FWA-1', hirerName: 'Synthetic Manufacturing Ltd', businessNature: 'Food packaging',
      roleId: 'PACK-OP', roleName: 'Packing Operative', duties: 'Operate packing line', location: 'Plant 1',
      startAt: START, endAt: END, expectedDuration: '1 shift', daysAndHours: 'Monday 06:00-14:00', count: 1,
      requiredSkills: [{ id: 'packing', level: 1 }], requiredQualifications: [{ id: 'food-safety', level: 1 }],
      healthSafetyRisks: [], expenses: {}, payAndConditions: {}, maxChargePerHour: 25, standardRole: true,
      industrialActionReplacement: false, fairWorkAgencyGangmasterLicenceRequired: true,
    },
    agencies: [
      { agencyId: 'GOOD', approved: true, active: true, performance: { fillReliability: .8 }, fairWorkAgencyGangmasterLicence: { status: 'licensed', evidenceRef: 'fwa-register-snapshot:GOOD', providerReference: 'FWA-GOOD', checkedAt: '2026-09-18T09:00:00.000Z' } },
      { agencyId: 'BAD', approved: true, active: true, performance: { fillReliability: 1 } },
    ],
    candidates: [candidate('W-GOOD', 'GOOD', goodPerformance), candidate('W-BAD', 'BAD', perfectPerformance)],
    policy: { autoDispatchApprovedAgencies: true, parallelAgencies: 2 },
  });

  assert.deepEqual(result.selectedWorkers.map(worker => worker.workerId), ['W-GOOD']);
  const rejected = result.rejectedWorkers.find(worker => worker.workerId === 'W-BAD');
  assert.ok(rejected.failures.includes('fwa_gangmaster_licence_evidence_missing'));
  assert.deepEqual(result.dispatchPlan.phases.flatMap(phase => phase.agencies.map(agency => agency.agencyId)), ['GOOD']);
  assert.equal(result.supplierEligibility.find(agency => agency.agencyId === 'BAD').eligible, false);
});
