'use strict';

const { createHash } = require('node:crypto');
const { createProvisioningOutbox } = require('./provisioning-outbox.cjs');
const { verifyScopeFinalizationReceipt } = require('./adaptive-scoping-finalization-receipt.cjs');

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

function requireDigest(value, code, message) {
  const digest = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(code, message, 400);
  return digest;
}

function verifyAttestedScope(intent, scopeProofKey, verifier = verifyScopeFinalizationReceipt) {
  if (!intent || typeof intent !== 'object' || !intent.scope || typeof intent.scope !== 'object') {
    fail('WFM_SCOPE_ADMISSION_INTENT_REQUIRED', 'Provisioning admission requires a sealed intent with final scope.', 400);
  }
  if (!scopeProofKey) fail('WFM_SCOPE_ADMISSION_KEY_REQUIRED', 'Trusted final-scope proof verification key is required.', 500);
  if (typeof verifier !== 'function') fail('WFM_SCOPE_ADMISSION_VERIFIER_REQUIRED', 'Final-scope proof verifier is required.', 500);

  const evidence = intent.scopeFinalizationEvidence;
  if (!evidence || typeof evidence !== 'object' || !evidence.verificationReceipt || typeof evidence.verificationReceipt !== 'object') {
    fail('WFM_SCOPE_FINALIZATION_PROOF_REQUIRED', 'Durable provisioning admission requires verified final-scope proof.', 403);
  }

  const declaredFinalizationDigest = requireDigest(
    evidence.finalizationDigest,
    'WFM_SCOPE_FINALIZATION_DIGEST_REQUIRED',
    'Final-scope proof digest is required for provisioning admission.'
  );
  const verified = verifier(evidence.verificationReceipt, intent.scope, scopeProofKey);
  if (!verified || verified.ok !== true) {
    fail('WFM_SCOPE_FINALIZATION_PROOF_INVALID', 'Final-scope proof was not accepted by the trusted verifier.', 403);
  }
  if (String(verified.finalizationDigest || '').toLowerCase() !== declaredFinalizationDigest) {
    fail('WFM_SCOPE_FINALIZATION_DIGEST_MISMATCH', 'Final-scope proof digest changed before provisioning admission.', 409);
  }

  const receiptSha256 = sha256(evidence.verificationReceipt);
  if (evidence.receiptSha256 != null) {
    const declaredReceiptDigest = requireDigest(
      evidence.receiptSha256,
      'WFM_SCOPE_FINALIZATION_RECEIPT_DIGEST_INVALID',
      'Final-scope receipt digest must be SHA-256.'
    );
    if (declaredReceiptDigest !== receiptSha256) {
      fail('WFM_SCOPE_FINALIZATION_RECEIPT_DIGEST_MISMATCH', 'Final-scope receipt changed after it was attached to provisioning.', 409);
    }
  }

  const binding = intent.scopeProofBinding;
  if (!binding || typeof binding !== 'object') {
    fail('WFM_SCOPE_FINALIZATION_BINDING_REQUIRED', 'Provisioning requires the final-scope proof to be bound to the sealed launch intent.', 403);
  }
  const boundFinalizationDigest = requireDigest(
    binding.finalizationDigest,
    'WFM_SCOPE_FINALIZATION_BINDING_INVALID',
    'Bound final-scope digest must be SHA-256.'
  );
  const boundReceiptSha256 = requireDigest(
    binding.receiptSha256,
    'WFM_SCOPE_FINALIZATION_BINDING_INVALID',
    'Bound final-scope receipt digest must be SHA-256.'
  );
  const subjectDigest = requireDigest(
    binding.subjectDigest,
    'WFM_SCOPE_FINALIZATION_BINDING_INVALID',
    'Bound launch subject digest must be SHA-256.'
  );
  const launchIntentDigest = requireDigest(
    intent.intentDigest,
    'WFM_SCOPE_FINALIZATION_BINDING_INVALID',
    'Sealed launch intent digest must be SHA-256 before scope proof binding can be checked.'
  );
  const expectedSubjectDigest = sha256({
    launchIntentDigest,
    finalizationDigest: declaredFinalizationDigest,
    receiptSha256
  });
  if (
    boundFinalizationDigest !== declaredFinalizationDigest ||
    boundReceiptSha256 !== receiptSha256 ||
    subjectDigest !== expectedSubjectDigest
  ) {
    fail('WFM_SCOPE_FINALIZATION_BINDING_MISMATCH', 'Final-scope proof is not bound to this exact sealed launch intent.', 409);
  }

  return Object.freeze({
    ok: true,
    finalizationDigest: declaredFinalizationDigest,
    receiptSha256,
    subjectDigest,
    graphVersion: verified.graphVersion,
    graphFingerprint: verified.graphFingerprint,
    revision: verified.revision,
    purchasedScope: Array.isArray(verified.purchasedScope) ? [...verified.purchasedScope] : [],
    operationsDigest: verified.operationsDigest
  });
}

