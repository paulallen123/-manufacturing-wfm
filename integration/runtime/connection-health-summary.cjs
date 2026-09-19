'use strict';

const { evaluateActivation, evaluateRuntimeHealth } = require('./connection-proof-gate.cjs');
const { gateCircuit } = require('./provider-circuit-breaker.cjs');
const { evaluateProviderProofLease } = require('./provider-proof-lifecycle.cjs');

function sameReview(item, review) {
  return item && item.reviewedDigest === review?.reviewedDigest;
}

function setupProgress(review, evidence = {}, activation = {}) {
  const connectionTest = evidence.connectionTest;
  const mappingReview = evidence.mappingReview;
  const reconciliation = evidence.reconciliation;
  const recovery = evidence.recoveryProof;

  const connectionReady = connectionTest?.status === 'PASS' && sameReview(connectionTest, review) && connectionTest.nonMutating === true;
  const mappingReady = mappingReview?.status === 'APPROVED' && sameReview(mappingReview, review) && Number(mappingReview.mappingVersion) === Number(review?.mapping?.version);
  const reconciliationReady = reconciliation?.status === 'PASS' && sameReview(reconciliation, review) && Number(reconciliation.mappingVersion) === Number(review?.mapping?.version);
  const recoveryReady = review?.recoveryProofRequired !== true || (
    recovery?.status === 'PASS' &&
    sameReview(recovery, review) &&
    recovery.observedFailure === true &&
    recovery.recovered === true &&
    recovery.reconciliationStatus === 'PASS'
  );

  return Object.freeze([
    Object.freeze({ key: 'connect', label: 'Safe connection test', state: connectionReady ? 'COMPLETE' : 'REQUIRED' }),
    Object.freeze({ key: 'map', label: 'Review mapping', state: mappingReady ? 'COMPLETE' : 'REQUIRED' }),
    Object.freeze({ key: 'reconcile', label: 'Reconcile source data', state: reconciliationReady ? 'COMPLETE' : 'REQUIRED' }),
    Object.freeze({ key: 'recovery', label: 'Prove recovery', state: review?.recoveryProofRequired !== true ? 'NOT_REQUIRED' : recoveryReady ? 'COMPLETE' : 'REQUIRED' }),
    Object.freeze({ key: 'approve', label: 'Approve activation', state: activation.canActivate === true ? 'COMPLETE' : 'REQUIRED' })
  ]);
}

function firstRequiredAction(progress) {
  const pending = progress.find((step) => step.state === 'REQUIRED');
  if (!pending) return 'No setup action required.';
  const actions = {
    connect: 'Run the bounded, non-mutating connection test.',
    map: 'Review and approve the proposed field mapping.',
    reconcile: 'Reconcile the mapped source against the staged data.',
    recovery: 'Complete the safe recovery proof before activation.',
    approve: 'An authorised integration owner must approve activation.'
  };
  return actions[pending.key] || 'Complete the next required setup step.';
}

function summarizeConnectionHealth(review, input = {}, now = Date.now()) {
  const evidence = input.activationEvidence || {};
  const activation = evaluateActivation(review, evidence, input.currentConfig);
  const progress = setupProgress(review, evidence, activation);

  if (!activation.canActivate) {
    return Object.freeze({
      state: 'SETUP_REQUIRED',
      canSync: false,
      customerMessage: 'Connection setup is not yet approved for live WFM ingestion.',
      nextAction: firstRequiredAction(progress),
      setupProgress: progress,
      signals: Object.freeze({ activation: 'REQUIRED', provider: 'NOT_EVALUATED', runtime: 'NOT_EVALUATED' })
    });
  }

  const providerProof = evaluateProviderProofLease(review, input.providerProofLease || {}, now);
  if (!providerProof.canUseForBusinessTraffic) {
    return Object.freeze({
      state: 'RECOVERING',
      canSync: false,
      customerMessage: 'The connection is approved, but its provider identity proof must be refreshed before new WFM data is trusted.',
      nextAction: providerProof.nextAction,
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: providerProof.state, runtime: 'PAUSED' })
    });
  }

  const circuit = gateCircuit(review, input.circuitState || {}, now);
  if (circuit.action === 'BLOCK') {
    return Object.freeze({
      state: 'BLOCKED',
      canSync: false,
      customerMessage: 'The connection is paused because its provider recovery state cannot be trusted.',
      nextAction: 'Repair the provider recovery state, then run a safe connection check.',
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'BLOCKED', runtime: 'NOT_EVALUATED' })
    });
  }
  if (circuit.action === 'PAUSE' || circuit.action === 'SAFE_PROBE_ONLY') {
    return Object.freeze({
      state: 'RECOVERING',
      canSync: false,
      customerMessage: 'The provider is temporarily paused while WFM protects the connection from repeated failures.',
      nextAction: circuit.action === 'SAFE_PROBE_ONLY'
        ? 'Run the bounded non-mutating recovery check and reconcile before resuming.'
        : 'Wait for the safe recovery window; normal traffic remains paused.',
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'RECOVERING', runtime: 'PAUSED' })
    });
  }

  const runtime = evaluateRuntimeHealth(review, input.runtime || {}, now);
  if (runtime.state === 'BLOCKED') {
    return Object.freeze({
      state: 'ATTENTION_REQUIRED',
      canSync: false,
      customerMessage: 'The provider is reachable, but WFM cannot yet trust the latest integration state.',
      nextAction: 'Resolve reconciliation, authority or exhausted-recovery issues before trusting new data.',
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: providerProof.state === 'REPROOF_DUE' ? 'REPROOF_DUE' : 'AVAILABLE', runtime: 'BLOCKED' })
    });
  }
  if (runtime.state === 'DEGRADED') {
    return Object.freeze({
      state: 'DEGRADED',
      canSync: true,
      customerMessage: 'The connection is running, but freshness, latency or retry performance is below its reviewed target.',
      nextAction: providerProof.state === 'REPROOF_DUE'
        ? 'Keep syncing and refresh the bounded provider identity proof before it expires.'
        : 'Keep syncing while WFM monitors recovery; investigate if the condition persists.',
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: providerProof.state === 'REPROOF_DUE' ? 'REPROOF_DUE' : 'AVAILABLE', runtime: 'DEGRADED' })
    });
  }

  if (providerProof.state === 'REPROOF_DUE') {
    return Object.freeze({
      state: 'DEGRADED',
      canSync: true,
      customerMessage: 'Connected and healthy; the safe provider identity check is due to refresh before it expires.',
      nextAction: providerProof.nextAction,
      setupProgress: progress,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'REPROOF_DUE', runtime: 'HEALTHY' })
    });
  }

  return Object.freeze({
    state: 'HEALTHY',
    canSync: true,
    customerMessage: 'Connected, approved, current and reconciled.',
    nextAction: 'No action required.',
    setupProgress: progress,
    signals: Object.freeze({ activation: 'APPROVED', provider: 'AVAILABLE', runtime: 'HEALTHY' })
  });
}

module.exports = {
  setupProgress,
  summarizeConnectionHealth
};
