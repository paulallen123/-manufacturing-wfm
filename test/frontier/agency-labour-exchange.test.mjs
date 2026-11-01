import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planAgencyLabourFulfilment,
  evaluateAgencyCandidate,
  validateAgencyResponse,
  reconcileAgencyInvoiceLine,
} from '../../src/frontier/agency-labour-exchange.mjs';

const START = '2026-09-21T06:00:00.000Z';
const END = '2026-09-21T14:00:00.000Z';

function baseRequest() {
  return {
    requestId: 'REQ-100', hirerName: 'Synthetic Manufacturing Ltd', businessNature: 'Food packaging',
    roleId: 'PACK-OP', roleName: 'Packing Operative', duties: 'Operate and inspect packing line',
    location: 'Plant 1, Birmingham', startAt: START, endAt: END, expectedDuration: '1 shift',
    daysAndHours: 'Monday 06:00-14:00', count: 2, requiredSkills: [{ id: 'packing', level: 1 }],
    requiredQualifications: [{ id: 'food-safety', level: 1 }], healthSafetyRisks: [{ id: 'machinery', severity: 'medium' }],
    controlMeasures: ['guarding', 'site induction'], expenses: {}, payAndConditions: { shiftPremium: 0 },
    maxChargePerHour: 25, standardRole: true, industrialActionReplacement: false,
  };
}

function agency(id, reliability = 0.9) {
  return { agencyId: id, approved: true, active: true, responseSlaMinutes: 5, performance: { fillReliability: reliability } };
}

function worker(id, agencyId, overrides = {}) {
  const base = {
    workerId: id, agencyId, consentToShare: true, available: true, siteReady: true, restCompliant: true,
    suitabilityStatus: 'suitable', availability: { startAt: '2026-09-21T05:00:00.000Z', endAt: '2026-09-21T15:00:00.000Z' },
    inductionValidUntil: '2026-12-31T23:59:59.000Z', rightToWork: { status: 'verified', validUntil: '2027-12-31T23:59:59.000Z' },
    skills: [{ id: 'packing', level: 2 }], qualifications: [{ id: 'food-safety', level: 1, status: 'valid', validUntil: '2027-12-31T23:59:59.000Z' }],
    awr: { weeksInSameRole: 4, equalTreatmentConfirmed: false }, chargeRatePerHour: 22,
    performance: { completedShifts: 30, attendanceRate: 0.98, punctualityRate: 0.97, qualityScore: 0.96, productivityScore: 0.95, completedSiteShifts: 18, completedRoleShifts: 20 },
  };
  return { ...base, ...overrides };
}

function baseInput() {
  return {
    now: '2026-09-18T11:45:00.000Z', tenantId: 'tenant-1', siteId: 'site-1', request: baseRequest(),
    agencies: [agency('A1', 0.95), agency('A2', 0.85), agency('A3', 0.75)],
    candidates: [
      worker('W1', 'A1'),
      worker('W2', 'A1', { chargeRatePerHour: 21, performance: { completedShifts: 25, attendanceRate: 0.96, punctualityRate: 0.95, qualityScore: 0.94, productivityScore: 0.93, completedSiteShifts: 15, completedRoleShifts: 18 } }),
      worker('W3', 'A2', { chargeRatePerHour: 18, performance: { completedShifts: 3, attendanceRate: 0.7, punctualityRate: 0.7, qualityScore: 0.75, productivityScore: 0.8, completedSiteShifts: 1, completedRoleShifts: 1 } }),
    ],
    policy: { parallelAgencies: 2, responseSlaMinutes: 5, autoDispatchApprovedAgencies: true },
  };
}

test('selects proven eligible workers and creates a staged agency cascade', () => {
  const r = planAgencyLabourFulfilment(baseInput());
  assert.equal(r.status, 'preferred_workers_identified');
  assert.deepEqual(r.selectedWorkers.map(x => x.workerId), ['W1', 'W2']);
  assert.equal(r.dispatchPlan.mode, 'approved_agency_auto_dispatch');
  assert.equal(r.dispatchPlan.phases[0].agencies.length, 2);
  assert.ok(r.dispatchPlan.phases[0].agencies.some(a => a.agencyId === 'A1'));
  assert.ok(r.dispatchPlan.actionContract.forbids.includes('direct_schedule_write'));
});

