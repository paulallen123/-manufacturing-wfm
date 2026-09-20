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

  const identityComplete = Boolean(deploymentId && deploymentSnapshotId && deploymentCreatedAt);
  const immutableBindingMatches = identityComplete
    && sourceIsImmutableDeploymentSnapshot
    && providerAttestedImmutable
    && bindingId === deploymentSnapshotId;

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
  } else if (immutableBindingMatches) {
    classification = 'deployment-config-evidence-bound';
    reason = 'provider-attested-immutable-config-bound-to-deployment-snapshot';
  }

  const configAgeMs = deploymentCreatedAt && configObservedAt
    ? Date.parse(configObservedAt) - Date.parse(deploymentCreatedAt)
    : null;

  const core = {
    schemaVersion: 1,
    proof: 'railway-deployment-config-evidence-binding',
    provider: 'railway',
    deploymentId,
    deploymentSnapshotId,
    deploymentCreatedAt,
    configObservedAt,
    configEvidenceSource: source,
    configBindingId: bindingId,
    providerAttestedImmutable,
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
      ? 'allow-bound-config-evidence-to-inform-diagnosis-without-granting-release-or-execution-authority'
      : 'treat-service-config-as-current-state-only-and-require-provider-bound-deployment-config-evidence-before-high-confidence-historical-diagnosis',
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
    receipt.proof !== 'railway-deployment-config-evidence-binding'
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
  digest,
};
