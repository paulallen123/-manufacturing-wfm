'use strict';

const { isProxy } = require('node:util').types;

const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const create = Object.create;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const ordinaryObjectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const ownKeys = Reflect.ownKeys;
const isFiniteNumber = Number.isFinite;
const isSafeInteger = Number.isSafeInteger;
const parseDate = Date.parse;
const SafeDate = Date;
const call = Function.call;
const testPattern = call.bind(RegExp.prototype.test);
const toISOString = call.bind(Date.prototype.toISOString);

const snapshotObject = (value, fields) => {
  try {
    if (!value || typeof value !== 'object' || isArray(value) || isProxy(value)) return null;
    const prototype = getPrototypeOf(value);
    if (prototype !== ordinaryObjectPrototype && prototype !== null) return null;
    const keys = ownKeys(value);
    if (keys.length !== fields.length) return null;
    const snapshot = create(null);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const descriptor = getOwnPropertyDescriptor(value, field);
      if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      defineProperty(snapshot, field, { value: descriptor.value, enumerable: true });
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (typeof keys[index] !== 'string') return null;
      let known = false;
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        if (keys[index] === fields[fieldIndex]) { known = true; break; }
      }
      if (!known) return null;
    }
    return freeze(snapshot);
  } catch {
    return null;
  }
};

const snapshotPair = value => {
  try {
    if (!isArray(value) || isProxy(value) || getPrototypeOf(value) !== arrayPrototype) return null;
    const length = getOwnPropertyDescriptor(value, 'length');
    if (!length || !hasOwn(length, 'value') || length.value !== 2) return null;
    const keys = ownKeys(value);
    if (keys.length !== 3) return null;
    const snapshot = create(null);
    for (let index = 0; index < 2; index += 1) {
      const key = index === 0 ? '0' : '1';
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      defineProperty(snapshot, key, { value: descriptor.value, enumerable: true });
    }
    return freeze(snapshot);
  } catch {
    return null;
  }
};

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const timestampPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const id = value => typeof value === 'string' && testPattern(idPattern, value);
const time = value => {
  if (typeof value !== 'string' || !testPattern(timestampPattern, value)) return null;
  const instant = parseDate(value);
  return isFiniteNumber(instant) && toISOString(new SafeDate(instant)) === value ? instant : null;
};
const scopeFields = ['tenant', 'site', 'asset', 'meter', 'unit', 'kind'];
const sourceFields = [...scopeFields, 'sourceRef', 'sourceRevision', 'observedAt', 'complete'];
const readingFields = [...scopeFields, 'at', 'value'];
const inputFields = ['scope', 'source', 'readings', 'now', 'maxAgeMs'];

function sameScope(left, right) {
  for (let index = 0; index < scopeFields.length; index += 1) {
    const field = scopeFields[index];
    if (left[field] !== right[field]) return false;
  }
  return true;
}

function evaluateMeterContext(input = {}) {
  const root = snapshotObject(input, inputFields);
  const scope = root && snapshotObject(root.scope, scopeFields);
  const source = root && snapshotObject(root.source, sourceFields);
  const readingInputs = root && snapshotPair(root.readings);
  if (!root || !scope || !source) {
    throw new Error('Exact scoped complete meter source required.');
  }
  if (!readingInputs) throw new Error('Invalid meter reading or scope.');
  const previousReading = snapshotObject(readingInputs[0], readingFields);
  const latestReading = snapshotObject(readingInputs[1], readingFields);
  for (let index = 0; index < 5; index += 1) {
    if (!id(scope[scopeFields[index]])) throw new Error('Exact scoped complete meter source required.');
  }
  if ((scope.kind !== 'CUMULATIVE' && scope.kind !== 'INSTANTANEOUS') ||
      !sameScope(source, scope) || !id(source.sourceRef) || !id(source.sourceRevision) ||
      source.complete !== true || !isSafeInteger(root.maxAgeMs) ||
      root.maxAgeMs < 1 || root.maxAgeMs > 7 * 86400000) {
    throw new Error('Exact scoped complete meter source required.');
  }
  const nowInstant = time(root.now);
  const observedInstant = time(source.observedAt);
  if (nowInstant === null || observedInstant === null || observedInstant > nowInstant ||
      nowInstant - observedInstant > root.maxAgeMs) {
    throw new Error('Exact scoped complete meter source required.');
  }

  let previousInstant;
  let latestInstant;
  for (let index = 0; index < 2; index += 1) {
    const reading = index === 0 ? previousReading : latestReading;
    if (!reading || !sameScope(reading, scope) || typeof reading.value !== 'number' ||
        !isFiniteNumber(reading.value) || reading.value < -1e12 || reading.value > 1e12 ||
        (scope.kind === 'CUMULATIVE' && reading.value < 0)) {
      throw new Error('Invalid meter reading or scope.');
    }
    const instant = time(reading.at);
    if (instant === null || instant > observedInstant) throw new Error('Invalid meter reading or scope.');
    if (index === 0) previousInstant = instant;
    else latestInstant = instant;
  }
  if (previousInstant >= latestInstant || nowInstant - previousInstant > root.maxAgeMs) {
    throw new Error('Meter observations are not ordered and current.');
  }

  const receiptScope = create(null);
  for (let index = 0; index < scopeFields.length; index += 1) {
    const field = scopeFields[index];
    defineProperty(receiptScope, field, { value: scope[field], enumerable: true });
  }
  freeze(receiptScope);
  let status = 'OBSERVED_CONTEXT';
  let change;
  if (scope.kind === 'CUMULATIVE') {
    if (latestReading.value < previousReading.value) status = 'RESET_OR_ROLLOVER_UNVERIFIED';
    else {
      change = latestReading.value - previousReading.value;
      if (!isFiniteNumber(change) || change < 0) throw new Error('Unsafe cumulative meter change.');
    }
  }
  const receipt = create(null);
  const put = (field, value) => defineProperty(receipt, field, { value, enumerable: true });
  put('contractVersion', 'VECTOR_MAINTENANCE_METER_CONTEXT_V1');
  put('status', status);
  put('scope', receiptScope);
  put('sourceRef', source.sourceRef);
  put('sourceRevision', source.sourceRevision);
  put('observedAt', source.observedAt);
  put('previousAt', previousReading.at);
  put('latestAt', latestReading.at);
  put('latestValue', latestReading.value);
  put('sourceAuthenticated', false);
  put('currentRevisionVerified', false);
  put('executionAuthority', false);
  put('claimBoundary', 'OBSERVED_METER_CONTEXT_NOT_CONDITION_DIAGNOSIS_OR_MAINTENANCE_DUE');
  if (change !== undefined) put('observedChange', change);
  return freeze(receipt);
}

module.exports = { evaluateMeterContext };
