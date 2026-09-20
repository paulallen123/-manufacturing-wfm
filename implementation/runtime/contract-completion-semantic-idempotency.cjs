'use strict';

const { createHash } = require('node:crypto');
const {
  createContractCompletionIngress,
  verifyContractCompletionReceipt
} = require('./contract-completion-ingress.cjs');

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

function semanticSubject(contract) {
  return {
    provider: requiredString(contract.provider, 'WFM_CONTRACT_PROVIDER_REQUIRED', 'Contract provider is required.'),
    contractId: requiredString(contract.contractId, 'WFM_CONTRACT_ID_REQUIRED', 'Contract id is required.'),
    contractVersion: requiredString(contract.contractVersion, 'WFM_CONTRACT_VERSION_REQUIRED', 'Contract version is required.')
  };
}

function semanticIdentity(contract) {
  const receipt = contract && contract.verificationReceipt;
  if (!receipt || typeof receipt !== 'object' || !/^[a-f0-9]{64}$/i.test(String(receipt.payloadSha256 || ''))) {
    fail('WFM_CONTRACT_RECEIPT_PAYLOAD_DIGEST_REQUIRED', 'Verified contract receipt must include the authenticated payload SHA-256.', 403);
  }
  return {
    ...semanticSubject(contract),
    tenantId: requiredString(contract.tenantId, 'WFM_TENANT_REQUIRED', 'Tenant id is required.'),
    completedAt: requiredString(contract.completedAt, 'WFM_CONTRACT_COMPLETED_AT_REQUIRED', 'Contract completion time is required.'),
    status: requiredString(contract.status, 'WFM_CONTRACT_STATUS_REQUIRED', 'Contract status is required.').toLowerCase(),
    payloadSha256: String(receipt.payloadSha256).toLowerCase()
  };
}

function createSemanticContractCompletionIngress(store, options = {}) {
  if (!store || store.durability !== 'DURABLE_TRANSACTIONAL' || typeof store.transaction !== 'function') {
    throw new Error('Semantic contract idempotency requires the same durable transactional store as contract ingress.');
  }
  const baseFactory = options.baseIngressFactory || createContractCompletionIngress;
  if (typeof baseFactory !== 'function') throw new Error('Semantic contract idempotency requires a base contract ingress factory.');
  const { baseIngressFactory, ...baseOptions } = options;
  const base = baseFactory(store, baseOptions);
  if (!base || typeof base.receive !== 'function') throw new Error('Semantic contract idempotency requires the standard contract ingress interface.');

  function receive(delivery) {
    const accepted = base.receive(delivery);
    if (!accepted || !accepted.contract) fail('WFM_CONTRACT_EVENT_REQUIRED', 'Contract ingress did not return a verified completed contract.', 500);
    verifyContractCompletionReceipt(accepted.contract, options.receiptKey);

    const subject = semanticSubject(accepted.contract);
    const identity = semanticIdentity(accepted.contract);
    const semanticDigest = sha256(identity);
    const key = 'wfm-contract-subject:v1:' + sha256(subject);

    return store.transaction(tx => {
      const existing = tx.get(key);
      if (existing) {
        if (existing.semanticDigest !== semanticDigest) {
          fail('WFM_CONTRACT_VERSION_DRIFT', 'The same contract version was authenticated with different tenant, completion or payload data.', 409);
        }
        return {
          duplicate: true,
          semanticDuplicate: true,
          key,
          contract: clone(existing.contract)
        };
      }

      tx.insert(key, {
        key,
        semanticDigest,
        subject: clone(subject),
        firstEventId: accepted.contract.eventId,
        contract: clone(accepted.contract)
      });
      return {
        ...accepted,
        semanticDuplicate: false,
        semanticKey: key
      };
    });
  }

  return { receive };
}

module.exports = {
  createSemanticContractCompletionIngress,
  semanticIdentity,
  semanticSubject,
  sha256,
  stable
};
