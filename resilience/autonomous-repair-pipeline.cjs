'use strict';

const { createHash } = require('node:crypto');

const sha = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');
const dig = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value) => {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(normalized)
    ? normalized
    : null;
};
const deny = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const PROTECTED = Object.freeze([
  'resilience/autonomous-repair-pipeline.cjs',
  'scripts/validate-autonomous-repair-pipeline.mjs',
  '.github/workflows/wfm-autonomous-repair-pipeline.yml',
  'resilience/autonomous-repair-factory.cjs',
  'resilience/isolated-repair-worker.cjs',
  'resilience/independent-repair-verifier.cjs',
  'resilience/disposable-staging-gate.cjs',
  'resilience/canary-rollback-controller.cjs',
  'scripts/validate-canary-rollback-controller.mjs',
  'resilience/autonomous-repair-canary-orchestrator.cjs',
  'scripts/validate-autonomous-repair-canary-orchestrator.mjs',
  'resilience/autonomy-control-loop.cjs',
  'scripts/validate-autonomy-control-loop.mjs',
  'resilience/support-tier-contract.json',
  'resilience/security-baseline.json',
]);

const REPAIR_CHAIN_FIELDS = Object.freeze([
  'tenantDigest',
  'actorSetDigest',
  'evidenceDigest',
  'failingTestDigest',
  'observedFailureDigest',
  'sourceSnapshotDigest',
  'repairIntentDigest',
  'patchDigest',
  'candidateDigest',
  'artifactDigest',
  'provenanceDigest',
  'rollbackDigest',
  'verificationDigest',
  'permitDigest',
  'signatureDigest',
  'stagingReceiptDigest',
]);

const POST_STAGING_REQUIRED_DIGEST_FIELDS = Object.freeze([
  'tenantDigest',
  'postStagingActorSetDigest',
  'repairChainDigest',
  'repairOutcomeReceiptDigest',
  'artifactDigest',
  'rollbackDigest',
  'stagingReceiptDigest',
  'canaryOutcomeReceiptDigest',
  'canaryEvidenceDigest',
]);

function computeRepairEvidenceChainDigest(source = {}) {
  if (!REPAIR_CHAIN_FIELDS.every((key) => dig(source[key]))) return null;
  return sha(REPAIR_CHAIN_FIELDS.map((key) => [key, source[key]]));
}

function computePostStagingDecisionDigest(source = {}) {
  const status = String(source.status || '');
  if (!['canary_proven', 'rolled_back_to_known_good'].includes(status)) return null;
  if (!POST_STAGING_REQUIRED_DIGEST_FIELDS.every((key) => dig(source[key]))) return null;
  const rollbackEvidenceDigest = source.rollbackEvidenceDigest == null ? null : source.rollbackEvidenceDigest;
  if (status === 'rolled_back_to_known_good' && !dig(rollbackEvidenceDigest)) return null;
  if (status === 'canary_proven' && rollbackEvidenceDigest !== null && !dig(rollbackEvidenceDigest)) return null;
  return sha([
    ['status', status],
    ...POST_STAGING_REQUIRED_DIGEST_FIELDS.map((key) => [key, source[key]]),
    ['rollbackEvidenceDigest', rollbackEvidenceDigest],
  ]);
}

const protectedPath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/');
  return PROTECTED.some((path) => normalized === path || normalized.startsWith(path + '/'));
};

function capabilities(obj, method, required, code) {
  if (!obj || typeof obj.capabilities !== 'function' || typeof obj[method] !== 'function') {
    deny(code, 'trusted component unavailable');
  }
  const actual = obj.capabilities();
  for (const [key, expected] of Object.entries(required)) {
    if (actual?.[key] !== expected) deny(code, `unsafe capability: ${key}`);
  }
  return Object.freeze({ ...actual });
}

