'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

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
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function keyBuffer(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'utf8');
  if (key.length < 32) fail('WFM_CONTRACT_RECEIPT_KEY_WEAK', 'Contract receipt key must contain at least 32 bytes.', 500);
  return key;
}

function receiptMac(core, receiptKey) {
  return createHmac('sha256', keyBuffer(receiptKey)).update(stable(core)).digest('hex');
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || '')) || !/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  return timingSafeEqual(Buffer.from(String(actual).toLowerCase(), 'hex'), Buffer.from(String(expected).toLowerCase(), 'hex'));
}

function parseAttemptTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const numeric = Number(value.trim());
    return numeric < 1e12 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('WFM_CONTRACT_EVENT_TIMESTAMP_INVALID', 'Contract completion delivery timestamp is invalid.', 400);
  return parsed;
}

function normaliseCompletedEvent(provider, eventId, verification) {
  if (!verification || verification.authenticated !== true) {
    fail('WFM_CONTRACT_EVENT_UNAUTHENTICATED', 'Contract completion delivery failed provider authentication.', 401);
  }
  const binding = verification.binding || {};
  if (binding.eventId !== true || binding.attemptTimestamp !== true || binding.rawBody !== true) {
    fail('WFM_CONTRACT_EVENT_SIGNATURE_BINDING_INCOMPLETE', 'Provider verification must bind the event id, delivery timestamp and exact body.', 401);
  }
  const event = verification.event;
  if (!event || typeof event !== 'object') fail('WFM_CONTRACT_EVENT_INVALID', 'Authenticated contract event is missing.', 400);
  if (String(event.type || '').toLowerCase() !== 'contract.completed') {
    fail('WFM_CONTRACT_EVENT_TYPE_UNSUPPORTED', 'Only completed-contract events can enter autonomous provisioning.', 409);
  }
  const contract = event.contract;
  if (!contract || typeof contract !== 'object') fail('WFM_CONTRACT_EVENT_INVALID', 'Completed-contract event is missing contract details.', 400);
  if (String(contract.status || '').toLowerCase() !== 'completed') {
    fail('WFM_CONTRACT_NOT_COMPLETED', 'Contract must be completed before provisioning.', 409);
  }
  return {
    provider,
    eventId,
    contractId: requireString(contract.contractId, 'WFM_CONTRACT_ID_REQUIRED', 'Contract id is required.'),
    contractVersion: requireString(contract.contractVersion, 'WFM_CONTRACT_VERSION_REQUIRED', 'Contract version is required.'),
    tenantId: requireString(contract.tenantId, 'WFM_TENANT_REQUIRED', 'Tenant id is required.'),
    completedAt: requireString(contract.completedAt, 'WFM_CONTRACT_COMPLETED_AT_REQUIRED', 'Contract completion time is required.'),
    status: 'completed',
    verifierKeyId: requireString(verification.keyId, 'WFM_CONTRACT_VERIFIER_KEY_REQUIRED', 'Provider verifier key identity is required.')
  };
}

function buildReceipt(contract, attemptTimestamp, payloadSha256, receiptKey, receivedAt) {
  const core = {
    schemaVersion: 1,
    provider: contract.provider,
    eventId: contract.eventId,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    tenantId: contract.tenantId,
    completedAt: contract.completedAt,
    attemptTimestamp,
    payloadSha256,
    verifierKeyId: contract.verifierKeyId,
    receivedAt
  };
  return { ...core, mac: receiptMac(core, receiptKey) };
}

function verifyContractCompletionReceipt(contract, receiptKey) {
  if (!contract || typeof contract !== 'object') fail('WFM_CONTRACT_EVENT_REQUIRED', 'Completed-contract event is required.', 400);
  const receipt = contract.verificationReceipt;
  if (!receipt || typeof receipt !== 'object') {
    fail('WFM_CONTRACT_RECEIPT_REQUIRED', 'Provisioning requires a cryptographically verified contract-completion receipt.', 403);
  }
  const { mac, ...core } = receipt;
  const expected = receiptMac(core, receiptKey);
  if (!safeEqualHex(mac, expected)) fail('WFM_CONTRACT_RECEIPT_INVALID', 'Contract-completion receipt failed integrity verification.', 403);

  const semantic = {
    provider: requireString(contract.provider, 'WFM_CONTRACT_PROVIDER_REQUIRED', 'Contract provider is required.'),
    eventId: requireString(contract.eventId, 'WFM_CONTRACT_EVENT_ID_REQUIRED', 'Contract event id is required.'),
    contractId: requireString(contract.contractId, 'WFM_CONTRACT_ID_REQUIRED', 'Contract id is required.'),
    contractVersion: requireString(contract.contractVersion, 'WFM_CONTRACT_VERSION_REQUIRED', 'Contract version is required.'),
    tenantId: requireString(contract.tenantId, 'WFM_TENANT_REQUIRED', 'Tenant id is required.'),
    completedAt: requireString(contract.completedAt, 'WFM_CONTRACT_COMPLETED_AT_REQUIRED', 'Contract completion time is required.')
  };
  for (const [key, value] of Object.entries(semantic)) {
    if (String(core[key] || '') !== value) fail('WFM_CONTRACT_RECEIPT_SUBJECT_MISMATCH', 'Contract-completion receipt does not match the contract being provisioned.', 409);
  }
  return {
    ok: true,
    receiptSha256: sha256(stable(receipt)),
    receipt: clone(receipt)
  };
}

