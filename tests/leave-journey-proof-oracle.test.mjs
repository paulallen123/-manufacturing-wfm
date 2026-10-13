import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLeaveJourneyEvidence } from '../scripts/leave-journey-proof-oracle.mjs';

function fixture() {
  const binding = { candidateSha: 'a'.repeat(40), deploymentId: 'deployment-1', tenant: 'synthetic-tenant',
    employeeId: 'employee-1', requestId: 'leave-1', requestDate: '2026-10-20', requestMinutes: 450 };
  const leave = { pendingMinutes: 0, bookedMinutes: 0, remainingMinutes: 1200, availableMinutes: 1200 };
  const pendingLeave = { pendingMinutes: 450, bookedMinutes: 0, remainingMinutes: 1200, availableMinutes: 750 };
  const approvedLeave = { pendingMinutes: 0, bookedMinutes: 450, remainingMinutes: 750, availableMinutes: 750 };
  const capture = (name, minute, stateVersion, role, actorId, sessionId, extra) => ({
    candidateSha: binding.candidateSha, deploymentId: binding.deploymentId, tenant: binding.tenant,
    responseId: name, capturedAt: `2026-10-13T10:${String(minute).padStart(2, '0')}:00.000Z`,
    stateVersion, role, actorId, sessionId, ...extra
  });
  const request = { id: binding.requestId, employee: binding.employeeId, date: binding.requestDate,
    status: 'pending', revision: 1, minutes: 450 };
  return { binding, captures: {
    before: capture('before', 0, 1, 'employee', binding.employeeId, 'employee-session-1', { leave, requestCount: 0 }),
    pending: capture('pending', 1, 2, 'employee', binding.employeeId, 'employee-session-1',
      { leave: pendingLeave, requestCount: 1, request }),
    overlap: capture('overlap', 2, 2, 'employee', binding.employeeId, 'employee-session-1',
      { leave: pendingLeave, requestCount: 1, request, requestId: binding.requestId,
        command: 'leave-request', reasonCode: 'OVERLAP', attemptDate: binding.requestDate,
        attemptMinutes: binding.requestMinutes, httpStatus: 409 }),
    manager: capture('manager', 3, 3, 'manager', 'manager-1', 'manager-session-1',
      { request: { ...request, status: 'approved', revision: 2 },
        audit: { id: 'audit-1', type: 'leave-decision', requestId: binding.requestId,
          employee: binding.employeeId, by: 'manager-1', revision: 2, at: '2026-10-13T10:03:00.000Z' } }),
    fresh: capture('fresh', 4, 3, 'employee', binding.employeeId, 'employee-session-2',
      { request: { ...request, status: 'approved', revision: 2 }, leave: approvedLeave })
  } };
}

test('accepts a fully bound synthetic leave evidence packet as internally consistent only', () => {
  const result = assessLeaveJourneyEvidence(fixture());
  assert.equal(result.status, 'EVIDENCE_CONSISTENT');
  assert.match(result.claimBoundary, /authenticated source/);
});

