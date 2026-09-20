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

function validId(value, max = 180) {
  const id = clean(value, max);
  return id && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function validGitCommit(value) {
  const candidate = clean(value, 64).toLowerCase();
  return /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
}

function validGitBlob(value) {
  const candidate = clean(value, 64).toLowerCase();
  return /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
}

function validImageDigest(value) {
  const candidate = clean(value, 96).toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(candidate) ? candidate : null;
}

function boundedInt(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function assessHostedStagingProof(input = {}) {
  const deploymentId = validId(input.deploymentId);
  const deploymentSnapshotId = validId(input.deploymentSnapshotId);
  const sourceCommitSha = validGitCommit(input.sourceCommitSha);
  const imageDigest = validImageDigest(input.imageDigest);
  const engineGitBlobSha = validGitBlob(input.engineGitBlobSha);
  const engineExpectedGitBlobSha = validGitBlob(input.engineExpectedGitBlobSha);
  const deploymentStatus = clean(input.deploymentStatus, 32).toUpperCase();

  const testsTotal = boundedInt(input.testsTotal, 1, 100000);
  const testsPassed = boundedInt(input.testsPassed, 0, 100000);
  const testsFailed = boundedInt(input.testsFailed, 0, 100000);
  const testsSkipped = boundedInt(input.testsSkipped, 0, 100000);

  const employees = boundedInt(input.scale?.employees, 1, 10000000);
  const sites = boundedInt(input.scale?.sites, 1, 100000);
  const punches = boundedInt(input.scale?.punches, 1, 1000000000);
  const timecards = boundedInt(input.scale?.timecards, 1, 1000000000);

  const identityBound = Boolean(
    deploymentId
    && deploymentSnapshotId
    && sourceCommitSha
    && imageDigest
    && engineGitBlobSha
    && engineExpectedGitBlobSha
    && engineGitBlobSha === engineExpectedGitBlobSha
  );
  const testsProven = Boolean(
    testsTotal
    && testsPassed === testsTotal
    && testsFailed === 0
    && testsSkipped === 0
  );
  const cloudScaleProofProven = Boolean(
    input.cloudScaleProofStatus === 'PASS'
    && input.engineIdentityExact === true
    && employees
    && sites
    && punches
    && timecards
    && input.massAssignmentCoverage === 1
    && input.cleanPayrollUnexplainedVariance === 0
    && input.cleanPayrollVarianceCount === 0
    && input.deliberateCorruptionDetected === true
    && input.hostileStructureBlockedAutoApply === true
    && input.payrollRulesRemainProtected === true
  );
  const hostedRuntimeProven = Boolean(
    deploymentStatus === 'SUCCESS'
    && input.containerStarted === true
    && input.httpsPublicOriginObserved === true
    && input.healthcheckSucceeded === true
  );
  const safetyBoundaryProven = Boolean(
    input.fixtureDemoOnly === true
    && input.productionApproved === false
    && input.productionMutation === false
    && input.customerMutation === false
  );
  const stagingExecutionEvidenceProven = Boolean(
    identityBound
    && testsProven
    && cloudScaleProofProven
    && hostedRuntimeProven
    && safetyBoundaryProven
  );

  const core = {
    schemaVersion: 1,
    proof: 'railway-hosted-staging-proof-receipt',
    provider: 'railway',
    deploymentId,
    deploymentSnapshotId,
    sourceCommitSha,
    imageDigest,
    engineGitBlobSha,
    engineExpectedGitBlobSha,
    deploymentStatus,
    tests: {
      total: testsTotal,
      passed: testsPassed,
      failed: testsFailed,
      skipped: testsSkipped,
      proven: testsProven,
    },
    scale: { employees, sites, punches, timecards },
    identityBound,
    cloudScaleProofProven,
    hostedRuntimeProven,
    safetyBoundaryProven,
    stagingExecutionEvidenceProven,
    claimBoundary: stagingExecutionEvidenceProven
      ? 'exact-hosted-staging-fixture-execution-and-scale-behaviour-only'
      : 'insufficient-or-inconsistent-hosted-staging-evidence',
    syntheticTimingModelIsExecutionProof: false,
    livePayrollProviderConnectionProven: false,
    liveHcmProviderConnectionProven: false,
    liveErpProviderConnectionProven: false,
    customerProductionImplementationProven: false,
    releaseProven: false,
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

function verifyHostedStagingProofReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ''))) return false;
  if (
    receipt.schemaVersion !== 1
    || receipt.proof !== 'railway-hosted-staging-proof-receipt'
    || receipt.provider !== 'railway'
    || receipt.syntheticTimingModelIsExecutionProof !== false
    || receipt.livePayrollProviderConnectionProven !== false
    || receipt.liveHcmProviderConnectionProven !== false
    || receipt.liveErpProviderConnectionProven !== false
    || receipt.customerProductionImplementationProven !== false
    || receipt.releaseProven !== false
    || receipt.releaseClaimAllowed !== false
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

  if (receipt.stagingExecutionEvidenceProven === true) {
    if (
      receipt.identityBound !== true
      || receipt.tests?.proven !== true
      || receipt.cloudScaleProofProven !== true
      || receipt.hostedRuntimeProven !== true
      || receipt.safetyBoundaryProven !== true
      || receipt.deploymentStatus !== 'SUCCESS'
      || receipt.engineGitBlobSha !== receipt.engineExpectedGitBlobSha
      || receipt.claimBoundary !== 'exact-hosted-staging-fixture-execution-and-scale-behaviour-only'
    ) return false;
  } else if (receipt.claimBoundary !== 'insufficient-or-inconsistent-hosted-staging-evidence') {
    return false;
  }

  const core = { ...receipt };
  const expected = core.receiptDigest;
  delete core.receiptDigest;
  return expected === digest(core);
}

module.exports = {
  assessHostedStagingProof,
  verifyHostedStagingProofReceipt,
  digest,
};
