'use strict';

const { processNextProviderProofMaintenance } = require('./provider-proof-maintenance-worker.cjs');
const { maintenanceRetryDecision } = require('./provider-proof-retry-policy.cjs');

function governedProviderFailure(error, decision) {
  const governed = new Error('Provider proof execution failed.');
  governed.errorClass = decision.errorClass;
  governed.retryable = decision.action === 'RETRY';
  if (decision.action === 'RETRY') governed.retryAfterMs = decision.retryAfterMs;
  return governed;
}

async function processNextProviderProofMaintenanceWithTransportPolicy(input = {}, now = Date.now()) {
  if (!input.ledger || typeof input.ledger.claimNext !== 'function') {
    throw new Error('Durable provider proof maintenance ledger is required.');
  }
  if (typeof input.loadContext !== 'function') throw new Error('Provider proof context loader is required.');
  if (typeof input.executeProof !== 'function') throw new Error('Trusted provider proof executor is required.');

  let activeClaim = null;
  let activeContext = null;
  const retryClock = typeof input.retryClock === 'function' ? input.retryClock : Date.now;

  const ledger = Object.freeze({
    claimNext(...args) {
      activeClaim = input.ledger.claimNext(...args);
      return activeClaim;
    },
    complete(...args) {
      return input.ledger.complete(...args);
    },
    getTask(...args) {
      return typeof input.ledger.getTask === 'function' ? input.ledger.getTask(...args) : null;
    }
  });

  const loadContext = async (...args) => {
    activeContext = await input.loadContext(...args);
    return activeContext;
  };

  const executeProof = async (...args) => {
    try {
      return await input.executeProof(...args);
    } catch (error) {
      const decision = maintenanceRetryDecision(
        activeContext?.review,
        activeClaim || {},
        error,
        Number(retryClock())
      );
      throw governedProviderFailure(error, decision);
    }
  };

  return processNextProviderProofMaintenance({
    ...input,
    ledger,
    loadContext,
    executeProof
  }, now);
}

module.exports = {
  governedProviderFailure,
  processNextProviderProofMaintenanceWithTransportPolicy
};
