'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function validIso(value) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function validId(value, max = 180) {
  const id = clean(value, max);
  return id && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function validDigest(value) {
  const candidate = clean(value, 80).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
}

function normaliseDeploymentConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  const build = value.build && typeof value.build === 'object' ? value.build : {};
  const normalized = {
    builder: clean(build.builder, 40).toUpperCase() || null,
    rootDirectory: clean(source.rootDirectory, 240) || null,
    dockerfilePath: clean(build.dockerfilePath, 240) || null,
    watchPatterns: Array.isArray(build.watchPatterns)
      ? [...new Set(build.watchPatterns.slice(0, 50).map((entry) => clean(entry, 240)).filter(Boolean))].sort()
      : [],
  };
  const hasPayload = Boolean(
    normalized.builder
    || normalized.rootDirectory
    || normalized.dockerfilePath
    || normalized.watchPatterns.length > 0
  );
  return hasPayload ? normalized : null;
}

function digestDeploymentConfigSnapshot(value = {}) {
  const normalized = normaliseDeploymentConfig(value);
  return normalized ? digest(normalized) : null;
}

function assessRailwayDeploymentConfigBinding(input = {}) {
  const deploymentId = validId(input.deploymentId);
  const deploymentSnapshotId = validId(input.deploymentSnapshotId);
  const deploymentCreatedAt = validIso(input.deploymentCreatedAt);
  const configObservedAt = validIso(input.configObservedAt);
  const evidence = input.configEvidence && typeof input.configEvidence === 'object'
    ? input.configEvidence
    : {};
  const source = clean(evidence.source, 80).toLowerCase() || null;
  const bindingId = validId(evidence.bindingId);
  const providerAttestedImmutable = evidence.providerAttestedImmutable === true;
  const sourceIsImmutableDeploymentSnapshot = source === 'deployment-snapshot';
  const configSnapshotDigest = digestDeploymentConfigSnapshot(input.configSnapshot);
  const attestedConfigDigest = validDigest(evidence.attestedConfigDigest);
  const configPayloadDigestBound = Boolean(
    configSnapshotDigest
    && attestedConfigDigest
    && configSnapshotDigest === attestedConfigDigest
  );

  const identityComplete = Boolean(deploymentId && deploymentSnapshotId && deploymentCreatedAt);
  const immutableBindingMatches = identityComplete
    && sourceIsImmutableDeploymentSnapshot
    && providerAttestedImmutable
    && bindingId === deploymentSnapshotId
    && configPayloadDigestBound;

  let classification = 'invalid-or-missing-config-binding';
  let reason = 'deployment-identity-or-config-binding-evidence-incomplete';

  if (source === 'live-service-config') {
    classification = 'mutable-config-not-deployment-bound';
    reason = 'live-service-config-can-change-after-deployment-and-cannot-prove-historical-deployment-config';
  } else if (sourceIsImmutableDeploymentSnapshot && !providerAttestedImmutable) {
    classification = 'unattested-config-snapshot';
    reason = 'deployment-snapshot-source-must-be-provider-attested-immutable';
  } else if (sourceIsImmutableDeploymentSnapshot && bindingId !== deploymentSnapshotId) {
    classification = 'config-snapshot-binding-mismatch';
    reason = 'config-binding-id-does-not-match-deployment-snapshot-id';
  } else if (
    sourceIsImmutableDeploymentSnapshot
    && providerAttestedImmutable
    && bindingId === deploymentSnapshotId
    && (!configSnapshotDigest || !attestedConfigDigest)
  ) {
    classification = 'config-payload-binding-incomplete';
    reason = 'immutable-deployment-config-evidence-must-bind-an-attested-digest-to-a-non-empty-safe-config-snapshot';
  } else if (
    sourceIsImmutableDeploymentSnapshot
    && providerAttestedImmutable
    && bindingId === deploymentSnapshotId
    && !configPayloadDigestBound
  ) {
    classification = 'config-payload-digest-mismatch';
    reason = 'attested-config-digest-does-not-match-the-config-snapshot-being-evaluated';
  } else if (immutableBindingMatches) {
    classification = 'deployment-config-evidence-bound';
    reason = 'provider-attested-immutable-config-and-payload-digest-bound-to-deployment-snapshot';
  }

  const configAgeMs = deploymentCreatedAt && configObservedAt
    ? Date.parse(configObservedAt) - Date.parse(deploymentCreatedAt)
    : null;

  const core = {
    schemaVersion: 2,
    proof: 'railway-deployment-config-evidence-binding',
    provider: 'railway',
    deploymentId,
    deploymentSnapshotId,
    deploymentCreatedAt,
    configObservedAt,
    configEvidenceSource: source,
    configBindingId: bindingId,
    providerAttestedImmutable,
    configSnapshotDigest,
    attestedConfigDigest,
    configPayloadDigestBound,
    classification,
    reason,
    deploymentConfigEvidenceBound: immutableBindingMatches,
    canElevateDiagnosisConfidence: immutableBindingMatches,
    securityHoldDiagnosisHighConfidenceAllowed: immutableBindingMatches,
    configAgeMs,
    productFailureProven: false,
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    safetyGateBypassAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
    recommendedAction: immutableBindingMatches
      ? 'allow-only-the-digest-bound-config-snapshot-to-inform-diagnosis-without-granting-release-or-execution-authority'
      : 'treat-unbound-or-mutable-service-config-as-current-state-only-and-require-provider-bound-snapshot-plus-payload-digest-before-high-confidence-historical-diagnosis',
  };

  return Object.freeze({
    ...core,
    receiptDigest: digest(core),
  });
}

function verifyRailwayDeploymentConfigBindingReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ''))) return false;
  if (
    receipt.schemaVersion !== 2
    || receipt.proof !== 'railway-deployment-config-evidence-binding'
    || receipt.provider !== 'railway'
    || receipt.productFailureProven !== false
    || receipt.releaseClaimAllowed !== false
    || receipt.autonomyPromotionAllowed !== false
    || receipt.automaticRedeployAllowed !== false
    || receipt.safetyGateBypassAllowed !== false
    || receipt.productionMutation !== false
    || receipt.customerMutation !== false
    || receipt.payrollMutation !== false
    || receipt.identityMutation !== false
    || receipt.modelAuthorityGranted !== false
    || receipt.executionAuthorityGranted !== false
  ) return false;

  const snapshotDigest = validDigest(receipt.configSnapshotDigest);
  const attestedDigest = validDigest(receipt.attestedConfigDigest);
  const digestBound = Boolean(snapshotDigest && attestedDigest && snapshotDigest === attestedDigest);
  if (receipt.configPayloadDigestBound !== digestBound) return false;

  const bound = receipt.deploymentConfigEvidenceBound === true;
  if (receipt.canElevateDiagnosisConfidence !== bound) return false;
  if (receipt.securityHoldDiagnosisHighConfidenceAllowed !== bound) return false;

  if (bound) {
    if (
      receipt.classification !== 'deployment-config-evidence-bound'
      || receipt.configEvidenceSource !== 'deployment-snapshot'
      || receipt.providerAttestedImmutable !== true
      || !receipt.deploymentSnapshotId
      || receipt.configBindingId !== receipt.deploymentSnapshotId
      || !digestBound
    ) return false;
  } else if (
    receipt.classification === 'deployment-config-evidence-bound'
    || receipt.canElevateDiagnosisConfidence !== false
    || receipt.securityHoldDiagnosisHighConfidenceAllowed !== false
  ) {
    return false;
  }

  const core = { ...receipt };
  const expected = core.receiptDigest;
  delete core.receiptDigest;
  return expected === digest(core);
}

module.exports = {
  assessRailwayDeploymentConfigBinding,
  verifyRailwayDeploymentConfigBindingReceipt,
  normaliseDeploymentConfig,
  digestDeploymentConfigSnapshot,
  digest,
};
