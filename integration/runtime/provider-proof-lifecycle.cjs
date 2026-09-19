'use strict';

const { createHash } = require('node:crypto');

const DIGEST = /^[a-f0-9]{64}$/i;
const MAX_CLOCK_SKEW_MS = 5000;
const MIN_LEASE_SECONDS = 300;
const MIN_RENEW_WINDOW_SECONDS = 60;
const MAX_LEASE_SECONDS = 86400;
const DEFAULT_LEASE_SECONDS = 3600;
const DEFAULT_RENEW_WINDOW_SECONDS = 600;

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

function boundedSeconds(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < MIN_LEASE_SECONDS || n > MAX_LEASE_SECONDS) {
    throw new Error(`Provider proof lease must be between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS} seconds.`);
  }
  return n;
}

function exactProofPayload(review, verifiedProof = {}) {
  return {
    reviewedDigest: String(review?.reviewedDigest || '').trim().toLowerCase(),
    connectionId: String(review?.connectionId || '').trim(),
    providerKey: String(review?.providerKey || '').trim().toLowerCase(),
    targetIdentity: String(review?.targetIdentity || '').trim(),
    environment: String(review?.environment || 'non-production').trim().toLowerCase(),
    observedAt: String(verifiedProof.observedAt || '').trim(),
    metadataDigest: String(verifiedProof.metadataDigest || '').trim().toLowerCase()
  };
}

function validateVerifiedProof(review, verifiedProof = {}, now = Date.now()) {
  if (!review?.reviewedDigest || !review?.connectionId || !review?.providerKey || !review?.targetIdentity) {
    throw new Error('Exact reviewed connection is required for provider proof lifecycle.');
  }
  if (verifiedProof.status !== 'PASS') throw new Error('Only independently verified provider proof may be leased.');
  if (verifiedProof.reviewedDigest !== review.reviewedDigest) throw new Error('Provider proof belongs to a different reviewed connection.');
  if (String(verifiedProof.providerKey || '').trim().toLowerCase() !== String(review.providerKey).trim().toLowerCase()) {
    throw new Error('Provider proof belongs to a different provider.');
  }
  if (String(verifiedProof.targetIdentity || '').trim() !== String(review.targetIdentity).trim()) {
    throw new Error('Provider proof belongs to a different target identity.');
  }
  if (String(verifiedProof.environment || review.environment || 'non-production').trim().toLowerCase() !== String(review.environment || 'non-production').trim().toLowerCase()) {
    throw new Error('Provider proof belongs to a different environment.');
  }
  if (verifiedProof.boundedMetadataOnly !== true || verifiedProof.containsSensitiveData !== false || verifiedProof.responseBodyRetained !== false) {
    throw new Error('Provider proof must remain bounded metadata evidence with no retained sensitive response body.');
  }
  if (!DIGEST.test(String(verifiedProof.metadataDigest || ''))) throw new Error('Provider proof metadata digest is invalid.');
  const observedAtMs = Date.parse(String(verifiedProof.observedAt || ''));
  if (!Number.isFinite(observedAtMs)) throw new Error('Provider proof observation time is invalid.');
  if (observedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Provider proof observation time is unreasonably in the future.');
  return { observedAtMs, payload: exactProofPayload(review, verifiedProof) };
}

function createProviderProofLease(review, verifiedProof, options = {}, now = Date.now()) {
  const check = validateVerifiedProof(review, verifiedProof, now);
  const maxAgeSeconds = boundedSeconds(options.maxAgeSeconds, DEFAULT_LEASE_SECONDS);
  const renewWindowSeconds = Number(options.renewWindowSeconds ?? DEFAULT_RENEW_WINDOW_SECONDS);
  if (!Number.isInteger(renewWindowSeconds) || renewWindowSeconds < MIN_RENEW_WINDOW_SECONDS || renewWindowSeconds > MAX_LEASE_SECONDS) throw new Error('Provider proof renewal window is invalid.');
  if (renewWindowSeconds >= maxAgeSeconds) throw new Error('Provider proof renewal window must be shorter than the proof lease.');

  const payload = {
    ...check.payload,
    maxAgeSeconds,
    renewWindowSeconds,
    expiresAt: new Date(check.observedAtMs + maxAgeSeconds * 1000).toISOString(),
    issuedAt: new Date(now).toISOString()
  };
  return Object.freeze({ ...payload, leaseDigest: digest(payload) });
}

function validateLeaseIntegrity(review, lease = {}) {
  const blockers = [];
  if (!lease || typeof lease !== 'object') return { valid: false, blockers: ['Provider proof lease is missing.'] };
  if (lease.reviewedDigest !== review?.reviewedDigest) blockers.push('Provider proof lease belongs to a different reviewed connection.');
  if (lease.connectionId !== review?.connectionId) blockers.push('Provider proof lease belongs to a different connection.');
  if (String(lease.providerKey || '').trim().toLowerCase() !== String(review?.providerKey || '').trim().toLowerCase()) blockers.push('Provider proof lease belongs to a different provider.');
  if (String(lease.targetIdentity || '').trim() !== String(review?.targetIdentity || '').trim()) blockers.push('Provider proof lease belongs to a different target identity.');
  if (String(lease.environment || '').trim().toLowerCase() !== String(review?.environment || 'non-production').trim().toLowerCase()) blockers.push('Provider proof lease belongs to a different environment.');
  if (!DIGEST.test(String(lease.metadataDigest || ''))) blockers.push('Provider proof lease metadata digest is invalid.');

  const maxAgeSeconds = Number(lease.maxAgeSeconds);
  const renewWindowSeconds = Number(lease.renewWindowSeconds);
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < MIN_LEASE_SECONDS || maxAgeSeconds > MAX_LEASE_SECONDS) blockers.push('Provider proof lease duration is invalid.');
  if (!Number.isInteger(renewWindowSeconds) || renewWindowSeconds < MIN_RENEW_WINDOW_SECONDS || renewWindowSeconds >= maxAgeSeconds) blockers.push('Provider proof renewal window is invalid.');

  const observedAtMs = Date.parse(String(lease.observedAt || ''));
  const expiresAtMs = Date.parse(String(lease.expiresAt || ''));
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs !== observedAtMs + maxAgeSeconds * 1000) blockers.push('Provider proof lease expiry does not match its reviewed duration.');

  const payload = { ...lease };
  delete payload.leaseDigest;
  if (!DIGEST.test(String(lease.leaseDigest || '')) || digest(payload) !== lease.leaseDigest) blockers.push('Provider proof lease integrity verification failed.');
  return { valid: blockers.length === 0, blockers, observedAtMs, expiresAtMs };
}

