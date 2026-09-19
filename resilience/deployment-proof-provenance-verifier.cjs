'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireHex64(value, code, message) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ''))) deny(code, message);
}

function requireGitSha(value, code, message) {
  if (!/^[a-f0-9]{40}$/i.test(String(value || ''))) deny(code, message);
}

function requireUuid(value, code, message) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''))) deny(code, message);
}

function requireReadOnlyObserver(observer, code = 'WFM_DEPLOY_PROOF_OBSERVER') {
  if (!observer || typeof observer !== 'object') deny(code, 'read-only deployment evidence observer required');
  if (!observer.principalId || !/^[a-z0-9][a-z0-9:_-]{2,127}$/i.test(observer.principalId)) deny(code, 'invalid observer principal');
  if (observer.source !== 'read-only-provider-api') deny(code, 'deployment evidence must come from the read-only provider API boundary');
  if (observer.readOnly !== true) deny(code, 'deployment evidence observer must be read-only');
  for (const key of ['writeAuthority', 'deployAuthority', 'productionAuthority', 'customerMutationAuthority', 'modelAuthority']) {
    if (observer[key] !== false) deny(code, `deployment evidence observer must explicitly deny ${key}`);
  }
}

function verifyDeploymentProofEvidence({ evidence, expected } = {}) {
  if (!evidence || typeof evidence !== 'object' || !expected || typeof expected !== 'object') {
    deny('WFM_DEPLOY_PROOF_INPUT', 'evidence and expected provenance are required');
  }
  if (evidence.schemaVersion !== 1 || evidence.proof !== 'external-deployment-proof-observation') {
    deny('WFM_DEPLOY_PROOF_SCHEMA', 'unsupported deployment proof evidence schema');
  }
  if (!expected.provider || evidence.provider !== expected.provider) deny('WFM_DEPLOY_PROOF_PROVIDER', 'deployment provider mismatch');
  requireReadOnlyObserver(evidence.observedBy);

  const deployment = evidence.deployment;
  if (!deployment || typeof deployment !== 'object') deny('WFM_DEPLOY_PROOF_INPUT', 'deployment observation required');
  requireUuid(deployment.deploymentId, 'WFM_DEPLOY_PROOF_ID', 'valid deployment id required');
  if (deployment.status !== 'SUCCESS') deny('WFM_DEPLOY_PROOF_STATUS', 'only successful provider deployment observations can be accepted');

  const exactBindings = [
    ['repository', expected.repository],
    ['branch', expected.branch],
    ['commitSha', expected.commitSha],
    ['serviceName', expected.serviceName],
    ['environmentName', expected.environmentName],
    ['builder', expected.builder],
    ['dockerfilePath', expected.dockerfilePath],
    ['healthcheckPath', expected.healthcheckPath],
    ['candidate', expected.candidate],
    ['runtimeSha256', expected.runtimeSha256],
  ];
  for (const [key, expectedValue] of exactBindings) {
    if (!expectedValue || deployment[key] !== expectedValue) deny('WFM_DEPLOY_PROOF_BINDING', `deployment ${key} does not match expected provenance`);
  }
  requireGitSha(deployment.commitSha, 'WFM_DEPLOY_PROOF_COMMIT', 'exact deployment commit SHA required');
  requireHex64(deployment.runtimeSha256, 'WFM_DEPLOY_PROOF_RUNTIME', 'exact runtime SHA-256 required');

  if (deployment.builder !== 'DOCKERFILE') deny('WFM_DEPLOY_PROOF_BUILDER', 'deployment must use the expected Dockerfile builder');
  if (deployment.dockerfilePath !== 'Dockerfile') deny('WFM_DEPLOY_PROOF_BUILDER', 'deployment must use the sealed Dockerfile path');
  if (deployment.healthcheckSucceeded !== true) deny('WFM_DEPLOY_PROOF_HEALTH', 'provider healthcheck must have succeeded');
  if (deployment.productionApproved !== false) deny('WFM_DEPLOY_PROOF_CLAIM', 'staging proof must not claim production approval');
  if (deployment.stagingOnly !== true) deny('WFM_DEPLOY_PROOF_CLAIM', 'deployment proof must remain staging-only');
  if (deployment.fixtureOnly !== true) deny('WFM_DEPLOY_PROOF_CLAIM', 'deployment proof must remain fixture-only until real-provider evidence is separately accepted');

  const evidenceCore = { ...evidence };
  delete evidenceCore.evidenceDigest;
  requireHex64(evidence.evidenceDigest, 'WFM_DEPLOY_PROOF_DIGEST', 'deployment evidence digest required');
  if (sha256(evidenceCore) !== evidence.evidenceDigest) deny('WFM_DEPLOY_PROOF_DIGEST', 'deployment evidence digest mismatch');

  let functionalEvidenceBound = false;
  if (evidence.functionalEvidence != null) {
    const functional = evidence.functionalEvidence;
    if (!functional || typeof functional !== 'object' || functional.status !== 'PASS') deny('WFM_DEPLOY_PROOF_FUNCTIONAL', 'functional evidence must explicitly pass');
    if (!functional.observerId || functional.observerId === evidence.observedBy.principalId) deny('WFM_DEPLOY_PROOF_FUNCTIONAL', 'functional verifier must be independent from deployment observer');
    if (functional.readOnly !== true) deny('WFM_DEPLOY_PROOF_FUNCTIONAL', 'functional verifier must be read-only');
    for (const key of ['writeAuthority', 'deployAuthority', 'productionAuthority', 'customerMutationAuthority', 'modelAuthority']) {
      if (functional[key] !== false) deny('WFM_DEPLOY_PROOF_FUNCTIONAL', `functional verifier must explicitly deny ${key}`);
    }
    requireHex64(functional.proofDigest, 'WFM_DEPLOY_PROOF_FUNCTIONAL', 'functional proof digest required');
    if (functional.deploymentId !== deployment.deploymentId
      || functional.commitSha !== deployment.commitSha
      || functional.runtimeSha256 !== deployment.runtimeSha256
      || functional.candidate !== deployment.candidate) {
      deny('WFM_DEPLOY_PROOF_FUNCTIONAL', 'functional evidence is not bound to the exact observed deployment');
    }
    functionalEvidenceBound = true;
  }

  const core = {
    schemaVersion: 1,
    proof: 'deployment-proof-provenance-verification',
    status: 'PASS',
    provider: evidence.provider,
    deploymentId: deployment.deploymentId,
    serviceName: deployment.serviceName,
    environmentName: deployment.environmentName,
    repository: deployment.repository,
    branch: deployment.branch,
    commitSha: deployment.commitSha,
    candidate: deployment.candidate,
    runtimeSha256: deployment.runtimeSha256,
    builder: deployment.builder,
    dockerfilePath: deployment.dockerfilePath,
    healthcheckSucceeded: true,
    sourceProvenanceBound: true,
    deploymentHealthy: true,
    functionalEvidenceBound,
    claimScope: functionalEvidenceBound ? 'FUNCTIONAL_EVIDENCE_BOUND_NOT_RELEASE_AUTHORITY' : 'DEPLOYMENT_HEALTH_ONLY',
    releaseAuthorityGranted: false,
    productionAuthorityGranted: false,
    customerMutationAuthorityGranted: false,
    modelAuthorityGranted: false,
    productionMutation: false,
    customerMutation: false,
  };
  return { ...core, receiptDigest: sha256(core) };
}

function sealDeploymentEvidence(evidence) {
  const core = structuredClone(evidence);
  delete core.evidenceDigest;
  return { ...core, evidenceDigest: sha256(core) };
}

module.exports = { verifyDeploymentProofEvidence, sealDeploymentEvidence, sha256 };
