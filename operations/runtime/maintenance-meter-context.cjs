'use strict';

const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : null;
const scopeFields = ['tenant', 'site', 'asset', 'meter', 'unit', 'kind'];
const sourceScopeFields = scopeFields;
const readingFields = [...scopeFields, 'at', 'value'];

function evaluateMeterContext({ scope, source, readings, now, maxAgeMs } = {}) {
  if (!exact(scope, scopeFields) || !scopeFields.slice(0, 5).every(field => id(scope[field])) ||
      !['CUMULATIVE', 'INSTANTANEOUS'].includes(scope.kind) || !exact(source, [...sourceScopeFields, 'sourceRef', 'sourceRevision', 'observedAt', 'complete']) ||
      !sourceScopeFields.every(field => source[field] === scope[field]) ||
      !id(source.sourceRef) || !id(source.sourceRevision) || source.complete !== true ||
      time(now) === null || time(source.observedAt) === null || time(source.observedAt) > time(now) ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 7 * 86400000 ||
      time(now) - time(source.observedAt) > maxAgeMs || !Array.isArray(readings) || readings.length !== 2) {
    throw new Error('Exact scoped complete meter source required.');
  }
  for (const reading of readings) {
    if (!exact(reading, readingFields) || !scopeFields.every(field => reading[field] === scope[field]) ||
        time(reading.at) === null || time(reading.at) > time(source.observedAt) ||
        typeof reading.value !== 'number' || !Number.isFinite(reading.value) ||
        Math.abs(reading.value) > 1e12 || (scope.kind === 'CUMULATIVE' && reading.value < 0)) {
      throw new Error('Invalid meter reading or scope.');
    }
  }
  if (time(readings[0].at) >= time(readings[1].at) || time(now) - time(readings[0].at) > maxAgeMs) {
    throw new Error('Meter observations are not ordered and current.');
  }
  const base = { contractVersion: 'VECTOR_MAINTENANCE_METER_CONTEXT_V1', status: 'OBSERVED_CONTEXT',
    scope: Object.freeze({ ...scope }), sourceRef: source.sourceRef, sourceRevision: source.sourceRevision,
    observedAt: source.observedAt, previousAt: readings[0].at, latestAt: readings[1].at,
    latestValue: readings[1].value, executionAuthority: false,
    claimBoundary: 'OBSERVED_METER_CONTEXT_NOT_CONDITION_DIAGNOSIS_OR_MAINTENANCE_DUE' };
  if (scope.kind !== 'CUMULATIVE') return Object.freeze(base);
  if (readings[1].value < readings[0].value) return Object.freeze({ ...base, status: 'RESET_OR_ROLLOVER_UNVERIFIED' });
  const change = readings[1].value - readings[0].value;
  if (!Number.isFinite(change) || change < 0) throw new Error('Unsafe cumulative meter change.');
  return Object.freeze({ ...base, observedChange: change });
}

module.exports = { evaluateMeterContext };
