'use strict';

const { createHash } = require('node:crypto');

const DIGEST = /^[a-f0-9]{32,128}$/i;
const OPERATION_KEY = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_CLOCK_SKEW_MS = 5000;
const SAFE_OUTCOMES = new Set(['APPLIED', 'NO_EFFECT', 'AMBIGUOUS']);

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

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

function binding(review, observation = {}, stageReceipt = {}) {
  return {
    reviewedDigest: review?.reviewedDigest || null,
    connectionId: review?.connectionId || null,
    capability: String(observation.capability || '').trim().toLowerCase(),
    sourceEpoch: String(observation.sourceEpoch || '').trim(),
    sourceOrdinal: String(observation.sourceOrdinal ?? '').trim(),
    evidenceDigest: String(observation.evidenceDigest || '').trim().toLowerCase(),
    operationKey: String(stageReceipt.operationKey || '').trim(),
    stageDigest: String(stageReceipt.stageDigest || '').trim().toLowerCase()
  };
}

function validateBinding(review, observation, stageReceipt) {
  const blockers = [];
  const value = binding(review, observation, stageReceipt);
  if (!review?.reviewedDigest || !review?.connectionId) blockers.push('Exact reviewed connection is required.');
  if (stageReceipt?.reviewedDigest !== review?.reviewedDigest) blockers.push('Apply handoff stage belongs to a different reviewed connection.');
  if (stageReceipt?.connectionId !== review?.connectionId) blockers.push('Apply handoff stage belongs to a different connection.');
  if (String(stageReceipt?.capability || '').trim().toLowerCase() !== value.capability) blockers.push('Apply handoff capability does not match the staged observation.');
  if (String(stageReceipt?.sourceEpoch || '') !== value.sourceEpoch) blockers.push('Apply handoff source generation does not match the staged observation.');
  if (String(stageReceipt?.sourceOrdinal ?? '') !== value.sourceOrdinal) blockers.push('Apply handoff source position does not match the staged observation.');
  if (String(stageReceipt?.evidenceDigest || '').trim().toLowerCase() !== value.evidenceDigest) blockers.push('Apply handoff evidence does not match the staged observation.');
  if (!OPERATION_KEY.test(value.operationKey)) blockers.push('Apply handoff requires the bounded durable operation key.');
  if (!DIGEST.test(value.stageDigest)) blockers.push('Apply handoff requires a valid durable stage digest.');
  if (!DIGEST.test(value.evidenceDigest)) blockers.push('Apply handoff requires a bounded observation evidence digest.');
  return { valid: blockers.length === 0, blockers, value };
}

