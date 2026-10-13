'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_CAPABILITY_ADMISSION_V1';
const READINESS_VERSION = 'VECTOR_CAPABILITY_READINESS_V1';
const SNAPSHOT_FIELDS = new Set(['contractVersion', 'tenant', 'revision', 'capabilities']);
const CAPABILITY_FIELDS = new Set(['id', 'status', 'reasonCodes']);
const REQUEST_FIELDS = new Set(['tenant', 'actorId', 'capabilityId', 'locale']);
const ADMISSION_FIELDS = new Set([
  'contractVersion', 'admitted', 'status', 'reasonCodes', 'binding', 'authorityFingerprint'
]);
const BINDING_FIELDS = new Set(['tenant', 'actorId', 'capabilityId', 'readinessRevision']);

function plainRecord(value, label, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' must be plain data.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(label + ' must be plain data.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedFields.has(key)) {
      throw new TypeError(label + ' contains an undeclared field.');
    }
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(label + ' must contain plain data properties.');
    }
  }
  return descriptors;
}

function exactText(value, label, max, pattern) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value !== value.trim()) {
    throw new TypeError(label + ' is invalid.');
  }
  if (pattern && !pattern.test(value)) throw new TypeError(label + ' is invalid.');
  return value;
}

function denseArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isSafeInteger(value.length) || value.length > max) {
    throw new TypeError(label + ' must be a bounded plain-data array.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(label + ' must be a dense plain-data array.');
    }
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new TypeError(label + ' must be a dense plain-data array.');
    }
  }
  return descriptors;
}

function reasonCodes(value, status) {
  const descriptors = denseArray(value, 'Capability reasonCodes', 20);
  const result = [];
  const seen = Object.create(null);
  for (let index = 0; index < value.length; index += 1) {
    const code = exactText(
      descriptors[String(index)].value,
      'Capability reason code',
      80,
      /^[A-Z][A-Z0-9_:-]*$/
    );
    if (Object.hasOwn(seen, code)) throw new TypeError('Capability reason codes must be unique.');
    Object.defineProperty(seen, code, { value: true, enumerable: true });
    Object.defineProperty(result, String(result.length), {
      value: code,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  if (status === 'ALLOW' && result.length) {
    throw new TypeError('An allowed capability cannot carry blocking reason codes.');
  }
  if (status === 'BLOCK' && !result.length) {
    throw new TypeError('A blocked capability requires a reason code.');
  }
  return Object.freeze(result);
}

function parseCapability(value, index) {
  const descriptors = plainRecord(value, 'Capability ' + index, CAPABILITY_FIELDS);
  if (!descriptors.id || !descriptors.status || !descriptors.reasonCodes) {
    throw new TypeError('Capability rows require id, status, and reasonCodes.');
  }
  const id = exactText(descriptors.id.value, 'Capability id', 120, /^[a-z][a-z0-9.-]*$/);
  const status = descriptors.status.value;
  if (status !== 'ALLOW' && status !== 'BLOCK') {
    throw new TypeError('Capability status must be ALLOW or BLOCK.');
  }
  return Object.freeze({ id, status, reasonCodes: reasonCodes(descriptors.reasonCodes.value, status) });
}

function parseReadiness(value) {
  const descriptors = plainRecord(value, 'Readiness snapshot', SNAPSHOT_FIELDS);
  for (const field of SNAPSHOT_FIELDS) {
    if (!descriptors[field]) throw new TypeError('Readiness snapshot requires ' + field + '.');
  }
  if (descriptors.contractVersion.value !== READINESS_VERSION) {
    throw new TypeError('Readiness snapshot contract version is unsupported.');
  }
  const tenant = exactText(descriptors.tenant.value, 'Readiness tenant', 160);
  const revision = exactText(
    descriptors.revision.value,
    'Readiness revision',
    180,
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
  );
  const rows = descriptors.capabilities.value;
  const rowDescriptors = denseArray(rows, 'Readiness capabilities', 256);
  const capabilities = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = parseCapability(rowDescriptors[String(index)].value, index);
    if (capabilities.has(row.id)) throw new TypeError('Readiness snapshot contains a duplicate capability id.');
    capabilities.set(row.id, row);
  }
  return Object.freeze({ tenant, revision, capabilities });
}

function parseRequest(value) {
  const descriptors = plainRecord(value, 'Capability request', REQUEST_FIELDS);
  for (const field of ['tenant', 'actorId', 'capabilityId']) {
    if (!descriptors[field]) throw new TypeError('Capability request requires ' + field + '.');
  }
  if (descriptors.locale && typeof descriptors.locale.value !== 'string') {
    throw new TypeError('Capability request locale must be presentation text.');
  }
  return Object.freeze({
    tenant: exactText(descriptors.tenant.value, 'Capability request tenant', 160),
    actorId: exactText(descriptors.actorId.value, 'Capability request actorId', 240),
    capabilityId: exactText(
      descriptors.capabilityId.value,
      'Capability request capabilityId',
      120,
      /^[a-z][a-z0-9.-]*$/
    )
  });
}

function authorityKey(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('Capability admission requires a server-held authority key.');
  }
  const key = Buffer.from(value);
  if (key.length < 32 || key.length > 1024) {
    throw new TypeError('Capability admission authority key must contain 32 to 1024 bytes.');
  }
  return key;
}

function fingerprint(binding, key) {
  return createHmac('sha256', key).update(JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    tenant: binding.tenant,
    actorId: binding.actorId,
    capabilityId: binding.capabilityId,
    readinessRevision: binding.readinessRevision
  })).digest('hex');
}

