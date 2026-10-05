'use strict';

const { createHash } = require('node:crypto');

const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeId = (value) => {
  const v = String(value || '').trim();
  return v && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(v) ? v : null;
};
const deny = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function createAutonomousRepairCanaryOrchestrator({ repairPipeline, canaryController, outcomeRecorder, replayGuard } = {}) {
  if (!repairPipeline || typeof repairPipeline.process !== 'function' || typeof repairPipeline.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_PIPELINE', 'trusted repair pipeline unavailable');
  }
  if (!canaryController || typeof canaryController.run !== 'function' || typeof canaryController.limits !== 'function' || typeof canaryController.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_CANARY', 'trusted canary controller unavailable');
  }
  if (!outcomeRecorder || typeof outcomeRecorder.record !== 'function' || typeof outcomeRecorder.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_RECORDER', 'durable outcome recorder unavailable');
  }
  if (!replayGuard || typeof replayGuard.claim !== 'function' || typeof replayGuard.complete !== 'function' || typeof replayGuard.capabilities !== 'function') {
    deny('WFM_POSTSTAGING_REPLAY', 'durable post-staging replay guard unavailable');
  }

  const pipelineCaps = repairPipeline.capabilities();
  for (const [key, expected] of Object.entries({
    independentVerificationRequired: true,
    exactArtifactStagingRequired: true,
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
    if (canaryCaps?.[lane]?.simulationOnly !== true || canaryCaps?.[lane]?.productionWriteAuthority !== false || canaryCaps?.[lane]?.customerWriteAuthority !== false || canaryCaps?.[lane]?.incrementalCostZero !== true || canaryCaps?.[lane]?.modelCanGrantAuthority !== false) {
      deny('WFM_POSTSTAGING_CANARY', `unsafe ${lane} capability`);
    }
  }
  if (canaryCaps?.attestor?.productionAuthority !== false || canaryCaps?.attestor?.customerWriteAuthority !== false || canaryCaps?.attestor?.modelCanGrantAuthority !== false) {
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

  const replayCaps = replayGuard.capabilities();
  for (const [key, expected] of Object.entries({
    durable: true,
    atomicClaim: true,
    failClosedOnPending: true,
    tenantScoped: true,
    independentWitness: true,
    modelCanGrantAuthority: false,
  })) {
    if (replayCaps?.[key] !== expected) deny('WFM_POSTSTAGING_REPLAY', `unsafe replay guard capability: ${key}`);
  }

  async function record(payload) {
    const result = await outcomeRecorder.record(Object.freeze({ ...payload }));
    if (!result || !validDigest(result.receiptDigest)) deny('WFM_POSTSTAGING_RECORDER_RESULT', 'durable composition receipt required');
    return result.receiptDigest;
  }

  async function contained(base, reason, extra = {}) {
    const payload = {
      schemaVersion: 1,
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

  async function execute(input = {}) {
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
    if (!incidentId || !tenant || !targetTenant || Object.values(actorIds).some((v) => !v)) {
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
    if (repair.independentlyVerified !== true || repair.exactArtifactStaged !== true || repair.productionAuthorityGranted === true || repair.productionMutation === true || repair.customerMutation === true) {
      return contained(base, 'repair-pipeline-authority-or-proof-violation');
    }
    for (const key of ['artifactDigest', 'rollbackDigest', 'stagingReceiptDigest', 'verificationDigest', 'outcomeReceiptDigest']) {
      if (!validDigest(repair[key])) return contained(base, 'repair-pipeline-evidence-incomplete', { missingOrInvalid: key });
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
    if (canary.productionAuthority === true || canary.productionAuthorityGranted === true || canary.productionMutation === true || canary.customerMutation === true) {
      return contained(base, 'canary-authority-violation');
    }
    if (canary.artifactDigest !== repair.artifactDigest || canary.rollbackDigest !== repair.rollbackDigest || canary.stagingReceiptDigest !== repair.stagingReceiptDigest) {
      return contained(base, 'post-staging-evidence-drift');
    }
    if (!validDigest(canary.outcomeReceiptDigest)) return contained(base, 'canary-receipt-invalid');

    const payload = {
      schemaVersion: 1,
      incidentId,
      tenantDigest: base.tenantDigest,
      status: canary.status,
      phase: 'post-staging-decision',
      repairOutcomeReceiptDigest: repair.outcomeReceiptDigest,
      canaryOutcomeReceiptDigest: canary.outcomeReceiptDigest,
      artifactDigest: repair.artifactDigest,
      rollbackDigest: repair.rollbackDigest,
      stagingReceiptDigest: repair.stagingReceiptDigest,
      canaryEvidenceDigest: validDigest(canary.canaryEvidenceDigest) ? canary.canaryEvidenceDigest : null,
      rollbackEvidenceDigest: validDigest(canary.rollbackEvidenceDigest) ? canary.rollbackEvidenceDigest : null,
      productionAuthorityGranted: false,
      promotionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    };
    const compositionReceiptDigest = await record(payload);
    return { ...payload, compositionReceiptDigest };
  }

  async function run(input = {}) {
    const incidentId = safeId(input.incidentId);
    const tenant = String(input.tenant || '').trim();
    const targetTenant = String(input.targetTenant || tenant).trim();
    const actorIds = [
      safeId(input.workerId),
      safeId(input.verifierId),
      safeId(input.releaseAuthorityId),
      safeId(input.stagingControllerId),
      safeId(input.canaryControllerId),
      safeId(input.rollbackControllerId),
    ];
    if (!incidentId || !tenant || !targetTenant || actorIds.some((v) => !v)) {
      deny('WFM_POSTSTAGING_INPUT', 'bounded incident, tenant and actor identities required');
    }
    if (new Set(actorIds).size !== actorIds.length) {
      deny('WFM_POSTSTAGING_SEPARATION', 'repair, verification, release, staging, canary and rollback actors must be distinct');
    }
    if (tenant !== targetTenant) deny('WFM_POSTSTAGING_CROSS_TENANT', 'cross-tenant post-staging decision denied');

    const tenantDigest = sha(tenant);
    const inputDigest = sha(JSON.stringify({
      input,
      pipelineCaps,
      limits,
      canaryCaps,
      recorderCaps,
      replayCaps,
    }));
    const claim = replayGuard.claim({
      scope: 'repair-canary-orchestrator',
      tenantDigest,
      incidentId,
      inputDigest,
    });
    if (claim?.status === 'replay') return claim.receipt;
    if (!claim || claim.status !== 'claimed' || !claim.token) {
      deny('WFM_POSTSTAGING_REPLAY', 'post-staging replay claim was not acquired');
    }

    const result = await execute(input);
    replayGuard.complete({
      scope: 'repair-canary-orchestrator',
      tenantDigest,
      incidentId,
      inputDigest,
      token: claim.token,
      receipt: result,
    });
    return result;
  }

  return {
    run,
    capabilities: () => ({
      endToEndRepairToCanaryDecision: true,
      sixActorSeparationRequired: true,
      canaryMaxInstances: 1,
      canaryMaxTrafficPercent: 5,
      simulationOnly: true,
      productionAuthority: false,
      promotionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      incrementalCostZero: true,
      durableReplayRequired: true,
    }),
  };

}

module.exports = { createAutonomousRepairCanaryOrchestrator };
