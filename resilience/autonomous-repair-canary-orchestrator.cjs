'use strict';

const { createHash } = require('node:crypto');
const {
  computeRepairEvidenceChainDigest,
  computePostStagingDecisionDigest,
} = require('./autonomous-repair-pipeline.cjs');

const sha = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeId = (value) => {
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

function createAutonomousRepairCanaryOrchestrator({ repairPipeline, canaryController, outcomeRecorder } = {}) {
  if (!repairPipeline || typeof repairPipeline.process !== 'function' || typeof repairPipeline.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_PIPELINE', 'trusted repair pipeline unavailable');
  }
  if (!canaryController || typeof canaryController.run !== 'function' || typeof canaryController.limits !== 'function' || typeof canaryController.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_CANARY', 'trusted canary controller unavailable');
  }
  if (!outcomeRecorder || typeof outcomeRecorder.record !== 'function' || typeof outcomeRecorder.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_RECORDER', 'durable outcome recorder unavailable');
  }

  const pipelineCaps = repairPipeline.capabilities();
  for (const [key, expected] of Object.entries({
    independentVerificationRequired: true,
    exactArtifactStagingRequired: true,
    signedProvenanceRequired: true,
    repairEvidenceChainRequired: true,
    isolatedStagingOnly: true,
    productionAuthority: false,
    productionMutation: false,
    customerMutation: false,
    incrementalCostZero: true,
  })) {
    if (pipelineCaps?.[key] !== expected) deny('WFM_POSTSTAGING_PIPELINE', `unsafe repair pipeline capability: ${key}`);
  }

  const limits = canaryController.limits();
  if (!limits || limits.maxInstances !== 1 || limits.maxTrafficPercent !== 5) {
    deny('WFM_POSTSTAGING_CANARY', 'canary blast-radius contract changed');
  }
  const canaryCaps = canaryController.capabilities();
  for (const lane of ['canary', 'rollback']) {
    if (canaryCaps?.[lane]?.simulationOnly !== true
      || canaryCaps?.[lane]?.productionWriteAuthority !== false
      || canaryCaps?.[lane]?.customerWriteAuthority !== false
      || canaryCaps?.[lane]?.incrementalCostZero !== true
      || canaryCaps?.[lane]?.modelCanGrantAuthority !== false) {
      deny('WFM_POSTSTAGING_CANARY', `unsafe ${lane} capability`);
    }
  }
  if (canaryCaps?.attestor?.productionAuthority !== false
    || canaryCaps?.attestor?.customerWriteAuthority !== false
    || canaryCaps?.attestor?.modelCanGrantAuthority !== false) {
    deny('WFM_POSTSTAGING_CANARY', 'unsafe known-good attestor capability');
  }

  const recorderCaps = outcomeRecorder.capabilities();
  for (const [key, expected] of Object.entries({
    appendOnly: true,
    durable: true,
    tamperEvident: true,
    customerDataStored: false,
    productionAuthority: false,
    customerWriteAuthority: false,
    incrementalCostZero: true,
  })) {
    if (recorderCaps?.[key] !== expected) deny('WFM_POSTSTAGING_RECORDER', `unsafe outcome recorder capability: ${key}`);
  }

  async function record(payload) {
    const result = await outcomeRecorder.record(Object.freeze({ ...payload }));
    if (!result || !validDigest(result.receiptDigest)) {
      deny('WFM_POSTSTAGING_RECORDER_RESULT', 'durable composition receipt required');
    }
    return result.receiptDigest;
  }

  async function contained(base, reason, extra = {}) {
    const payload = {
      schemaVersion: 2,
      incidentId: base.incidentId,
      tenantDigest: base.tenantDigest,
      status: 'contained',
      phase: 'post-staging-decision',
      reason,
      productionAuthorityGranted: false,
      promotionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
      ...extra,
    };
    const compositionReceiptDigest = await record(payload);
    return { ...payload, compositionReceiptDigest };
  }

  async function run(input = {}) {
    const incidentId = safeId(input.incidentId);
    const tenant = String(input.tenant || '').trim();
    const targetTenant = String(input.targetTenant || tenant).trim();
    const actorIds = {
      workerId: safeId(input.workerId),
      verifierId: safeId(input.verifierId),
      releaseAuthorityId: safeId(input.releaseAuthorityId),
      stagingControllerId: safeId(input.stagingControllerId),
      canaryControllerId: safeId(input.canaryControllerId),
      rollbackControllerId: safeId(input.rollbackControllerId),
    };
    if (!incidentId || !tenant || !targetTenant || Object.values(actorIds).some((value) => !value)) {
      deny('WFM_POSTSTAGING_INPUT', 'bounded incident, tenant and actor identities required');
    }
    if (new Set(Object.values(actorIds)).size !== Object.values(actorIds).length) {
      deny('WFM_POSTSTAGING_SEPARATION', 'repair, verification, release, staging, canary and rollback actors must be distinct');
    }
    if (tenant !== targetTenant) deny('WFM_POSTSTAGING_CROSS_TENANT', 'cross-tenant post-staging decision denied');

    const repair = await repairPipeline.process({ ...input, targetTenant });
    if (!repair || repair.status !== 'verified_candidate_staged') {
      return repair || contained({ incidentId, tenantDigest: sha(tenant) }, 'repair-pipeline-no-terminal-result');
    }

    const base = { incidentId, tenantDigest: sha(tenant) };
    if (repair.independentlyVerified !== true
      || repair.exactArtifactStaged !== true
      || repair.productionAuthorityGranted === true
      || repair.productionMutation === true
      || repair.customerMutation === true) {
      return contained(base, 'repair-pipeline-authority-or-proof-violation');
    }
    if (repair.tenantDigest !== base.tenantDigest) {
      return contained(base, 'repair-pipeline-tenant-binding-drift');
    }

    const expectedRepairActorSetDigest = sha([
      actorIds.workerId,
      actorIds.verifierId,
      actorIds.releaseAuthorityId,
      actorIds.stagingControllerId,
    ]);
    if (repair.actorSetDigest !== expectedRepairActorSetDigest) {
      return contained(base, 'repair-pipeline-actor-binding-drift');
    }
    const recomputedRepairChainDigest = computeRepairEvidenceChainDigest(repair);
    if (!recomputedRepairChainDigest || repair.repairChainDigest !== recomputedRepairChainDigest) {
      return contained(base, 'repair-pipeline-evidence-chain-invalid');
    }
    if (!validDigest(repair.outcomeReceiptDigest)) {
      return contained(base, 'repair-pipeline-outcome-receipt-invalid');
    }

    const canary = await canaryController.run(Object.freeze({
      incidentId,
      tenant,
      targetTenant,
      canaryControllerId: actorIds.canaryControllerId,
      rollbackControllerId: actorIds.rollbackControllerId,
      artifactDigest: repair.artifactDigest,
      rollbackDigest: repair.rollbackDigest,
      stagingReceiptDigest: repair.stagingReceiptDigest,
      maxInstances: 1,
      trafficPercent: 5,
    }));

    if (!canary || !['canary_proven', 'rolled_back_to_known_good', 'contained'].includes(canary.status)) {
      return contained(base, 'canary-result-invalid');
    }
    if (canary.productionAuthority === true
      || canary.productionAuthorityGranted === true
      || canary.productionMutation === true
      || canary.customerMutation === true) {
      return contained(base, 'canary-authority-violation');
    }
    if (canary.artifactDigest !== repair.artifactDigest
      || canary.rollbackDigest !== repair.rollbackDigest
      || canary.stagingReceiptDigest !== repair.stagingReceiptDigest) {
      return contained(base, 'post-staging-evidence-drift');
    }
    if (!validDigest(canary.outcomeReceiptDigest)) return contained(base, 'canary-receipt-invalid');
    if (!validDigest(canary.canaryEvidenceDigest)) return contained(base, 'canary-evidence-invalid');
    if (canary.status === 'rolled_back_to_known_good' && !validDigest(canary.rollbackEvidenceDigest)) {
      return contained(base, 'rollback-evidence-invalid');
    }
    if (canary.status === 'contained') {
      return contained(base, canary.reason || 'canary-contained', {
        repairChainDigest: repair.repairChainDigest,
        repairOutcomeReceiptDigest: repair.outcomeReceiptDigest,
        canaryOutcomeReceiptDigest: canary.outcomeReceiptDigest,
      });
    }

    const postStagingActorSetDigest = sha(Object.values(actorIds));
    const payload = {
      schemaVersion: 2,
      incidentId,
      tenantDigest: base.tenantDigest,
      status: canary.status,
      phase: 'post-staging-decision',
      postStagingActorSetDigest,
      repairOutcomeReceiptDigest: repair.outcomeReceiptDigest,
      canaryOutcomeReceiptDigest: canary.outcomeReceiptDigest,
      evidenceDigest: repair.evidenceDigest,
      failingTestDigest: repair.failingTestDigest,
      observedFailureDigest: repair.observedFailureDigest,
      sourceSnapshotDigest: repair.sourceSnapshotDigest,
      repairIntentDigest: repair.repairIntentDigest,
      patchDigest: repair.patchDigest,
      candidateDigest: repair.candidateDigest,
      artifactDigest: repair.artifactDigest,
      provenanceDigest: repair.provenanceDigest,
      rollbackDigest: repair.rollbackDigest,
      verificationDigest: repair.verificationDigest,
      permitDigest: repair.permitDigest,
      signatureDigest: repair.signatureDigest,
      stagingReceiptDigest: repair.stagingReceiptDigest,
      actorSetDigest: repair.actorSetDigest,
      repairChainDigest: repair.repairChainDigest,
      canaryEvidenceDigest: canary.canaryEvidenceDigest,
      rollbackEvidenceDigest: validDigest(canary.rollbackEvidenceDigest) ? canary.rollbackEvidenceDigest : null,
      productionAuthorityGranted: false,
      promotionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    };
    const decisionChainDigest = computePostStagingDecisionDigest(payload);
    if (!decisionChainDigest) return contained(base, 'post-staging-decision-evidence-incomplete');
    const finalPayload = { ...payload, decisionChainDigest };
    const compositionReceiptDigest = await record(finalPayload);
    return { ...finalPayload, compositionReceiptDigest };
  }

  return {
    run,
    capabilities: () => ({
      endToEndRepairToCanaryDecision: true,
      repairEvidenceChainRequired: true,
      signedProvenanceRequired: true,
      postStagingDecisionChainRequired: true,
      sixActorSeparationRequired: true,
      canaryMaxInstances: 1,
      canaryMaxTrafficPercent: 5,
      simulationOnly: true,
      productionAuthority: false,
      promotionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      incrementalCostZero: true,
    }),
  };
}

module.exports = { createAutonomousRepairCanaryOrchestrator };
