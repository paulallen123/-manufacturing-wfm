'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { verifyScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');
const { enumerateReachablePaths } = require('./adaptive-scoping-graph.cjs');

const ACTION_TYPES = new Set(['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP']);

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

function semanticOperation(operation) {
  const next = {};
  for (const [key, value] of Object.entries(operation || {})) {
    if (key === 'answerSource') continue;
    next[key] = value;
  }
  return next;
}

function normaliseOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    fail('WFM_SCOPE_NOT_ACTIONABLE', 'Final scope must contain machine-actionable operations.', 400);
  }
  const normalised = operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || !ACTION_TYPES.has(operation.type)) {
      fail('WFM_SCOPE_OPERATION_INVALID', `Scope operation ${index} is not machine-actionable.`, 400);
    }
    if (!operation.key && operation.type !== 'NO_OP') {
      fail('WFM_SCOPE_OPERATION_INVALID', `Scope operation ${index} requires a key.`, 400);
    }
    return semanticOperation(operation);
  });
  return normalised.sort((a, b) => stable(a).localeCompare(stable(b)));
}

function normaliseFinalScope(scope) {
  if (!scope || typeof scope !== 'object') fail('WFM_SCOPE_REQUIRED', 'Final adaptive scope is required.', 400);
  const graphVersion = requiredString(scope.graphVersion, 'WFM_SCOPE_VERSION_REQUIRED', 'Scope graph version is required.');
  const graphFingerprint = requiredString(scope.graphFingerprint, 'WFM_SCOPE_FINGERPRINT_REQUIRED', 'Scope graph fingerprint is required.').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(graphFingerprint)) fail('WFM_SCOPE_FINGERPRINT_INVALID', 'Scope graph fingerprint must be SHA-256.', 400);
  const revision = requiredString(scope.revision, 'WFM_SCOPE_REVISION_REQUIRED', 'Scope revision is required.');
  if (!Array.isArray(scope.purchasedScope)) fail('WFM_SCOPE_PURCHASE_REQUIRED', 'Purchased scope is required.', 400);
  if (!Array.isArray(scope.questions) || scope.questions.length !== 0) {
    fail('WFM_SCOPE_INCOMPLETE', 'Finalization requires a terminal scope with no unanswered questions.', 409);
  }
  if (!scope.answers || typeof scope.answers !== 'object' || Array.isArray(scope.answers)) {
    fail('WFM_SCOPE_ANSWERS_REQUIRED', 'Finalization requires the active answer set.', 400);
  }
  const operations = normaliseOperations(scope.operations);
  return {
    graphVersion,
    graphFingerprint,
    revision,
    purchasedScope: [...new Set(scope.purchasedScope.map(String))].sort(),
    answers: JSON.parse(JSON.stringify(scope.answers)),
    provenance: scope.provenance && typeof scope.provenance === 'object' && !Array.isArray(scope.provenance) ? JSON.parse(JSON.stringify(scope.provenance)) : {},
    operations,
    operationsDigest: sha256(operations)
  };
}

function graphIdentity(compiled) {
  if (!compiled || typeof compiled !== 'object') fail('WFM_SCOPE_GRAPH_REQUIRED', 'Compiled scoping graph is required.', 400);
  const graphVersion = requiredString(compiled.version, 'WFM_SCOPE_VERSION_REQUIRED', 'Scope graph version is required.');
  const graphFingerprint = requiredString(compiled.graphFingerprint, 'WFM_SCOPE_FINGERPRINT_REQUIRED', 'Scope graph fingerprint is required.').toLowerCase();
  return { graphVersion, graphFingerprint };
}

function assertReachable(compiled, scope, pathEnumerator = enumerateReachablePaths) {
  if (typeof pathEnumerator !== 'function') fail('WFM_SCOPE_ENUMERATOR_REQUIRED', 'Reachable-path enumerator is required.', 500);
  const identity = graphIdentity(compiled);
  if (identity.graphVersion !== scope.graphVersion || identity.graphFingerprint !== scope.graphFingerprint) {
    fail('WFM_SCOPE_FINALIZATION_GRAPH_MISMATCH', 'Final scope does not match the compiled graph being attested.', 409);
  }
  const paths = pathEnumerator(compiled, scope.purchasedScope);
  if (!Array.isArray(paths) || paths.length === 0) fail('WFM_SCOPE_FINALIZATION_UNREACHABLE', 'No reachable terminal path exists for this purchased scope.', 409);

  const expectedAnswers = stable(scope.answers);
  const expectedOperations = stable(scope.operations);
  const matched = paths.some(path => {
    if (!path || !Array.isArray(path.questions) || path.questions.length !== 0) return false;
    const pathOperations = normaliseOperations(path.operations);
    return stable(path.answers || {}) === expectedAnswers && stable(pathOperations) === expectedOperations;
  });
  if (!matched) fail('WFM_SCOPE_FINALIZATION_UNREACHABLE', 'Final scope does not match any reachable terminal path in the proven graph.', 409);
}

