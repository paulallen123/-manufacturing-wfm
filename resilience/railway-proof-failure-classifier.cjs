'use strict';

const { createHash } = require('node:crypto');

const EXPECTED_BROWSER_ROLES = Object.freeze([
  'manager',
  'employee',
  'payroll',
  'company-admin',
  'isolation-manager',
]);

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

function normaliseLogs(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 500).map((entry) => clean(typeof entry === 'string' ? entry : entry?.message));
}

function contains(logs, pattern) {
  return logs.some((line) => pattern.test(line));
}

function normaliseServiceConfig(value = {}) {
  const source = value?.source && typeof value.source === 'object' ? value.source : {};
  const build = value?.build && typeof value.build === 'object' ? value.build : {};
  return {
    builder: clean(build.builder, 40).toUpperCase() || null,
    rootDirectory: clean(source.rootDirectory, 240) || null,
    dockerfilePath: clean(build.dockerfilePath, 240) || null,
    watchPatterns: Array.isArray(build.watchPatterns)
      ? build.watchPatterns.slice(0, 50).map((entry) => clean(entry, 240)).filter(Boolean)
      : [],
  };
}

function securityHoldBuildEvidence(serviceConfig, buildLogs, deployLogs) {
  const config = normaliseServiceConfig(serviceConfig);
  const rootHeld = /__security_hold_[a-z0-9_-]*__/i.test(config.rootDirectory || '');
  const dockerfileHeld = /__security_(?:manual_redeploy_)?hold__[a-z0-9_/-]*/i.test(config.dockerfilePath || '')
    || /__security_manual_redeploy_hold__/i.test(config.dockerfilePath || '');
  const watchHeld = config.watchPatterns.some((entry) => /__security_hold_[a-z0-9_-]*__/i.test(entry));
  const holdSignals = [rootHeld, dockerfileHeld, watchHeld].filter(Boolean).length;
  const observedRailpack = contains(buildLogs, /using build driver railpack(?:-v)?/i)
    || contains(buildLogs, /Railpack\s+\d+\.\d+\.\d+/i);
  const railpackDetectionFailed = contains(buildLogs, /Railpack could not determine how to build the app/i)
    || contains(buildLogs, /Script\s+start\.sh\s+not\s+found/i);
  const configuredDockerfileBuilder = config.builder === 'DOCKERFILE' && Boolean(config.dockerfilePath);
  const active = configuredDockerfileBuilder
    && holdSignals >= 2
    && observedRailpack
    && railpackDetectionFailed
    && deployLogs.length === 0;

  return {
    active,
    config,
    holdSignals,
    observedBuilder: observedRailpack ? 'RAILPACK' : null,
  };
}

function restartDurabilityFailures(deployLogs) {
  const failures = [];
  if (contains(deployLogs, /POST_RESTART_LEAVE_PERSISTENCE_FAIL/i)) failures.push('approved-leave');
  if (contains(deployLogs, /POST_RESTART_CORRECTION_PERSISTENCE_FAIL/i)) failures.push('rejected-correction');
  if (contains(deployLogs, /POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_FAIL/i)) failures.push('revoked-kiosk');
  return failures;
}

function browserRoleMatrixEvidence(deployLogs) {
  const expected = new Set(EXPECTED_BROWSER_ROLES);
  const passed = new Set();
  const failed = new Map();

  for (const line of deployLogs) {
    const pass = line.match(/^PRIVATE_BROWSER_ROLE_PASS=([a-z0-9-]+)\|/i);
    if (pass) {
      const role = clean(pass[1], 40).toLowerCase();
      if (expected.has(role)) passed.add(role);
      continue;
    }

    const fail = line.match(/^PRIVATE_BROWSER_ROLE_FAIL=([a-z0-9-]+)\|(.+)$/i);
    if (fail) {
      const role = clean(fail[1], 40).toLowerCase();
      if (expected.has(role)) failed.set(role, clean(fail[2], 240));
    }
  }

  const overlaps = [...passed].filter((role) => failed.has(role));
  const accounted = new Set([...passed, ...failed.keys()]);
  const completeAccounting = EXPECTED_BROWSER_ROLES.every((role) => accounted.has(role))
    && accounted.size === EXPECTED_BROWSER_ROLES.length
    && overlaps.length === 0;

  return {
    completeAccounting,
    passedBrowserRoles: EXPECTED_BROWSER_ROLES.filter((role) => passed.has(role)),
    failedBrowserRoles: EXPECTED_BROWSER_ROLES
      .filter((role) => failed.has(role))
      .map((role) => ({ role, reason: failed.get(role) })),
  };
}

