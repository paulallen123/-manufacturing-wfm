import test from 'node:test';
import assert from 'node:assert/strict';
import { roleProofResult } from './vector-proof-result.mjs';

// Synthetic evidence-gate tests only. No browser, signed session, provider,
// customer state or network is used or proved by this suite.
const checksum = 'a'.repeat(64);
const leaveKeys = ['employeeUiSubmitted', 'pendingStateReadBack', 'overlapRefusedInUi',
  'refreshedUiRetainedPending', 'managerUiDecided', 'managerStateReadBack',
  'freshEmployeeLoginSawDecision', 'requestAuditLinked', 'freshBalanceReconciled'];
const attendanceKeys = ['managerUiApproved', 'exactCorrectionReadBack',
  'rawPunchesPreserved', 'domainAuditReadBack', 'refreshedUiRetainedCorrection',
  'weeklySignStillBlocked', 'payrollReleaseStillBlocked', 'weeklySignOffCompleted'];
const truth = keys => Object.fromEntries(keys.map(key => [key, true]));
function evidence() {
  return {
    leave: truth(leaveKeys),
    attendance: { ...truth(attendanceKeys), weeklySignOffEvidence: {
      submittedRevision: 3, signatureRevision: 3, auditRevision: 3, refreshedStatus: 'signed' } },
    payroll: {
      expectedTeamIds: ['team-one', 'team-two'],
      teamSignOffs: ['team-one', 'team-two'].map(teamId => ({ teamId,
        submittedRevision: 3, signatureRevision: 3, auditRevision: 3, refreshedStatus: 'signed' })),
      release: { responseStatus: 200, batchId: 'synthetic-batch', status: 'released', rowCount: 2,
        computedChecksum: checksum, checksumHeader: checksum, persistedBatchId: 'synthetic-batch',
        auditBatchId: 'synthetic-batch', freshLoginBatchId: 'synthetic-batch', reconciliationOk: true }
    }
  };
}
function result(e = evidence(), asset = { status: 'BOUND' }) {
  return roleProofResult(asset, e.leave, e.attendance, e.payroll);
}
function assertPartial(value) {
  assert.equal(value.status, 'PARTIAL');
  assert.equal(value.endToEndVerified, false);
  assert.equal(value.productReady, false);
  for (const key of ['server-audit-readback', 'exact-backend-binding', 'major-workflow-coverage'])
    assert.ok(value.missingEvidence.includes(key), key + ' must remain unproved');
}

test('complete scoped synthetic journeys and bound assets still cannot claim whole-product readiness', () => {
  const r = result();
  for (const key of ['scopedLeaveActionVerified', 'scopedLeaveJourneyVerified',
    'scopedAttendanceCorrectionVerified', 'scopedAttendanceJourneyVerified', 'scopedPayrollJourneyVerified'])
    assert.equal(r[key], true, key);
  assert.equal(r.exactAssetsVerified, true);
  assertPartial(r);
});

test('absent business evidence remains navigation-only even with bound assets', () => {
  const r = roleProofResult({ status: 'BOUND' });
  for (const key of ['scopedLeaveActionVerified', 'scopedLeaveJourneyVerified',
    'scopedAttendanceCorrectionVerified', 'scopedAttendanceJourneyVerified', 'scopedPayrollJourneyVerified'])
    assert.equal(r[key], false, key);
  assert.equal(r.proofScope, 'role-navigation-and-source-presentation');
  assertPartial(r);
});

for (const key of leaveKeys) test('leave journey rejects missing ' + key, () => {
  const e = evidence(); delete e.leave[key];
  const r = result(e); assert.equal(r.scopedLeaveJourneyVerified, false); assertPartial(r);
});
for (const key of attendanceKeys) test('attendance journey rejects missing ' + key, () => {
  const e = evidence(); delete e.attendance[key];
  const r = result(e); assert.equal(r.scopedAttendanceJourneyVerified, false); assertPartial(r);
});
for (const key of ['submittedRevision', 'signatureRevision', 'auditRevision', 'refreshedStatus'])
  test('attendance sign-off rejects missing ' + key, () => {
    const e = evidence(); delete e.attendance.weeklySignOffEvidence[key];
    const r = result(e); assert.equal(r.scopedAttendanceJourneyVerified, false); assertPartial(r);
  });
for (const key of Object.keys(evidence().payroll.release)) test('payroll journey rejects missing release.' + key, () => {
  const e = evidence(); delete e.payroll.release[key];
  const r = result(e); assert.equal(r.scopedPayrollJourneyVerified, false); assertPartial(r);
});
for (const key of ['persistedBatchId', 'auditBatchId', 'freshLoginBatchId'])
  test('payroll journey rejects conflicting ' + key, () => {
    const e = evidence(); e.payroll.release[key] = 'different-synthetic-batch';
    const r = result(e); assert.equal(r.scopedPayrollJourneyVerified, false); assertPartial(r);
  });

for (const [label, id] of [['null', null], ['missing', undefined], ['empty', ''],
  ['spaces', '   '], ['tab', '\t'], ['number', 7], ['boolean', false]])
  test('payroll cannot count ' + label + ' as an identified team', () => {
    const e = evidence(); e.payroll.expectedTeamIds = [id];
    e.payroll.teamSignOffs = [{ ...e.payroll.teamSignOffs[0], teamId: id }];
    const r = result(e);
    assert.equal(r.scopedPayrollJourneyVerified, false, 'Missing or malformed team identity is not a scoped sign-off');
    assert.ok(r.missingEvidence.includes('all-team-weekly-sign-off'));
    assertPartial(r);
  });

test('payroll rejects duplicate expected identities and duplicate signatures', () => {
  const e = evidence(); e.payroll.expectedTeamIds = ['team-one', 'team-one'];
  e.payroll.teamSignOffs = [e.payroll.teamSignOffs[0], { ...e.payroll.teamSignOffs[0] }];
  assert.equal(result(e).scopedPayrollJourneyVerified, false);
});
test('payroll rejects missing expected team, extra signed team and replacement signed identity', () => {
  for (const mutate of [
    p => p.teamSignOffs.pop(),
    p => p.teamSignOffs.push({ ...p.teamSignOffs[0], teamId: 'extra-team' }),
    p => { p.teamSignOffs[1].teamId = 'replacement-team'; }
  ]) {
    const e = evidence(); mutate(e.payroll); assert.equal(result(e).scopedPayrollJourneyVerified, false);
  }
});
test('ordinary distinct identifiers remain valid independent of signature ordering', () => {
  const e = evidence(); e.payroll.teamSignOffs.reverse();
  assert.equal(result(e).scopedPayrollJourneyVerified, true); assertPartial(result(e));
});
test('only exact BOUND assets satisfy exact asset evidence, while readiness always remains false', () => {
  for (const asset of [null, {}, { status: 'UNBOUND' }, { status: 'bound' }, { status: true }]) {
    const r = result(evidence(), asset); assert.equal(r.exactAssetsVerified, false);
    assert.ok(r.missingEvidence.includes('exact-deployed-asset-binding')); assertPartial(r);
  }
});
