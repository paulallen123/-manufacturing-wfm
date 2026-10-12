'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_PROOF_CARRYING_STATE_V1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 50, maxLen = 220) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => text(item, maxLen)).filter(Boolean))].slice(0, max);
}

function releaseSha(value) {
  const sha = text(value, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    const error = new Error('Exact 40-character release SHA is required for proof-carrying state.');
    error.statusCode = 409;
    error.reasonCode = 'RELEASE_IDENTITY_UNPROVEN';
    throw error;
  }
  return sha;
}

function nonEmpty(value, name, max = 240) {
  const result = text(value, max);
  if (!result) {
    const error = new Error(name + ' is required for proof-carrying state.');
    error.statusCode = 409;
    error.reasonCode = 'PROOF_BINDING_INCOMPLETE';
    throw error;
  }
  return result;
}

function normaliseScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    const error = new Error('Decision scope is required for proof-carrying state.');
    error.statusCode = 409;
    error.reasonCode = 'PROOF_SCOPE_MISSING';
    throw error;
  }
  const copy = clone(scope);
  if (!Object.keys(copy).length) {
    const error = new Error('Decision scope cannot be empty.');
    error.statusCode = 409;
    error.reasonCode = 'PROOF_SCOPE_MISSING';
    throw error;
  }
  return copy;
}

function createProofCarryingState(input = {}) {
  const tenant = nonEmpty(input.tenant, 'tenant', 120);
  const actorRef = nonEmpty(input.actorRef, 'actorRef', 180);
  const actorAuthority = nonEmpty(input.actorAuthority, 'actorAuthority', 100).toUpperCase();
  const sourceRevision = nonEmpty(input.sourceRevision, 'sourceRevision', 240);
  const exactReleaseSha = releaseSha(input.releaseSha);
  const decisionRef = nonEmpty(input.decisionRef, 'decisionRef', 200);
  const scope = normaliseScope(input.scope);
  const evidenceRefs = list(input.evidenceRefs, 80, 240);
  if (!evidenceRefs.length) {
    const error = new Error('At least one evidence reference is required for proof-carrying state.');
    error.statusCode = 409;
    error.reasonCode = 'PROOF_EVIDENCE_MISSING';
    throw error;
  }
  const createdAt = (() => {
    const raw = nonEmpty(input.createdAt, 'createdAt', 80);
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      const error = new Error('Valid proof timestamp is required.');
      error.statusCode = 409;
      error.reasonCode = 'PROOF_TIMESTAMP_INVALID';
      throw error;
    }
    return new Date(ms).toISOString();
  })();
  const payload = {
    contractVersion: CONTRACT_VERSION,
    tenant,
    actorRef,
    actorAuthority,
    decisionRef,
    sourceRevision,
    releaseSha: exactReleaseSha,
    scope,
    scopeDigest: digest(scope),
    evidenceRefs,
    createdAt
  };
  return Object.freeze({ ...clone(payload), proofDigest: digest(payload) });
}

function inspectProofCarryingState(proof, current = {}) {
  const reasons = [];
  if (!proof || proof.contractVersion !== CONTRACT_VERSION) {
    return { current: false, reasons: ['PROOF_CONTRACT_INVALID'] };
  }
  const expectedDigest = proof.proofDigest;
  const payload = { ...clone(proof) };
  delete payload.proofDigest;
  if (digest(payload) !== expectedDigest) reasons.push('PROOF_DIGEST_MISMATCH');

  const expectedTenant = text(current.tenant, 120);
  if (!expectedTenant) reasons.push('CURRENT_TENANT_MISSING');
  else if (proof.tenant !== expectedTenant) reasons.push('TENANT_CHANGED');

  const expectedRevision = text(current.sourceRevision, 240);
  if (!expectedRevision) reasons.push('CURRENT_SOURCE_REVISION_MISSING');
  else if (proof.sourceRevision !== expectedRevision) reasons.push('SOURCE_REVISION_CHANGED');

  if (current.releaseSha == null || current.releaseSha === '') reasons.push('RELEASE_IDENTITY_UNPROVEN');
  else {
    let sha = null;
    try { sha = releaseSha(current.releaseSha); } catch { reasons.push('RELEASE_IDENTITY_UNPROVEN'); }
    if (sha && proof.releaseSha !== sha) reasons.push('RELEASE_SHA_CHANGED');
  }

  if (!current.scope) reasons.push('PROOF_SCOPE_MISSING');
  else {
    let scopeDigest = null;
    try { scopeDigest = digest(normaliseScope(current.scope)); } catch { reasons.push('PROOF_SCOPE_MISSING'); }
    if (scopeDigest && proof.scopeDigest !== scopeDigest) reasons.push('DECISION_SCOPE_CHANGED');
  }

  for (const [field, code, max] of [
    ['actorRef','ACTOR_CHANGED',180],
    ['actorAuthority','ACTOR_AUTHORITY_CHANGED',100],
    ['decisionRef','DECISION_CHANGED',200]
  ]) {
    if (current[field] != null && text(current[field],max)) {
      const expected = field === 'actorAuthority' ? text(current[field],max).toUpperCase() : text(current[field],max);
      if (proof[field] !== expected) reasons.push(code);
    }
  }

  return { current: reasons.length === 0, reasons };
}

function assertProofCarryingState(proof, current = {}) {
  const result = inspectProofCarryingState(proof, current);
  if (!result.current) {
    const error = new Error('Proof-carrying state is stale or invalid: ' + result.reasons.join(', ') + '. Re-evaluate current evidence before acting.');
    error.statusCode = 409;
    error.reasonCode = result.reasons[0] || 'PROOF_STALE';
    error.reasons = result.reasons;
    throw error;
  }
  return proof;
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  stable,
  digest,
  createProofCarryingState,
  inspectProofCarryingState,
  assertProofCarryingState
});
