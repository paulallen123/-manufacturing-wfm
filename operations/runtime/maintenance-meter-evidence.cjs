'use strict';

// Source-owned cumulative count meter comparison. No due-date, threshold,
// condition diagnosis, work-order or machine-control authority is inferred.
const { types } = require('node:util');
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/i;
const id = value => typeof value === 'string' && ID.test(value);
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}
function inertJson(value) {
  const seen = new Set(); let count = 0;
  function copy(item, depth) {
    if (++count > 5000 || depth > 24 || types.isProxy(item)) throw Error('INVALID_JSON');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || seen.has(item)) throw Error('INVALID_JSON');
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (!array && proto !== Object.prototype && proto !== null) throw Error('INVALID_JSON');
    seen.add(item);
    const fields = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(fields);
    const length = array ? fields.length.value : 0;
    if (array && (length > 1000 || keys.length !== length + 1)) throw Error('INVALID_JSON');
    const result = array ? new Array(length) : Object.create(null);
    for (let i = 0, n = keys.length; i < n; i++) {
      const key = keys[i];
      if (array && key === 'length') continue;
      const field = fields[key];
      if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw Error('INVALID_JSON');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) throw Error('INVALID_JSON');
      result[key] = copy(field.value, depth + 1);
    }
    seen.delete(item);
    return result;
  }
  return copy(value, 0);
}
const scopeKeys = Object.freeze(['tenant', 'site', 'asset', 'meter']);
function validScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  for (let i = 0; i < scopeKeys.length; i++) if (!id(scope[scopeKeys[i]])) return false;
  return true;
}
function sameScope(row, scope) {
  for (let i = 0; i < scopeKeys.length; i++) if (row[scopeKeys[i]] !== scope[scopeKeys[i]]) return false;
  return true;
}
function blocked(blockers) {
  return Object.freeze({ contractVersion: 'VECTOR_MAINTENANCE_METER_EVIDENCE_V1',
    status: 'BLOCKED', delta: null, executionAuthority: false, dueAuthority: false,
    blockers: Object.freeze(blockers) });
}
function assessMaintenanceMeterEvidence(input) {
  let packet;
  try { packet = inertJson(input); } catch { return blocked(['INVALID_JSON']); }
  const scope = packet?.scope, expected = packet?.expected;
  const now = instant(packet?.now), age = packet?.maxEvidenceAgeMs;
  if (!validScope(scope) || now === null || !Number.isSafeInteger(age) || age < 1 || age > 30 * 86400000 ||
      !expected || !id(expected.source) || !id(expected.unit) ||
      !id(expected.earlierRevision) || !id(expected.laterRevision) ||
      expected.earlierRevision === expected.laterRevision) return blocked(['INVALID_EXPECTATION']);
  const earlier = packet.earlier, later = packet.later;
  const valid = row => row && typeof row === 'object' && !Array.isArray(row) &&
    id(row.revision) && id(row.unit) && Number.isSafeInteger(row.value) && row.value >= 0 &&
    instant(row.observedAt) !== null && id(row.provenance?.source) && HASH.test(row.provenance?.recordHash);
  if (!valid(earlier) || !valid(later)) return blocked(['INVALID_READING']);
  const blockers = [];
  if (!sameScope(earlier, scope) || !sameScope(later, scope)) blockers[blockers.length] = 'SCOPE_MISMATCH';
  if (earlier.unit !== expected.unit || later.unit !== expected.unit ||
      earlier.revision !== expected.earlierRevision || later.revision !== expected.laterRevision ||
      earlier.provenance.source !== expected.source || later.provenance.source !== expected.source) blockers[blockers.length] = 'SOURCE_MISMATCH';
  const start = instant(earlier.observedAt), end = instant(later.observedAt);
  if (start >= end || end > now) blockers[blockers.length] = 'TIME_UNPROVEN';
  if (start < now - age || end < now - age) blockers[blockers.length] = 'STALE_EVIDENCE';
  if (later.value < earlier.value) blockers[blockers.length] = 'ROLLOVER_UNPROVEN';
  const delta = later.value - earlier.value;
  if (!Number.isSafeInteger(delta)) blockers[blockers.length] = 'INVALID_READING';
  if (blockers.length) return blocked(blockers);
  return Object.freeze({ contractVersion: 'VECTOR_MAINTENANCE_METER_EVIDENCE_V1',
    status: 'CONSISTENT_DELTA', delta, executionAuthority: false, dueAuthority: false,
    blockers: Object.freeze([]) });
}
module.exports = Object.freeze({ assessMaintenanceMeterEvidence });