for (const [name, edit, reason] of [
  ['source drift', p => { p.captures.manager.candidateSha = 'b'.repeat(40); }, 'CAPTURE_SCOPE_OR_SOURCE_DRIFT'],
  ['same session after fresh login', p => { p.captures.fresh.sessionId = p.captures.before.sessionId; }, 'SESSION_SEPARATION_UNPROVEN'],
  ['manager is employee', p => { p.captures.manager.actorId = p.binding.employeeId; }, 'ACTOR_AUTHORITY_UNPROVEN'],
  ['stale decision version', p => { p.captures.manager.stateVersion = 2; }, 'VERSION_CHAIN_UNPROVEN'],
  ['overlap creates a second request', p => { p.captures.overlap.requestCount = 2; }, 'OVERLAP_REFUSAL_UNPROVEN'],
  ['unrelated 409', p => { p.captures.overlap.reasonCode = 'VERSION_CONFLICT'; }, 'OVERLAP_REFUSAL_UNPROVEN'],
  ['overlap on different date', p => { p.captures.overlap.attemptDate = '2026-10-21'; }, 'OVERLAP_REFUSAL_UNPROVEN'],
  ['overlap changes entitlement', p => { p.captures.overlap.leave = { ...p.captures.overlap.leave, availableMinutes: 300 }; }, 'OVERLAP_CHANGED_BALANCE'],
  ['unbound audit request', p => { delete p.captures.manager.audit.requestId; }, 'REQUEST_BOUND_AUDIT_UNPROVEN'],
  ['wrong audit actor', p => { p.captures.manager.audit.by = 'other-manager'; }, 'REQUEST_BOUND_AUDIT_UNPROVEN'],
  ['stale request revision', p => { p.captures.fresh.request.revision = 1; }, 'DECISION_REVISION_UNPROVEN'],
  ['manager changes requested minutes', p => { p.captures.manager.request.minutes = 900; }, 'DECISION_REVISION_UNPROVEN'],
  ['fresh readback belongs to another employee', p => { p.captures.fresh.request.employee = 'employee-2'; }, 'DECISION_REVISION_UNPROVEN'],
  ['audit before request', p => { p.captures.manager.audit.at = '2026-10-13T09:59:00.000Z'; }, 'REQUEST_BOUND_AUDIT_UNPROVEN'],
  ['audit after manager readback', p => { p.captures.manager.audit.at = '2026-10-13T10:04:00.000Z'; }, 'REQUEST_BOUND_AUDIT_UNPROVEN'],
  ['double debit on approval', p => { p.captures.fresh.leave.availableMinutes = 300; }, 'ENTITLEMENT_TRANSITION_UNPROVEN'],
  ['out of order capture', p => { p.captures.manager.capturedAt = '2026-10-13T10:01:00.000Z'; }, 'CAPTURE_ORDER_UNPROVEN'],
  ['duplicate response', p => { p.captures.manager.responseId = 'pending'; }, 'DUPLICATE_RESPONSE']
]) test(`blocks ${name}`, () => {
  const packet = fixture(); edit(packet);
  const result = assessLeaveJourneyEvidence(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes(reason));
});

test('rejects accessor and proxy packets without invoking a getter', () => {
  let calls = 0;
  const packet = fixture();
  Object.defineProperty(packet.captures.manager, 'audit', { get() { calls++; throw new Error('unsafe'); } });
  assert.deepEqual(assessLeaveJourneyEvidence(packet).blockers, ['ACTIVE_OR_MALFORMED_PACKET']);
  assert.equal(calls, 0);
  assert.deepEqual(assessLeaveJourneyEvidence(new Proxy(fixture(), {})).blockers, ['ACTIVE_OR_MALFORMED_PACKET']);
});

test('rejects sparse arrays and cyclic captures', () => {
  const sparse = fixture(); sparse.extra = new Array(2); sparse.extra[0] = 'value';
  assert.deepEqual(assessLeaveJourneyEvidence(sparse).blockers, ['ACTIVE_OR_MALFORMED_PACKET']);
  const cyclic = fixture(); cyclic.captures.before.self = cyclic;
  assert.deepEqual(assessLeaveJourneyEvidence(cyclic).blockers, ['ACTIVE_OR_MALFORMED_PACKET']);
});

test('current sealed request shape cannot be misreported as request-revision proof', () => {
  const packet = fixture();
  for (const stage of ['pending', 'overlap', 'manager', 'fresh']) {
    packet.captures[stage].request.hours = 7.5;
    delete packet.captures[stage].request.minutes;
    delete packet.captures[stage].request.revision;
  }
  const result = assessLeaveJourneyEvidence(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('PENDING_REQUEST_UNPROVEN'));
  assert.ok(result.blockers.includes('DECISION_REVISION_UNPROVEN'));
});
