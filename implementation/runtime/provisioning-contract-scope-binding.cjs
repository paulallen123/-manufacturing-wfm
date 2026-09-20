'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { createScopeAttestedLaunchIntent } = require('./provisioning-launch-intent.cjs');
const { createScopeAttestedProvisioningOutbox } = require('./provisioning-scope-attested-admission.cjs');

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

function requiredDigest(value, code, message) {
  const digest = requiredString(value, code, message).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(code, message, 400);
  return digest;
}

function keyBuffer(value) {
  if (Buffer.isBuffer(value) && value.length >= 32) return Buffer.from(value);
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32) return Buffer.from(value, 'utf8');
  fail('WFM_CONTRACT_SCOPE_BINDING_KEY_REQUIRED', 'Contract-scope binding key of at least 32 bytes is required.', 500);
}

function mac(core, key) {
  return createHmac('sha256', keyBuffer(key)).update(stable(core)).digest('hex');
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || '')) || !/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  return timingSafeEqual(Buffer.from(String(actual).toLowerCase(), 'hex'), Buffer.from(String(expected).toLowerCase(), 'hex'));
}

function normaliseContractSubject(contract) {
  if (!contract || typeof contract !== 'object') {
    fail('WFM_CONTRACT_SCOPE_SUBJECT_REQUIRED', 'Authenticated completed-contract subject is required for final scope binding.', 400);
  }
  return {
    provider: requiredString(contract.provider, 'WFM_CONTRACT_PROVIDER_REQUIRED', 'Contract provider is required.'),
    contractId: requiredString(contract.contractId, 'WFM_CONTRACT_ID_REQUIRED', 'Contract id is required.'),
    contractVersion: requiredString(contract.contractVersion, 'WFM_CONTRACT_VERSION_REQUIRED', 'Contract version is required.'),
    tenantId: requiredString(contract.tenantId, 'WFM_TENANT_REQUIRED', 'Tenant id is required.'),
    completedAt: requiredString(contract.completedAt, 'WFM_CONTRACT_COMPLETED_AT_REQUIRED', 'Contract completion time is required.')
  };
}

function normaliseScopeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || !evidence.verificationReceipt || typeof evidence.verificationReceipt !== 'object') {
    fail('WFM_SCOPE_FINALIZATION_PROOF_REQUIRED', 'Verified final-scope evidence is required for contract binding.', 403);
  }
  const finalizationDigest = requiredDigest(
    evidence.finalizationDigest,
    'WFM_SCOPE_FINALIZATION_DIGEST_REQUIRED',
    'Final-scope proof digest must be SHA-256.'
  );
  const receiptSha256 = sha256(evidence.verificationReceipt);
  if (evidence.receiptSha256 != null) {
    const declared = requiredDigest(
      evidence.receiptSha256,
      'WFM_SCOPE_FINALIZATION_RECEIPT_DIGEST_INVALID',
      'Final-scope receipt digest must be SHA-256.'
    );
    if (declared !== receiptSha256) {
      fail('WFM_SCOPE_FINALIZATION_RECEIPT_DIGEST_MISMATCH', 'Final-scope receipt changed before contract binding.', 409);
    }
  }
  if (String(evidence.verificationReceipt.finalizationDigest || '').toLowerCase() !== finalizationDigest) {
    fail('WFM_SCOPE_FINALIZATION_DIGEST_MISMATCH', 'Final-scope receipt does not match its declared digest.', 409);
  }
  return { finalizationDigest, receiptSha256 };
}

function createContractScopeBinding(scopeFinalizationEvidence, contract, bindingKey) {
  const scope = normaliseScopeEvidence(scopeFinalizationEvidence);
  const contractSubject = normaliseContractSubject(contract);
  const core = {
    schemaVersion: 1,
    verifier: 'wfm-contract-scope-binding-v1',
    finalizationDigest: scope.finalizationDigest,
    finalizationReceiptSha256: scope.receiptSha256,
    contractSubjectDigest: sha256(contractSubject)
  };
  const bindingDigest = sha256(core);
  return Object.freeze({
    ...core,
    bindingDigest,
    mac: mac(core, bindingKey)
  });
}

