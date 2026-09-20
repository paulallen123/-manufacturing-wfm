'use strict';

const { evaluateActivation, evaluateRuntimeHealth } = require('./connection-proof-gate.cjs');
const { planProviderProofMaintenance } = require('./provider-proof-maintenance.cjs');

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

function maintenanceExecutionDisposition(maintenance = {}, execution = {}) {
  const state = String(execution?.state || '').trim().toUpperCase();
  if (!state || state === 'IDLE' || state === 'SUCCESS' || state === 'SUCCEEDED') return null;

  const canContinueOnExistingProof = maintenance.canUseForBusinessTraffic === true;

  if (state === 'CLAIM_EXPIRED') {
    return Object.freeze({
      state: canContinueOnExistingProof ? 'DEGRADED' : 'RECOVERING',
      canSync: canContinueOnExistingProof,
      customerMessage: canContinueOnExistingProof
        ? 'The connection can keep syncing on its current proof, but an automatic provider safety check expired before completion.'
        : 'The connection remains paused because an automatic provider safety check expired before a trusted completion was recorded.',
      nextAction: canContinueOnExistingProof
        ? 'Reclaim the durable maintenance task and rerun the safe provider check before the current proof expires.'
        : 'Reclaim the durable maintenance task, rerun the safe provider check and reconcile before resuming.',
      providerSignal: 'RETRYING',
      runtimeSignal: canContinueOnExistingProof ? 'HEALTHY' : 'PAUSED',
      maintenanceExecutionState: state,
      reconciliationRequiredBeforeResume: !canContinueOnExistingProof
    });
  }

  if (state === 'COMPLETION_UNCERTAIN') {
    return Object.freeze({
      state: canContinueOnExistingProof ? 'DEGRADED' : 'ATTENTION_REQUIRED',
      canSync: canContinueOnExistingProof,
      customerMessage: canContinueOnExistingProof
        ? 'The connection can keep syncing on its current proof, but WFM has not confirmed the outcome of the latest safety check.'
        : 'The connection is paused because WFM cannot prove whether the latest provider safety check completed durably.',
      nextAction: canContinueOnExistingProof
        ? 'Confirm the durable maintenance outcome; rerun the safe provider check if it was not recorded.'
        : 'Reconcile the control-plane outcome and confirm durable completion before retrying or resuming.',
      providerSignal: 'OUTCOME_UNCERTAIN',
      runtimeSignal: canContinueOnExistingProof ? 'HEALTHY' : 'PAUSED',
      maintenanceExecutionState: state,
      reconciliationRequiredBeforeResume: !canContinueOnExistingProof
    });
  }

  if (state === 'PENDING' || state === 'RETRY_REQUIRED') {
    return Object.freeze({
      state: canContinueOnExistingProof ? 'DEGRADED' : 'RECOVERING',
      canSync: canContinueOnExistingProof,
      customerMessage: canContinueOnExistingProof
        ? 'The connection can keep syncing on its current proof; the latest safety check has been safely reconciled and queued for retry.'
        : 'The connection remains paused while the safely reconciled provider check waits for retry.',
      nextAction: canContinueOnExistingProof
        ? 'Retry the bounded provider check at its durable retry time before the current proof expires.'
        : 'Retry the bounded provider check, then pass reconciliation and runtime gates before resuming.',
      providerSignal: 'RETRYING',
      runtimeSignal: canContinueOnExistingProof ? 'HEALTHY' : 'PAUSED',
      maintenanceExecutionState: state,
      reconciliationRequiredBeforeResume: !canContinueOnExistingProof
    });
  }

  if (state === 'BLOCKED' || state === 'ATTENTION_REQUIRED') {
    return Object.freeze({
      state: 'ATTENTION_REQUIRED',
      canSync: false,
      customerMessage: 'The connection is paused because WFM reconciled the maintenance outcome to a blocked or conflicting control-plane state.',
      nextAction: 'Resolve the durable maintenance conflict and re-establish trusted provider proof before allowing new sync.',
      providerSignal: 'BLOCKED',
      runtimeSignal: 'PAUSED',
      maintenanceExecutionState: state,
      reconciliationRequiredBeforeResume: true
    });
  }

  return null;
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

  const maintenance = planProviderProofMaintenance(review, {
    providerProofLease: input.providerProofLease || {},
    circuitState: input.circuitState || {}
  }, now);

  if (maintenance.action === 'REPAIR_RECOVERY_STATE') {
    return Object.freeze({
      state: 'BLOCKED',
      canSync: false,
      customerMessage: 'The connection is paused because its provider recovery state cannot be trusted.',
      nextAction: maintenance.nextAction,
      setupProgress: progress,
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'BLOCKED', runtime: 'NOT_EVALUATED' })
    });
  }

  const maintenanceExecution = maintenanceExecutionDisposition(maintenance, input.maintenanceExecution || {});
  if (maintenanceExecution) {
    return Object.freeze({
      state: maintenanceExecution.state,
      canSync: maintenanceExecution.canSync,
      customerMessage: maintenanceExecution.customerMessage,
      nextAction: maintenanceExecution.nextAction,
      setupProgress: progress,
      automation: maintenance,
      maintenanceExecutionState: maintenanceExecution.maintenanceExecutionState,
      reconciliationRequiredBeforeResume: maintenanceExecution.reconciliationRequiredBeforeResume,
      signals: Object.freeze({
        activation: 'APPROVED',
        provider: maintenanceExecution.providerSignal,
        runtime: maintenanceExecution.runtimeSignal
      })
    });
  }

  if (maintenance.action === 'WAIT_FOR_RECOVERY_WINDOW' || maintenance.action === 'RUN_SAFE_RECOVERY_PROBE') {
    return Object.freeze({
      state: 'RECOVERING',
      canSync: false,
      customerMessage: 'The provider is temporarily paused while WFM protects the connection from repeated failures.',
      nextAction: maintenance.nextAction,
      setupProgress: progress,
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'RECOVERING', runtime: 'PAUSED' })
    });
  }

  if (maintenance.action === 'RUN_SAFE_PROVIDER_PROOF' && maintenance.canUseForBusinessTraffic === false) {
    return Object.freeze({
      state: 'RECOVERING',
      canSync: false,
      customerMessage: 'The connection is approved, but its provider identity proof must be refreshed before new WFM data is trusted.',
      nextAction: maintenance.nextAction,
      setupProgress: progress,
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: maintenance.proofState, runtime: 'PAUSED' })
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
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: maintenance.proofState === 'REPROOF_DUE' ? 'REPROOF_DUE' : 'AVAILABLE', runtime: 'BLOCKED' })
    });
  }
  if (runtime.state === 'DEGRADED') {
    return Object.freeze({
      state: 'DEGRADED',
      canSync: true,
      customerMessage: 'The connection is running, but freshness, latency or retry performance is below its reviewed target.',
      nextAction: maintenance.action === 'RUN_SAFE_PROVIDER_PROOF'
        ? maintenance.nextAction
        : 'Keep syncing while WFM monitors recovery; investigate if the condition persists.',
      setupProgress: progress,
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: maintenance.proofState === 'REPROOF_DUE' ? 'REPROOF_DUE' : 'AVAILABLE', runtime: 'DEGRADED' })
    });
  }

  if (maintenance.action === 'RUN_SAFE_PROVIDER_PROOF') {
    return Object.freeze({
      state: 'DEGRADED',
      canSync: true,
      customerMessage: 'Connected and healthy; WFM has scheduled the safe provider identity refresh before it expires.',
      nextAction: maintenance.nextAction,
      setupProgress: progress,
      automation: maintenance,
      signals: Object.freeze({ activation: 'APPROVED', provider: 'REPROOF_DUE', runtime: 'HEALTHY' })
    });
  }

  return Object.freeze({
    state: 'HEALTHY',
    canSync: true,
    customerMessage: 'Connected, approved, current and reconciled.',
    nextAction: 'No action required.',
    setupProgress: progress,
    automation: maintenance,
    signals: Object.freeze({ activation: 'APPROVED', provider: 'AVAILABLE', runtime: 'HEALTHY' })
  });
}

module.exports = {
  setupProgress,
  maintenanceExecutionDisposition,
  summarizeConnectionHealth
};