function evaluateProviderProofLease(review, lease = {}, now = Date.now()) {
  const check = validateLeaseIntegrity(review, lease);
  if (!check.valid) return Object.freeze({ state: 'BLOCKED', canUseForBusinessTraffic: false, blockers: check.blockers, nextAction: 'Run a bounded metadata-only provider proof for the exact reviewed connection.' });
  if (check.observedAtMs > now + MAX_CLOCK_SKEW_MS) {
    return Object.freeze({ state: 'BLOCKED', canUseForBusinessTraffic: false, blockers: ['Provider proof lease observation time is unreasonably in the future.'], nextAction: 'Run the safe provider proof again with a trusted clock.' });
  }
  if (check.expiresAtMs <= now) {
    return Object.freeze({ state: 'REPROOF_REQUIRED', canUseForBusinessTraffic: false, blockers: ['Provider identity proof has expired.'], nextAction: 'Refresh the bounded metadata proof; customer re-approval is unnecessary if the exact reviewed connection and metadata digest are unchanged.' });
  }
  const renewAtMs = check.expiresAtMs - Number(lease.renewWindowSeconds) * 1000;
  if (now >= renewAtMs) {
    return Object.freeze({ state: 'REPROOF_DUE', canUseForBusinessTraffic: true, blockers: [], nextAction: 'Refresh the bounded metadata proof before it expires.' });
  }
  return Object.freeze({ state: 'CURRENT', canUseForBusinessTraffic: true, blockers: [], nextAction: 'No provider re-proof action required.' });
}

function renewProviderProofLease(review, priorLease, verifiedProof, options = {}, now = Date.now()) {
  const prior = validateLeaseIntegrity(review, priorLease);
  if (!prior.valid) throw new Error('Cannot renew an invalid provider proof lease: ' + prior.blockers.join(' '));
  const next = createProviderProofLease(review, verifiedProof, {
    maxAgeSeconds: options.maxAgeSeconds ?? priorLease.maxAgeSeconds,
    renewWindowSeconds: options.renewWindowSeconds ?? priorLease.renewWindowSeconds
  }, now);
  const nextObservedAtMs = Date.parse(next.observedAt);
  if (nextObservedAtMs < prior.observedAtMs) throw new Error('Provider re-proof cannot move backwards in observation time.');
  const metadataUnchanged = next.metadataDigest === priorLease.metadataDigest;
  return Object.freeze({
    lease: next,
    approvalDisposition: metadataUnchanged ? 'PRESERVE_EXISTING_APPROVAL' : 'REVIEW_REQUIRED',
    mappingReviewRequired: !metadataUnchanged,
    priorLeaseDigest: priorLease.leaseDigest,
    renewalDigest: digest({ priorLeaseDigest: priorLease.leaseDigest, nextLeaseDigest: next.leaseDigest, metadataUnchanged })
  });
}

module.exports = {
  createProviderProofLease,
  evaluateProviderProofLease,
  renewProviderProofLease
};
