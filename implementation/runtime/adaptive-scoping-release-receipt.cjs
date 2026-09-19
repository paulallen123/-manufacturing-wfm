'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { proveEveryDeclaredReachablePath } = require('./adaptive-scoping-exhaustive-proof.cjs');

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requiredString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function proofKeyBuffer(proofKey) {
  if (Buffer.isBuffer(proofKey) && proofKey.length >= 32) return proofKey;
  if (typeof proofKey === 'string' && Buffer.byteLength(proofKey, 'utf8') >= 32) return Buffer.from(proofKey, 'utf8');
  fail('WFM_SCOPE_PROOF_KEY_REQUIRED', 'Trusted scoping proof key of at least 32 bytes is required.', 500);
}

function hmac(core, proofKey) {
  return createHmac('sha256', proofKeyBuffer(proofKey)).update(stable(core)).digest('hex');
}

function normaliseGraphIdentity(compiled) {
  if (!compiled || typeof compiled !== 'object') fail('WFM_SCOPE_GRAPH_REQUIRED', 'Compiled scoping graph is required.', 400);
  const graphVersion = requiredString(compiled.version, 'WFM_SCOPE_VERSION_REQUIRED', 'Scope graph version is required.');
  const graphFingerprint = requiredString(compiled.graphFingerprint, 'WFM_SCOPE_FINGERPRINT_REQUIRED', 'Scope graph fingerprint is required.').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(graphFingerprint)) fail('WFM_SCOPE_FINGERPRINT_INVALID', 'Scope graph fingerprint must be SHA-256.', 400);
  return { graphVersion, graphFingerprint };
}

function createScopeReleaseReceipt(compiled, { proofKey, proveGraph = proveEveryDeclaredReachablePath, ...proofOptions } = {}) {
  if (typeof proveGraph !== 'function') fail('WFM_SCOPE_PROVER_REQUIRED', 'Exhaustive scoping prover is required.', 500);
  const { graphVersion, graphFingerprint } = normaliseGraphIdentity(compiled);
  const proof = proveGraph(compiled, proofOptions);
  if (!proof || !Array.isArray(proof.declaredScopes) || !Number.isInteger(proof.purchasedScopeVariants) || proof.purchasedScopeVariants < 1 || !Number.isInteger(proof.terminalPaths) || proof.terminalPaths < 1) {
    fail('WFM_SCOPE_PROOF_INVALID', 'Exhaustive scoping proof did not return a complete proof summary.', 500);
  }

  const core = {
    schemaVersion: 1,
    verifier: 'adaptive-scoping-exhaustive-proof-v1',
    graphVersion,
    graphFingerprint,
    declaredScopes: [...proof.declaredScopes].map(String).sort(),
    purchasedScopeVariants: proof.purchasedScopeVariants,
    terminalPaths: proof.terminalPaths
  };
  return Object.freeze({
    ...core,
    proofDigest: sha256(core),
    mac: hmac(core, proofKey)
  });
}

function verifyScopeReleaseReceipt(receipt, expected, proofKey) {
  if (!receipt || typeof receipt !== 'object') fail('WFM_SCOPE_PROOF_REQUIRED', 'Verified scoping release proof is required.', 403);
  const graphVersion = requiredString(expected && expected.graphVersion, 'WFM_SCOPE_VERSION_REQUIRED', 'Expected scope graph version is required.');
  const graphFingerprint = requiredString(expected && expected.graphFingerprint, 'WFM_SCOPE_FINGERPRINT_REQUIRED', 'Expected scope graph fingerprint is required.').toLowerCase();
  const core = {
    schemaVersion: receipt.schemaVersion,
    verifier: receipt.verifier,
    graphVersion: receipt.graphVersion,
    graphFingerprint: String(receipt.graphFingerprint || '').toLowerCase(),
    declaredScopes: Array.isArray(receipt.declaredScopes) ? [...receipt.declaredScopes].map(String).sort() : null,
    purchasedScopeVariants: receipt.purchasedScopeVariants,
    terminalPaths: receipt.terminalPaths
  };

  if (core.schemaVersion !== 1 || core.verifier !== 'adaptive-scoping-exhaustive-proof-v1') fail('WFM_SCOPE_PROOF_SCHEMA_INVALID', 'Scoping release proof schema or verifier is not trusted.', 403);
  if (!Array.isArray(core.declaredScopes) || !Number.isInteger(core.purchasedScopeVariants) || core.purchasedScopeVariants < 1 || !Number.isInteger(core.terminalPaths) || core.terminalPaths < 1) {
    fail('WFM_SCOPE_PROOF_INVALID', 'Scoping release proof summary is incomplete.', 403);
  }
  if (core.graphVersion !== graphVersion || core.graphFingerprint !== graphFingerprint) {
    fail('WFM_SCOPE_PROOF_SUBJECT_MISMATCH', 'Scoping proof does not cover the exact graph version and fingerprint being provisioned.', 409);
  }

  const proofDigest = sha256(core);
  if (String(receipt.proofDigest || '').toLowerCase() !== proofDigest) fail('WFM_SCOPE_PROOF_DIGEST_MISMATCH', 'Scoping release proof digest changed after verification.', 409);
  const expectedMac = hmac(core, proofKey);
  const actualMac = String(receipt.mac || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actualMac) || !timingSafeEqual(Buffer.from(actualMac, 'hex'), Buffer.from(expectedMac, 'hex'))) {
    fail('WFM_SCOPE_PROOF_INVALID', 'Scoping release proof signature is invalid.', 403);
  }

  return Object.freeze({ ok: true, graphVersion, graphFingerprint, proofDigest });
}

module.exports = {
  createScopeReleaseReceipt,
  verifyScopeReleaseReceipt,
  sha256,
  stable
};
