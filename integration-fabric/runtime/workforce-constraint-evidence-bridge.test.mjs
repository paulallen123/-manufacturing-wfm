import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkforceConstraintEvidenceCandidate } from './workforce-constraint-evidence-bridge.mjs';

const denied = {
  operationalDecisionAuthority: false,
  controlAuthority: false,
  writeBackAuthority: false,
  payrollAuthority: false,
  attendanceAuthority: false,
  causalClaimAuthority: false,
  checkpointAdvanceAllowed: false,
  deletionAuthority: false
};

function azure(overrides = {}) {
  return {
    ...denied,
    stateSnapshotCandidate: true,
    sourceCompletenessProven: false,
    deliveryCompletenessProven: false,
    wfmTenantId: 'tenant-1',
    connectionId: 'aio-1',
    externalAssetId: 'asset-1',
    reconciliationFingerprint: `sha256:${'a'.repeat(64)}`,
    ...overrides
  };
}

test('admits Azure IoT current-state evidence only as bounded workforce constraint context', () => {
  const candidate = buildWorkforceConstraintEvidenceCandidate({
    tenantId: 'tenant-1',
    evidenceType: 'azure-iot-operations-keyframe',
    siteId: 'plant-1',
    workCenterId: 'line-a',
    evidence: azure()
  });

  assert.equal(candidate.workforceConstraintEvidenceCandidate, true);
  assert.equal(candidate.eligibleForWorkforceConstraintAssessment, true);
  assert.equal(candidate.wfmTenantId, 'tenant-1');
  for (const field of Object.keys(denied)) assert.equal(candidate[field], false, field);
});

test('rejects manufacturing evidence when plant/site binding drifts', () => {
  assert.throws(() => buildWorkforceConstraintEvidenceCandidate({
    tenantId: 'tenant-1',
    evidenceType: 'manufacturing-observation',
    siteId: 'plant-1',
    evidence: {
      ...denied,
      transactionalEvidenceCandidate: true,
      derivedObservationCandidate: false,
      wfmTenantId: 'tenant-1',
      connectionId: 'mes-1',
      plantId: 'plant-2',
      checkpointNamespace: 'manufacturing-observation:abc'
    }
  }), /plant does not match/);
});

test('rejects manufacturing evidence when tenant binding drifts', () => {
  assert.throws(() => buildWorkforceConstraintEvidenceCandidate({
    tenantId: 'tenant-1',
    evidenceType: 'azure-iot-operations-keyframe',
    siteId: 'plant-1',
    evidence: azure({ wfmTenantId: 'tenant-2' })
  }), /tenant does not match/);
});

test('rejects malformed Azure reconciliation fingerprints before workforce assessment', () => {
  assert.throws(() => buildWorkforceConstraintEvidenceCandidate({
    tenantId: 'tenant-1',
    evidenceType: 'azure-iot-operations-keyframe',
    siteId: 'plant-1',
    evidence: azure({ reconciliationFingerprint: 'not-a-content-digest' })
  }), /sha256 fingerprint/);
});

test('rejects any upstream attempt to smuggle authority through the bridge', () => {
  for (const field of Object.keys(denied)) {
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate({
      tenantId: 'tenant-1',
      evidenceType: 'azure-iot-operations-keyframe',
      siteId: 'plant-1',
      evidence: azure({ [field]: true })
    }), new RegExp(field));
  }
});
