'use strict';

const { createHash, sign, verify } = require('node:crypto');

const arrayIsArray = Array.isArray;
const bufferFrom = Buffer.from;
const bufferToString = Buffer.prototype.toString;
const dateConstructor = Date;
const dateParse = Date.parse;
const dateToISOString = Date.prototype.toISOString;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const setConstructor = Set;
const setPrototype = Set.prototype;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setValues = Set.prototype.values;
const setIteratorNext = objectGetPrototypeOf(setValues.call(new setConstructor())).next;
const hashPrototype = objectGetPrototypeOf(createHash('sha256'));
const hashUpdate = hashPrototype.update;
const hashDigest = hashPrototype.digest;

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:/-]{1,160}$/;
const PERMIT_KEYS = ['version', 'permitId', 'tenant', 'site', 'actionType', 'resource', 'tool', 'actorId', 'authorityDigest', 'eventDigest', 'policyDigest', 'buildDigest', 'nonce', 'issuedAt', 'expiresAt', 'maxCalls', 'keyId', 'trustLevel'];
const RECEIPT_KEYS = ['version', 'permitId', 'permitDigest', 'tenant', 'site', 'executorId', 'buildDigest', 'tool', 'resource', 'startedAt', 'endedAt', 'callCount', 'outcome', 'transcriptDigest', 'preStateDigest', 'postStateDigest', 'keyId', 'trustLevel'];
const CONTEXT_KEYS = ['now', 'maxPermitTtlMs', 'maxCalls', 'tenant', 'site', 'actionType', 'actorId', 'resource', 'tool', 'eventDigest', 'policyDigest', 'buildDigest', 'authorityDigest', 'revokedKeys', 'nonceSeen', 'resolveKey'];
const BINDING_KEYS = ['publicKey', 'role', 'principalId', 'tenant', 'site'];

function deny() { throw new Error('Portable autonomy evidence invalid.'); }
function strictRecord(value, keys) {
  if (!value || typeof value !== 'object' || arrayIsArray(value) || objectGetPrototypeOf(value) !== objectPrototype ||
      reflectOwnKeys(value).length !== keys.length) deny();
  const result = {};
  for (const key of keys) {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !objectHasOwn(descriptor, 'value') || !descriptor.enumerable) deny();
    result[key] = descriptor.value;
  }
  return result;
}
function iso(value) {
  if (typeof value !== 'string' || !regexpTest.call(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)) deny();
  const ms = dateParse(value);
  if (!numberIsFinite(ms) || dateToISOString.call(new dateConstructor(ms)) !== value) deny();
  return ms;
}
function id(value) { if (typeof value !== 'string' || !regexpTest.call(ID, value)) deny(); }
function hex(value) { if (typeof value !== 'string' || !regexpTest.call(HEX, value)) deny(); }
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
    if (!numberIsSafeInteger(record.maxCalls) || record.maxCalls < 1 || record.maxCalls > 100 ||
        iso(record.expiresAt) <= iso(record.issuedAt)) deny();
  } else {
    if (!numberIsSafeInteger(record.callCount) || record.callCount < 0 ||
        (record.outcome !== 'SUCCEEDED' && record.outcome !== 'FAILED' &&
         record.outcome !== 'INCOMPLETE' && record.outcome !== 'COMPENSATED') ||
        iso(record.endedAt) < iso(record.startedAt)) deny();
  }
  return record;
}
function bytes(kind, record) {
  if (kind !== 'permit' && kind !== 'receipt') deny();
  return bufferFrom(`VECTOR_PORTABLE_AUTONOMY_L1_V1:${kind}:` + jsonStringify(shape(kind, record)), 'utf8');
}
function recordDigest(kind, record) {
  const hash = createHash('sha256');
  hashUpdate.call(hash, bytes(kind, record));
  return hashDigest.call(hash, 'hex');
}
function signed(kind, record, privateKey) {
  const payload = shape(kind, record);
  if (privateKey?.asymmetricKeyType !== 'ed25519') deny();
  return { payload, signature: sign(null, bytes(kind, payload), privateKey).toString('base64url') };
}
function signedRecord(input, kind, resolveKey, revokedKeys) {
  const wrapper = strictRecord(input, ['payload', 'signature']);
  const payload = shape(kind, wrapper.payload);
  if (typeof wrapper.signature !== 'string' || !regexpTest.call(/^[A-Za-z0-9_-]{86}$/, wrapper.signature) ||
      setHas.call(revokedKeys, payload.keyId)) deny();
  const signature = bufferFrom(wrapper.signature, 'base64url');
  if (bufferToString.call(signature, 'base64url') !== wrapper.signature || signature.length !== 64) deny();
  const binding = strictRecord(resolveKey(payload.keyId, kind), BINDING_KEYS);
  if (binding.role !== (kind === 'permit' ? 'authority' : 'executor') ||
      binding.tenant !== payload.tenant || binding.site !== payload.site ||
      (kind === 'receipt' && binding.principalId !== payload.executorId) ||
      binding.publicKey?.asymmetricKeyType !== 'ed25519' ||
      !verify(null, bytes(kind, payload), binding.publicKey, signature)) deny();
  return payload;
}
function revokedSnapshot(input) {
  if (!input || typeof input !== 'object' || objectGetPrototypeOf(input) !== setPrototype) deny();
  const result = new setConstructor();
  let iterator;
  try { iterator = setValues.call(input); } catch { deny(); }
  while (true) {
    let step;
    try { step = setIteratorNext.call(iterator); } catch { deny(); }
    if (step.done) break;
    const keyId = step.value;
    id(keyId);
    setAdd.call(result, keyId);
  }
  return result;
}

function verifyPair(permitEnvelope, receiptEnvelope, contextInput) {
  const context = strictRecord(contextInput, CONTEXT_KEYS);
  if (typeof context.resolveKey !== 'function' || typeof context.nonceSeen !== 'function' ||
      !numberIsSafeInteger(context.now) || !numberIsSafeInteger(context.maxPermitTtlMs) ||
      context.maxPermitTtlMs < 1 || !numberIsSafeInteger(context.maxCalls) || context.maxCalls < 1) deny();
  const revokedKeys = revokedSnapshot(context.revokedKeys);
  const permit = signedRecord(permitEnvelope, 'permit', context.resolveKey, revokedKeys);
  const receipt = signedRecord(receiptEnvelope, 'receipt', context.resolveKey, revokedKeys);
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
  return objectFreeze({ verified: true, trustLevel: 'L1_SOFTWARE', executionAuthority: false,
    permitDigest: receipt.permitDigest, receiptDigest: recordDigest('receipt', receipt), outcome: receipt.outcome });
}

module.exports = { signPermit: (record, key) => signed('permit', record, key),
  signReceipt: (record, key) => signed('receipt', record, key), recordDigest, verifyPair };