function createAutonomousRepairPipeline({ factory, worker, verifier, stagingGate, signer, outcomeRecorder } = {}) {
  if (!factory || ['snapshot', 'openIncident', 'registerReproducer', 'issueStagingPermit'].some((method) => typeof factory[method] !== 'function')) {
    deny('WFM_PIPELINE_INPUT', 'repair factory required');
  }
  if (!worker || typeof worker.run !== 'function' || !verifier || typeof verifier.run !== 'function' || !stagingGate || typeof stagingGate.run !== 'function') {
    deny('WFM_PIPELINE_INPUT', 'repair stages required');
  }

  const signerCaps = capabilities(signer, 'sign', {
    networkMode: 'none',
    reusableCredentialsVisible: false,
    customerDataVisible: false,
    sourceWriteAllowed: false,
    productionAuthority: false,
    customerWriteAuthority: false,
    isolatedStagingAuthorityOnly: true,
    incrementalCostZero: true,
  }, 'WFM_PIPELINE_SIGNER');
  const recorderCaps = capabilities(outcomeRecorder, 'record', {
    appendOnly: true,
    durable: true,
    tamperEvident: true,
    customerDataStored: false,
    productionAuthority: false,
    customerWriteAuthority: false,
    incrementalCostZero: true,
  }, 'WFM_PIPELINE_RECORDER');

  async function record(payload) {
    const result = await outcomeRecorder.record(payload);
    if (!result || !dig(result.receiptDigest)) deny('WFM_PIPELINE_RECORDER_RESULT', 'terminal receipt required');
    return result.receiptDigest;
  }

  async function process(input = {}) {
    const incidentId = id(input.incidentId);
    const tenant = String(input.tenant || '').trim();
    const workerId = id(input.workerId);
    const verifierId = id(input.verifierId);
    const releaseAuthorityId = id(input.releaseAuthorityId);
    const stagingControllerId = id(input.stagingControllerId);
    if (!incidentId || !tenant || !workerId || !verifierId || !releaseAuthorityId || !stagingControllerId) {
      deny('WFM_PIPELINE_INPUT', 'bounded identities required');
    }
    if (new Set([workerId, verifierId, releaseAuthorityId, stagingControllerId]).size !== 4) {
      deny('WFM_PIPELINE_SEPARATION', 'repair actors must be distinct');
    }

    for (const key of ['evidenceDigest', 'failingTestDigest', 'observedFailureDigest', 'sourceSnapshotDigest', 'repairIntentDigest', 'rollbackSourceDigest']) {
      if (!dig(input[key])) deny('WFM_PIPELINE_INPUT', `${key} must be SHA-256`);
    }
    if (!Array.isArray(input.allowedChangedPaths) || !input.allowedChangedPaths.length) {
      deny('WFM_PIPELINE_INPUT', 'bounded changed paths required');
    }
    if (input.allowedChangedPaths.some(protectedPath)) {
      deny('WFM_PIPELINE_PROTECTED_PATH', 'authority/proof paths are immutable to repair');
    }

    let recordSnapshot = factory.snapshot(incidentId);
    if (!recordSnapshot) {
      factory.openIncident({ incidentId, tenant, evidenceDigest: input.evidenceDigest });
      recordSnapshot = factory.snapshot(incidentId);
    }
    if (!recordSnapshot || recordSnapshot.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (recordSnapshot.evidenceDigest !== input.evidenceDigest) deny('WFM_PIPELINE_EVIDENCE_DRIFT', 'evidence changed');

    if (recordSnapshot.state === 'diagnosing') {
      factory.registerReproducer({
        incidentId,
        tenant,
        failingTestDigest: input.failingTestDigest,
        observedFailureDigest: input.observedFailureDigest,
      });
      recordSnapshot = factory.snapshot(incidentId);
    }
    if (!['reproduced', 'candidate-rejected'].includes(recordSnapshot.state)) {
      deny('WFM_PIPELINE_STATE', 'incident not repairable');
    }

    const proposal = await worker.run({
      incidentId,
      tenant,
      workerId,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      repairIntentDigest: input.repairIntentDigest,
      allowedChangedPaths: [...input.allowedChangedPaths],
    });
    if (!proposal || proposal.status !== 'candidate-proposed') {
      return {
        status: 'contained',
        phase: 'repair-worker',
        reason: proposal?.reason || 'no-safe-candidate',
        productionAuthorityGranted: false,
        productionMutation: false,
        customerMutation: false,
      };
    }
    if (!dig(proposal.candidateDigest) || !dig(proposal.patchDigest)) {
      deny('WFM_PIPELINE_WORKER_RESULT', 'invalid candidate evidence');
    }

    const verification = await verifier.run({
      incidentId,
      tenant,
      verifierId,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      expectedCandidateDigest: proposal.candidateDigest,
      rollbackSourceDigest: input.rollbackSourceDigest,
    });
    if (!verification || verification.status !== 'verified') {
      return {
        status: 'contained',
        phase: 'independent-verifier',
        reason: verification?.reason || verification?.status || 'not-verified',
        productionAuthorityGranted: false,
        productionMutation: false,
        customerMutation: false,
      };
    }
    for (const value of [verification.artifactDigest, verification.provenanceDigest, verification.rollbackDigest, verification.verificationDigest]) {
      if (!dig(value)) deny('WFM_PIPELINE_VERIFIER_RESULT', 'invalid verification evidence');
    }
    if (verification.candidateDigest !== proposal.candidateDigest) deny('WFM_PIPELINE_CANDIDATE_DRIFT', 'candidate drift');
    if (verification.productionAuthority === true || verification.stagingPermitAuthority === true) {
      deny('WFM_PIPELINE_VERIFIER_AUTHORITY', 'verifier authority violation');
    }

    const permit = factory.issueStagingPermit({
      incidentId,
      tenant,
      authorityId: releaseAuthorityId,
      artifactDigest: verification.artifactDigest,
    });
    if (!permit || permit.scope !== 'isolated-staging-only' || !dig(permit.permitDigest)) {
      deny('WFM_PIPELINE_PERMIT', 'invalid staging permit');
    }

    const signRequest = {
      schemaVersion: 1,
      incidentId,
      tenantDigest: sha(tenant),
      candidateDigest: proposal.candidateDigest,
      artifactDigest: verification.artifactDigest,
      provenanceDigest: verification.provenanceDigest,
      rollbackDigest: verification.rollbackDigest,
      verificationDigest: verification.verificationDigest,
      permitDigest: permit.permitDigest,
      signerId: releaseAuthorityId,
      scope: 'isolated-staging-only',
      productionAuthority: false,
      customerMutation: false,
      signerCapabilityDigest: sha(signerCaps),
    };
    const signature = await signer.sign(structuredClone(signRequest));
    if (!signature || !dig(signature.signatureDigest)) deny('WFM_PIPELINE_SIGNATURE', 'signature required');
    if (signature.signerId !== releaseAuthorityId
      || signature.acceptedArtifactDigest !== verification.artifactDigest
      || signature.acceptedPermitDigest !== permit.permitDigest) {
      deny('WFM_PIPELINE_SIGNATURE_DRIFT', 'signature binding drift');
    }
    if (signature.productionAuthority === true || signature.customerMutation === true) {
      deny('WFM_PIPELINE_SIGNER_AUTHORITY', 'signer authority violation');
    }

    const staging = await stagingGate.run({
      incidentId,
      tenant,
      authorityId: releaseAuthorityId,
      signerId: signature.signerId,
      artifactDigest: verification.artifactDigest,
      provenanceDigest: verification.provenanceDigest,
      signatureDigest: signature.signatureDigest,
    });
    if (!staging || staging.status !== 'staged') {
      const reason = staging?.reason || 'staging-rejected';
      const outcomeReceiptDigest = await record({
        incidentId,
        tenantDigest: sha(tenant),
        actorId: stagingControllerId,
        status: 'contained',
        phase: 'disposable-staging',
        candidateDigest: proposal.candidateDigest,
        artifactDigest: verification.artifactDigest,
        rollbackDigest: verification.rollbackDigest,
        permitDigest: permit.permitDigest,
        reason,
        productionAuthority: false,
        productionMutation: false,
        customerMutation: false,
      });
      return {
        status: 'contained',
        phase: 'disposable-staging',
        reason,
        outcomeReceiptDigest,
        productionAuthorityGranted: false,
        productionMutation: false,
        customerMutation: false,
      };
    }
    if (!dig(staging.stagingReceiptDigest)
      || staging.artifactDigest !== verification.artifactDigest
      || staging.permitDigest !== permit.permitDigest) {
      deny('WFM_PIPELINE_STAGING_DRIFT', 'staging receipt drift');
    }
    if (staging.productionAuthority === true || staging.productionMutation === true || staging.customerMutation === true) {
      deny('WFM_PIPELINE_STAGING_AUTHORITY', 'staging authority violation');
    }

    const repairEvidence = {
      tenantDigest: sha(tenant),
      actorSetDigest: sha([workerId, verifierId, releaseAuthorityId, stagingControllerId]),
      evidenceDigest: input.evidenceDigest,
      failingTestDigest: input.failingTestDigest,
      observedFailureDigest: input.observedFailureDigest,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      repairIntentDigest: input.repairIntentDigest,
      patchDigest: proposal.patchDigest,
      candidateDigest: proposal.candidateDigest,
      artifactDigest: verification.artifactDigest,
      provenanceDigest: verification.provenanceDigest,
      rollbackDigest: verification.rollbackDigest,
      verificationDigest: verification.verificationDigest,
      permitDigest: permit.permitDigest,
      signatureDigest: signature.signatureDigest,
      stagingReceiptDigest: staging.stagingReceiptDigest,
    };
    const repairChainDigest = computeRepairEvidenceChainDigest(repairEvidence);
    if (!repairChainDigest) deny('WFM_PIPELINE_REPAIR_CHAIN', 'complete repair evidence chain required');

    const terminalPayload = {
      incidentId,
      tenantDigest: repairEvidence.tenantDigest,
      actorId: stagingControllerId,
      status: 'verified_candidate_staged',
      phase: 'complete',
      ...repairEvidence,
      repairChainDigest,
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
    };
    const outcomeReceiptDigest = await record(terminalPayload);

    return {
      status: 'verified_candidate_staged',
      phase: 'complete',
      ...repairEvidence,
      repairChainDigest,
      outcomeReceiptDigest,
      independentlyVerified: true,
      exactArtifactStaged: true,
      productionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    };
  }

  return {
    process,
    capabilities: () => ({
      independentVerificationRequired: true,
      exactArtifactStagingRequired: true,
      signedProvenanceRequired: true,
      repairEvidenceChainRequired: true,
      isolatedStagingOnly: true,
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      incrementalCostZero: true,
    }),
    signerCapabilities: () => ({ ...signerCaps }),
    recorderCapabilities: () => ({ ...recorderCaps }),
    protectedPaths: [...PROTECTED],
  };
}

module.exports = {
  createAutonomousRepairPipeline,
  PIPELINE_PROTECTED_PATHS: PROTECTED,
  REPAIR_CHAIN_FIELDS,
  computeRepairEvidenceChainDigest,
  computePostStagingDecisionDigest,
};