test('right-to-work, qualifications, rest, site readiness and AWR parity are hard gates', () => {
  const request = baseRequest(), a = agency('A1');
  const cases = [
    worker('x1', 'A1', { rightToWork: { status: 'unchecked' } }),
    worker('x2', 'A1', { qualifications: [] }),
    worker('x3', 'A1', { restCompliant: false }),
    worker('x4', 'A1', { siteReady: false }),
    worker('x5', 'A1', { awr: { weeksInSameRole: 12, equalTreatmentConfirmed: false } }),
  ];
  const expected = ['right_to_work_not_verified', 'invalid_qualification:food-safety', 'working_time_or_rest_not_confirmed', 'worker_not_site_ready', 'awr_equal_treatment_not_confirmed'];
  cases.forEach((candidate, i) => {
    const r = evaluateAgencyCandidate(candidate, request, a);
    assert.equal(r.eligible, false);
    assert.ok(r.failures.includes(expected[i]));
  });
});

test('industrial action replacement request is blocked before any worker ranking', () => {
  const input = baseInput();
  input.request.industrialActionReplacement = true;
  const r = planAgencyLabourFulfilment(input);
  assert.equal(r.status, 'request_blocked');
  assert.ok(r.requestFailures.includes('industrial_action_replacement_forbidden'));
  assert.equal(r.selectedWorkers.length, 0);
});

test('sensitive attributes are ignored and cannot change ranking score', () => {
  const request = baseRequest(), a = agency('A1');
  const base = worker('W1', 'A1');
  const withSensitive = { ...structuredClone(base), age: 61, sex: 'female', ethnicity: 'x', disability: 'x', nationality: 'x' };
  const x = evaluateAgencyCandidate(base, request, a);
  const y = evaluateAgencyCandidate(withSensitive, request, a);
  assert.equal(x.score.score, y.score.score);
  assert.ok(y.ignoredSensitiveFields.includes('age'));
  assert.ok(y.ignoredSensitiveFields.includes('sex'));
});

test('cheapest worker does not beat strongly evidenced better worker solely on price', () => {
  const r = planAgencyLabourFulfilment(baseInput());
  assert.ok(!r.selectedWorkers.some(x => x.workerId === 'W3'));
  assert.ok(r.selectedWorkers[0].score.score > r.eligibleWorkers.find(x => x.workerId === 'W3').score.score);
});

test('high-risk request requires manager approval even when auto-dispatch policy is enabled', () => {
  const input = baseInput();
  input.request.healthSafetyRisks = [{ id: 'confined-space', severity: 'high' }];
  const r = planAgencyLabourFulfilment(input);
  assert.equal(r.dispatchPlan.mode, 'manager_approval_then_dispatch');
  assert.equal(r.dispatchPlan.actionContract.requiresManagerApproval, true);
});

test('agency can confirm a preferred worker, but alternative worker must be revalidated', () => {
  const input = baseInput();
  const plan = planAgencyLabourFulfilment(input);
  const confirm = validateAgencyResponse(plan, { requestId: 'REQ-100', agencyId: 'A1', action: 'confirm_preferred_worker', workerId: 'W1' });
  assert.equal(confirm.valid, true);
  const altNoEvidence = validateAgencyResponse(plan, { requestId: 'REQ-100', agencyId: 'A2', action: 'propose_alternative', workerId: 'W9' });
  assert.equal(altNoEvidence.valid, false);
  assert.ok(altNoEvidence.failures.includes('alternative_worker_requires_revalidation'));
  const alt = worker('W9', 'A2');
  const altChecked = validateAgencyResponse(plan, { requestId: 'REQ-100', agencyId: 'A2', action: 'propose_alternative', workerId: 'W9' }, { candidate: alt, request: input.request, agency: input.agencies[1], policy: input.policy });
  assert.equal(altChecked.valid, true);
});

test('invoice reconciliation catches hours rate and expense variance without touching worker pay', () => {
  const ok = reconcileAgencyInvoiceLine({ shiftId: 'S1', workerId: 'W1', agencyId: 'A1', scheduledHours: 8, clockedHours: 8, agencyClaimedHours: 8, billedHours: 8, contractRatePerHour: 22, invoiceRatePerHour: 22, approvedExpenses: 0, invoicedExpenses: 0, clockEvidenceComplete: true });
  assert.equal(ok.status, 'manufacturer_invoice_line_matched');
  assert.equal(ok.expectedManufacturerInvoice, 176);
  assert.match(ok.boundary, /never_worker_wage_withholding/);

  const bad = reconcileAgencyInvoiceLine({ shiftId: 'S1', workerId: 'W1', agencyId: 'A1', scheduledHours: 8, clockedHours: 7.5, agencyClaimedHours: 8, billedHours: 8, contractRatePerHour: 22, invoiceRatePerHour: 24, approvedExpenses: 0, invoicedExpenses: 10, clockEvidenceComplete: true, duplicateInvoiceReference: true });
  assert.equal(bad.status, 'manufacturer_invoice_review_required');
  for (const f of ['agency_claim_vs_clock_variance', 'billed_hours_vs_clock_variance', 'invoice_rate_mismatch', 'unapproved_expense_variance', 'duplicate_invoice_reference']) assert.ok(bad.failures.includes(f));
});

