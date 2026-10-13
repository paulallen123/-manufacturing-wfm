'use strict';

const { createHash, sign, verify } = require('node:crypto');

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:/-]{1,160}$/;
const PERMIT_KEYS = ['version', 'permitId', 'tenant', 'site', 'actionType', 'resource', 'tool', 'actorId', 'authorityDigest', 'eventDigest', 'policyDigest', 'buildDigest', 'nonce', 'issuedAt', 'expiresAt', 'maxCalls', 'keyId', 'trustLevel'];
const RECEIPT_KEYS = ['version', 'permitId', 'permitDigest', 'tenant', 'site', 'executorId', 'buildDigest', 'tool', 'resource', 'startedAt', 'endedAt', 'callCount', 'outcome', 'transcriptDigest', 'preStateDigest', 'postStateDigest', 'keyId', 'trustLevel'];

function deny() { throw new Error('Portable autonomy evidence invalid.'); }
function strictRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length) deny();
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) deny();
    result[key] = descriptor.value;
  }
  return result;
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) deny();
  return ms;
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) deny(); }
function hex(value) { if (typeof value !== 'string' || !HEX.test(value)) deny(); }
function shape(kind, input) {
  const record = strictRecord(input, kind === 'permit' ? PERMIT_KEYS : RECEIPT_KEYS);
  if (record.version !== 'VECTOR_PORTABLE_AUTONOMY_L1_V1' || record.trustLevel !== 'L1_SOFTWARE') deny();
  const fields = kind === 'permit'
    ? ['permitId','tenant','site','actionType','resource','tool','actorId','nonce','keyId']
    : ['permitId','tenant','site','executorId','tool','resource','outcome','keyId'];
  for (const key of fields) id(record[key]);
  for (const key of kind === 'permit'
    ? ['authorityDigest','eventDigest','policyDigest','buildDigest']
    : ['permitDigest','buildDigest','transcriptDigest','preStateDigest','postStateDigest']) hex(record[key]);
  if (kind === 'permit') {
    if (!Number.isSafeInteger(record.maxCalls) || record.maxCalls < 1 || record.maxCalls > 100 ||
        iso(record.expiresAt) <= iso(record.issuedAt)) deny();
  } else {
    if (!Number.isSafeInteger(record.callCount) || record.callCount < 0 ||
        !['SUCCEEDED','FAILED','INCOMPLETE','COMPENSATED'].includes(record.outcome) ||
        iso(record.endedAt) < iso(record.startedAt)) deny();
  }
  return record;
}
function bytes(kind, record) {
  if (kind !== 'permit' && kind !== 'receipt') deny();
  return Buffer.from(`VECTOR_PORTABLE_AUTONOMY_L1_V1:${kind}:` + JSON.stringify(shape(kind, record)), 'utf8');
}
function recordDigest(kind, record) { return createHash('sha256').update(bytes(kind, record)).digest('hex'); }
function signed(kind, record, privateKey) {
  const payload = shape(kind, record);
  if (privateKey?.asymmetricKeyType !== 'ed25519') deny();
  return { payload, signature: sign(null, bytes(kind, payload), privateKey).toString('base64url') };
}
function signedRecord(input, kind, resolveKey, revokedKeys) {
  const wrapper = strictRecord(input, ['payload', 'signature']);
  const payload = shape(kind, wrapper.payload);
  if (typeof wrapper.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(wrapper.signature) ||
      revokedKeys.has(payload.keyId)) deny();
  const signature = Buffer.from(wrapper.signature, 'base64url');
  if (signature.toString('base64url') !== wrapper.signature || signature.length !== 64) deny();
  const binding = resolveKey(payload.keyId, kind);
  if (!binding || binding.role !== (kind === 'permit' ? 'authority' : 'executor') ||
      binding.tenant !== payload.tenant || binding.site !== payload.site ||
      (kind === 'receipt' && binding.principalId !== payload.executorId) ||
      binding.publicKey?.asymmetricKeyType !== 'ed25519' ||
      !verify(null, bytes(kind, payload), binding.publicKey, signature)) deny();
  return payload;
}

function verifyPair(permitEnvelope, receiptEnvelope, context) {
  if (!context || typeof context.resolveKey !== 'function' || !(context.revokedKeys instanceof Set) ||
      typeof context.nonceSeen !== 'function' || !Number.isSafeInteger(context.now) ||
      !Number.isSafeInteger(context.maxPermitTtlMs) || context.maxPermitTtlMs < 1 ||
      !Number.isSafeInteger(context.maxCalls) || context.maxCalls < 1) deny();
  const permit = signedRecord(permitEnvelope, 'permit', context.resolveKey, context.revokedKeys);
  const receipt = signedRecord(receiptEnvelope, 'receipt', context.resolveKey, context.revokedKeys);
  const issued = iso(permit.issuedAt), expiry = iso(permit.expiresAt);
  if (expiry - issued > context.maxPermitTtlMs || permit.maxCalls > context.maxCalls ||
      issued > context.now || expiry < context.now || context.nonceSeen(permit.tenant, permit.nonce) !== false ||
      context.tenant !== permit.tenant || context.site !== permit.site ||
      context.actionType !== permit.actionType || context.actorId !== permit.actorId ||
      context.resource !== permit.resource || context.tool !== permit.tool ||
      context.eventDigest !== permit.eventDigest ||
      context.policyDigest !== permit.policyDigest || context.buildDigest !== permit.buildDigest ||
      context.authorityDigest !== permit.authorityDigest ||
      receipt.permitId !== permit.permitId || receipt.permitDigest !== recordDigest('permit', permit) ||
      receipt.tenant !== permit.tenant || receipt.site !== permit.site ||
      receipt.resource !== permit.resource || receipt.tool !== permit.tool ||
      receipt.buildDigest !== permit.buildDigest || receipt.callCount > permit.maxCalls ||
      iso(receipt.startedAt) < issued || iso(receipt.endedAt) > context.now ||
      (receipt.outcome === 'SUCCEEDED' && receipt.callCount === 0)) deny();
  return Object.freeze({ verified: true, trustLevel: 'L1_SOFTWARE', executionAuthority: false,
    permitDigest: receipt.permitDigest, receiptDigest: recordDigest('receipt', receipt), outcome: receipt.outcome });
}

module.exports = { signPermit: (record, key) => signed('permit', record, key),
  signReceipt: (record, key) => signed('receipt', record, key), recordDigest, verifyPair };
