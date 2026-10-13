import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPermissionRevocationRace } from '../scripts/permission-revocation-race-oracle.mjs';

function fixture() {
  const context = { candidateSha: 'a'.repeat(40), tenant: 'synthetic-a',
    principalId: 'synthetic-manager', permission: 'synthetic.action',
    operationKey: 'synthetic-op-1', sequenceDomain: 'synthetic-server-ledger' };
  const item = (captureId, more) => ({ ...context, captureId, ...more });
  return { context,
    preflight: item('pre', { sequence: 1, wouldAllow: true, permissionRevision: 7 }),
    inFlight: item('race', { requestStartSequence: 2, decisionSequence: 4,
      responseSequence: 5, status: 403, denialReason: 'PERMISSION_REVOKED',
      permissionRevision: 8, effectApplied: false, effectId: null }),
    revocation: item('revoke', { sequence: 3, state: 'COMMITTED', auditId: 'audit-3',
      previousRevision: 7, currentRevision: 8 }),
    postRevocation: item('post', { decisionSequence: 6, status: 403,
      denialReason: 'PERMISSION_REVOKED', freshSession: true,
      permissionRevision: 8, effectApplied: false, effectId: null }),
    readback: item('read', { sequence: 7, permissionRevision: 8,
      permissionActive: false, effectCount: 0, revocationAuditId: 'audit-3' }) };
}

test('admits a denied overlapping action with fresh-session and effect readback', () => {
  assert.deepEqual(assessPermissionRevocationRace(fixture()), { status: 'PASS', failures: [] });
});

for (const [name, change, code] of [
  ['stale candidate', p => { p.inFlight.candidateSha = 'b'.repeat(40); }, 'IDENTITY_INFLIGHT'],
  ['another tenant', p => { p.readback.tenant = 'synthetic-b'; }, 'IDENTITY_READBACK'],
  ['reused capture', p => { p.readback.captureId = 'post'; }, 'REUSED_CAPTURE'],
  ['uncommitted revocation', p => { p.revocation.state = 'PENDING'; }, 'REVOCATION_NOT_COMMITTED'],
  ['unwitnessed race', p => { p.inFlight.requestStartSequence = 3; }, 'NO_ORDERED_RACE'],
  ['stale authority decision', p => { p.inFlight.permissionRevision = 7; }, 'IN_FLIGHT_ACTION_NOT_DENIED'],
  ['accepted in-flight action', p => { p.inFlight.status = 200; p.inFlight.effectApplied = true; }, 'IN_FLIGHT_ACTION_NOT_DENIED'],
  ['old session only', p => { p.postRevocation.freshSession = false; }, 'FRESH_SESSION_NOT_DENIED'],
  ['persisted effect', p => { p.readback.effectCount = 1; }, 'READBACK_NOT_CLEAN'],
  ['detached audit', p => { p.readback.revocationAuditId = 'other'; }, 'READBACK_NOT_CLEAN']
]) {
  test(`rejects ${name}`, () => {
    const proof = fixture(); change(proof);
    assert.ok(assessPermissionRevocationRace(proof).failures.includes(code));
  });
}