test('identical evidence is deterministic', () => {
  const input = baseInput();
  const a = planAgencyLabourFulfilment(input);
  const b = planAgencyLabourFulfilment(structuredClone(input));
  assert.equal(a.reproducibilityHash, b.reproducibilityHash);
  assert.deepEqual(a.selectedWorkers, b.selectedWorkers);
});

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32); }

test('5,000 synthetic candidates never select an ineligible worker', () => {
  const rnd = lcg(0xa9e7c1);
  let selected = 0;
  for (let scenario = 0; scenario < 500; scenario++) {
    const input = baseInput();
    input.request.count = 4;
    input.candidates = [];
    const truth = new Map();
    for (let i = 0; i < 10; i++) {
      const agencyId = ['A1', 'A2', 'A3'][i % 3];
      const validRtw = rnd() > 0.08, validQual = rnd() > 0.08, rest = rnd() > 0.06, ready = rnd() > 0.07, available = rnd() > 0.06, consent = rnd() > 0.03, parity = rnd() > 0.05;
      const weeks = rnd() > 0.8 ? 12 : Math.floor(rnd() * 11);
      const candidate = worker('S' + scenario + '-W' + i, agencyId, {
        consentToShare: consent, available, siteReady: ready, restCompliant: rest,
        rightToWork: validRtw ? { status: 'verified', validUntil: '2027-12-31T23:59:59.000Z' } : { status: 'unchecked' },
        qualifications: validQual ? [{ id: 'food-safety', level: 1, status: 'valid', validUntil: '2027-12-31T23:59:59.000Z' }] : [],
        awr: { weeksInSameRole: weeks, equalTreatmentConfirmed: weeks < 12 || parity },
        chargeRatePerHour: 15 + rnd() * 9,
        performance: { completedShifts: Math.floor(rnd() * 60), attendanceRate: rnd(), punctualityRate: rnd(), qualityScore: rnd(), productivityScore: rnd(), completedSiteShifts: Math.floor(rnd() * 25), completedRoleShifts: Math.floor(rnd() * 25) },
      });
      const should = validRtw && validQual && rest && ready && available && consent && (weeks < 12 || parity);
      truth.set(candidate.workerId, should);
      input.candidates.push(candidate);
    }
    const r = planAgencyLabourFulfilment(input);
    for (const worker of r.selectedWorkers) {
      selected++;
      assert.equal(truth.get(worker.workerId), true);
    }
    assert.ok(r.selectedWorkers.length <= input.request.count);
  }
  assert.ok(selected > 300);
});

// Alternative eligibility evidence must describe the worker, supplier and request
// named by this response. Fixture approvals remain synthetic and grant no authority.
for (const [name, change, failure] of [
  ['different eligible worker', (response, context) => { context.candidate = worker('W10', 'A2'); }, 'alternative_worker_identity_mismatch'],
  ['different dispatched supplier', response => { response.agencyId = 'A1'; }, 'alternative_agency_identity_mismatch'],
  ['different evidence request', (response, context) => { context.request = { ...context.request, requestId: 'OTHER-REQUEST' }; }, 'alternative_request_identity_mismatch'],
  ['missing response worker', response => { delete response.workerId; }, 'alternative_worker_identity_mismatch'],
  ['missing evidence worker', (response, context) => { delete context.candidate.workerId; }, 'alternative_worker_identity_mismatch'],
  ['both worker identities missing', (response, context) => { delete response.workerId; delete context.candidate.workerId; }, 'alternative_worker_identity_mismatch'],
]) test('alternative response refuses ' + name + ' without changing evidence', () => {
  const input = baseInput(), plan = planAgencyLabourFulfilment(input);
  const response = { requestId: input.request.requestId, agencyId: 'A2', action: 'propose_alternative', workerId: 'W9' };
  const context = { candidate: worker('W9', 'A2'), request: input.request, agency: input.agencies[1], policy: input.policy };
  assert.equal(validateAgencyResponse(plan, response, context).valid, true);
  change(response, context);
  assert.equal(evaluateAgencyCandidate(context.candidate, context.request, context.agency, context.policy).eligible, true);
  const before = JSON.stringify({ plan, response, context });
  const result = validateAgencyResponse(plan, response, context);
  assert.equal(result.valid, false);
  assert.ok(result.failures.includes(failure));
  assert.equal(JSON.stringify({ plan, response, context }), before);
});
