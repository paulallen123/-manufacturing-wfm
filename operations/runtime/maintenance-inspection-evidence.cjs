'use strict';

// Read-only consistency check for source-owned CMMS inspection receipts.
// The caller must authenticate the independent expected checklist and capture.
// A consistent packet is never permission to close or execute a work order.
const { types } = require('node:util');
const SCOPE_KEYS = Object.freeze(['tenant', 'site', 'asset', 'workOrder']);
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
function time(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function inertJson(input) {
  const seen = new Set();
  let count = 0;
  function copy(value, depth) {
    if (++count > 5000 || depth > 24 || types.isProxy(value)) throw Error('INVALID_JSON');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value)) throw Error('INVALID_JSON');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw Error('INVALID_JSON');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = array ? descriptors.length.value : 0;
    if (array && (length > 1000 || keys.length !== length + 1)) throw Error('INVALID_JSON');
    const result = array ? new Array(length) : Object.create(null);
    for (let i = 0, n = keys.length; i < n; i++) {
      const key = keys[i];
      if (array && key === 'length') continue;
      const field = descriptors[key];
      if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw Error('INVALID_JSON');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) throw Error('INVALID_JSON');
      result[key] = copy(field.value, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  return copy(input, 0);
}

function validScope(scope) {
  return scope && typeof scope === 'object' && !Array.isArray(scope) &&
    SCOPE_KEYS.every(key => name(scope[key]));
}
function sameScope(actual, expected) {
  return validScope(actual) && SCOPE_KEYS.every(key => actual[key] === expected[key]);
}

function assessMaintenanceInspectionEvidence(input) {
  const reasons = new Set();
  let packet;
  try { packet = inertJson(input); } catch {
    return Object.freeze({ status: 'BLOCKED', inspectionOutcome: null,
      workOrderAuthority: false, reasons: Object.freeze(['INVALID_JSON']) });
  }
  const expected = packet?.expected, capture = packet?.capture;
  const asOf = time(packet?.asOf), validFrom = time(expected?.validFrom);
  if (!asOf || !expected || !validScope(expected.scope) || !name(expected.checklistId) ||
      !name(expected.revision) || !name(expected.sourceRef) || !validFrom || validFrom > asOf ||
      !Number.isSafeInteger(expected.maxAgeMs) || expected.maxAgeMs < 1 || expected.maxAgeMs > 86400000 ||
      !Array.isArray(expected.requiredItemIds) || expected.requiredItemIds.length < 1 ||
      expected.requiredItemIds.length > 100 || !expected.requiredItemIds.every(name) ||
      new Set(expected.requiredItemIds).size !== expected.requiredItemIds.length) reasons.add('INVALID_CONTRACT');
  if (!capture || !validScope(capture.scope) || !name(capture.checklistId) ||
      !name(capture.revision) || !name(capture.sourceRef) || !time(capture.capturedAt) ||
      !Array.isArray(capture.results) || capture.results.length > 100) reasons.add('INVALID_CAPTURE');
  if (reasons.size) return result(reasons);
  if (!sameScope(capture.scope, expected.scope)) reasons.add('SCOPE_MISMATCH');
  if (capture.checklistId !== expected.checklistId || capture.revision !== expected.revision) reasons.add('SOURCE_MISMATCH');
  if (capture.complete !== true) reasons.add('INCOMPLETE_CAPTURE');
  const capturedAt = time(capture.capturedAt);
  if (capturedAt > asOf || capturedAt < asOf - expected.maxAgeMs) reasons.add('STALE_EVIDENCE');
  const required = new Set(expected.requiredItemIds), observed = new Set();
  for (let i = 0; i < capture.results.length; i++) {
    const row = capture.results[i];
    if (!row || !name(row.itemId) || !name(row.evidenceRef) || !time(row.observedAt)) {
      reasons.add('INVALID_RESULT'); continue;
    }
    if (!sameScope(row.scope, expected.scope)) reasons.add('SCOPE_MISMATCH');
    if (!required.has(row.itemId)) reasons.add('UNKNOWN_ITEM');
    if (observed.has(row.itemId)) reasons.add('DUPLICATE_ITEM');
    observed.add(row.itemId);
    if (row.outcome !== 'PASS') reasons.add('NON_PASS_ITEM');
    const observedAt = time(row.observedAt);
    if (observedAt < validFrom || observedAt > capturedAt || observedAt < asOf - expected.maxAgeMs) reasons.add('EVIDENCE_TIME');
  }
  for (const id of required) if (!observed.has(id)) reasons.add('MISSING_ITEM');
  return result(reasons);
}
function result(reasons) {
  const blocked = reasons.size > 0;
  return Object.freeze({ status: blocked ? 'BLOCKED' : 'EVIDENCE_CONSISTENT',
    inspectionOutcome: blocked ? null : 'PASS', workOrderAuthority: false,
    reasons: Object.freeze([...reasons].sort()) });
}
module.exports = Object.freeze({ assessMaintenanceInspectionEvidence });
