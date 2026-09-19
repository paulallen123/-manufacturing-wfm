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

function normaliseLogs(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 500).map((entry) => clean(typeof entry === 'string' ? entry : entry?.message));
}

function contains(logs, pattern) {
  return logs.some((line) => pattern.test(line));
}

function restartDurabilityFailures(deployLogs) {
  const failures = [];
  if (contains(deployLogs, /POST_RESTART_LEAVE_PERSISTENCE_FAIL/i)) failures.push('approved-leave');
  if (contains(deployLogs, /POST_RESTART_CORRECTION_PERSISTENCE_FAIL/i)) failures.push('rejected-correction');
  if (contains(deployLogs, /POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_FAIL/i)) failures.push('revoked-kiosk');
  return failures;
}

function terminal(input, detail) {
  const failedDurabilityChecks = Array.isArray(detail.failedDurabilityChecks)
    ? detail.failedDurabilityChecks.map((value) => clean(value, 80)).filter(Boolean)
    : [];
  const core = {
    schemaVersion: 1,
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
    releaseClaimAllowed: false,
    autonomyPromotionAllowed: false,
    automaticRedeployAllowed: false,
    automaticProductionMutationAllowed: false,
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
  const evidenceFingerprint = digest({ status, buildLogs, deployLogs });
  const failedDurabilityChecks = restartDurabilityFailures(deployLogs);

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
    || receipt.releaseClaimAllowed !== false
    || receipt.autonomyPromotionAllowed !== false
    || receipt.automaticRedeployAllowed !== false
    || receipt.automaticProductionMutationAllowed !== false
    || receipt.customerMutation !== false
    || receipt.payrollMutation !== false
    || receipt.identityMutation !== false
    || receipt.productionMutation !== false
    || receipt.modelAuthorityGranted !== false
    || receipt.executionAuthorityGranted !== false
    || !Array.isArray(receipt.failedDurabilityChecks)
  ) return false;

  const allowedDurabilityChecks = new Set(['approved-leave', 'rejected-correction', 'revoked-kiosk']);
  if (receipt.failedDurabilityChecks.some((value) => !allowedDurabilityChecks.has(value))) return false;

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

  const core = { ...receipt };
  const expected = core.diagnosisReceiptDigest;
  delete core.diagnosisReceiptDigest;
  return expected === digest(core);
}

module.exports = { classifyRailwayProofFailure, verifyDiagnosisReceipt, digest };
