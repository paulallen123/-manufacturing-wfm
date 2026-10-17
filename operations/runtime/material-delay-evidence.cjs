'use strict';

// Pure advisory evidence assessment. Source authentication and all operational
// authority remain outside this component.
const { types } = require('node:util');

const isProxy = types.isProxy;
const arrayIsArray = Array.isArray;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const defineProperty = Object.defineProperty;
const objectCreate = Object.create;
const objectHasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply;
const objectFreeze = Object.freeze;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const numberFrom = Number;
const stringFrom = String;
const stringTrim = String.prototype.trim;
const regexpExec = RegExp.prototype.exec;
const DateCtor = Date;
const dateParse = Date.parse;
const dateToISOString = Date.prototype.toISOString;
const SetCtor = Set;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;

const IDENTITY_KEYS = objectFreeze([
  'tenantId',
  'siteId',
  'materialId',
  'productionOrderId',
  'requirementRevision'
]);
const REASON_ORDER = objectFreeze([
  'INVALID_JSON',
  'INVALID_AS_OF',
  'INVALID_AGE_LIMIT',
  'INVALID_REQUIREMENT',
  'INVALID_SUPPLY',
  'SCOPE_MISMATCH',
  'UNIT_MISMATCH',
  'INACTIVE_SUPPLY',
  'FUTURE_EVIDENCE',
  'STALE_EVIDENCE',
  'INSUFFICIENT_QUANTITY'
]);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function append(array, value) {
  defineProperty(array, stringFrom(array.length), {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function inertJson(input) {
  const seen = new SetCtor();
  let count = 0;

  function copy(value, depth) {
    count += 1;
    if (count > 5000 || depth > 24 || isProxy(value)) throw new Error('INVALID_JSON');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && numberIsFinite(value)) return value;
    if (typeof value !== 'object' || reflectApply(setHas, seen, [value])) throw new Error('INVALID_JSON');

    const array = arrayIsArray(value);
    const prototype = getPrototypeOf(value);
    if ((!array && prototype !== objectPrototype && prototype !== null) ||
        (array && prototype !== arrayPrototype)) throw new Error('INVALID_JSON');

    reflectApply(setAdd, seen, [value]);
    const descriptors = getOwnPropertyDescriptors(value);
    const keys = ownKeys(descriptors);
    const length = array ? descriptors.length?.value : 0;
    if (array && (!numberIsSafeInteger(length) || length < 0 || length > 1000 || keys.length !== length + 1)) {
      throw new Error('INVALID_JSON');
    }
    const result = array ? [] : objectCreate(null);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (array && key === 'length') continue;
      const field = descriptors[key];
      if (typeof key !== 'string' || !field.enumerable || !objectHasOwn(field, 'value')) {
        throw new Error('INVALID_JSON');
      }
      if (array && (!reflectApply(regexpExec, /^(0|[1-9]\d*)$/, [key]) || numberFrom(key) >= length)) {
        throw new Error('INVALID_JSON');
      }
      const copied = copy(field.value, depth + 1);
      if (array) append(result, copied);
      else defineProperty(result, key, { value: copied, enumerable: true, configurable: true, writable: true });
    }
    reflectApply(setDelete, seen, [value]);
    return result;
  }

  return copy(input, 0);
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 &&
    value === reflectApply(stringTrim, value, []);
}

function instant(value) {
  if (typeof value !== 'string' || !reflectApply(regexpExec, INSTANT, [value])) return null;
  const parsed = dateParse(value);
  return numberIsFinite(parsed) && reflectApply(dateToISOString, new DateCtor(parsed), []) === value ? parsed : null;
}

function positiveNumber(value) {
  return typeof value === 'number' && numberIsFinite(value) && value > 0;
}

function hasIdentity(record) {
  if (!record || typeof record !== 'object' || arrayIsArray(record)) return false;
  for (let i = 0; i < IDENTITY_KEYS.length; i += 1) {
    if (!text(record[IDENTITY_KEYS[i]])) return false;
  }
  return true;
}

function record(value) {
  return value !== null && typeof value === 'object' && !arrayIsArray(value);
}

function sameIdentity(left, right) {
  for (let i = 0; i < IDENTITY_KEYS.length; i += 1) {
    const key = IDENTITY_KEYS[i];
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || objectFreeze(value) !== value) return value;
  const keys = ownKeys(value);
  for (let i = 0; i < keys.length; i += 1) deepFreeze(value[keys[i]]);
  return value;
}

function reasonList(flags) {
  const result = [];
  for (let i = 0; i < REASON_ORDER.length; i += 1) {
    const reason = REASON_ORDER[i];
    if (flags[reason] === true) append(result, reason);
  }
  return result;
}

function blocked(flags) {
  return deepFreeze({
    status: 'BLOCKED',
    delayMinutes: null,
    scope: null,
    sourceRefs: null,
    sourceAuthenticated: false,
    planningAuthority: false,
    procurementAuthority: false,
    scheduleAuthority: false,
    machineAuthority: false,
    customerReady: false,
    cause: null,
    savings: null,
    reasons: reasonList(flags)
  });
}

function assessMaterialDelayEvidence(input) {
  let packet;
  try {
    packet = inertJson(input);
  } catch {
    return blocked({ INVALID_JSON: true });
  }

  if (!record(packet)) return blocked({ INVALID_JSON: true });

  const flags = objectCreate(null);
  const asOf = instant(packet?.asOf);
  if (asOf === null) flags.INVALID_AS_OF = true;
  if (!numberIsSafeInteger(packet?.maxEvidenceAgeMs) || packet.maxEvidenceAgeMs < 1 ||
      packet.maxEvidenceAgeMs > 86400000) flags.INVALID_AGE_LIMIT = true;

  const requirement = packet?.requirement;
  const supply = packet?.supply;
  if (!record(requirement)) flags.INVALID_REQUIREMENT = true;
  if (!record(supply)) flags.INVALID_SUPPLY = true;
  if (flags.INVALID_REQUIREMENT || flags.INVALID_SUPPLY) return blocked(flags);
  const requiredAt = instant(requirement?.requiredAt);
  const expectedAt = instant(supply?.expectedAt);
  const observedAt = instant(supply?.observedAt);

  if (!hasIdentity(requirement) || requiredAt === null || !positiveNumber(requirement?.requiredQuantity) ||
      !text(requirement?.unit) || !text(requirement?.sourceRef)) flags.INVALID_REQUIREMENT = true;
  if (!hasIdentity(supply) || expectedAt === null || observedAt === null ||
      !positiveNumber(supply?.expectedQuantity) || !text(supply?.unit) || !text(supply?.sourceRef) ||
      !text(supply?.lifecycle)) flags.INVALID_SUPPLY = true;

  if (flags.INVALID_REQUIREMENT || flags.INVALID_SUPPLY || flags.INVALID_AS_OF || flags.INVALID_AGE_LIMIT) {
    return blocked(flags);
  }
  if (!sameIdentity(requirement, supply)) flags.SCOPE_MISMATCH = true;
  if (requirement.unit !== supply.unit) flags.UNIT_MISMATCH = true;
  if (supply.lifecycle !== 'ACTIVE') flags.INACTIVE_SUPPLY = true;
  if (observedAt > asOf) flags.FUTURE_EVIDENCE = true;
  if (asOf - observedAt > packet.maxEvidenceAgeMs) flags.STALE_EVIDENCE = true;
  if (supply.expectedQuantity < requirement.requiredQuantity) flags.INSUFFICIENT_QUANTITY = true;

  if (reasonList(flags).length > 0) return blocked(flags);

  const rawDelayMinutes = (expectedAt - requiredAt) / 60000;
  const delayMinutes = rawDelayMinutes > 0 ? rawDelayMinutes : 0;
  if (!numberIsFinite(delayMinutes)) return blocked({ INVALID_SUPPLY: true });
  return deepFreeze({
    status: delayMinutes > 0 ? 'DELAY_EVIDENCE_CURRENT' : 'ON_TIME_EVIDENCE_CURRENT',
    delayMinutes,
    scope: {
      tenantId: requirement.tenantId,
      siteId: requirement.siteId,
      materialId: requirement.materialId,
      productionOrderId: requirement.productionOrderId,
      requirementRevision: requirement.requirementRevision
    },
    observedAt: supply.observedAt,
    requiredAt: requirement.requiredAt,
    expectedAt: supply.expectedAt,
    requiredQuantity: requirement.requiredQuantity,
    expectedQuantity: supply.expectedQuantity,
    unit: requirement.unit,
    sourceRefs: {
      requirement: requirement.sourceRef,
      supply: supply.sourceRef
    },
    sourceAuthenticated: false,
    planningAuthority: false,
    procurementAuthority: false,
    scheduleAuthority: false,
    machineAuthority: false,
    customerReady: false,
    cause: null,
    savings: null,
    reasons: []
  });
}

module.exports = objectFreeze({ assessMaterialDelayEvidence });