function makeApplyIntent(review, observation, stageReceipt, input = {}, now = Date.now()) {
  const check = validateBinding(review, observation, stageReceipt);
  if (!check.valid) throw new Error('Cannot create apply intent: ' + check.blockers.join(' '));
  const recordedAtMs = Date.parse(String(input.recordedAt || ''));
  if (!Number.isFinite(recordedAtMs)) throw new Error('Apply intent time is invalid.');
  if (recordedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Apply intent time is unreasonably in the future.');
  if (input.durable !== true) throw new Error('Apply intent must be durably recorded before WFM mutation.');
  if (input.idempotencyEnforced !== true) throw new Error('Automated WFM apply requires operation-key idempotency.');

  const payload = {
    ...check.value,
    status: 'INTENT_RECORDED',
    recordedAt: new Date(recordedAtMs).toISOString(),
    durable: true,
    idempotencyEnforced: true
  };
  return Object.freeze({ ...payload, entryDigest: digest(payload) });
}

function markApplyOutcome(intent, input = {}, now = Date.now()) {
  const status = String(input.status || '').trim().toUpperCase();
  if (!SAFE_OUTCOMES.has(status)) throw new Error('Unsupported apply outcome.');
  if (!intent || intent.status !== 'INTENT_RECORDED' || intent.durable !== true || intent.idempotencyEnforced !== true) {
    throw new Error('A durable idempotent apply intent is required.');
  }
  const expectedIntentDigest = intent.entryDigest;
  const intentPayload = { ...intent };
  delete intentPayload.entryDigest;
  if (!DIGEST.test(String(expectedIntentDigest || '')) || digest(intentPayload) !== expectedIntentDigest) {
    throw new Error('Apply intent integrity verification failed.');
  }
  const recordedAtMs = Date.parse(String(input.recordedAt || ''));
  if (!Number.isFinite(recordedAtMs)) throw new Error('Apply outcome time is invalid.');
  if (recordedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Apply outcome time is unreasonably in the future.');
  if (recordedAtMs < Date.parse(intent.recordedAt)) throw new Error('Apply outcome cannot predate its intent.');
  if (input.durable !== true) throw new Error('Apply outcome must be durably recorded.');

  const effectDigest = String(input.effectDigest || '').trim().toLowerCase();
  if (status === 'APPLIED' && !DIGEST.test(effectDigest)) throw new Error('Applied outcome requires a bounded business-effect digest.');
  if (status !== 'APPLIED' && effectDigest && !DIGEST.test(effectDigest)) throw new Error('Business-effect digest is invalid.');

  const payload = {
    reviewedDigest: intent.reviewedDigest,
    connectionId: intent.connectionId,
    capability: intent.capability,
    sourceEpoch: intent.sourceEpoch,
    sourceOrdinal: intent.sourceOrdinal,
    evidenceDigest: intent.evidenceDigest,
    operationKey: intent.operationKey,
    stageDigest: intent.stageDigest,
    status,
    intentDigest: expectedIntentDigest,
    recordedAt: new Date(recordedAtMs).toISOString(),
    durable: true,
    idempotencyEnforced: true,
    effectDigest: effectDigest || null
  };
  return Object.freeze({ ...payload, entryDigest: digest(payload) });
}

function evaluateApplyHandoff(review, observation, stageReceipt, entry, now = Date.now()) {
  const check = validateBinding(review, observation, stageReceipt);
  if (!check.valid) return Object.freeze({ action: 'BLOCK', reason: 'apply-binding-invalid', blockers: check.blockers });
  if (!entry || typeof entry !== 'object') {
    return Object.freeze({ action: 'BLOCK', reason: 'durable-apply-intent-required', blockers: ['Durable idempotent apply intent must exist before WFM mutation.'] });
  }

  const blockers = [];
  for (const [key, value] of Object.entries(check.value)) {
    if (entry[key] !== value) blockers.push(`Apply handoff ${key} does not match the exact staged observation.`);
  }
  if (entry.durable !== true) blockers.push('Apply handoff is not durably recorded.');
  if (entry.idempotencyEnforced !== true) blockers.push('Apply handoff does not prove operation-key idempotency.');
  const recordedAtMs = Date.parse(String(entry.recordedAt || ''));
  if (!Number.isFinite(recordedAtMs)) blockers.push('Apply handoff time is invalid.');
  else if (recordedAtMs > now + MAX_CLOCK_SKEW_MS) blockers.push('Apply handoff time is unreasonably in the future.');

  const payload = { ...entry };
  delete payload.entryDigest;
  if (!DIGEST.test(String(entry.entryDigest || '')) || digest(payload) !== entry.entryDigest) blockers.push('Apply handoff integrity verification failed.');
  if (blockers.length) return Object.freeze({ action: 'BLOCK', reason: 'apply-handoff-invalid', blockers });

  if (entry.status === 'INTENT_RECORDED') {
    return Object.freeze({ action: 'APPLY_OR_RETRY_SAFE', reason: 'durable-idempotent-intent', blockers: [], operationKey: entry.operationKey });
  }
  if (entry.status === 'APPLIED' || entry.status === 'NO_EFFECT') {
    return Object.freeze({ action: 'ADVANCE_FENCE_NO_APPLY', reason: entry.status === 'APPLIED' ? 'already-applied' : 'already-no-effect', blockers: [], operationKey: entry.operationKey });
  }
  if (entry.status === 'AMBIGUOUS') {
    return Object.freeze({ action: 'RECONCILE_BEFORE_APPLY', reason: 'prior-apply-outcome-ambiguous', blockers: ['Prior WFM apply outcome is ambiguous; reconcile the business effect before any retry.'], operationKey: entry.operationKey });
  }
  return Object.freeze({ action: 'BLOCK', reason: 'unsupported-apply-status', blockers: ['Apply handoff status is unsupported.'] });
}

module.exports = {
  makeApplyIntent,
  markApplyOutcome,
  evaluateApplyHandoff
};