function blocked(reasonCodesValue) {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    admitted: false,
    status: 'BLOCKED',
    reasonCodes: Object.freeze([...reasonCodesValue]),
    binding: null,
    authorityFingerprint: null
  });
}

function createCapabilityAdmission(input = {}) {
  const container = plainRecord(
    input,
    'Capability admission input',
    new Set(['readiness', 'request', 'authorityKey'])
  );
  if (!container.readiness || !container.request || !container.authorityKey) {
    throw new TypeError('Capability admission requires readiness, request, and a server-held authority key.');
  }
  const key = authorityKey(container.authorityKey.value);
  const readiness = parseReadiness(container.readiness.value);
  const request = parseRequest(container.request.value);
  if (readiness.tenant !== request.tenant) return blocked(['READINESS_SCOPE_MISMATCH']);
  const capability = readiness.capabilities.get(request.capabilityId);
  if (!capability) return blocked(['CAPABILITY_NOT_DECLARED']);
  if (capability.status !== 'ALLOW') return blocked(capability.reasonCodes);
  const binding = Object.freeze({
    tenant: request.tenant,
    actorId: request.actorId,
    capabilityId: request.capabilityId,
    readinessRevision: readiness.revision
  });
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    admitted: true,
    status: 'ADMITTED',
    reasonCodes: Object.freeze([]),
    binding,
    authorityFingerprint: fingerprint(binding, key)
  });
}

function parseAdmission(value) {
  const descriptors = plainRecord(value, 'Capability admission', ADMISSION_FIELDS);
  for (const field of ADMISSION_FIELDS) {
    if (!descriptors[field]) throw new TypeError('Capability admission requires ' + field + '.');
  }
  if (descriptors.contractVersion.value !== CONTRACT_VERSION || descriptors.admitted.value !== true ||
      descriptors.status.value !== 'ADMITTED') {
    throw new TypeError('Capability admission was not granted.');
  }
  const bindingDescriptors = plainRecord(descriptors.binding.value, 'Capability admission binding', BINDING_FIELDS);
  for (const field of BINDING_FIELDS) {
    if (!bindingDescriptors[field]) throw new TypeError('Capability admission binding requires ' + field + '.');
  }
  const binding = Object.freeze({
    tenant: exactText(bindingDescriptors.tenant.value, 'Admission tenant', 160),
    actorId: exactText(bindingDescriptors.actorId.value, 'Admission actorId', 240),
    capabilityId: exactText(bindingDescriptors.capabilityId.value, 'Admission capabilityId', 120, /^[a-z][a-z0-9.-]*$/),
    readinessRevision: exactText(bindingDescriptors.readinessRevision.value, 'Admission readiness revision', 180, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  });
  const authorityFingerprint = exactText(
    descriptors.authorityFingerprint.value,
    'Admission authority fingerprint',
    64,
    /^[0-9a-f]{64}$/
  );
  return Object.freeze({ binding, authorityFingerprint });
}

function verificationBlocked(reasonCodesValue) {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    verified: false,
    status: 'BLOCKED',
    reasonCodes: Object.freeze([...reasonCodesValue]),
    binding: null,
    authorityFingerprint: null
  });
}

function verifyCapabilityAdmission(input = {}) {
  const container = plainRecord(
    input,
    'Capability verification input',
    new Set(['admission', 'readiness', 'request', 'authorityKey'])
  );
  if (!container.admission || !container.readiness || !container.request || !container.authorityKey) {
    throw new TypeError('Capability verification requires admission, readiness, request, and a server-held authority key.');
  }
  const key = authorityKey(container.authorityKey.value);
  let admission;
  try {
    admission = parseAdmission(container.admission.value);
  } catch {
    return verificationBlocked(['ADMISSION_BINDING_INVALID']);
  }
  const request = parseRequest(container.request.value);
  if (admission.binding.tenant !== request.tenant ||
      admission.binding.actorId !== request.actorId ||
      admission.binding.capabilityId !== request.capabilityId) {
    return verificationBlocked(['REQUEST_SCOPE_CHANGED']);
  }
  const expectedFingerprint = fingerprint(admission.binding, key);
  if (!timingSafeEqual(
    Buffer.from(expectedFingerprint, 'hex'),
    Buffer.from(admission.authorityFingerprint, 'hex')
  )) {
    return verificationBlocked(['ADMISSION_FINGERPRINT_MISMATCH']);
  }
  const readiness = parseReadiness(container.readiness.value);
  if (readiness.revision !== admission.binding.readinessRevision) {
    return verificationBlocked(['READINESS_REVISION_CHANGED']);
  }
  if (readiness.tenant !== admission.binding.tenant) {
    return verificationBlocked(['READINESS_SCOPE_MISMATCH']);
  }
  const capability = readiness.capabilities.get(admission.binding.capabilityId);
  if (!capability) return verificationBlocked(['CAPABILITY_NOT_DECLARED']);
  if (capability.status !== 'ALLOW') return verificationBlocked(capability.reasonCodes);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    verified: true,
    status: 'VERIFIED',
    reasonCodes: Object.freeze([]),
    binding: admission.binding,
    authorityFingerprint: admission.authorityFingerprint
  });
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  READINESS_VERSION,
  createCapabilityAdmission,
  verifyCapabilityAdmission
});