function verifyContractScopeBinding(binding, scopeFinalizationEvidence, contract, bindingKey) {
  if (!binding || typeof binding !== 'object') {
    fail('WFM_CONTRACT_SCOPE_BINDING_REQUIRED', 'A trusted binding between the completed contract and final scope is required.', 403);
  }
  const scope = normaliseScopeEvidence(scopeFinalizationEvidence);
  const contractSubjectDigest = sha256(normaliseContractSubject(contract));
  const core = {
    schemaVersion: binding.schemaVersion,
    verifier: binding.verifier,
    finalizationDigest: String(binding.finalizationDigest || '').toLowerCase(),
    finalizationReceiptSha256: String(binding.finalizationReceiptSha256 || '').toLowerCase(),
    contractSubjectDigest: String(binding.contractSubjectDigest || '').toLowerCase()
  };
  if (core.schemaVersion !== 1 || core.verifier !== 'wfm-contract-scope-binding-v1') {
    fail('WFM_CONTRACT_SCOPE_BINDING_SCHEMA_INVALID', 'Contract-scope binding schema or verifier is not trusted.', 403);
  }
  if (
    core.finalizationDigest !== scope.finalizationDigest ||
    core.finalizationReceiptSha256 !== scope.receiptSha256
  ) {
    fail('WFM_CONTRACT_SCOPE_BINDING_SCOPE_MISMATCH', 'Contract-scope binding is detached from the exact finalized scope.', 409);
  }
  if (core.contractSubjectDigest !== contractSubjectDigest) {
    fail('WFM_CONTRACT_SCOPE_BINDING_CONTRACT_MISMATCH', 'Finalized scope belongs to a different contract or customer tenant.', 409);
  }
  const expectedDigest = sha256(core);
  if (String(binding.bindingDigest || '').toLowerCase() !== expectedDigest) {
    fail('WFM_CONTRACT_SCOPE_BINDING_DIGEST_MISMATCH', 'Contract-scope binding changed after it was issued.', 409);
  }
  const expectedMac = mac(core, bindingKey);
  if (!safeEqualHex(binding.mac, expectedMac)) {
    fail('WFM_CONTRACT_SCOPE_BINDING_INVALID', 'Contract-scope binding failed integrity verification.', 403);
  }
  return Object.freeze({
    ok: true,
    bindingDigest: expectedDigest,
    contractSubjectDigest,
    finalizationDigest: scope.finalizationDigest,
    finalizationReceiptSha256: scope.receiptSha256
  });
}

function createContractScopeBoundLaunchIntent(input, options = {}) {
  if (!options.contractScopeBindingKey) {
    fail('WFM_CONTRACT_SCOPE_BINDING_KEY_REQUIRED', 'Contract-scope binding verification key is required.', 500);
  }
  if (!input || !input.contractScopeBindingEvidence) {
    fail('WFM_CONTRACT_SCOPE_BINDING_REQUIRED', 'Contract-bound launch requires trusted contract-scope binding evidence.', 403);
  }
  const base = createScopeAttestedLaunchIntent(input, options);
  const verified = verifyContractScopeBinding(
    input.contractScopeBindingEvidence,
    base.scopeFinalizationEvidence,
    base.contract,
    options.contractScopeBindingKey
  );
  const contractBoundIntentDigest = sha256({
    launchIntentDigest: base.intentDigest,
    contractScopeBindingDigest: verified.bindingDigest
  });
  return {
    ...base,
    contractScopeBindingEvidence: clone(input.contractScopeBindingEvidence),
    contractScopeBindingDigest: verified.bindingDigest,
    contractBoundIntentDigest
  };
}

