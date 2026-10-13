import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAutopilotReadbackEvidence } from '../scripts/autopilot-readback-proof-oracle.mjs';

function fixture() {
  const binding = { candidateSha: 'a'.repeat(40), deploymentId: 'deployment-1', tenant: 'synthetic-tenant',
    contextRevision: 'context-r1', episodeId: 'shadow-1', optionId: 'overtime-1' };
  const capture = (name, minute, httpStatus, body) => ({ candidateSha: binding.candidateSha,
    deploymentId: binding.deploymentId, tenant: binding.tenant, responseId: name,
    capturedAt: `2026-10-13T10:${String(minute).padStart(2, '0')}:00.000Z`, httpStatus, body });
  const permit = { permitId: 'permit-1', tenant: binding.tenant, shadowEpisodeId: binding.episodeId,
    optionId: binding.optionId, contextRevision: binding.contextRevision, actorRef: 'manager-1',
    issuedAt: '2026-10-13T10:00:00.000Z', expiresAt: '2026-10-13T10:15:00.000Z',
    plan: { adapter: 'workforce-lifecycle', reversible: true,
      action: { eventKey: 'event-1', employeeId: 'synthetic-employee', kind: 'OVERTIME_OVERRIDE' } } };
  const detail = { eventId: 'lifecycle-1', outcomeStatus: 'UNPROVEN', outcomeDigest: null };
  const event = (state, minute, eventDetail) => ({ executionId: 'execution-1', permitId: permit.permitId,
    state, createdAt: `2026-10-13T10:0${minute}:00.000Z`, detail: eventDetail });
  return { binding, captures: {
    permit: capture('permit-response', 0, 201, { contractVersion: 'VECTOR_AUTOPILOT_PERMIT_V1', permit }),
    execution: capture('execute-response', 3, 200, { contractVersion: 'VECTOR_AUTOPILOT_EXECUTION_V1',
      result: { executionId: 'execution-1', idempotent: false, state: 'VERIFIED', detail } }),
    status: capture('status-response', 4, 200, { contractVersion: 'VECTOR_AUTOPILOT_EXECUTION_V1',
      tenant: binding.tenant, events: [event('VERIFIED', 3, detail), event('APPLIED', 2, { eventId: 'lifecycle-1' }),
        event('PREPARED', 1, { episodeId: 'selected-episode-1', optionId: binding.optionId })] }),
    lifecycle: capture('lifecycle-response', 5, 200, { tenant: binding.tenant, eventKey: 'event-1',
      id: 'lifecycle-1', status: 'ACCEPTED', employeeId: 'synthetic-employee', kind: 'OVERTIME_OVERRIDE' })
  } };
}
const assess = value => assessAutopilotReadbackEvidence(JSON.stringify(value));

test('consistent synthetic permit, execution, history and lifecycle readback is bounded', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'EVIDENCE_CONSISTENT');
  assert.match(result.claimBoundary, /independently measured outcome/);
});

for (const [name, edit, blocker] of [
  ['candidate drift', p => { p.captures.lifecycle.candidateSha = 'b'.repeat(40); }, 'SOURCE_SCOPE_UNPROVEN'],
  ['duplicate response', p => { p.captures.status.responseId = 'execute-response'; }, 'DUPLICATE_RESPONSE'],
  ['expired permit', p => { p.captures.permit.body.permit.expiresAt = '2026-10-13T10:02:00.000Z'; }, 'PERMIT_UNPROVEN'],
  ['unapproved option', p => { p.captures.permit.body.permit.optionId = 'other'; }, 'PERMIT_UNPROVEN'],
  ['forecast treated as outcome', p => { p.captures.execution.body.result.detail.outcomeStatus = 'PROVEN'; }, 'EXECUTION_UNPROVEN'],
  ['rollback presented as verified', p => { p.captures.execution.body.result.state = 'ROLLED_BACK'; }, 'EXECUTION_UNPROVEN'],
  ['missing prepared event', p => { p.captures.status.body.events.pop(); }, 'EXECUTION_HISTORY_UNPROVEN'],
  ['foreign permit in history', p => { p.captures.status.body.events[0].permitId = 'other'; }, 'EXECUTION_HISTORY_UNPROVEN'],
  ['wrong applied event', p => { p.captures.status.body.events[1].detail.eventId = 'other'; }, 'EXECUTION_HISTORY_UNPROVEN'],
  ['verified before apply', p => { p.captures.status.body.events[0].createdAt = '2026-10-13T10:01:00.000Z'; }, 'EXECUTION_HISTORY_UNPROVEN'],
  ['cross-tenant lifecycle readback', p => { p.captures.lifecycle.body.tenant = 'other'; }, 'LIFECYCLE_READBACK_UNPROVEN'],
  ['wrong lifecycle employee', p => { p.captures.lifecycle.body.employeeId = 'other'; }, 'LIFECYCLE_READBACK_UNPROVEN']
]) test(`blocks ${name}`, () => {
  const packet = fixture(); edit(packet);
  const result = assess(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes(blocker));
});

test('requires bounded JSON text, not active objects', () => {
  assert.equal(assessAutopilotReadbackEvidence(fixture()).status, 'BLOCKED');
  assert.equal(assessAutopilotReadbackEvidence('{').status, 'BLOCKED');
});
