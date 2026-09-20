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

function clean(value, max = 4000) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normaliseVariableNames(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .slice(0, 500)
    .map((value) => clean(value, 120).toUpperCase())
    .filter((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)))]
    .sort();
}

function validatePublicOrigin(value) {
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
  const variableNames = normaliseVariableNames(input.variableNames);
  const variableDeclared = variableNames.includes('WFM_PUBLIC_ORIGIN');
  const origin = validatePublicOrigin(input.publicOrigin);

  const ready = !hostedMode || (variableDeclared && origin.valid);
  const core = {
    schemaVersion: 1,
    proof: 'hosted-public-origin-preflight',
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
  const deploymentId = clean(input.deploymentId, 160) || null;
  const deployLogs = Array.isArray(input.deployLogs)
    ? input.deployLogs.slice(0, 500).map((entry) => clean(typeof entry === 'string' ? entry : entry?.message))
    : [];
  const variableNames = normaliseVariableNames(input.currentVariableNames);
  const exactHostedOriginFailure = deployLogs.some((line) => /Hosted staging requires an explicit HTTPS WFM_PUBLIC_ORIGIN\.?/i.test(line));
  const runtimeObserved = deployLogs.some((line) => /Node\.js\s+v\d+\.\d+\.\d+/i.test(line));
  const currentVariableDeclared = variableNames.includes('WFM_PUBLIC_ORIGIN');

  const core = {
    schemaVersion: 1,
    proof: 'railway-hosted-origin-startup-diagnosis',
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
    currentVariableDeclared,
    currentVariableNamesDigest: digest(variableNames),
    liveConfigCorroborationOnly: true,
    deploymentTimeVariableBindingProven: false,
    evidenceFingerprint: digest({ deploymentId, status, deployLogs }),
    recommendedAction: exactHostedOriginFailure
      ? 'configure-WFM_PUBLIC_ORIGIN-through-the-existing-human-approved-environment-config-path-and-rerun-the-isolated-proof'
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

function verifyReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ''))) return false;
  if (
    receipt.releaseClaimAllowed !== false
    || receipt.autonomyPromotionAllowed !== false
    || receipt.automaticRedeployAllowed !== false
    || receipt.automaticConfigurationMutationAllowed !== false
    || receipt.productionMutation !== false
    || receipt.customerMutation !== false
    || receipt.payrollMutation !== false
    || receipt.identityMutation !== false
    || receipt.modelAuthorityGranted !== false
    || receipt.executionAuthorityGranted !== false
  ) return false;
  if (receipt.proof === 'railway-hosted-origin-startup-diagnosis') {
    if (receipt.provider !== 'railway' || receipt.deploymentTimeVariableBindingProven !== false || receipt.liveConfigCorroborationOnly !== true) return false;
    if (receipt.classification === 'hosted-public-origin-configuration-blocker') {
      if (receipt.configurationFailureProven !== true || receipt.requiredKey !== 'WFM_PUBLIC_ORIGIN' || receipt.requiredValueContract !== 'explicit-https-origin') return false;
    }
  }
  const core = { ...receipt };
  delete core.receiptDigest;
  return digest(core) === receipt.receiptDigest;
}

module.exports = {
  diagnoseHostedOriginStartupFailure,
  evaluateHostedOriginPreflight,
  normaliseVariableNames,
  validatePublicOrigin,
  verifyReceipt,
  digest,
};