function createScopeAttestedProvisioningOutbox(store, options = {}) {
  const {
    scopeProofKey,
    scopeVerifier = verifyScopeFinalizationReceipt,
    baseOutboxFactory = createProvisioningOutbox,
    ...baseOptions
  } = options;
  if (!scopeProofKey) throw new Error('Scope-attested provisioning requires a trusted final-scope proof verification key.');
  if (typeof scopeVerifier !== 'function') throw new Error('Scope-attested provisioning requires a final-scope proof verifier.');
  if (typeof baseOutboxFactory !== 'function') throw new Error('Scope-attested provisioning requires a durable outbox factory.');

  const base = baseOutboxFactory(store, baseOptions);
  if (
    !base ||
    typeof base.enqueue !== 'function' ||
    typeof base.get !== 'function' ||
    typeof base.claim !== 'function' ||
    typeof base.beginMutation !== 'function' ||
    typeof base.recordProviderOutcome !== 'function' ||
    typeof base.recordReconciliation !== 'function' ||
    typeof base.recordIndependentVerification !== 'function'
  ) {
    throw new Error('Scope-attested provisioning requires the standard durable provisioning outbox interface.');
  }

  function verifyIntent(intent) {
    return verifyAttestedScope(intent, scopeProofKey, scopeVerifier);
  }

  function verifyStored(queueKey) {
    const record = base.get(queueKey);
    if (!record || !record.payload) fail('WFM_SCOPE_ADMISSION_RECORD_REQUIRED', 'Provisioning queue record or sealed payload is missing.', 409);
    return { record, verifiedScope: verifyIntent(record.payload) };
  }

  function withScopeProof(result, verifiedScope) {
    return {
      ...result,
      scopeFinalizationDigest: verifiedScope.finalizationDigest,
      scopeFinalizationReceiptSha256: verifiedScope.receiptSha256,
      scopeProofSubjectDigest: verifiedScope.subjectDigest
    };
  }

  function enqueue(intent) {
    const verifiedScope = verifyIntent(intent);
    const existing = intent && intent.queueKey ? base.get(intent.queueKey) : null;
    if (existing && existing.payload) {
      const storedScope = verifyIntent(existing.payload);
      if (storedScope.subjectDigest !== verifiedScope.subjectDigest) {
        fail('WFM_SCOPE_FINALIZATION_BINDING_DRIFT', 'This provisioning identity is already bound to a different finalized scope proof.', 409);
      }
    }

    const result = base.enqueue(intent);
    const effectiveScope = result.duplicate && result.record && result.record.payload
      ? verifyIntent(result.record.payload)
      : verifiedScope;
    return withScopeProof(result, effectiveScope);
  }

  function claim(queueKey, workerId) {
    verifyStored(queueKey);
    return base.claim(queueKey, workerId);
  }

  function beginMutation(token) {
    if (!token || typeof token !== 'object' || !token.queueKey) {
      fail('WFM_SCOPE_ADMISSION_TOKEN_REQUIRED', 'Provisioning mutation requires a queue token.', 400);
    }
    verifyStored(token.queueKey);
    return base.beginMutation(token);
  }

  function recordProviderOutcome(token, outcome = {}) {
    if (!token || typeof token !== 'object' || !token.queueKey) {
      fail('WFM_SCOPE_ADMISSION_TOKEN_REQUIRED', 'Provisioning outcome requires a queue token.', 400);
    }
    const { verifiedScope } = verifyStored(token.queueKey);
    return withScopeProof(base.recordProviderOutcome(token, outcome), verifiedScope);
  }

  function recordReconciliation(queueKey, result = {}) {
    const { verifiedScope } = verifyStored(queueKey);
    return withScopeProof(base.recordReconciliation(queueKey, result), verifiedScope);
  }

  function recordIndependentVerification(queueKey, verification = {}) {
    const { verifiedScope } = verifyStored(queueKey);
    const suppliedDigest = requireDigest(
      verification.scopeFinalizationDigest,
      'WFM_SCOPE_FINALIZATION_VERIFICATION_DIGEST_REQUIRED',
      'Independent readiness verification must identify the exact finalized scope proof.'
    );
    if (suppliedDigest !== verifiedScope.finalizationDigest) {
      fail('WFM_SCOPE_FINALIZATION_VERIFICATION_MISMATCH', 'Independent readiness verification is detached from the finalized scope being provisioned.', 409);
    }

    const checks = {
      ...(verification.checks || {}),
      scopeFinalizationVerified: true,
      scopeFinalizationDigest: verifiedScope.finalizationDigest,
      scopeFinalizationReceiptSha256: verifiedScope.receiptSha256,
      scopeProofSubjectDigest: verifiedScope.subjectDigest
    };
    const result = base.recordIndependentVerification(queueKey, { ...verification, checks });
    return withScopeProof(result, verifiedScope);
  }

  return {
    ...base,
    enqueue,
    claim,
    beginMutation,
    recordProviderOutcome,
    recordReconciliation,
    recordIndependentVerification
  };
}

module.exports = {
  createScopeAttestedProvisioningOutbox,
  verifyAttestedScope,
  sha256,
  stable
};
