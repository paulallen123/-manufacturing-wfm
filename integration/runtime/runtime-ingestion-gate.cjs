'use strict';

const { createHash } = require('node:crypto');
const { evaluateActivation } = require('./connection-proof-gate.cjs');
const { gateCircuit } = require('./provider-circuit-breaker.cjs');
const { evaluateAuthorityObservation } = require('./source-authority-fence.cjs');

const DIGEST = /^[a-f0-9]{32,128}$/i;
const OPERATION_KEY = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_CLOCK_SKEW_MS = 5000;

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

function receiptPayload(review, observation, input = {}) {
  return {
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    capability: String(observation.capability || '').trim().toLowerCase(),
    sourceEpoch: String(observation.sourceEpoch || '').trim(),
    sourceOrdinal: String(observation.sourceOrdinal ?? '').trim(),
    evidenceDigest: String(observation.evidenceDigest || '').trim().toLowerCase(),
    operationKey: String(input.operationKey || '').trim(),
    stagedAt: String(input.stagedAt || '').trim(),
    durable: input.durable === true
  };
}

function makeDurableStageReceipt(review, observation, input = {}, now = Date.now()) {
  if (!review?.reviewedDigest || !review?.connectionId) throw new Error('Exact reviewed connection is required for durable staging.');
  const observedAtMs = Date.parse(String(observation?.observedAt || ''));
  const stagedAtMs = Date.parse(String(input.stagedAt || ''));
  const operationKey = String(input.operationKey || '').trim();
  const evidenceDigest = String(observation?.evidenceDigest || '').trim().toLowerCase();

  if (!Number.isFinite(observedAtMs)) throw new Error('Observation time is invalid.');
  if (observedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Observation time is unreasonably in the future.');
  if (!Number.isFinite(stagedAtMs)) throw new Error('Durable stage time is invalid.');
  if (stagedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Durable stage time is unreasonably in the future.');
  if (stagedAtMs + MAX_CLOCK_SKEW_MS < observedAtMs) throw new Error('Durable stage cannot materially predate the observation.');
  if (!OPERATION_KEY.test(operationKey)) throw new Error('Durable stage requires a bounded operation key.');
  if (!DIGEST.test(evidenceDigest)) throw new Error('Durable stage requires the bounded observation evidence digest.');
  if (input.durable !== true) throw new Error('Observation must be durably staged before apply.');

  const payload = receiptPayload(review, observation, { ...input, operationKey });
  return Object.freeze({ ...payload, stageDigest: sha256(JSON.stringify(stable(payload))) });
}

function validateDurableStageReceipt(review, observation, receipt = {}, now = Date.now()) {
  const blockers = [];
  if (!receipt || typeof receipt !== 'object') return Object.freeze({ valid: false, blockers: ['Durable stage receipt is missing.'] });

  const expected = receiptPayload(review, observation, receipt);
  if (receipt.reviewedDigest !== review?.reviewedDigest) blockers.push('Durable stage receipt belongs to a different reviewed connection.');
  if (receipt.connectionId !== review?.connectionId) blockers.push('Durable stage receipt belongs to a different connection.');
  if (String(receipt.capability || '').trim().toLowerCase() !== String(observation?.capability || '').trim().toLowerCase()) blockers.push('Durable stage receipt capability does not match the observation.');
  if (String(receipt.sourceEpoch || '') !== String(observation?.sourceEpoch || '')) blockers.push('Durable stage receipt source generation does not match the observation.');
  if (String(receipt.sourceOrdinal ?? '') !== String(observation?.sourceOrdinal ?? '')) blockers.push('Durable stage receipt source position does not match the observation.');
  if (String(receipt.evidenceDigest || '').toLowerCase() !== String(observation?.evidenceDigest || '').toLowerCase()) blockers.push('Durable stage receipt evidence does not match the observation.');
  if (!OPERATION_KEY.test(String(receipt.operationKey || ''))) blockers.push('Durable stage receipt operation key is invalid.');
  if (receipt.durable !== true) blockers.push('Observation was not proven durably staged before apply.');

  const observedAtMs = Date.parse(String(observation?.observedAt || ''));
  const stagedAtMs = Date.parse(String(receipt.stagedAt || ''));
  if (!Number.isFinite(observedAtMs)) blockers.push('Observation time is invalid.');
  else if (observedAtMs > now + MAX_CLOCK_SKEW_MS) blockers.push('Observation time is unreasonably in the future.');
  if (!Number.isFinite(stagedAtMs)) blockers.push('Durable stage time is invalid.');
  else {
    if (stagedAtMs > now + MAX_CLOCK_SKEW_MS) blockers.push('Durable stage time is unreasonably in the future.');
    if (Number.isFinite(observedAtMs) && stagedAtMs + MAX_CLOCK_SKEW_MS < observedAtMs) blockers.push('Durable stage materially predates the observation.');
  }

  const expectedDigest = sha256(JSON.stringify(stable(expected)));
  if (!receipt.stageDigest || receipt.stageDigest !== expectedDigest) blockers.push('Durable stage receipt integrity verification failed.');

  return Object.freeze({ valid: blockers.length === 0, blockers });
}

function gateMappedObservation(review, input = {}, now = Date.now()) {
  if (!input.currentConfig) {
    return Object.freeze({ action: 'BLOCK', reason: 'current-config-required', blockers: ['Runtime admission requires the current connection configuration, not only the historic review.'] });
  }
  if (!input.circuitState || input.circuitState.reviewedDigest !== review?.reviewedDigest) {
    return Object.freeze({ action: 'BLOCK', reason: 'circuit-state-required', blockers: ['Runtime admission requires circuit state for this exact reviewed connection.'] });
  }

  const activation = evaluateActivation(review, input.activationEvidence || {}, input.currentConfig);
  if (!activation.canActivate) {
    return Object.freeze({ action: 'BLOCK', reason: 'activation-not-current', blockers: activation.blockers });
  }

  const circuit = gateCircuit(review, input.circuitState, now);
  if (circuit.action !== 'ALLOW') {
    return Object.freeze({
      action: circuit.action === 'SAFE_PROBE_ONLY' ? 'SAFE_PROBE_ONLY' : circuit.action,
      reason: circuit.reason,
      blockers: circuit.action === 'BLOCK' ? [circuit.reason] : [],
      nextProbeAt: circuit.nextProbeAt || null,
      probeRequirements: circuit.probeRequirements || null
    });
  }

  const authority = evaluateAuthorityObservation(review, input.fence, input.observation || {});
  if (authority.action === 'DUPLICATE_NOOP') {
    return Object.freeze({ action: 'NOOP', reason: authority.reason, blockers: [], nextFence: authority.nextFence });
  }
  if (authority.action !== 'ACCEPT') {
    return Object.freeze({ action: authority.action, reason: authority.reason, blockers: authority.blockers || [], nextFence: null });
  }

  const stageCheck = validateDurableStageReceipt(review, input.observation || {}, input.stageReceipt, now);
  if (!stageCheck.valid) {
    return Object.freeze({ action: 'BLOCK', reason: 'durable-stage-proof-invalid', blockers: stageCheck.blockers, nextFence: null });
  }

  return Object.freeze({
    action: 'READY_TO_APPLY',
    reason: 'approved-authoritative-durably-staged-observation',
    blockers: [],
    operationKey: input.stageReceipt.operationKey,
    nextFence: authority.nextFence
  });
}

module.exports = {
  makeDurableStageReceipt,
  validateDurableStageReceipt,
  gateMappedObservation
};
