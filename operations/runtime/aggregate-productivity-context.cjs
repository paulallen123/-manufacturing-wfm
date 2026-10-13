'use strict';

const { createHash } = require('node:crypto');
const scopeFields = ['tenant', 'site', 'line', 'product', 'periodStart', 'periodEnd'];
const sourceFields = [...scopeFields, 'sourceRef', 'sourceRevision', 'observedAt'];
const productionFields = [...sourceFields, 'goodUnits', 'rejectedUnits', 'sourceHash'];
const workforceFields = [...sourceFields, 'directHours', 'workerCount', 'sourceHash'];
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : null;
const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const digest = (source, metricFields) => createHash('sha256').update(JSON.stringify([...sourceFields, ...metricFields].map(field => source[field]))).digest('hex');
const round3 = value => Math.round(value * 1000) / 1000;

function summarizeAggregateProductivity(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Aggregate evidence required.');
  const { scope, production, workforce, now, maxEvidenceAgeMs } = input;
  if (!exactKeys(scope, scopeFields) || !scopeFields.slice(0, 4).every(field => id(scope[field])) ||
      utc(scope.periodStart) === null || utc(scope.periodEnd) === null || utc(scope.periodEnd) <= utc(scope.periodStart) ||
      utc(now) === null || utc(scope.periodEnd) > utc(now) || !Number.isSafeInteger(maxEvidenceAgeMs) ||
      maxEvidenceAgeMs < 1 || maxEvidenceAgeMs > 7 * 86400000) throw new Error('Exact past site/line/product scope and evidence age required.');
  for (const [source, fields, metrics] of [
    [production, productionFields, ['goodUnits', 'rejectedUnits']],
    [workforce, workforceFields, ['directHours', 'workerCount']]
  ]) {
    if (!exactKeys(source, fields) || !scopeFields.every(field => source[field] === scope[field]) ||
        !id(source.sourceRef) || !id(source.sourceRevision) || utc(source.observedAt) === null ||
        utc(source.observedAt) < utc(scope.periodEnd) || utc(source.observedAt) > utc(now) ||
        utc(now) - utc(source.observedAt) > maxEvidenceAgeMs || source.sourceHash !== digest(source, metrics)) {
      throw new Error('Source-scoped aggregate evidence invalid or stale.');
    }
  }
  if (!Number.isSafeInteger(production.goodUnits) || production.goodUnits < 0 || production.goodUnits > 1e9 ||
      !Number.isSafeInteger(production.rejectedUnits) || production.rejectedUnits < 0 || production.rejectedUnits > 1e9 ||
      !Number.isSafeInteger(production.goodUnits + production.rejectedUnits) || production.goodUnits + production.rejectedUnits === 0 ||
      typeof workforce.directHours !== 'number' || !Number.isFinite(workforce.directHours) || workforce.directHours < 0.001 || workforce.directHours > 1e6 ||
      !Number.isSafeInteger(workforce.workerCount) || workforce.workerCount < 1 || workforce.workerCount > 1e6) {
    throw new Error('Unsafe aggregate production or workforce quantities.');
  }
  const base = { contractVersion: 'VECTOR_AGGREGATE_PRODUCTIVITY_CONTEXT_V1',
    executionAuthority: false, claimBoundary: 'SITE_LINE_PRODUCT_CONTEXT_NOT_PERSON_PERFORMANCE_OR_CAUSAL_SAVING' };
  if (workforce.workerCount < 5) return Object.freeze({ ...base, status: 'SUPPRESSED' });
  const rate = production.goodUnits / workforce.directHours;
  if (!Number.isFinite(rate) || rate > 1e6) throw new Error('Unsafe aggregate productivity rate.');
  return Object.freeze({ ...base, status: 'AGGREGATE_CONTEXT',
    scope: Object.freeze({ ...scope }),
    sourceRefs: Object.freeze([production.sourceRef, workforce.sourceRef]), sourceHashes: Object.freeze([production.sourceHash, workforce.sourceHash]),
    goodUnitsPerDirectHour: round3(rate),
    goodUnitYield: round3(production.goodUnits / (production.goodUnits + production.rejectedUnits)) });
}

module.exports = { summarizeAggregateProductivity };
