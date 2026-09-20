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

function normaliseHostedVariableNames(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .slice(0, 500)
    .map((value) => clean(value, 120).toUpperCase())
    .filter((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)))]
    .sort();
}

function validateHostedPublicOrigin(value) {
  const raw = clean(value, 500);
  if (!raw) return { valid: false, reason: 'value-unavailable-or-empty', origin: null };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, reason: 'invalid-url', origin: null };
  }
  if (url.protocol !== 'https:') return { valid: false, reason: 'https-required', origin: null };
  if (url.username || url.password) return { valid: false, reason: 'embedded-credentials-forbidden', origin: null };
  if (!url.hostname) return { valid: false, reason: 'hostname-required', origin: null };
  if (url.search || url.hash) return { valid: false, reason: 'query-or-fragment-forbidden', origin: null };
  if (url.pathname && url.pathname !== '/') return { valid: false, reason: 'origin-must-not-contain-path', origin: null };
  return { valid: true, reason: 'explicit-https-origin', origin: url.origin };
}

function evaluateHostedOriginPreflight(input = {}) {
  const hostedMode = input.hostedMode === true;
  const variableNames = normaliseHostedVariableNames(input.variableNames);
  const variableDeclared = variableNames.includes('WFM_PUBLIC_ORIGIN');
  const origin = validateHostedPublicOrigin(input.publicOrigin);
  const ready = !hostedMode || (variableDeclared && origin.valid);

  const core = {
    schemaVersion: 1,
    proof: 'hosted-public-origin-preflight-protected-boundary',
    hostedMode,
    variableNamesDigest: digest(variableNames),
    publicOriginVariableDeclared: variableDeclared,
    publicOriginValueValidated: origin.valid,
    publicOriginValidationReason: origin.reason,
    validatedOrigin: origin.valid ? origin.origin : null,
    ready,
    manualConfigurationRequired: hostedMode && !ready,
    missingKeys: hostedMode && !variableDeclared ? ['WFM_PUBLIC_ORIGIN'] : [],
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    automaticConfigurationMutationAllowed: false,
    safetyGateBypassAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
  };

  return Object.freeze({ ...core, receiptDigest: digest(core) });
}

function diagnoseHostedOriginStartupFailure(input = {}) {
  const status = clean(input.deploymentStatus, 40).toUpperCase();
  if (!['FAILED', 'CRASHED'].includes(status)) {
    throw new Error('Hosted-origin startup diagnosis accepts FAILED or CRASHED deployments only.');
  }
  const deploymentId = validId(input.deploymentId);
  const deployLogs = Array.isArray(input.deployLogs)
    ? input.deployLogs.slice(0, 500).map((entry) => clean(typeof entry === 'string' ? entry : entry?.message, 4000))
    : [];
  const exactHostedOriginFailure = deployLogs.some((line) => /Hosted staging requires an explicit HTTPS WFM_PUBLIC_ORIGIN\.?/i.test(line));
  const runtimeObserved = deployLogs.some((line) => /Node\.js\s+v\d+\.\d+\.\d+/i.test(line));

  const core = {
    schemaVersion: 1,
    proof: 'railway-hosted-origin-startup-diagnosis-protected-boundary',
    provider: 'railway',
    deploymentId,
    deploymentStatus: status,
    classification: exactHostedOriginFailure
      ? 'hosted-public-origin-configuration-blocker'
      : 'not-hosted-public-origin-blocker',
    confidence: exactHostedOriginFailure ? 'high' : 'none',
    productRuntimeExecuted: deployLogs.length > 0,
    runtimeIdentityObserved: runtimeObserved,
    productFailureProven: false,
    configurationFailureProven: exactHostedOriginFailure,
    requiredKey: exactHostedOriginFailure ? 'WFM_PUBLIC_ORIGIN' : null,
    requiredValueContract: exactHostedOriginFailure ? 'explicit-https-origin' : null,
    deploymentTimeVariableBindingProven: false,
    evidenceFingerprint: digest({ deploymentId, status, deployLogs }),
    recommendedAction: exactHostedOriginFailure
      ? 'require-human-approved-WFM_PUBLIC_ORIGIN-configuration-before-an-isolated-proof-rerun'
      : 'preserve-evidence-and-use-the-general-proof-failure-classifier',
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    automaticConfigurationMutationAllowed: false,
    safetyGateBypassAllowed: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
  };

  return Object.freeze({ ...core, receiptDigest: digest(core) });
}

function verifyHostedOriginReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ''))) return false;
  if (
    receipt.releaseClaimAllowed !== false
    || receipt.autonomyPromotionAllowed !== false
    || receipt.automaticRedeployAllowed !== false
    || receipt.automaticConfigurationMutationAllowed !== false
    || receipt.safetyGateBypassAllowed !== false
    || receipt.productionMutation !== false
    || receipt.customerMutation !== false
    || receipt.payrollMutation !== false
    || receipt.identityMutation !== false
    || receipt.modelAuthorityGranted !== false
    || receipt.executionAuthorityGranted !== false
  ) return false;
  if (receipt.proof === 'railway-hosted-origin-startup-diagnosis-protected-boundary') {
    if (receipt.provider !== 'railway' || receipt.deploymentTimeVariableBindingProven !== false) return false;
    if (receipt.classification === 'hosted-public-origin-configuration-blocker') {
      if (
        receipt.configurationFailureProven !== true
        || receipt.productFailureProven !== false
        || receipt.requiredKey !== 'WFM_PUBLIC_ORIGIN'
        || receipt.requiredValueContract !== 'explicit-https-origin'
      ) return false;
    }
  } else if (receipt.proof === 'hosted-public-origin-preflight-protected-boundary') {
    if (receipt.hostedMode === true && receipt.ready === true) {
      if (receipt.publicOriginVariableDeclared !== true || receipt.publicOriginValueValidated !== true) return false;
    }
  } else {
    return false;
  }
  const core = { ...receipt };
  const expected = core.receiptDigest;
  delete core.receiptDigest;
  return expected === digest(core);
}