function createScopeFinalizationReceipt(compiled, evaluation, releaseReceipt, { proofKey, enumerateReachablePaths: pathEnumerator = enumerateReachablePaths } = {}) {
  const scope = normaliseFinalScope(evaluation);
  const identity = graphIdentity(compiled);
  const verifiedRelease = verifyScopeReleaseReceipt(releaseReceipt, identity, proofKey);
  assertReachable(compiled, scope, pathEnumerator);

  const core = {
    schemaVersion: 1,
    verifier: 'adaptive-scoping-finalization-v1',
    releaseProofDigest: verifiedRelease.proofDigest,
    graphVersion: scope.graphVersion,
    graphFingerprint: scope.graphFingerprint,
    revision: scope.revision,
    purchasedScope: scope.purchasedScope,
    operationsDigest: scope.operationsDigest,
    answersDigest: sha256(scope.answers),
    provenanceDigest: sha256(scope.provenance)
  };
  return Object.freeze({
    ...core,
    finalizationDigest: sha256(core),
    releaseReceipt: JSON.parse(JSON.stringify(releaseReceipt)),
    mac: hmac(core, proofKey)
  });
}

function verifyScopeFinalizationReceipt(receipt, expectedScope, proofKey) {
  if (!receipt || typeof receipt !== 'object') fail('WFM_SCOPE_FINALIZATION_PROOF_REQUIRED', 'Verified final scope proof is required.', 403);
  const expected = {
    graphVersion: requiredString(expectedScope && expectedScope.graphVersion, 'WFM_SCOPE_VERSION_REQUIRED', 'Expected scope graph version is required.'),
    graphFingerprint: requiredString(expectedScope && expectedScope.graphFingerprint, 'WFM_SCOPE_FINGERPRINT_REQUIRED', 'Expected scope graph fingerprint is required.').toLowerCase(),
    revision: requiredString(expectedScope && expectedScope.revision, 'WFM_SCOPE_REVISION_REQUIRED', 'Expected scope revision is required.'),
    purchasedScope: Array.isArray(expectedScope && expectedScope.purchasedScope) ? [...new Set(expectedScope.purchasedScope.map(String))].sort() : null,
    operationsDigest: requiredString(expectedScope && expectedScope.operationsDigest, 'WFM_SCOPE_OPERATIONS_DIGEST_REQUIRED', 'Expected scope operations digest is required.').toLowerCase()
  };
  if (!Array.isArray(expected.purchasedScope)) fail('WFM_SCOPE_PURCHASE_REQUIRED', 'Expected purchased scope is required.', 400);

  const verifiedRelease = verifyScopeReleaseReceipt(receipt.releaseReceipt, {
    graphVersion: expected.graphVersion,
    graphFingerprint: expected.graphFingerprint
  }, proofKey);

  const core = {
    schemaVersion: receipt.schemaVersion,
    verifier: receipt.verifier,
    releaseProofDigest: String(receipt.releaseProofDigest || '').toLowerCase(),
    graphVersion: receipt.graphVersion,
    graphFingerprint: String(receipt.graphFingerprint || '').toLowerCase(),
    revision: receipt.revision,
    purchasedScope: Array.isArray(receipt.purchasedScope) ? [...new Set(receipt.purchasedScope.map(String))].sort() : null,
    operationsDigest: String(receipt.operationsDigest || '').toLowerCase(),
    answersDigest: String(receipt.answersDigest || '').toLowerCase(),
    provenanceDigest: String(receipt.provenanceDigest || '').toLowerCase()
  };

  if (core.schemaVersion !== 1 || core.verifier !== 'adaptive-scoping-finalization-v1') {
    fail('WFM_SCOPE_FINALIZATION_SCHEMA_INVALID', 'Final scope proof schema or verifier is not trusted.', 403);
  }
  if (core.releaseProofDigest !== verifiedRelease.proofDigest) {
    fail('WFM_SCOPE_FINALIZATION_RELEASE_MISMATCH', 'Final scope proof is detached from the proven graph release.', 409);
  }
  if (core.graphVersion !== expected.graphVersion || core.graphFingerprint !== expected.graphFingerprint || core.revision !== expected.revision || stable(core.purchasedScope) !== stable(expected.purchasedScope) || core.operationsDigest !== expected.operationsDigest) {
    fail('WFM_SCOPE_FINALIZATION_SUBJECT_MISMATCH', 'Final scope proof does not match the exact scope revision being provisioned.', 409);
  }
  if (!/^[a-f0-9]{64}$/.test(core.answersDigest) || !/^[a-f0-9]{64}$/.test(core.provenanceDigest)) {
    fail('WFM_SCOPE_FINALIZATION_PROOF_INVALID', 'Final scope proof is incomplete.', 403);
  }

  const finalizationDigest = sha256(core);
  if (String(receipt.finalizationDigest || '').toLowerCase() !== finalizationDigest) {
    fail('WFM_SCOPE_FINALIZATION_DIGEST_MISMATCH', 'Final scope proof digest changed after finalization.', 409);
  }
  const expectedMac = hmac(core, proofKey);
  const actualMac = String(receipt.mac || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actualMac) || !timingSafeEqual(Buffer.from(actualMac, 'hex'), Buffer.from(expectedMac, 'hex'))) {
    fail('WFM_SCOPE_FINALIZATION_PROOF_INVALID', 'Final scope proof signature is invalid.', 403);
  }

  return Object.freeze({
    ok: true,
    finalizationDigest,
    releaseProofDigest: verifiedRelease.proofDigest,
    graphVersion: expected.graphVersion,
    graphFingerprint: expected.graphFingerprint,
    revision: expected.revision,
    purchasedScope: expected.purchasedScope,
    operationsDigest: expected.operationsDigest
  });
}

module.exports = {
  createScopeFinalizationReceipt,
  verifyScopeFinalizationReceipt,
  normaliseFinalScope,
  sha256,
  stable
};