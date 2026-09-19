'use strict';

const { createHash } = require('node:crypto');
const { validateReconciliationCheckpoint } = require('./transport-runtime-policy.cjs');

const DIGEST = /^[a-f0-9]{32,128}$/i;
const EPOCH = /^[A-Za-z0-9._:-]{1,160}$/;
const ORDINAL = /^(0|[1-9][0-9]*)$/;

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

function authorityAssignment(review, capability) {
  if (!review?.reviewedDigest) throw new Error('Exact reviewed connection digest is required.');
  const normalized = String(capability || '').trim().toLowerCase();
  const assignments = Array.isArray(review.authority) ? review.authority : [];
  const assignment = assignments.find((item) => String(item?.capability || '').trim().toLowerCase() === normalized);
  if (!assignment) throw new Error('Capability has no reviewed deterministic authority assignment.');
  if (!assignment.sourceId || assignment.sourceId !== review.connectionId) {
    throw new Error('Capability authority does not resolve to this exact reviewed connection.');
  }
  return { capability: normalized, sourceId: assignment.sourceId };
}

function mappingVersion(review) {
  const version = Number(review?.mapping?.version);
  if (!Number.isInteger(version) || version <= 0) throw new Error('Reviewed mapping version is required.');
  return version;
}

function normalizeOrdinal(value) {
  const text = String(value ?? '').trim();
  if (!ORDINAL.test(text)) throw new Error('Source ordering evidence must be a non-negative monotonic integer.');
  return text;
}