function terminal(input, detail) {
  const failedDurabilityChecks = Array.isArray(detail.failedDurabilityChecks)
    ? detail.failedDurabilityChecks.map((value) => clean(value, 80)).filter(Boolean)
    : [];
  const passedBrowserRoles = Array.isArray(detail.passedBrowserRoles)
    ? detail.passedBrowserRoles.map((value) => clean(value, 40).toLowerCase()).filter(Boolean)
    : [];
  const failedBrowserRoles = Array.isArray(detail.failedBrowserRoles)
    ? detail.failedBrowserRoles.map((entry) => ({
      role: clean(entry?.role, 40).toLowerCase(),
      reason: clean(entry?.reason, 240),
    })).filter((entry) => entry.role && entry.reason)
    : [];
  const expectedBrowserRoles = detail.browserRoleEvidenceRequired === true
    ? [...EXPECTED_BROWSER_ROLES]
    : [];

  const core = {
    schemaVersion: 3,
    provider: 'railway',
    scope: 'proof-infrastructure-diagnosis-only',
    deploymentId: clean(input.deploymentId, 160) || null,
    deploymentStatus: clean(input.deploymentStatus, 40).toUpperCase() || null,
    phase: detail.phase,
    classification: detail.classification,
    confidence: detail.confidence,
    evidenceFingerprint: detail.evidenceFingerprint,
    productRuntimeExecuted: detail.productRuntimeExecuted,
    productFailureProven: false,
    productStateDurabilityProven: detail.productStateDurabilityProven ?? null,
    durableStateEvidenceRequired: detail.durableStateEvidenceRequired === true,
    failedDurabilityChecks,
    browserRoleEvidenceRequired: detail.browserRoleEvidenceRequired === true,
    browserRoleMatrixProven: detail.browserRoleMatrixProven ?? null,
    expectedBrowserRoles,
    passedBrowserRoles,
    failedBrowserRoles,
    securityContainmentHoldDetected: detail.securityContainmentHoldDetected === true,
    builderContractProven: detail.builderContractProven ?? null,
    configuredBuilder: clean(detail.configuredBuilder, 40).toUpperCase() || null,
    observedBuilder: clean(detail.observedBuilder, 40).toUpperCase() || null,
    configuredDockerfilePath: clean(detail.configuredDockerfilePath, 240) || null,
    configuredRootDirectory: clean(detail.configuredRootDirectory, 240) || null,
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    automaticProductionMutationAllowed: false,
    safetyGateBypassAllowed: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    productionMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
    recommendedAction: detail.recommendedAction,
  };
  return { ...core, diagnosisReceiptDigest: digest(core) };
}