function createContractScopeBoundProvisioningOutbox(store, options = {}) {
  const {
    contractScopeBindingKey,
    baseOutboxFactory = createScopeAttestedProvisioningOutbox,
    ...baseOptions
  } = options;
  keyBuffer(contractScopeBindingKey);
  if (typeof baseOutboxFactory !== 'function') throw new Error('Contract-scope-bound provisioning requires a base outbox factory.');
  const base = baseOutboxFactory(store, baseOptions);
  if (!base || typeof base.enqueue !== 'function' || typeof base.get !== 'function' || typeof base.claim !== 'function' || typeof base.beginMutation !== 'function' || typeof base.recordIndependentVerification !== 'function') {
    throw new Error('Contract-scope-bound provisioning requires the standard scope-attested outbox interface.');
  }

  function verifyIntent(intent) {
    if (!intent || typeof intent !== 'object') fail('WFM_LAUNCH_INTENT_REQUIRED', 'Provisioning launch intent is required.', 400);
    const verified = verifyContractScopeBinding(
      intent.contractScopeBindingEvidence,
      intent.scopeFinalizationEvidence,
      intent.contract,
      contractScopeBindingKey
    );
    const declared = requiredDigest(
      intent.contractScopeBindingDigest,
      'WFM_CONTRACT_SCOPE_BINDING_DIGEST_REQUIRED',
      'Contract-scope binding digest is required on the launch intent.'
    );
    if (declared !== verified.bindingDigest) {
      fail('WFM_CONTRACT_SCOPE_BINDING_DIGEST_MISMATCH', 'Launch intent does not carry the exact contract-scope binding.', 409);
    }
    const expectedIntentDigest = sha256({
      launchIntentDigest: requiredDigest(intent.intentDigest, 'WFM_LAUNCH_INTENT_DIGEST_REQUIRED', 'Sealed launch intent digest is required.'),
      contractScopeBindingDigest: verified.bindingDigest
    });
    if (String(intent.contractBoundIntentDigest || '').toLowerCase() !== expectedIntentDigest) {
      fail('WFM_CONTRACT_SCOPE_BOUND_INTENT_MISMATCH', 'Contract-bound launch identity changed after sealing.', 409);
    }
    return { ...verified, contractBoundIntentDigest: expectedIntentDigest };
  }

  function verifyStored(queueKey) {
    const record = base.get(queueKey);
    if (!record || !record.payload) fail('WFM_CONTRACT_SCOPE_QUEUE_RECORD_REQUIRED', 'Provisioning queue record or sealed payload is missing.', 409);
    return { record, verified: verifyIntent(record.payload) };
  }

  function enqueue(intent) {
    const verified = verifyIntent(intent);
    const existing = intent && intent.queueKey ? base.get(intent.queueKey) : null;
    if (existing && existing.payload) {
      const stored = verifyIntent(existing.payload);
      if (stored.bindingDigest !== verified.bindingDigest) {
        fail('WFM_CONTRACT_SCOPE_BINDING_DRIFT', 'This provisioning identity is already bound to a different contract-scope proof.', 409);
      }
    }
    const result = base.enqueue(intent);
    return {
      ...result,
      contractScopeBindingDigest: verified.bindingDigest,
      contractSubjectDigest: verified.contractSubjectDigest,
      contractBoundIntentDigest: verified.contractBoundIntentDigest
    };
  }

  function claim(queueKey, workerId) {
    verifyStored(queueKey);
    return base.claim(queueKey, workerId);
  }

  function beginMutation(token) {
    if (!token || typeof token !== 'object' || !token.queueKey) {
      fail('WFM_CONTRACT_SCOPE_TOKEN_REQUIRED', 'Provisioning mutation requires a queue token.', 400);
    }
    verifyStored(token.queueKey);
    return base.beginMutation(token);
  }

  function recordIndependentVerification(queueKey, verification = {}) {
    const { verified } = verifyStored(queueKey);
    const supplied = requiredDigest(
      verification.contractScopeBindingDigest,
      'WFM_CONTRACT_SCOPE_VERIFICATION_DIGEST_REQUIRED',
      'Independent readiness verification must identify the exact contract-scope binding.'
    );
    if (supplied !== verified.bindingDigest) {
      fail('WFM_CONTRACT_SCOPE_VERIFICATION_MISMATCH', 'Independent readiness verification is detached from the contract-bound scope.', 409);
    }
    const checks = {
      ...(verification.checks || {}),
      contractScopeBindingVerified: true,
      contractScopeBindingDigest: verified.bindingDigest,
      contractSubjectDigest: verified.contractSubjectDigest,
      contractBoundIntentDigest: verified.contractBoundIntentDigest
    };
    const result = base.recordIndependentVerification(queueKey, { ...verification, checks });
    return {
      ...result,
      contractScopeBindingDigest: verified.bindingDigest,
      contractSubjectDigest: verified.contractSubjectDigest,
      contractBoundIntentDigest: verified.contractBoundIntentDigest
    };
  }

  return {
    ...base,
    enqueue,
    claim,
    beginMutation,
    recordIndependentVerification
  };
}

module.exports = {
  createContractScopeBinding,
  verifyContractScopeBinding,
  createContractScopeBoundLaunchIntent,
  createContractScopeBoundProvisioningOutbox,
  normaliseContractSubject,
  sha256,
  stable
};