function compareOrdinals(left, right) {
  const a = BigInt(normalizeOrdinal(left));
  const b = BigInt(normalizeOrdinal(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeObservation(review, input = {}) {
  const assignment = authorityAssignment(review, input.capability);
  const sourceId = String(input.sourceId || '').trim();
  const reviewedDigest = String(input.reviewedDigest || '').trim();
  const version = Number(input.mappingVersion);
  const sourceEpoch = String(input.sourceEpoch || '').trim();
  const sourceOrdinal = normalizeOrdinal(input.sourceOrdinal);
  const evidenceDigest = String(input.evidenceDigest || '').trim().toLowerCase();
  const observedAt = String(input.observedAt || '').trim();

  if (sourceId !== assignment.sourceId) throw new Error('Observation is not from the reviewed authoritative source.');
  if (reviewedDigest !== review.reviewedDigest) throw new Error('Observation does not match the exact reviewed connection.');
  if (version !== mappingVersion(review)) throw new Error('Observation mapping version is stale or unreviewed.');
  if (!EPOCH.test(sourceEpoch)) throw new Error('Source epoch/generation evidence is required.');
  if (!DIGEST.test(evidenceDigest)) throw new Error('Observation requires a bounded evidence digest, not raw provider data.');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Observation time is invalid.');

  return Object.freeze({
    capability: assignment.capability,
    sourceId,
    reviewedDigest,
    mappingVersion: version,
    sourceEpoch,
    sourceOrdinal,
    evidenceDigest,
    observedAt
  });
}

function fencePayload(review, observation) {
  return {
    reviewedDigest: review.reviewedDigest,
    connectionId: review.connectionId,
    capability: observation.capability,
    sourceId: observation.sourceId,
    mappingVersion: observation.mappingVersion,
    sourceEpoch: observation.sourceEpoch,
    sourceOrdinal: observation.sourceOrdinal,
    evidenceDigest: observation.evidenceDigest,
    observedAt: observation.observedAt
  };
}

function makeFence(review, observation) {
  const payload = fencePayload(review, observation);
  return Object.freeze({ ...payload, fenceDigest: digest(payload) });
}

function validateFence(review, fence = {}) {
  const blockers = [];
  let assignment;
  try {
    assignment = authorityAssignment(review, fence.capability);
  } catch (error) {
    blockers.push(error.message);
  }

  if (fence.reviewedDigest !== review?.reviewedDigest) blockers.push('Authority fence belongs to a different reviewed connection.');
  if (fence.connectionId !== review?.connectionId) blockers.push('Authority fence belongs to a different connection.');
  if (assignment && fence.sourceId !== assignment.sourceId) blockers.push('Authority fence source is no longer authoritative.');
  try {
    if (Number(fence.mappingVersion) !== mappingVersion(review)) blockers.push('Authority fence mapping version is stale.');
  } catch (error) {
    blockers.push(error.message);
  }
  if (!EPOCH.test(String(fence.sourceEpoch || ''))) blockers.push('Authority fence source epoch is invalid.');
  try {
    normalizeOrdinal(fence.sourceOrdinal);
  } catch (error) {
    blockers.push(error.message);
  }
  if (!DIGEST.test(String(fence.evidenceDigest || ''))) blockers.push('Authority fence evidence digest is invalid.');
  if (!Number.isFinite(Date.parse(String(fence.observedAt || '')))) blockers.push('Authority fence observation time is invalid.');

  const payload = {
    reviewedDigest: fence.reviewedDigest,
    connectionId: fence.connectionId,
    capability: fence.capability,
    sourceId: fence.sourceId,
    mappingVersion: fence.mappingVersion,
    sourceEpoch: fence.sourceEpoch,
    sourceOrdinal: fence.sourceOrdinal,
    evidenceDigest: fence.evidenceDigest,
    observedAt: fence.observedAt
  };
  if (!fence.fenceDigest || fence.fenceDigest !== digest(payload)) blockers.push('Authority fence integrity verification failed.');

  return Object.freeze({ valid: blockers.length === 0, blockers });
}

function seedAuthorityFence(review, input = {}) {
  const observation = normalizeObservation(review, input);
  return makeFence(review, observation);
}

function evaluateAuthorityObservation(review, fence, input = {}) {
  const fenceCheck = validateFence(review, fence);
  if (!fenceCheck.valid) {
    return Object.freeze({ action: 'BLOCK', reason: 'invalid-authority-fence', blockers: fenceCheck.blockers, nextFence: null });
  }

  let observation;
  try {
    observation = normalizeObservation(review, input);
  } catch (error) {
    return Object.freeze({ action: 'BLOCK', reason: 'invalid-authority-observation', blockers: [error.message], nextFence: null });
  }

  if (observation.capability !== fence.capability) {
    return Object.freeze({ action: 'BLOCK', reason: 'capability-mismatch', blockers: ['Observation capability does not match this authority fence.'], nextFence: null });
  }
  if (observation.sourceEpoch !== fence.sourceEpoch) {
    return Object.freeze({
      action: 'RECONCILE_BEFORE_APPLY',
      reason: 'source-epoch-changed',
      blockers: ['Source generation changed; reconcile and explicitly rebase authority before accepting data.'],
      nextFence: null
    });
  }

  const ordering = compareOrdinals(observation.sourceOrdinal, fence.sourceOrdinal);
  if (ordering < 0) {
    return Object.freeze({
      action: 'QUARANTINE',
      reason: 'stale-source-observation',
      blockers: ['Late or replayed source data is older than the accepted authority checkpoint.'],
      nextFence: null
    });
  }
  if (ordering === 0) {
    if (observation.evidenceDigest === fence.evidenceDigest) {
      return Object.freeze({ action: 'DUPLICATE_NOOP', reason: 'already-accepted', blockers: [], nextFence: fence });
    }
    return Object.freeze({
      action: 'QUARANTINE',
      reason: 'same-position-conflict',
      blockers: ['The same source position produced different evidence and cannot be deterministically trusted.'],
      nextFence: null
    });
  }

  return Object.freeze({
    action: 'ACCEPT',
    reason: 'newer-authoritative-observation',
    blockers: [],
    nextFence: makeFence(review, observation)
  });
}

function rebaseAuthorityFence(review, fence, input = {}) {
  const fenceCheck = validateFence(review, fence);
  if (!fenceCheck.valid) throw new Error('Cannot rebase an invalid authority fence: ' + fenceCheck.blockers.join(' '));

  const observation = normalizeObservation(review, input.observation || {});
  if (observation.capability !== fence.capability) throw new Error('Authority rebase cannot change capability.');
  if (observation.sourceEpoch === fence.sourceEpoch) throw new Error('Authority rebase is only for an explicitly changed source generation.');

  const checkpoint = input.reconciliationCheckpoint;
  const checkpointCheck = validateReconciliationCheckpoint(review, checkpoint || {});
  if (!checkpointCheck.valid) throw new Error('Authority rebase requires valid reconciliation: ' + checkpointCheck.blockers.join(' '));
  if (Number(checkpoint.mappingVersion) !== mappingVersion(review)) throw new Error('Authority rebase reconciliation uses a stale mapping version.');

  const approval = input.approval || {};
  if (approval.decision !== 'APPROVED' || approval.reviewedDigest !== review.reviewedDigest || input.explicitRebaseApproval !== true) {
    throw new Error('Authority rebase requires explicit approval for this exact reviewed connection.');
  }

  return makeFence(review, observation);
}

module.exports = {
  normalizeObservation,
  validateFence,
  seedAuthorityFence,
  evaluateAuthorityObservation,
  rebaseAuthorityFence
};
