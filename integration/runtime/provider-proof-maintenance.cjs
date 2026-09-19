'use strict';

const { createHash } = require('node:crypto');
const {
  createProviderProofLease,
  evaluateProviderProofLease,
  renewProviderProofLease
} = require('./provider-proof-lifecycle.cjs');
const { gateCircuit } = require('./provider-circuit-breaker.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function taskKey(review, proofState, circuit, lease = {}, action = '') {
  return sha256(JSON.stringify(stable({
    reviewedDigest: review?.reviewedDigest || '',
    connectionId: review?.connectionId || '',
    providerKey: review?.providerKey || '',
    targetIdentity: review?.targetIdentity || '',
    proofState,
    leaseDigest: lease?.leaseDigest || null,
    circuitStatus: circuit?.state?.status || circuit?.action || 'UNKNOWN',
    openedAt: circuit?.state?.openedAt || null,
    nextProbeAt: circuit?.nextProbeAt || null,
    action
  })));
}

function safeProofRequest(review, action, proofState, circuit, lease, extra = {}) {
  return Object.freeze({
    action,
    taskKey: taskKey(review, proofState, circuit, lease, action),
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    providerKey: review.providerKey,
    targetIdentity: review.targetIdentity,
    environment: review.environment || 'non-production',
    proofMode: 'BOUNDED_METADATA_ONLY',
    nonMutating: true,
    writeAllowed: false,
    businessApplyAllowed: false,
    payrollDataAllowed: false,
    workforcePayloadAllowed: false,
    responseBodyRetentionAllowed: false,
    mappingMutationAllowed: false,
    ...extra
  });
}

function planProviderProofMaintenance(review, input = {}, now = Date.now()) {
  if (!review?.reviewedDigest || !review?.connectionId || !review?.providerKey || !review?.targetIdentity) {
    throw new Error('Exact reviewed connection is required for provider proof maintenance.');
  }

  const lease = input.providerProofLease || {};
  const proof = evaluateProviderProofLease(review, lease, now);
  const circuit = gateCircuit(review, input.circuitState || {}, now);

  if (circuit.action === 'BLOCK') {
    return Object.freeze({
      state: 'BLOCKED',
      canUseForBusinessTraffic: false,
      action: 'REPAIR_RECOVERY_STATE',
      automatic: false,
      proofState: proof.state,
      reason: circuit.reason,
      nextAction: 'Repair the provider recovery state before any connection proof or business sync is trusted.'
    });
  }

  if (circuit.action === 'PAUSE') {
    return Object.freeze({
      state: 'WAITING_FOR_RECOVERY_WINDOW',
      canUseForBusinessTraffic: false,
      action: 'WAIT_FOR_RECOVERY_WINDOW',
      automatic: true,
      proofState: proof.state,
      executeNotBefore: circuit.nextProbeAt,
      nextAction: 'Keep normal sync paused until the safe recovery window, then run one bounded recovery check.'
    });
  }

  if (circuit.action === 'SAFE_PROBE_ONLY') {
    const refreshProviderProof = proof.state !== 'CURRENT';
    return Object.freeze({
      state: 'RECOVERY_PROBE_REQUIRED',
      canUseForBusinessTraffic: false,
      action: 'RUN_SAFE_RECOVERY_PROBE',
      automatic: true,
      proofState: proof.state,
      task: safeProofRequest(review, 'RUN_SAFE_RECOVERY_PROBE', proof.state, circuit, lease, {
        recoveryProbe: true,
        reconciliationRequired: true,
        refreshProviderProof,
        mayResumeBusinessTrafficAfterSuccess: false
      }),
      nextAction: refreshProviderProof
        ? 'Run one bounded recovery check that also refreshes provider identity proof, then reconcile before resuming.'
        : 'Run the bounded recovery check and reconcile before resuming normal sync.'
    });
  }

  if (circuit.action !== 'ALLOW') {
    return Object.freeze({
      state: 'BLOCKED',
      canUseForBusinessTraffic: false,
      action: 'REPAIR_RECOVERY_STATE',
      automatic: false,
      proofState: proof.state,
      reason: 'unexpected-provider-circuit-action',
      nextAction: 'Repair the provider recovery state before continuing.'
    });
  }

  if (proof.state === 'CURRENT') {
    return Object.freeze({
      state: 'CURRENT',
      canUseForBusinessTraffic: true,
      action: 'NONE',
      automatic: true,
      proofState: proof.state,
      nextAction: 'No provider proof maintenance required.'
    });
  }

  if (proof.state === 'REPROOF_DUE') {
    return Object.freeze({
      state: 'REPROOF_SCHEDULED',
      canUseForBusinessTraffic: true,
      action: 'RUN_SAFE_PROVIDER_PROOF',
      automatic: true,
      proofState: proof.state,
      task: safeProofRequest(review, 'RUN_SAFE_PROVIDER_PROOF', proof.state, circuit, lease, {
        recoveryProbe: false,
        reconciliationRequired: false,
        refreshProviderProof: true,
        mayResumeBusinessTrafficAfterSuccess: true
      }),
      nextAction: 'Refresh provider identity automatically while normal sync continues.'
    });
  }

  return Object.freeze({
    state: 'REPROOF_REQUIRED',
    canUseForBusinessTraffic: false,
    action: 'RUN_SAFE_PROVIDER_PROOF',
    automatic: true,
    proofState: proof.state,
    task: safeProofRequest(review, 'RUN_SAFE_PROVIDER_PROOF', proof.state, circuit, lease, {
      recoveryProbe: false,
      reconciliationRequired: false,
      refreshProviderProof: true,
      mayResumeBusinessTrafficAfterSuccess: false
    }),
    nextAction: proof.state === 'BLOCKED'
      ? 'Re-run the bounded provider identity proof; keep sync paused and require review because the prior proof anchor is invalid.'
      : 'Refresh provider identity automatically before allowing new business sync.'
  });
}

function completeProviderProofMaintenance(review, priorLease, verifiedProof, options = {}, now = Date.now()) {
  const prior = evaluateProviderProofLease(review, priorLease || {}, now);

  if (prior.state !== 'BLOCKED') {
    const renewed = renewProviderProofLease(review, priorLease, verifiedProof, options, now);
    return Object.freeze({
      ...renewed,
      businessTrafficDisposition: renewed.mappingReviewRequired
        ? 'BLOCK_FOR_REVIEW'
        : 'ELIGIBLE_AFTER_RUNTIME_GATES'
    });
  }

  const lease = createProviderProofLease(review, verifiedProof, options, now);
  return Object.freeze({
    lease,
    approvalDisposition: 'REVIEW_REQUIRED',
    mappingReviewRequired: true,
    priorLeaseDigest: null,
    renewalDigest: sha256(JSON.stringify(stable({
      reviewedDigest: review.reviewedDigest,
      nextLeaseDigest: lease.leaseDigest,
      priorProofAnchorValid: false
    }))),
    businessTrafficDisposition: 'BLOCK_FOR_REVIEW'
  });
}

module.exports = {
  planProviderProofMaintenance,
  completeProviderProofMaintenance
};
