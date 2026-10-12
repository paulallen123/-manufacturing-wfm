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

function assetBinding(overrides = {}) {
  return {
    wfmTenantId: 'tenant-1', connectionId: 'aio-1', externalAssetId: 'asset-1',
    siteId: 'plant-1', workCenterId: 'line-a', ...overrides
  };
}

function request(overrides = {}) {
  return {
    tenantId: 'tenant-1', evidenceType: 'azure-iot-operations-keyframe',
    siteId: 'plant-1', workCenterId: 'line-a',
    assetBinding: assetBinding(), evidence: azure(), ...overrides
  };
}

function manufacturing(overrides = {}) {
  return {
    ...denied, transactionalEvidenceCandidate: true, derivedObservationCandidate: false,
    wfmTenantId: 'tenant-1', connectionId: 'mes-1', plantId: 'plant-1',
    workCenterId: 'line-a', checkpointNamespace: 'manufacturing-observation:abc',
    observations: [{ id: 'observation-1', temperature: 20 }], ...overrides
  };
}

function observationRequest(overrides = {}) {
  return request({ evidenceType: 'manufacturing-observation', assetBinding: null,
    evidence: manufacturing(), ...overrides });
}

test('returns only blocked advisory context when trusted admission is unavailable', () => {
  const candidate = buildWorkforceConstraintEvidenceCandidate({
    tenantId: 'tenant-1',
    evidenceType: 'azure-iot-operations-keyframe',
    siteId: 'plant-1',
    workCenterId: 'line-a',
    assetBinding: assetBinding(),
    evidence: azure()
  });

  assert.equal(candidate.workforceConstraintEvidenceCandidate, false);
  assert.equal(candidate.eligibleForWorkforceConstraintAssessment, false);
  assert.equal(candidate.admissionStatus, 'blocked');
  assert.equal(candidate.blockedReason, 'trusted-evidence-admission-unavailable');
  assert.equal(candidate.advisoryOnly, true);
  assert.equal(candidate.sourceProvenance, 'unknown');
  assert.equal(candidate.siteBindingProven, false);
  assert.equal(candidate.wfmTenantId, 'tenant-1');
  for (const field of Object.keys(denied)) assert.equal(candidate[field], false, field);
});

test('Azure cannot borrow a caller-selected site or work centre without an explicit asset binding', () => {
  for (const binding of [undefined, null, {}]) {
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({ assetBinding: binding })), /assetBinding/);
  }
});

test('Azure binding must exactly match tenant, connection, asset, site and work centre', () => {
  for (const field of ['wfmTenantId', 'connectionId', 'externalAssetId', 'siteId', 'workCenterId']) {
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({
      assetBinding: assetBinding({ [field]: 'different' })
    })), new RegExp(`assetBinding.${field}`));
    const missing = assetBinding();
    delete missing[field];
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({ assetBinding: missing })), /assetBinding/);
  }
});

test('explicit null work centre is site-only context and cannot be upgraded to a line', () => {
  const binding = assetBinding({ workCenterId: null });
  const candidate = buildWorkforceConstraintEvidenceCandidate(request({ workCenterId: null, assetBinding: binding }));
  assert.equal(candidate.workCenterId, null);
  assert.equal(candidate.eligibleForWorkforceConstraintAssessment, false);
  assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({ assetBinding: binding })), /workCenterId/);
});

test('manufacturing work centre cannot be invented or rebound', () => {
  for (const value of [undefined, null, 'other-line']) {
    const evidence = manufacturing({ workCenterId: value });
    if (value === undefined) delete evidence.workCenterId;
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(observationRequest({ evidence })), /workCenterId/);
  }
});

