import test from 'node:test';
import assert from 'node:assert/strict';
import { roleProofResult } from './vector-proof-result.mjs';

// Local reporting-gate evidence only. No browser, session, customer, provider,
// synthetic approval or hosted business action is exercised by these tests.
const checksum = 'a'.repeat(64);
function signOff(revision) {
  return { submittedRevision: revision, signatureRevision: revision,
    auditRevision: revision, refreshedStatus: 'signed' };
}
function result(revision) {
  return roleProofResult({ status: 'BOUND' }, null, {
    managerUiApproved: true, exactCorrectionReadBack: true, rawPunchesPreserved: true,
    domainAuditReadBack: true, refreshedUiRetainedCorrection: true,
    weeklySignStillBlocked: true, payrollReleaseStillBlocked: true,
    weeklySignOffCompleted: true, weeklySignOffEvidence: signOff(revision)
  }, {
    expectedTeamIds: ['identified-team'],
    teamSignOffs: [{ teamId: 'identified-team', ...signOff(revision) }],
    release: { responseStatus: 200, batchId: 'fictional-batch', status: 'released',
      rowCount: 1, computedChecksum: checksum, checksumHeader: checksum,
      persistedBatchId: 'fictional-batch', auditBatchId: 'fictional-batch',
      freshLoginBatchId: 'fictional-batch', reconciliationOk: true }
  });
}
function assertPartial(value) {
  assert.equal(value.status, 'PARTIAL');
  assert.equal(value.endToEndVerified, false);
  assert.equal(value.productReady, false);
  assert.ok(value.missingEvidence.includes('exact-backend-binding'));
}

for (const [label, revision] of [
  ['negative', -1], ['minimum-safe-negative', Number.MIN_SAFE_INTEGER],
  ['unsafe-positive', Number.MAX_SAFE_INTEGER + 1],
  ['unsafe-negative', Number.MIN_SAFE_INTEGER - 1],
  ['fraction', 1.5], ['NaN', NaN], ['infinity', Infinity],
  ['numeric-string', '3'], ['null', null], ['absent', undefined]
]) {
  test('attendance cannot verify sign-off with ' + label + ' revision', () => {
    const value = result(revision);
    assert.equal(value.scopedAttendanceJourneyVerified, false);
    assert.ok(value.missingEvidence.includes('weekly-sign-off-version-binding'));
    assertPartial(value);
  });
  test('payroll cannot verify sign-offs with ' + label + ' revision', () => {
    const value = result(revision);
    assert.equal(value.scopedPayrollJourneyVerified, false);
    assert.ok(value.missingEvidence.includes('all-team-weekly-sign-off'));
    assertPartial(value);
  });
}

for (const revision of [0, 1, 3, Number.MAX_SAFE_INTEGER]) {
  test('nonnegative safe revision ' + revision + ' retains scoped proof only', () => {
    const value = result(revision);
    assert.equal(value.scopedAttendanceJourneyVerified, true);
    assert.equal(value.scopedPayrollJourneyVerified, true);
    assertPartial(value);
  });
}
