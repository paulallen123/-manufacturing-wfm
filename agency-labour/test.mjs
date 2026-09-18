import assert from 'node:assert/strict';
import { createRequirementPlan, clockingExceptions, reconcileInvoice, estimateTouchlessSavings, workerEligibility, explainWorkerFit } from './engine.mjs';

const NOW = '2026-09-18T11:00:00Z';
const baseRequirement = {
  id: 'REQ-001', siteId: 'PLANT-1', shiftId: 'SHIFT-N1', role: 'PACKING_OPERATOR', headcount: 3,
  shiftHours: 8, shiftStart: '2026-09-18T22:00:00Z', requiredCertifications: ['SITE_INDUCTION']
};
const policy = {
  supplierResponseMinutes: 10,
  notice: { shiftNoticePresumptionHours: 24 },
  matching: { minHistoryForHighConfidence: 5, staleHistoryDays: 180, maxSiteExperienceWeight: 0.15, humanReviewRequired: true }
};
const suppliers = [
  { id:'A', active:true, roles:['PACKING_OPERATOR'], tier:1, billRate:18.5, fillRate:.95, avgResponseMinutes:7, capacity:2 },
  { id:'B', active:true, roles:['PACKING_OPERATOR'], tier:2, billRate:17.9, fillRate:.88, avgResponseMinutes:12, capacity:3 }
];
const workers = [
  { id:'W1', supplierId:'A', skills:['PACKING_OPERATOR'], availableShiftIds:['SHIFT-N1'], certifications:[{code:'SITE_INDUCTION',validUntil:'2027-01-01'}], attendanceRate:.99, punctualityRate:.98, siteRoleHistory:[{siteId:'PLANT-1',role:'PACKING_OPERATOR',completedShifts:20,qualityIndex:.94,lastShiftAt:'2026-09-10'}] },
  { id:'W2', supplierId:'A', skills:['PACKING_OPERATOR'], availableShiftIds:['SHIFT-N1'], certifications:[{code:'SITE_INDUCTION',validUntil:'2027-01-01'}], attendanceRate:.97, punctualityRate:.97, siteRoleHistory:[{siteId:'PLANT-1',role:'PACKING_OPERATOR',completedShifts:7,qualityIndex:.91,lastShiftAt:'2026-09-01'}] },
  { id:'W3', supplierId:'B', skills:['PACKING_OPERATOR'], availableShiftIds:['SHIFT-N1'], certifications:[{code:'SITE_INDUCTION',validUntil:'2027-01-01'}], attendanceRate:.96, punctualityRate:.95, siteRoleHistory:[] },
  { id:'W4', supplierId:'B', skills:['PACKING_OPERATOR'], availableShiftIds:['SHIFT-N1'], certifications:[{code:'SITE_INDUCTION',validUntil:'2026-01-01'}], attendanceRate:1, punctualityRate:1, siteRoleHistory:[] }
];

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('same-day request is flagged high notice risk and retains emergency evidence field', () => {
  const plan = createRequirementPlan({ requirement:{...baseRequirement, emergencyReason:'SICKNESS_SPIKE'}, suppliers, workers, policy, now:NOW });
  assert.equal(plan.noticeRisk.risk, 'HIGH');
  assert.equal(plan.noticeRisk.evidenceRequired, true);
});

test('supplier cascade uses preferred tier first and auto-cascades shortage', () => {
  const plan = createRequirementPlan({ requirement:baseRequirement, suppliers, workers, policy, now:NOW });
  assert.equal(plan.supplierCascade[0].supplierId, 'A');
  assert.equal(plan.supplierCascade[0].requestedHeadcount, 2);
  assert.equal(plan.supplierCascade[1].supplierId, 'B');
  assert.equal(plan.supplierCascade[1].requestedHeadcount, 1);
});

test('expired certification blocks worker', () => {
  const e = workerEligibility(workers[3], baseRequirement, new Date(NOW));
  assert.equal(e.eligible, false);
  assert.ok(e.blocks.some(x => x.startsWith('CERT_EXPIRED')));
});

test('new compliant worker is eligible with neutral-start safeguard rather than punitive score', () => {
  const f = explainWorkerFit(workers[2], baseRequirement, policy, new Date(NOW));
  assert.equal(f.recommendationBand, 'ELIGIBLE_NEW');
  assert.equal(f.safeguards.newWorkerNeutralBaseline, true);
});

test('experienced comparable worker can be preferred with explanation', () => {
  const f = explainWorkerFit(workers[0], baseRequirement, policy, new Date(NOW));
  assert.equal(f.recommendationBand, 'PREFERRED');
  assert.ok(f.reasons.includes('STRONG_ATTENDANCE'));
  assert.equal(f.safeguards.humanReviewRequired, true);
});

test('touchless eligibility is true when enough eligible workers and suppliers exist', () => {
  const plan = createRequirementPlan({ requirement:baseRequirement, suppliers, workers, policy, now:NOW });
  assert.equal(plan.touchlessEligible, true);
});

test('no-show triggers replacement exception', () => {
  const x = clockingExceptions({ confirmations:[{workerId:'W1',shiftStart:'2026-09-18T22:00:00Z'}], clockings:[] });
  assert.equal(x[0].type, 'NO_SHOW');
  assert.equal(x[0].action, 'TRIGGER_REPLACEMENT_AND_NOTIFY_SUPPLIER');
});

test('late arrival is detected', () => {
  const x = clockingExceptions({ confirmations:[{workerId:'W1',shiftStart:'2026-09-18T22:00:00Z'}], clockings:[{workerId:'W1',clockIn:'2026-09-18T22:12:00Z'}] });
  assert.equal(x[0].type, 'LATE_ARRIVAL');
});

test('invoice hours mismatch is blocked from auto-approval', () => {
  const r = reconcileInvoice({ approved:[{workerId:'W1',hours:8,billRate:18.5}], invoice:[{workerId:'W1',hours:9,billRate:18.5}] });
  assert.equal(r.autoApprove, false);
  assert.equal(r.exceptions[0].type, 'HOURS_MISMATCH');
});

test('invoice rate mismatch is blocked from auto-approval', () => {
  const r = reconcileInvoice({ approved:[{workerId:'W1',hours:8,billRate:18.5}], invoice:[{workerId:'W1',hours:8,billRate:19.5}] });
  assert.equal(r.autoApprove, false);
  assert.equal(r.exceptions[0].type, 'RATE_MISMATCH');
});

test('clean invoice can auto-approve', () => {
  const r = reconcileInvoice({ approved:[{workerId:'W1',hours:8,billRate:18.5}], invoice:[{workerId:'W1',hours:8,billRate:18.5}] });
  assert.equal(r.autoApprove, true);
  assert.equal(r.variance, 0);
});

test('touchless savings model is transparent and baseline-driven', () => {
  const s = estimateTouchlessSavings({ requirementsPerWeek:30, minutesPerManualRequirement:12, touchlessRate:.7, managerHourlyCost:35, agencyMinutesSavedPerRequirement:8, agencyHourlyCost:25 });
  assert.equal(s.managerHoursSavedPerWeek, 4.2);
  assert.equal(s.manufacturerAdminSavingPerWeek, 147);
  assert.match(s.note, /Illustrative only/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}`); throw e; }
}
console.log(`\n${passed}/${tests.length} tests passed`);
