'use strict';

const RETRY_EXHAUSTION_ERRORS = new Set([
  'retry-budget-exhausted',
  'retry-window-would-be-exceeded'
]);

function text(value) {
  return String(value ?? '').trim();
}

function maintenanceErrorClass(execution = {}) {
  return text(execution.errorClass || execution.durable?.lastErrorClass || '').toLowerCase();
}

function retryExhaustionHealth(maintenance = {}, execution = {}) {
  const errorClass = maintenanceErrorClass(execution);
  if (!RETRY_EXHAUSTION_ERRORS.has(errorClass)) return null;

  const currentProofStillTrusted = maintenance.canUseForBusinessTraffic === true;
  const maintenanceExecutionState = text(execution.state || execution.durable?.status || 'BLOCKED').toUpperCase();

  if (currentProofStillTrusted) {
    return Object.freeze({
      state: 'DEGRADED',
      canSync: true,
      customerMessage: 'The connection can keep syncing on its current trusted proof, but automatic recovery reached its safe retry limit.',
      nextAction: 'Check provider availability or authorisation, then run a fresh bounded provider proof before the current proof expires.',
      providerSignal: 'RETRY_EXHAUSTED',
      runtimeSignal: 'HEALTHY',
      maintenanceExecutionState,
      reconciliationRequiredBeforeResume: false,
      retryExhausted: true
    });
  }

  return Object.freeze({
    state: 'ATTENTION_REQUIRED',
    canSync: false,
    customerMessage: 'The connection is paused because automatic recovery reached its safe retry limit and no trusted provider proof remains.',
    nextAction: 'Check provider availability or authorisation, run a fresh bounded provider proof, then reconcile before resuming.',
    providerSignal: 'RETRY_EXHAUSTED',
    runtimeSignal: 'PAUSED',
    maintenanceExecutionState,
    reconciliationRequiredBeforeResume: true,
    retryExhausted: true
  });
}

module.exports = {
  RETRY_EXHAUSTION_ERRORS,
  maintenanceErrorClass,
  retryExhaustionHealth
};
