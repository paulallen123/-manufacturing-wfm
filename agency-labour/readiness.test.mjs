import assert from 'node:assert/strict';
import {
  buildAssignmentReadyPack,
  diffAssignmentPack,
  assessAssignmentHandshake,
  assessAvailabilityFreshness,
  assessAwrContinuity
} from './readiness.mjs';

const baseInput = {
  hirer: { id: 'H1', name: 'Factory Ltd', natureOfBusiness: 'Food manufacturing' },
  site: { id: 'S1', name: 'Tamworth Plant', location: 'Tamworth, UK' },
  requirement: {
    id: 'REQ1', role: 'PACKER', responsibilities: ['pack', 'label'],
    shiftStart: '2026-09-18T22:00:00Z', shiftEnd: '2026-09-19T06:00:00Z', expectedDuration: '1 shift',
    requiredSkills: ['PACKER'], requiredCertifications: [], expenses: []
  },
  safety: {
    risks: [{ id: 'R1', hazard: 'moving machinery' }],
    controlMeasures: ['guarding', 'induction'], requiredTraining: [{ code: 'SITE_INDUCTION' }],
    raiseConcernRoute: 'Shift manager'
  },
  versionedAt: '2026-09-18T12:00:00Z'
};

const pack = buildAssignmentReadyPack(baseInput);
assert.equal(pack.complete, true);
assert.equal(pack.touchlessReady, true);
assert.equal(pack.versionHash.length, 64);

const sameSemanticDifferentTimestamp = buildAssignmentReadyPack({
  ...baseInput,
  versionedAt: '2026-09-18T13:00:00Z'
});
assert.equal(sameSemanticDifferentTimestamp.versionHash, pack.versionHash);

const changed = buildAssignmentReadyPack({
  ...baseInput,
  versionedAt: '2026-09-18T12:00:00Z',
  safety: { ...baseInput.safety, controlMeasures: ['guarding', 'induction', 'hearing protection'] }
});
const delta = diffAssignmentPack(pack, changed);
assert.equal(delta.changed, true);
assert.equal(delta.requiresReacknowledgement, true);
assert(delta.changes.some(c => c.path === 'safety.controlMeasures'));

const handshakeGood = assessAssignmentHandshake({
  pack,
  supplierAcknowledgement: { versionHash: pack.versionHash, acknowledgedAt: '2026-09-18T12:05:00Z' },
  workerAcknowledgement: { versionHash: pack.versionHash, acknowledgedAt: '2026-09-18T12:06:00Z' },
  workerTraining: [{ code: 'SITE_INDUCTION', validUntil: '2027-01-01T00:00:00Z' }],
  now: '2026-09-18T12:10:00Z'
});
assert.equal(handshakeGood.touchlessAllowed, true);

const handshakeStale = assessAssignmentHandshake({
  pack: changed,
  supplierAcknowledgement: { versionHash: pack.versionHash },
  workerAcknowledgement: { versionHash: pack.versionHash },
  workerTraining: [{ code: 'SITE_INDUCTION', validUntil: '2027-01-01T00:00:00Z' }],
  now: '2026-09-18T12:10:00Z'
});
assert.equal(handshakeStale.touchlessAllowed, false);
assert(handshakeStale.gaps.includes('SUPPLIER_HAS_NOT_ACKNOWLEDGED_CURRENT_PACK'));
assert(handshakeStale.gaps.includes('WORKER_HAS_NOT_ACKNOWLEDGED_CURRENT_PACK'));

const fresh = assessAvailabilityFreshness({
  worker: { id: 'W1', availability: { shiftIds: ['SHIFT1'], lastUpdatedAt: '2026-09-18T13:00:00Z' } },
  requirement: { shiftId: 'SHIFT1', shiftStart: '2026-09-18T17:00:00Z' },
  now: '2026-09-18T14:00:00Z'
});
assert.equal(fresh.fresh, true);

const stale = assessAvailabilityFreshness({
  worker: { id: 'W2', availability: { shiftIds: ['SHIFT1'], lastUpdatedAt: '2026-09-18T08:00:00Z' } },
  requirement: { shiftId: 'SHIFT1', shiftStart: '2026-09-18T17:00:00Z' },
  now: '2026-09-18T14:00:00Z'
});
assert.equal(stale.fresh, false);
assert.equal(stale.action, 'REQUEST_ONE_TAP_AVAILABILITY_REFRESH');
assert.equal(stale.supplierCallRequired, false);

const assignments = [];
for (let i = 0; i < 12; i++) {
  const start = new Date(Date.UTC(2026, 5, 1 + i * 7));
  assignments.push({
    workerId: 'W1', hirerId: 'H1', roleKey: 'PACKER', supplierId: i < 6 ? 'A' : 'B',
    startAt: start.toISOString(), endAt: new Date(start.getTime() + 8 * 3600_000).toISOString()
  });
}
const awr = assessAwrContinuity({ workerId: 'W1', hirerId: 'H1', roleKey: 'PACKER', assignments });
assert.equal(awr.qualifyingWeeks, 12);
assert.equal(awr.suppliedByMultipleAgencies, true);
assert.equal(awr.status, 'QUALIFIED_EQUAL_TREATMENT');
assert(awr.requiredActions.includes('ENFORCE_EQUAL_TREATMENT_FOR_PAY_AND_BASIC_WORKING_CONDITIONS'));

const reset = assessAwrContinuity({
  workerId: 'W1', hirerId: 'H1', roleKey: 'PACKER', assignments,
  continuityEvents: [{
    workerId: 'W1', hirerId: 'H1', roleKey: 'PACKER', decision: 'RESET',
    reason: 'SUBSTANTIVELY_DIFFERENT_ROLE', effectiveAt: assignments[8].startAt, evidenceRef: 'ROLE-CHANGE-123'
  }]
});
assert(reset.qualifyingWeeks < 12);
assert.equal(reset.lastReset.evidenceRef, 'ROLE-CHANGE-123');

console.log('readiness tests: 9/9 passed');