function assertHostedOriginSafetyContract() {
  const missing = evaluateHostedOriginPreflight({ hostedMode: true, variableNames: ['WFM_HOSTED_STAGING'] });
  const valid = evaluateHostedOriginPreflight({
    hostedMode: true,
    variableNames: ['WFM_PUBLIC_ORIGIN'],
    publicOrigin: 'https://proof.invalid/',
  });
  const observedFailure = diagnoseHostedOriginStartupFailure({
    deploymentId: 'self-check',
    deploymentStatus: 'FAILED',
    deployLogs: ['Node.js v22.23.2', 'Error: Hosted staging requires an explicit HTTPS WFM_PUBLIC_ORIGIN.'],
  });
  if (
    missing.ready !== false
    || missing.manualConfigurationRequired !== true
    || missing.missingKeys.length !== 1
    || missing.missingKeys[0] !== 'WFM_PUBLIC_ORIGIN'
    || valid.ready !== true
    || valid.validatedOrigin !== 'https://proof.invalid'
    || validateHostedPublicOrigin('http://proof.invalid').valid !== false
    || validateHostedPublicOrigin('https://user:pass@proof.invalid').valid !== false
    || validateHostedPublicOrigin('https://proof.invalid/path').valid !== false
    || observedFailure.classification !== 'hosted-public-origin-configuration-blocker'
    || observedFailure.configurationFailureProven !== true
    || !verifyHostedOriginReceipt(missing)
    || !verifyHostedOriginReceipt(valid)
    || !verifyHostedOriginReceipt(observedFailure)
  ) {
    throw new Error('Hosted public-origin safety contract failed closed self-check.');
  }
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

function configBindingCanElevateDiagnosis(input = {}) {
  const deploymentId = validId(input.deploymentId);
  const serviceConfigDigest = digestDeploymentConfigSnapshot(input.serviceConfig);
  const receipt = input.deploymentConfigBindingReceipt;
  const receiptValid = verifyRailwayDeploymentConfigBindingReceipt(receipt);
  const bound = Boolean(
    receiptValid
    && receipt.deploymentConfigEvidenceBound === true
    && receipt.canElevateDiagnosisConfidence === true
    && receipt.securityHoldDiagnosisHighConfidenceAllowed === true
    && receipt.deploymentId === deploymentId
    && serviceConfigDigest
    && receipt.configSnapshotDigest === serviceConfigDigest
    && receipt.attestedConfigDigest === serviceConfigDigest
  );

  return {
    receiptValid,
    bound,
    serviceConfigDigest,
    receipt: receiptValid && (receipt.deploymentConfigEvidenceBound !== true || bound) ? receipt : null,
  };
}

function classifyRailwayProofFailureWithBoundConfig(input = {}) {
  const binding = configBindingCanElevateDiagnosis(input);
  const classifier = require('./railway-proof-failure-classifier.cjs');
  const classifierInput = { ...input };
  delete classifierInput.deploymentConfigBindingReceipt;
  if (!binding.bound) delete classifierInput.serviceConfig;

  const diagnosis = classifier.classifyRailwayProofFailure(classifierInput);
  if (!classifier.verifyDiagnosisReceipt(diagnosis)) {
    throw new Error('Railway proof diagnosis receipt failed verification.');
  }

  const core = {
    schemaVersion: 1,
    proof: 'railway-proof-failure-provenance-bound-classification',
    provider: 'railway',
    deploymentId: validId(input.deploymentId),
    deploymentConfigEvidenceBound: binding.bound,
    serviceConfigDigest: binding.serviceConfigDigest,
    configBindingReceipt: binding.receipt,
    diagnosis,
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
    recommendedAction: binding.bound
      ? 'use-only-the-bound-config-backed-diagnosis-without-granting-release-or-execution-authority'
      : 'treat-service-config-as-current-state-only-and-do-not-elevate-historical-config-diagnosis-confidence',
  };

  return Object.freeze({
    ...core,
    receiptDigest: digest(core),
  });
}

function verifyRailwayProofFailureWithBoundConfigReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ''))) return false;
  if (
    receipt.schemaVersion !== 1
    || receipt.proof !== 'railway-proof-failure-provenance-bound-classification'
    || receipt.provider !== 'railway'
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
    || !receipt.diagnosis
  ) return false;

  const classifier = require('./railway-proof-failure-classifier.cjs');
  if (!classifier.verifyDiagnosisReceipt(receipt.diagnosis)) return false;
  if (receipt.diagnosis.deploymentId !== receipt.deploymentId) return false;

  const bound = receipt.deploymentConfigEvidenceBound === true;
  if (bound) {
    if (
      !receipt.configBindingReceipt
      || !verifyRailwayDeploymentConfigBindingReceipt(receipt.configBindingReceipt)
      || receipt.configBindingReceipt.deploymentConfigEvidenceBound !== true
      || receipt.configBindingReceipt.deploymentId !== receipt.deploymentId
      || !validDigest(receipt.serviceConfigDigest)
      || receipt.configBindingReceipt.configSnapshotDigest !== receipt.serviceConfigDigest
      || receipt.configBindingReceipt.attestedConfigDigest !== receipt.serviceConfigDigest
    ) return false;
  } else {
    if (receipt.configBindingReceipt) {
      if (!verifyRailwayDeploymentConfigBindingReceipt(receipt.configBindingReceipt)) return false;
      if (receipt.configBindingReceipt.deploymentConfigEvidenceBound !== false) return false;
    }
    if (receipt.diagnosis.classification === 'security-containment-hold-active') return false;
  }

  const core = { ...receipt };
  const expected = core.receiptDigest;
  delete core.receiptDigest;
  return expected === digest(core);
}

assertHostedOriginSafetyContract();

module.exports = {
  assessRailwayDeploymentConfigBinding,
  verifyRailwayDeploymentConfigBindingReceipt,
  classifyRailwayProofFailureWithBoundConfig,
  verifyRailwayProofFailureWithBoundConfigReceipt,
  normaliseDeploymentConfig,
  digestDeploymentConfigSnapshot,
  evaluateHostedOriginPreflight,
  diagnoseHostedOriginStartupFailure,
  validateHostedPublicOrigin,
  verifyHostedOriginReceipt,
  normaliseHostedVariableNames,
  digest,
};