function createContractCompletionIngress(store, {
  now = Date.now,
  receiptKey,
  providerVerifiers,
  maxPastMs = 5 * 60 * 1000,
  maxFutureMs = 60 * 1000
} = {}) {
  if (!store || store.durability !== 'DURABLE_TRANSACTIONAL' || typeof store.transaction !== 'function') {
    throw new Error('Contract completion ingress requires a durable transactional store.');
  }
  keyBuffer(receiptKey);
  if (!providerVerifiers || typeof providerVerifiers !== 'object') {
    throw new Error('Contract completion ingress requires provider verifiers.');
  }

  function stamp() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new Error('Contract completion ingress clock is invalid.');
    return Math.trunc(value);
  }

  function assertTransaction(tx) {
    if (!tx || typeof tx.get !== 'function' || typeof tx.insert !== 'function') {
      throw new Error('Contract completion ingress transaction must support get/insert.');
    }
  }

  function prepare({ provider, eventId, attemptTimestamp, rawBody, headers = {} }) {
    const source = requireString(provider, 'WFM_CONTRACT_PROVIDER_REQUIRED', 'Contract provider is required.');
    const deliveryId = requireString(eventId, 'WFM_CONTRACT_EVENT_ID_REQUIRED', 'Contract event id is required.');
    if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody))) {
      fail('WFM_CONTRACT_RAW_BODY_REQUIRED', 'Exact raw contract-event body is required for authentication.', 400);
    }
    const body = Buffer.isBuffer(rawBody) ? Buffer.from(rawBody) : Buffer.from(rawBody, 'utf8');
    if (body.length === 0 || body.length > 1024 * 1024) fail('WFM_CONTRACT_BODY_SIZE_INVALID', 'Contract-event body must be between 1 byte and 1 MB.', 413);

    const receivedAt = stamp();
    const attemptedAt = parseAttemptTimestamp(attemptTimestamp);
    if (attemptedAt < receivedAt - maxPastMs) fail('WFM_CONTRACT_EVENT_STALE', 'Contract completion delivery is outside the accepted replay window.', 401);
    if (attemptedAt > receivedAt + maxFutureMs) fail('WFM_CONTRACT_EVENT_FROM_FUTURE', 'Contract completion delivery timestamp is too far in the future.', 401);

    const verifier = providerVerifiers[source];
    if (typeof verifier !== 'function') fail('WFM_CONTRACT_PROVIDER_UNSUPPORTED', 'No trusted verifier exists for this contract provider.', 403);
    const verification = verifier({ provider: source, eventId: deliveryId, attemptTimestamp, rawBody: body, headers: clone(headers) });
    const completed = normaliseCompletedEvent(source, deliveryId, verification);
    const payloadDigest = sha256(body);
    const key = 'wfm-contract-event:v1:' + sha256(stable({ provider: source, eventId: deliveryId }));
    const receipt = buildReceipt(completed, attemptedAt, payloadDigest, receiptKey, receivedAt);
    const contract = {
      authenticated: true,
      provider: completed.provider,
      eventId: completed.eventId,
      contractId: completed.contractId,
      contractVersion: completed.contractVersion,
      tenantId: completed.tenantId,
      completedAt: completed.completedAt,
      status: completed.status,
      verificationReceipt: receipt
    };
    return { key, payloadDigest, receivedAt, contract };
  }

  function applyPrepared(tx, prepared) {
    assertTransaction(tx);
    const existing = tx.get(prepared.key);
    if (existing) {
      if (existing.payloadSha256 !== prepared.payloadDigest) {
        fail('WFM_CONTRACT_EVENT_ID_DRIFT', 'The same authenticated contract event id was reused with a different body.', 409);
      }
      return { duplicate: true, key: prepared.key, contract: clone(existing.contract) };
    }
    tx.insert(prepared.key, {
      key: prepared.key,
      payloadSha256: prepared.payloadDigest,
      contract: clone(prepared.contract),
      receivedAt: prepared.receivedAt
    });
    return { duplicate: false, key: prepared.key, contract: clone(prepared.contract) };
  }

  function receiveWithinTransaction(tx, delivery) {
    return applyPrepared(tx, prepare(delivery));
  }

  function receive(delivery) {
    const prepared = prepare(delivery);
    return store.transaction(tx => applyPrepared(tx, prepared));
  }

  return { receive, receiveWithinTransaction };
}

module.exports = {
  createContractCompletionIngress,
  verifyContractCompletionReceipt,
  stable,
  sha256
};