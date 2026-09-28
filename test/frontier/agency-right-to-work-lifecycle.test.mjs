import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAgencyRightToWorkLifecycle,
  DEFAULT_RIGHT_TO_WORK_REFRESH_LEAD_DAYS,
} from '../../src/frontier/agency-right-to-work-lifecycle.mjs';

const REQUEST = { startAt:'2026-10-20T06:00:00.000Z', endAt:'2026-10-20T14:00:00.000Z' };
const NOW = '2026-10-10T12:00:00.000Z';

function timed(overrides = {}) {
  return {
    status:'verified',
    checkMethod:'home_office_online',
    validUntil:'2026-11-30T23:59:59.000Z',
    ...overrides,
  };
}

function pvn(overrides = {}) {
  return {
    status:'positive',
    issuedAt:'2026-10-01T09:00:00.000Z',
    validUntil:'2027-04-01T09:00:00.000Z',
    evidenceRef:'internal-pvn-evidence-reference-secret',
    ...overrides,
  };
}

test('continuous permission has no scheduled follow-up and no raw evidence', () => {
  const result = evaluateAgencyRightToWorkLifecycle({ status:'verified', indefinite:true, checkMethod:'home_office_online' }, REQUEST, { now:NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.evidence.status, 'continuous');
  assert.equal(result.evidence.followUpRequired, false);
  assert.equal(result.evidence.effectiveCoverageUntil, null);
  assert.equal(result.evidence.refreshAction, null);
});

test('time-limited permission remains current outside the operational refresh window', () => {
  const result = evaluateAgencyRightToWorkLifecycle(timed(), REQUEST, { now:NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.evidence.status, 'current');
  assert.equal(result.evidence.followUpRequired, true);
  assert.equal(result.evidence.refreshLeadDays, DEFAULT_RIGHT_TO_WORK_REFRESH_LEAD_DAYS);
  assert.equal(result.warnings.length, 0);
});

test('time-limited permission stays eligible for a covered assignment while creating a low-friction refresh action', () => {
  const result = evaluateAgencyRightToWorkLifecycle(timed({ validUntil:'2026-10-22T23:59:59.000Z' }), REQUEST, { now:NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.evidence.status, 'refresh_due');
  assert.deepEqual(result.warnings, ['follow_up_due_soon']);
  assert.equal(result.evidence.refreshAction.type, 'request_updated_right_to_work_assurance_from_supplying_agency');
  assert.equal(result.evidence.refreshAction.dueBy, '2026-10-22T23:59:59.000Z');
  assert.match(result.evidence.refreshAction.authorityBoundary, /no_worker_contact_schedule_payroll_or_invoice_mutation/);
});

test('refresh lead time is operational, bounded and never presented as a statutory deadline', () => {
  const high = evaluateAgencyRightToWorkLifecycle(timed(), REQUEST, { now:NOW, refreshLeadDays:999 });
  const low = evaluateAgencyRightToWorkLifecycle(timed(), REQUEST, { now:NOW, refreshLeadDays:0 });
  assert.equal(high.evidence.refreshLeadDays, 90);
  assert.equal(low.evidence.refreshLeadDays, 1);
  assert.match(high.evidence.operationalRule, /not_a_statutory_deadline/);
});

test('evidence that does not cover assignment end fails closed before ranking', () => {
  const result = evaluateAgencyRightToWorkLifecycle(timed({ validUntil:'2026-10-20T13:59:59.000Z' }), REQUEST, { now:NOW });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('right_to_work_expires_before_shift_end'));
  assert.equal(result.evidence.status, 'invalid');
});

test('Employer Checking Service route requires positive verification evidence rather than trusting an old permission date', () => {
  const missing = evaluateAgencyRightToWorkLifecycle(timed({ checkMethod:'employer_checking_service', validUntil:'2027-01-01T00:00:00.000Z' }), REQUEST, { now:NOW });
  assert.equal(missing.eligible, false);
  assert.ok(missing.failures.includes('right_to_work_ecs_positive_verification_notice_missing'));

  const pass = evaluateAgencyRightToWorkLifecycle(timed({
    checkMethod:'employer_checking_service',
    validUntil:'2026-09-30T23:59:59.000Z',
    positiveVerificationNotice:pvn(),
  }), REQUEST, { now:NOW });
  assert.equal(pass.eligible, true);
  assert.equal(pass.evidence.evidenceSource, 'positive_verification_notice');
  assert.equal(pass.evidence.effectiveCoverageUntil, '2027-04-01T09:00:00.000Z');
  assert.equal(pass.evidence.positiveVerificationNotice.evidenceFingerprint.length, 24);
  assert.doesNotMatch(JSON.stringify(pass), /internal-pvn-evidence-reference-secret/);
});

test('expired, negative, malformed or future-dated PVN evidence fails closed', () => {
  const cases = [
    [pvn({ status:'negative' }), 'right_to_work_ecs_positive_verification_notice_not_positive'],
    [pvn({ validUntil:'2026-10-20T13:00:00.000Z' }), 'right_to_work_expires_before_shift_end'],
    [pvn({ issuedAt:'2026-10-11T09:00:00.000Z' }), 'right_to_work_ecs_positive_verification_notice_in_future'],
    [pvn({ evidenceRef:'' }), 'right_to_work_ecs_positive_verification_notice_evidence_ref_missing'],
    [pvn({ issuedAt:'2026-10-10T09:00:00.000Z', validUntil:'2026-10-10T09:00:00.000Z' }), 'right_to_work_ecs_positive_verification_notice_expiry_invalid'],
  ];
  for (const [notice, failure] of cases) {
    const result = evaluateAgencyRightToWorkLifecycle(timed({ checkMethod:'employer_checking_service', positiveVerificationNotice:notice }), REQUEST, { now:NOW });
    assert.equal(result.eligible, false, failure);
    assert.ok(result.failures.includes(failure), failure);
  }
});

test('pending application flags do not silently create the statutory 28-day continuation', () => {
  const result = evaluateAgencyRightToWorkLifecycle(timed({
    validUntil:'2026-10-09T23:59:59.000Z',
    pendingInTimeApplication:true,
    employerReasonablySatisfiedPendingApplication:true,
  }), REQUEST, { now:NOW });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('right_to_work_expires_before_shift_end'));
  assert.match(result.evidence.unsupportedContinuationRule, /no_28_day_continuation_is_inferred/);
});

test('10,000 lifecycle evaluations never treat expired assignment coverage as eligible', () => {
  let eligibleExpired = 0;
  let refreshDue = 0;
  for (let index = 0; index < 10_000; index++) {
    const valid = index % 2 === 0;
    const dueSoon = index % 4 === 0;
    const rightToWork = timed({
      validUntil: valid
        ? (dueSoon ? '2026-10-22T23:59:59.000Z' : '2027-12-31T23:59:59.000Z')
        : '2026-10-20T13:59:59.000Z',
    });
    const result = evaluateAgencyRightToWorkLifecycle(rightToWork, REQUEST, { now:NOW });
    if (!valid && result.eligible) eligibleExpired++;
    if (result.evidence.status === 'refresh_due') refreshDue++;
  }
  assert.equal(eligibleExpired, 0);
  assert.equal(refreshDue, 2_500);
});