test('manufacturing fingerprint binds content instead of checkpoint namespace', () => {
  const first = buildWorkforceConstraintEvidenceCandidate(observationRequest());
  const second = buildWorkforceConstraintEvidenceCandidate(observationRequest({
    evidence: manufacturing({ observations: [{ id: 'observation-1', temperature: 99 }] })
  }));
  assert.match(first.sourceEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
  // Fixed fixture independently hashed from sorted compact JSON using Python hashlib.
  assert.equal(first.sourceEvidenceFingerprint, 'sha256:81e8f23a33cdd84e5478cdb0551c913245dda764f4fcb6e096eb83076469deca');
  assert.notEqual(first.sourceEvidenceFingerprint, second.sourceEvidenceFingerprint);
  assert.equal(first.checkpointNamespace, 'manufacturing-observation:abc');
  assert.equal(first.fingerprintKind, 'sha256-canonical-input-v1');
  assert.equal(first.admissionStatus, 'blocked');
});

test('local digest is deterministic across object key order and does not trust a supplied digest', () => {
  const original = manufacturing({ reconciliationFingerprint: `sha256:${'b'.repeat(64)}` });
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  const first = buildWorkforceConstraintEvidenceCandidate(observationRequest({ evidence: original }));
  const second = buildWorkforceConstraintEvidenceCandidate(observationRequest({ evidence: reordered }));
  assert.equal(first.sourceEvidenceFingerprint, second.sourceEvidenceFingerprint);
  assert.notEqual(first.sourceEvidenceFingerprint, original.reconciliationFingerprint);
});

test('digest includes the requested scope and Azure binding, without authenticating either', () => {
  const first = buildWorkforceConstraintEvidenceCandidate(request());
  const second = buildWorkforceConstraintEvidenceCandidate(request({
    siteId: 'plant-2', assetBinding: assetBinding({ siteId: 'plant-2' })
  }));
  assert.notEqual(first.sourceEvidenceFingerprint, second.sourceEvidenceFingerprint);
  assert.equal(second.siteBindingProven, false);
  assert.equal(second.admissionStatus, 'blocked');
  assert.equal(first.sourceReconciliationFingerprint, azure().reconciliationFingerprint);
});

test('caller flags, claimed attestation and completeness cannot confer trusted admission', () => {
  const forged = {
    trusted: true, admitted: true, trustedEvidenceAdmission: true,
    admissionStatus: 'admitted', sourceProvenance: 'verified', siteBindingProven: true,
    eligibleForWorkforceConstraintAssessment: true, workforceConstraintEvidenceCandidate: true,
    sourceCompletenessProven: true, deliveryCompletenessProven: true,
    attestation: { verified: true, issuer: 'caller' }
  };
  for (const input of [request({ ...forged, evidence: azure(forged) }),
    observationRequest({ ...forged, evidence: manufacturing(forged) })]) {
    const result = buildWorkforceConstraintEvidenceCandidate(input);
    assert.equal(result.admissionStatus, 'blocked');
    assert.equal(result.workforceConstraintEvidenceCandidate, false);
    assert.equal(result.eligibleForWorkforceConstraintAssessment, false);
    assert.equal(result.sourceCompletenessProven, false);
    assert.equal(result.deliveryCompletenessProven, false);
    for (const field of Object.keys(denied)) assert.equal(result[field], false, field);
  }
});

test('all eight explicit authority denials are required for both source types', () => {
  for (const field of Object.keys(denied)) {
    for (const value of [true, null, 0, 'false', undefined]) {
      for (const input of [request(), observationRequest()]) {
        if (value === undefined) delete input.evidence[field];
        else input.evidence[field] = value;
        assert.throws(() => buildWorkforceConstraintEvidenceCandidate(input), new RegExp(field));
      }
    }
  }
});

test('arrays with accessors, hidden keys, symbols, extra keys or holes are rejected without executing accessors', () => {
  let reads = 0;
  const accessor = [0];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 20; } });
  const hidden = [0];
  Object.defineProperty(hidden, 'extra', { value: 1 });
  const symbol = [0];
  symbol[Symbol('extra')] = 1;
  const extra = [0];
  extra.extra = 1;
  const sparse = new Array(1);
  for (const observations of [accessor, hidden, symbol, extra, sparse]) {
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(observationRequest({
      evidence: manufacturing({ observations })
    })), /array|executable|hidden|symbol/);
  }
  assert.equal(reads, 0);
});

test('prototype-shaped own keys cannot smuggle inherited authority fields', () => {
  const evidence = JSON.parse(JSON.stringify(azure()));
  delete evidence.operationalDecisionAuthority;
  Object.defineProperty(evidence, '__proto__', { enumerable: true, value: { operationalDecisionAuthority: false } });
  assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({ evidence })), /operationalDecisionAuthority/);
});

test('rejects executable, cyclic, non-finite and unsupported source data', () => {
  let reads = 0;
  const executable = azure();
  Object.defineProperty(executable, 'payload', { enumerable: true, get() { reads++; return 1; } });
  const cyclic = azure();
  cyclic.payload = cyclic;
  for (const evidence of [executable, cyclic, azure({ payload: NaN }), azure({ payload: new Date() })]) {
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(request({ evidence })));
  }
  assert.equal(reads, 0);
});

test('result is immutable and isolated from later caller mutation', () => {
  const input = request();
  const result = buildWorkforceConstraintEvidenceCandidate(input);
  const digest = result.sourceEvidenceFingerprint;
  input.evidence.externalAssetId = 'mutated';
  input.assetBinding.siteId = 'mutated';
  assert.equal(result.siteId, 'plant-1');
  assert.equal(result.sourceEvidenceFingerprint, digest);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.eligibleForWorkforceConstraintAssessment = true; }, TypeError);
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

test('rejects both source types when tenant binding drifts', () => {
  for (const input of [request(), observationRequest()]) {
    input.evidence.wfmTenantId = 'tenant-2';
    assert.throws(() => buildWorkforceConstraintEvidenceCandidate(input), /tenant does not match/);
  }
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