function classifyRailwayProofFailure(input = {}) {
  const status = clean(input.deploymentStatus, 40).toUpperCase();
  if (!['FAILED', 'CRASHED'].includes(status)) {
    throw new Error('Railway proof failure classifier accepts FAILED or CRASHED proof deployments only.');
  }

  const buildLogs = normaliseLogs(input.buildLogs);
  const deployLogs = normaliseLogs(input.deployLogs);
  const serviceConfig = normaliseServiceConfig(input.serviceConfig);
  const evidenceFingerprint = digest({ status, buildLogs, deployLogs, serviceConfig });
  const failedDurabilityChecks = restartDurabilityFailures(deployLogs);
  const browserMatrix = browserRoleMatrixEvidence(deployLogs);
  const securityHold = securityHoldBuildEvidence(input.serviceConfig, buildLogs, deployLogs);

  if (securityHold.active) {
    return terminal(input, {
      phase: 'build-pre-runtime-security-hold',
      classification: 'security-containment-hold-active',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: false,
      securityContainmentHoldDetected: true,
      builderContractProven: false,
      configuredBuilder: securityHold.config.builder,
      observedBuilder: securityHold.observedBuilder,
      configuredDockerfilePath: securityHold.config.dockerfilePath,
      configuredRootDirectory: securityHold.config.rootDirectory,
      recommendedAction: 'preserve-security-hold-and-require-explicit-human-authorised-hold-removal-before-any-new-proof-deployment',
    });
  }

  if (
    failedDurabilityChecks.length > 0
    && contains(deployLogs, /HEALTH_PASS\b/i)
    && contains(deployLogs, /POST_RESTART_AUTH_PASS\b/i)
    && contains(deployLogs, /POST_RESTART_TENANT_IDENTITY_PASS\b/i)
    && contains(deployLogs, /POST_RESTART_PERSISTENCE_FATAL\b/i)
  ) {
    return terminal(input, {
      phase: 'post-restart-state-verification',
      classification: 'consequential-state-durability-proof-blocker',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: true,
      productStateDurabilityProven: false,
      durableStateEvidenceRequired: true,
      failedDurabilityChecks,
      recommendedAction: 'block-autonomy-promotion-and-release-claims-until-consequential-state-survives-a-clean-restart',
    });
  }

  if (
    browserMatrix.completeAccounting
    && browserMatrix.passedBrowserRoles.length > 0
    && browserMatrix.failedBrowserRoles.length > 0
    && contains(deployLogs, /AssertionError.*browser matrix failures:/i)
  ) {
    return terminal(input, {
      phase: 'proof-harness-role-matrix',
      classification: 'partial-role-browser-proof-blocker',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: true,
      browserRoleEvidenceRequired: true,
      browserRoleMatrixProven: false,
      passedBrowserRoles: browserMatrix.passedBrowserRoles,
      failedBrowserRoles: browserMatrix.failedBrowserRoles,
      recommendedAction: 'preserve-passing-role-evidence-and-require-isolated-fix-plus-full-five-role-rerun-before-any-autonomy-or-release-claim',
    });
  }

  if (
    contains(buildLogs, /__security_hold_[a-f0-9]+__/i)
    && contains(buildLogs, /no such file or directory/i)
    && contains(buildLogs, /snapshot-target-unpack/i)
  ) {
    return terminal(input, {
      phase: 'provider-build-snapshot',
      classification: 'provider-snapshot-integrity-blocker',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: false,
      recommendedAction: 'halt-automatic-redeploy-and-rebuild-proof-snapshot-from-clean-source-state',
    });
  }

  if (
    contains(deployLogs, /manager login failed/i)
    && contains(deployLogs, /401\s*!==\s*200|actual:\s*401|\b401\b/i)
  ) {
    return terminal(input, {
      phase: 'proof-harness-authentication',
      classification: 'proof-auth-contract-mismatch',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: true,
      recommendedAction: 'inspect-read-only-role-login-contract-before-any-redeploy',
    });
  }

  if (
    contains(deployLogs, /invalid hosted request host/i)
    && contains(deployLogs, /\b403\b|forbidden/i)
  ) {
    return terminal(input, {
      phase: 'proof-harness-host-validation',
      classification: 'proof-host-allowlist-mismatch',
      confidence: 'high',
      evidenceFingerprint,
      productRuntimeExecuted: true,
      recommendedAction: 'inspect-host-binding-and-private-proxy-contract-before-any-redeploy',
    });
  }

  if (buildLogs.length > 0 && deployLogs.length === 0) {
    return terminal(input, {
      phase: 'build-pre-runtime',
      classification: 'unclassified-pre-runtime-proof-blocker',
      confidence: 'medium',
      evidenceFingerprint,
      productRuntimeExecuted: false,
      recommendedAction: 'preserve-evidence-and-require-diagnosis-before-any-redeploy',
    });
  }

  return terminal(input, {
    phase: deployLogs.length > 0 ? 'runtime-or-proof-harness' : 'unknown',
    classification: 'unclassified-proof-failure',
    confidence: 'low',
    evidenceFingerprint,
    productRuntimeExecuted: deployLogs.length > 0,
    recommendedAction: 'preserve-evidence-and-require-diagnosis-before-any-redeploy',
  });
}

function verifyDiagnosisReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(receipt.diagnosisReceiptDigest || '')) return false;
  if (
    receipt.provider !== 'railway'
    || receipt.scope !== 'proof-infrastructure-diagnosis-only'
    || receipt.productFailureProven !== false
    || receipt.productStateDurabilityProven === true
    || receipt.browserRoleMatrixProven === true
    || receipt.releaseClaimAllowed !== false
    || receipt.autonomyPromotionAllowed !== false
    || receipt.automaticRedeployAllowed !== false
    || receipt.automaticProductionMutationAllowed !== false
    || receipt.safetyGateBypassAllowed !== false
    || receipt.customerMutation !== false
    || receipt.payrollMutation !== false
    || receipt.identityMutation !== false
    || receipt.productionMutation !== false
    || receipt.modelAuthorityGranted !== false
    || receipt.executionAuthorityGranted !== false
    || !Array.isArray(receipt.failedDurabilityChecks)
    || !Array.isArray(receipt.expectedBrowserRoles)
    || !Array.isArray(receipt.passedBrowserRoles)
    || !Array.isArray(receipt.failedBrowserRoles)
  ) return false;

  const allowedDurabilityChecks = new Set(['approved-leave', 'rejected-correction', 'revoked-kiosk']);
  if (receipt.failedDurabilityChecks.some((value) => !allowedDurabilityChecks.has(value))) return false;

  const allowedBrowserRoles = new Set(EXPECTED_BROWSER_ROLES);
  if (receipt.expectedBrowserRoles.some((value) => !allowedBrowserRoles.has(value))) return false;
  if (receipt.passedBrowserRoles.some((value) => !allowedBrowserRoles.has(value))) return false;
  if (receipt.failedBrowserRoles.some((entry) => !entry || !allowedBrowserRoles.has(entry.role) || !clean(entry.reason, 240))) return false;
  if (new Set(receipt.expectedBrowserRoles).size !== receipt.expectedBrowserRoles.length) return false;
  if (new Set(receipt.passedBrowserRoles).size !== receipt.passedBrowserRoles.length) return false;
  if (new Set(receipt.failedBrowserRoles.map((entry) => entry.role)).size !== receipt.failedBrowserRoles.length) return false;

  if (receipt.classification === 'security-containment-hold-active') {
    if (
      receipt.phase !== 'build-pre-runtime-security-hold'
      || receipt.productRuntimeExecuted !== false
      || receipt.securityContainmentHoldDetected !== true
      || receipt.builderContractProven !== false
      || receipt.configuredBuilder !== 'DOCKERFILE'
      || receipt.observedBuilder !== 'RAILPACK'
      || !/__security_manual_redeploy_hold__/i.test(receipt.configuredDockerfilePath || '')
      || !/__security_hold_/i.test(receipt.configuredRootDirectory || '')
    ) return false;
  } else if (
    receipt.securityContainmentHoldDetected !== false
    || receipt.builderContractProven !== null
    || receipt.configuredBuilder !== null
    || receipt.observedBuilder !== null
    || receipt.configuredDockerfilePath !== null
    || receipt.configuredRootDirectory !== null
  ) {
    return false;
  }

  if (receipt.classification === 'consequential-state-durability-proof-blocker') {
    if (
      receipt.phase !== 'post-restart-state-verification'
      || receipt.productRuntimeExecuted !== true
      || receipt.productStateDurabilityProven !== false
      || receipt.durableStateEvidenceRequired !== true
      || receipt.failedDurabilityChecks.length === 0
    ) return false;
  } else if (
    receipt.productStateDurabilityProven !== null
    || receipt.durableStateEvidenceRequired !== false
    || receipt.failedDurabilityChecks.length !== 0
  ) {
    return false;
  }

  if (receipt.classification === 'partial-role-browser-proof-blocker') {
    const failedRoles = receipt.failedBrowserRoles.map((entry) => entry.role);
    const overlap = receipt.passedBrowserRoles.some((role) => failedRoles.includes(role));
    const accounted = new Set([...receipt.passedBrowserRoles, ...failedRoles]);
    if (
      receipt.phase !== 'proof-harness-role-matrix'
      || receipt.productRuntimeExecuted !== true
      || receipt.browserRoleMatrixProven !== false
      || receipt.browserRoleEvidenceRequired !== true
      || receipt.expectedBrowserRoles.length !== EXPECTED_BROWSER_ROLES.length
      || !EXPECTED_BROWSER_ROLES.every((role, index) => receipt.expectedBrowserRoles[index] === role)
      || receipt.passedBrowserRoles.length === 0
      || receipt.failedBrowserRoles.length === 0
      || overlap
      || accounted.size !== EXPECTED_BROWSER_ROLES.length
      || !EXPECTED_BROWSER_ROLES.every((role) => accounted.has(role))
    ) return false;
  } else if (
    receipt.browserRoleMatrixProven !== null
    || receipt.browserRoleEvidenceRequired !== false
    || receipt.expectedBrowserRoles.length !== 0
    || receipt.passedBrowserRoles.length !== 0
    || receipt.failedBrowserRoles.length !== 0
  ) {
    return false;
  }

  const core = { ...receipt };
  const expected = core.diagnosisReceiptDigest;
  delete core.diagnosisReceiptDigest;
  return expected === digest(core);
}

module.exports = {
  EXPECTED_BROWSER_ROLES,
  browserRoleMatrixEvidence,
  classifyRailwayProofFailure,
  verifyDiagnosisReceipt,
  digest,
};
