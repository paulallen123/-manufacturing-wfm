'use strict';

const { createHash } = require('node:crypto');
const { buildProviderProofPlan } = require('./provider-proof-profiles.cjs');
const { verifyProviderProofResponse } = require('./provider-proof-response-verifier.cjs');
const { completeProviderProofMaintenance } = require('./provider-proof-maintenance.cjs');

const DIGEST = /^[a-f0-9]{64}$/i;
const ERROR_CLASS = /^[A-Za-z0-9._:-]{1,120}$/;
const SAFE_ACTIONS = new Set(['RUN_SAFE_PROVIDER_PROOF', 'RUN_SAFE_RECOVERY_PROBE']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function safeErrorClass(error, fallback) {
  const candidate = text(error?.errorClass || error?.code || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
  return ERROR_CLASS.test(candidate) ? candidate : fallback;
}

function elapsedNow(startedAt, wallStarted, wallClock = Date.now) {
  const wallCurrent = Number(wallClock());
  const elapsed = Number.isFinite(wallCurrent) && Number.isFinite(Number(wallStarted))
    ? Math.max(0, wallCurrent - Number(wallStarted))
    : 0;
  return Number(startedAt) + elapsed;
}

function claimExpired(claim, now) {
  const expiresAtMs = Date.parse(text(claim?.claimExpiresAt));
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Number(now);
}

function assertClaimMatchesReview(claim, review) {
  const task = claim?.task;
  if (!claim?.taskKey || !claim?.claimToken || !task || !review) throw new Error('Claim, safe task and reviewed connection are required.');
  if (!SAFE_ACTIONS.has(task.action)) throw new Error('Claimed maintenance action is not approved.');
  if (task.taskKey !== claim.taskKey) throw new Error('Claimed task key does not match the leased task.');
  if (task.reviewedDigest !== review.reviewedDigest) throw new Error('Claimed provider proof belongs to a different review.');
  if (task.connectionId !== review.connectionId) throw new Error('Claimed provider proof belongs to a different connection.');
  if (lower(task.providerKey) !== lower(review.providerKey)) throw new Error('Claimed provider proof belongs to a different provider.');
  if (text(task.targetIdentity) !== text(review.targetIdentity)) throw new Error('Claimed provider proof belongs to a different target identity.');
  if (lower(task.environment || 'non-production') !== lower(review.environment || 'non-production')) {
    throw new Error('Claimed provider proof belongs to a different environment.');
  }
  if (task.proofMode !== 'BOUNDED_METADATA_ONLY' || task.nonMutating !== true || task.writeAllowed !== false ||
      task.businessApplyAllowed !== false || task.payrollDataAllowed !== false || task.workforcePayloadAllowed !== false ||
      task.responseBodyRetentionAllowed !== false || task.mappingMutationAllowed !== false) {
    throw new Error('Claimed provider proof exceeds the approved metadata-only boundary.');
  }
}

function validateControlPlaneReconciliation(review, result = {}, now = Date.now()) {
  if (result.status !== 'PASS') throw Object.assign(new Error('Recovery reconciliation did not pass.'), { errorClass: 'reconciliation-not-passed' });
  if (result.reviewedDigest !== review.reviewedDigest) throw Object.assign(new Error('Recovery reconciliation belongs to a different review.'), { errorClass: 'reconciliation-review-mismatch' });
  if (result.scope !== 'CONTROL_PLANE_ONLY') throw Object.assign(new Error('Recovery reconciliation exceeded the control-plane boundary.'), { errorClass: 'reconciliation-scope-invalid' });
  if (result.containsSensitiveData !== false || result.writePerformed !== false || result.businessRecordsRead !== false) {
    throw Object.assign(new Error('Recovery reconciliation exceeded the no-data/no-write boundary.'), { errorClass: 'reconciliation-safety-boundary' });
  }
  const observedAtMs = Date.parse(text(result.observedAt));
  if (!Number.isFinite(observedAtMs) || observedAtMs > now + 5000) {
    throw Object.assign(new Error('Recovery reconciliation observation time is invalid.'), { errorClass: 'reconciliation-time-invalid' });
  }
  const evidenceDigest = lower(result.evidenceDigest);
  if (!DIGEST.test(evidenceDigest)) throw Object.assign(new Error('Recovery reconciliation evidence digest is invalid.'), { errorClass: 'reconciliation-evidence-invalid' });
  return Object.freeze({
    status: 'PASS',
    reviewedDigest: review.reviewedDigest,
    scope: 'CONTROL_PLANE_ONLY',
    observedAt: new Date(observedAtMs).toISOString(),
    evidenceDigest,
    containsSensitiveData: false,
    writePerformed: false,
    businessRecordsRead: false
  });
}

function safeProofSummary(proof) {
  return Object.freeze({
    status: proof.status,
    providerKey: proof.providerKey,
    providerFamily: proof.providerFamily,
    reviewedDigest: proof.reviewedDigest,
    targetIdentity: proof.targetIdentity,
    targetHost: proof.targetHost,
    observedAt: proof.observedAt,
    measuredLatencyMs: proof.measuredLatencyMs,
    metadataDigest: proof.metadataDigest,
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false
  });
}

async function executeProviderProofClaim(input = {}, now = Date.now()) {
  const { claim, review, target, priorLease, leaseOptions, executeProof, reconcileControlPlane } = input;
  const wallClock = typeof input.wallClock === 'function' ? input.wallClock : Date.now;
  const wallStarted = Number(wallClock());
  assertClaimMatchesReview(claim, review);
  if (typeof executeProof !== 'function') throw new Error('Trusted provider proof executor is required.');

  const plan = buildProviderProofPlan(review, target || {});
  if (plan.reviewedDigest !== review.reviewedDigest || plan.activationAllowedFromThisProofAlone !== false) {
    throw new Error('Provider proof plan is not bound to the exact reviewed connection.');
  }

  const response = await executeProof(plan, Object.freeze({
    action: claim.task.action,
    taskKey: claim.taskKey,
    recoveryProbe: claim.task.recoveryProbe === true,
    reconciliationRequired: claim.task.reconciliationRequired === true
  }));
  const proofNow = elapsedNow(now, wallStarted, wallClock);
  const verifiedProof = verifyProviderProofResponse(plan, response, proofNow);
  const completion = completeProviderProofMaintenance(review, priorLease || {}, verifiedProof, leaseOptions || {}, proofNow);

  let reconciliation = null;
  if (claim.task.reconciliationRequired === true) {
    if (typeof reconcileControlPlane !== 'function') {
      throw Object.assign(new Error('Recovery proof requires safe reconciliation before completion.'), { errorClass: 'reconciliation-required' });
    }
    const reconciliationResult = await reconcileControlPlane(Object.freeze({
      taskKey: claim.taskKey,
      review: Object.freeze({
        reviewedDigest: review.reviewedDigest,
        connectionId: review.connectionId,
        providerKey: review.providerKey,
        targetIdentity: review.targetIdentity,
        environment: review.environment || 'non-production'
      }),
      verifiedProof: safeProofSummary(verifiedProof),
      nextLeaseDigest: completion.lease.leaseDigest
    }));
    reconciliation = validateControlPlaneReconciliation(
      review,
      reconciliationResult,
      elapsedNow(now, wallStarted, wallClock)
    );
  }

  const safeResult = Object.freeze({
    taskKey: claim.taskKey,
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    providerKey: lower(review.providerKey),
    targetIdentity: text(review.targetIdentity),
    action: claim.task.action,
    verifiedAt: verifiedProof.observedAt,
    measuredLatencyMs: verifiedProof.measuredLatencyMs,
    metadataDigest: verifiedProof.metadataDigest,
    nextLeaseDigest: completion.lease.leaseDigest,
    approvalDisposition: completion.approvalDisposition,
    mappingReviewRequired: completion.mappingReviewRequired === true,
    reconciliationDigest: reconciliation?.evidenceDigest || null,
    reconciliationObservedAt: reconciliation?.observedAt || null,
    businessTrafficDisposition: completion.businessTrafficDisposition,
    automaticResumeAllowed: claim.task.mayResumeBusinessTrafficAfterSuccess === true &&
      completion.businessTrafficDisposition === 'ELIGIBLE_AFTER_RUNTIME_GATES' &&
      completion.mappingReviewRequired !== true &&
      (claim.task.reconciliationRequired !== true || reconciliation?.status === 'PASS')
  });

  return Object.freeze({
    status: 'SUCCESS',
    outcomeDigest: digest(safeResult),
    result: safeResult,
    lease: completion.lease
  });
}

async function processNextProviderProofMaintenance(input = {}, now = Date.now()) {
  const { ledger, workerId, loadContext } = input;
  const wallClock = typeof input.wallClock === 'function' ? input.wallClock : Date.now;
  const wallStarted = Number(wallClock());
  if (!ledger || typeof ledger.claimNext !== 'function' || typeof ledger.complete !== 'function') {
    throw new Error('Durable provider proof maintenance ledger is required.');
  }
  if (typeof loadContext !== 'function') throw new Error('Provider proof context loader is required.');

  const claim = ledger.claimNext(workerId, input.claimOptions || {}, now);
  if (!claim) return Object.freeze({ state: 'IDLE' });

  let execution;
  try {
    const context = await loadContext(claim.task);
    execution = await executeProviderProofClaim({
      claim,
      review: context?.review,
      target: context?.target,
      priorLease: context?.priorLease,
      leaseOptions: context?.leaseOptions,
      executeProof: input.executeProof,
      reconcileControlPlane: input.reconcileControlPlane,
      wallClock
    }, now);
  } catch (error) {
    const failureNow = elapsedNow(now, wallStarted, wallClock);
    if (claimExpired(claim, failureNow)) {
      return Object.freeze({ state: 'CLAIM_EXPIRED', errorClass: 'maintenance-claim-expired' });
    }
    const retry = error?.retryable === true;
    const errorClass = safeErrorClass(error, retry ? 'provider-temporary-unavailable' : 'provider-proof-execution-blocked');
    try {
      const durable = ledger.complete(claim.taskKey, claim.claimToken, retry ? {
        status: 'RETRY',
        errorClass,
        retryAfterMs: Number.isInteger(error?.retryAfterMs) && error.retryAfterMs > 0 ? error.retryAfterMs : 5000
      } : {
        status: 'BLOCK',
        errorClass
      }, failureNow);
      return Object.freeze({ state: durable.status, durable, errorClass });
    } catch {
      return Object.freeze({ state: 'COMPLETION_UNCERTAIN', errorClass: 'maintenance-completion-not-confirmed' });
    }
  }

  const completionNow = elapsedNow(now, wallStarted, wallClock);
  if (claimExpired(claim, completionNow)) {
    return Object.freeze({ state: 'CLAIM_EXPIRED', errorClass: 'maintenance-claim-expired' });
  }

  try {
    const durable = ledger.complete(claim.taskKey, claim.claimToken, {
      status: 'SUCCESS',
      outcomeDigest: execution.outcomeDigest
    }, completionNow);
    return Object.freeze({ state: 'SUCCEEDED', durable, result: execution.result, lease: execution.lease });
  } catch {
    return Object.freeze({ state: 'COMPLETION_UNCERTAIN', errorClass: 'maintenance-completion-not-confirmed' });
  }
}

module.exports = {
  elapsedNow,
  claimExpired,
  assertClaimMatchesReview,
  validateControlPlaneReconciliation,
  executeProviderProofClaim,
  processNextProviderProofMaintenance
};
