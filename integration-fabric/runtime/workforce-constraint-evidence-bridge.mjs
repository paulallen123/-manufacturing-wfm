import { createHash } from 'node:crypto';

function fail(message) { throw new Error(message); }

function plain(value, path = 'value', seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if (!value || typeof value !== 'object') fail(`${path} contains unsupported data`);
  if (seen.has(value)) fail(`${path} contains cyclic or shared data`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
      fail(`${path} must be a dense plain array`);
    }
    const out = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${path}[${index}] contains executable, hidden or sparse array data`);
      out.push(plain(descriptor.value, `${path}[${index}]`, seen));
    }
    seen.delete(value);
    return out;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${path} must be plain data`);
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${path} contains symbol data`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    out[key] = plain(descriptor.value, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return out;
}

// Canonicalize only the validated, inert snapshot produced by plain().
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${name} must be a clean non-empty string`);
  }
  return value;
}

function sha256Fingerprint(value, name) {
  text(value, name);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail(`${name} must be a sha256 fingerprint`);
  return value;
}

function assertNoEscalatedAuthority(evidence) {
  for (const field of [
    'operationalDecisionAuthority', 'controlAuthority', 'writeBackAuthority',
    'payrollAuthority', 'attendanceAuthority', 'causalClaimAuthority',
    'checkpointAdvanceAllowed', 'deletionAuthority'
  ]) {
    if (evidence[field] !== false) fail(`source evidence must explicitly deny ${field}`);
  }
}

/**
 * Advisory projection only. No trusted admission verifier or asset registry is
 * available in this contract: every structurally valid result remains blocked.
 * Caller flags, mapping assertions and digests never establish provenance.
 * Continue customer proof owns any future integration/admission decision.
 */
export function buildWorkforceConstraintEvidenceCandidate({
  tenantId,
  evidenceType,
  siteId,
  workCenterId = null,
  evidence,
  assetBinding = null
}) {
  tenantId = text(tenantId, 'tenantId');
  evidenceType = text(evidenceType, 'evidenceType');
  siteId = text(siteId, 'siteId');
  if (workCenterId !== null) workCenterId = text(workCenterId, 'workCenterId');

  const source = plain(evidence, 'evidence');
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('evidence must be a plain object');
  assertNoEscalatedAuthority(source);
  text(source.wfmTenantId, 'evidence.wfmTenantId');
  if (source.wfmTenantId !== tenantId) fail('manufacturing evidence tenant does not match requested VECTOR tenant');
  text(source.connectionId, 'evidence.connectionId');

  let binding = null;
  if (evidenceType === 'azure-iot-operations-keyframe') {
    if (source.stateSnapshotCandidate !== true) fail('Azure IoT Operations evidence must declare a state snapshot candidate');
    text(source.externalAssetId, 'evidence.externalAssetId');
    sha256Fingerprint(source.reconciliationFingerprint, 'evidence.reconciliationFingerprint');
    binding = plain(assetBinding, 'assetBinding');
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) fail('assetBinding must explicitly bind the Azure asset to a site and work centre');
    const expected = { wfmTenantId: tenantId, connectionId: source.connectionId,
      externalAssetId: source.externalAssetId, siteId, workCenterId };
    for (const [field, value] of Object.entries(expected)) {
      if (field !== 'workCenterId' || binding[field] !== null) text(binding[field], `assetBinding.${field}`);
      if (binding[field] !== value) fail(`assetBinding.${field} does not match requested source scope`);
    }
  } else if (evidenceType === 'manufacturing-observation') {
    if (source.transactionalEvidenceCandidate !== true && source.derivedObservationCandidate !== true) {
      fail('manufacturing observation must declare a transactional or derived candidate');
    }
    text(source.plantId, 'evidence.plantId');
    if (source.plantId !== siteId) fail('manufacturing observation plant does not match requested VECTOR site');
    const sourceWorkCenterId = source.workCenterId ?? null;
    if (sourceWorkCenterId !== null) text(sourceWorkCenterId, 'evidence.workCenterId');
    if (sourceWorkCenterId !== workCenterId) fail('manufacturing observation workCenterId does not match requested VECTOR work centre');
    text(source.checkpointNamespace, 'evidence.checkpointNamespace');
    if (assetBinding !== null) fail('assetBinding is only supported for Azure evidence');
  } else {
    fail('unsupported manufacturing evidence type');
  }

  // This digest identifies supplied content and scope, not authenticated source
  // bytes. A checkpoint namespace is retained separately as routing metadata.
  const sourceEvidenceFingerprint = `sha256:${createHash('sha256').update(canonical({
    version: 1, evidenceType, siteId, workCenterId, evidence: source, assetBinding: binding
  }), 'utf8').digest('hex')}`;

  return Object.freeze({
    workforceConstraintEvidenceCandidate: false,
    eligibleForWorkforceConstraintAssessment: false,
    admissionStatus: 'blocked',
    blockedReason: 'trusted-evidence-admission-unavailable',
    advisoryOnly: true,
    sourceProvenance: 'unknown',
    siteBindingProven: false,
    evidenceType,
    wfmTenantId: source.wfmTenantId,
    connectionId: source.connectionId,
    siteId,
    workCenterId,
    sourceEvidenceFingerprint,
    fingerprintKind: 'sha256-canonical-input-v1',
    sourceReconciliationFingerprint: evidenceType === 'azure-iot-operations-keyframe' ? source.reconciliationFingerprint : null,
    checkpointNamespace: evidenceType === 'manufacturing-observation' ? source.checkpointNamespace : null,
    sourceCompletenessProven: false,
    deliveryCompletenessProven: false,
    operationalDecisionAuthority: false,
    controlAuthority: false,
    writeBackAuthority: false,
    payrollAuthority: false,
    attendanceAuthority: false,
    causalClaimAuthority: false,
    checkpointAdvanceAllowed: false,
    deletionAuthority: false
  });
}
