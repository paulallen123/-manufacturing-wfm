import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { roleProofResult } from './vector-proof-result.mjs';

// Pure-function regressions; these do not launch a browser or claim hosted proof.
const source = fs.readFileSync(new URL('../ux-overlay/vector-shell.js', import.meta.url), 'utf8');
const metricsSource = source.slice(source.indexOf('function metrics('), source.indexOf('\nfunction departmentRows('));
const costSource = source.slice(source.indexOf('function labourCost('), source.indexOf('\nfunction money('));

function metrics(stats, fallback = null) {
  return vm.runInNewContext(`${metricsSource}\nmetrics(null)`, {
    scopedStats: () => stats,
    parseNumber: value => value == null ? null : Number(value),
    findMetric: () => fallback,
    labourCost: () => null,
    money: value => value == null ? '—' : String(value)
  });
}
function cost(report) {
  return vm.runInNewContext(`${costSource}\nlabourCost()`, { VCU: { report: () => report } });
}

test('authoritative zero attendance and absence survive unrelated rendered numbers', () => {
  const result = metrics({ total: 20, onsite: 0, sick: 0 }, 13);
  assert.equal(result[0].value, 0);
  assert.equal(result[0].detail, '0% of workforce');
  assert.equal(result[1].value, 0);
  assert.equal(result[1].detail, '0.0% absence rate');
});
test('an empty workforce is not replaced by a number from another card', () => {
  const result = metrics({ total: 0, onsite: 0, sick: 0 }, 13);
  assert.equal(result[0].value, 0);
  assert.equal(result[0].progress, null);
});
test('missing evidence stays unknown', () => {
  const result = metrics({});
  assert.equal(result[0].value, '—');
  assert.equal(result[1].value, '—');
});
test('missing, blank, boolean and malformed costs cannot become a verified zero', () => {
  for (const value of [null, undefined, '', ' ', false, true, 'invalid', Infinity]) {
    assert.equal(cost({ summary: { labourCostPence: value } }), null, `invalid value: ${String(value)}`);
  }
});
test('verified zero and pence values remain valid', () => {
  assert.equal(cost({ summary: { labourCostPence: 0 } }), 0);
  assert.equal(cost({ summary: { labourCostPence: 12345 } }), 123.45);
  assert.equal(cost({ summary: { labourCostPence: '12345' } }), 123.45);
});
test('unbound navigation proof cannot claim end-to-end readiness', () => {
  const result = roleProofResult({ status: 'UNBOUND' });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.productReady, false);
  assert.equal(result.endToEndVerified, false);
  assert.ok(result.missingEvidence.includes('exact-deployed-asset-binding'));
});
test('exact assets and successful role checks still require completed business workflows', () => {
  const result = roleProofResult({ status: 'BOUND' });
  assert.equal(result.exactAssetsVerified, true);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.endToEndVerified, false);
  assert.ok(result.missingEvidence.includes('persisted-state-readback'));
  assert.ok(result.missingEvidence.includes('updated-UI-after-reload'));
});
test('opening a workflow route cannot be counted as a completed business action', () => {
  const result = roleProofResult({ status: 'BOUND' }, { routeOpened: true, returnContextRestored: true });
  assert.equal(result.scopedLeaveJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('UI-triggered-business-action'));
  assert.ok(result.missingEvidence.includes('persisted-state-readback'));
});
test('saved leave UI journey removes navigation-only gaps but retains audit and backend proof boundaries', () => {
  const result = roleProofResult({ status: 'BOUND' }, {
    employeeUiSubmitted: true,
    pendingStateReadBack: true,
    overlapRefusedInUi: true,
    refreshedUiRetainedPending: true,
    managerUiDecided: true,
    managerStateReadBack: true,
    freshEmployeeLoginSawDecision: true
  });
  assert.equal(result.scopedLeaveJourneyVerified, true);
  assert.equal(result.endToEndVerified, false);
  assert.equal(result.productReady, false);
  assert.ok(!result.missingEvidence.includes('UI-triggered-business-action'));
  assert.ok(!result.missingEvidence.includes('persisted-state-readback'));
  assert.ok(!result.missingEvidence.includes('updated-UI-after-reload'));
  assert.ok(result.missingEvidence.includes('server-audit-readback'));
  assert.ok(result.missingEvidence.includes('exact-backend-binding'));
  assert.ok(result.missingEvidence.includes('major-workflow-coverage'));
});
test('saved attendance correction is reported separately without manufacturing weekly or payroll readiness', () => {
  const leave = {
    employeeUiSubmitted: true, pendingStateReadBack: true, overlapRefusedInUi: true,
    refreshedUiRetainedPending: true, managerUiDecided: true,
    managerStateReadBack: true, freshEmployeeLoginSawDecision: true
  };
  const attendance = {
    managerUiApproved: true,
    exactCorrectionReadBack: true,
    rawPunchesPreserved: true,
    domainAuditReadBack: true,
    refreshedUiRetainedCorrection: true,
    weeklySignStillBlocked: true,
    payrollReleaseStillBlocked: true
  };
  const result = roleProofResult({ status: 'BOUND' }, leave, attendance);
  assert.equal(result.scopedAttendanceJourneyVerified, true);
  assert.equal(result.endToEndVerified, false);
  assert.equal(result.productReady, false);
  assert.ok(result.missingEvidence.includes('weekly-sign-off-business-action'));
  assert.ok(result.missingEvidence.includes('payroll-reconciliation-business-action'));
  assert.ok(result.missingEvidence.includes('exact-backend-binding'));
});
