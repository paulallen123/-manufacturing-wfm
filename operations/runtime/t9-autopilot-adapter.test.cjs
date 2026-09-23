'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { executeT9AutopilotAction } = require('./t9-autopilot-adapter.cjs');

function fixture() {
  const nowMs = Date.parse('2026-09-23T09:00:00.000Z');
  return {
    now: () => nowMs,
    permit: {
      permit_id: 'permit-1',
      actor_ref: 'manager@example.test',
      issued_at: '2026-09-23T08:55:00.000Z',
      expires_at: '2026-09-23T09:10:00.000Z',
    },
    selected: {
      episodeId: 'episode-1',
      contextRevision: 'r7',
      selection: { optionId: 'overtime', selectedAt: '2026-09-23T08:55:00.000Z' },
    },
    plan: {
      action: {
        eventKey: 'ot-1',
        kind: 'OVERTIME_OVERRIDE',
        employeeId: 'E1',
        effectiveAt: '2026-09-23T10:00:00.000Z',
        payload: { minutes: 60 },
      },
      rollback: { eventKey: 'rb-1', reason: 'restore original workforce state' },
    },
  };
}

test('T9 adapter routes an approved Autopilot write through evidence, authority and independent readback', async () => {
  const f = fixture();
  const events = new Map();
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const event = { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' };
      events.set(eventKey, event);
      return { event, decision: { status: 'ACCEPTED', reasonCode: 'OK' } };
    },
    getTrustedEvent({ eventKey }) { return events.get(eventKey) || null; },
  };
  const result = await executeT9AutopilotAction({ tenant: 'A', ...f, lifecycle });
  assert.equal(result.state, 'VERIFIED');
  assert.match(result.trustReceiptDigest, /^[a-f0-9]{64}$/);
  assert.match(result.evidenceLedgerHeadDigest, /^[a-f0-9]{64}$/);
  assert.match(result.authorityGrantDigest, /^[a-f0-9]{64}$/);
});

test('T9 adapter independently rolls back when postconditions are not verified', async () => {
  const f = fixture();
  const events = new Map();
  let firstRead = true;
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const event = { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' };
      events.set(eventKey, event);
      return { event, decision: { status: 'ACCEPTED', reasonCode: 'OK' } };
    },
    getTrustedEvent({ eventKey }) {
      if (eventKey === 'ot-1' && firstRead) { firstRead = false; return null; }
      return events.get(eventKey) || null;
    },
  };
  const result = await executeT9AutopilotAction({ tenant: 'A', ...f, lifecycle });
  assert.equal(result.state, 'ROLLED_BACK');
  assert.equal(result.rollbackEventId, 'wf-rb-1');
});

test('T9 adapter refuses an expired customer permit before any mutation', async () => {
  const f = fixture();
  const lifecycle = {
    applyTrustedEvent() { throw new Error('must not execute'); },
    getTrustedEvent() { return null; },
  };
  await assert.rejects(
    () => executeT9AutopilotAction({
      tenant: 'A',
      ...f,
      now: () => Date.parse('2026-09-23T09:20:00.000Z'),
      lifecycle,
    }),
    /expire/i
  );
});

test('T9 adapter fails closed when telemetry is blind for a medium-risk workforce action', async () => {
  const f = fixture();
  let writes = 0;
  const lifecycle = {
    applyTrustedEvent() { writes += 1; throw new Error('must not execute'); },
    getTrustedEvent() { return null; },
  };
  await assert.rejects(
    () => executeT9AutopilotAction({ tenant: 'A', ...f, telemetryBlind: true, lifecycle }),
    (error) => error?.code === 'VECTOR_ACTION_UNKNOWNS'
  );
  assert.equal(writes, 0);
});
