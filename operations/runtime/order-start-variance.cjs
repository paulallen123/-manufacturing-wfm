'use strict';

// Advisory comparison of two supplied source records; source authentication belongs upstream.
const { types } = require('node:util');
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function inertRecord(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail('INERT_RECORD');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('INERT_RECORD');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) fail('INERT_RECORD');
    snapshot[key] = descriptors[key].value;
  }
  return snapshot;
}
function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && value.trim() === value; }
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('INVALID_TIME');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('INVALID_TIME');
  return ms;
}
function record(value, input, expectedSource) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    value.tenantId !== input.tenantId || value.siteId !== input.siteId ||
    value.lineId !== input.lineId || value.orderId !== input.orderId) fail('SCOPE_MISMATCH');
  if (value.source !== expectedSource || !id(value.recordId) || !id(value.revision) ||
    typeof value.recordSha256 !== 'string' || !SHA.test(value.recordSha256)) fail('INVALID_SOURCE');
  const observed = time(value.observedAt);
  if (observed > input.asOfMs || input.asOfMs - observed > input.maxAgeMinutes * 60000) fail('STALE_SOURCE');
  return observed;
}
function assessOrderStartVariance(input) {
  const scope = inertRecord(input);
  if (!id(scope.tenantId) || !id(scope.siteId) || !id(scope.lineId) || !id(scope.orderId) ||
    !Number.isSafeInteger(scope.maxAgeMinutes) || scope.maxAgeMinutes < 1 || scope.maxAgeMinutes > 1440) fail('INVALID_SCOPE');
  const asOfMs = time(scope.asOf);
  const context = { ...scope, asOfMs };
  const plan = inertRecord(scope.plan), actual = inertRecord(scope.actual);
  const planObserved = record(plan, context, 'ERP');
  const actualObserved = record(actual, context, 'MES');
  if (plan.recordSha256 === actual.recordSha256) fail('SOURCE_COLLISION');
  if (plan.complete !== true || plan.state !== 'PUBLISHED' || actual.complete !== true || actual.state !== 'STARTED' ||
    actual.plannedRevision !== plan.revision || actual.plannedRecordSha256 !== plan.recordSha256) fail('REVISION_MISMATCH');
  const plannedStart = time(plan.plannedStart), plannedEnd = time(plan.plannedEnd);
  const actualStart = time(actual.actualStart);
  if (plannedStart >= plannedEnd || planObserved > actualStart || actualStart > actualObserved ||
    planObserved > actualObserved || actualStart > asOfMs) fail('INVALID_CHRONOLOGY');
  const deltaMs = actualStart - plannedStart;
  if (deltaMs % 60000 !== 0 || !Number.isSafeInteger(deltaMs / 60000)) fail('UNSUPPORTED_PRECISION');
  return Object.freeze({
    tenantId: scope.tenantId, siteId: scope.siteId, lineId: scope.lineId, orderId: scope.orderId,
    plannedRevision: plan.revision, plannedRecordSha256: plan.recordSha256,
    actualRecordSha256: actual.recordSha256, startVarianceMinutes: deltaMs / 60000,
    status: deltaMs > 0 ? 'STARTED_LATE' : deltaMs < 0 ? 'STARTED_EARLY' : 'ON_TIME',
    sourceAuthenticated: false, causeVerified: false, costVerified: false,
    scheduleAuthority: false, executionAuthority: false,
    claimBoundary: 'DECLARED_ORDER_START_VARIANCE_ONLY'
  });
}
module.exports = { assessOrderStartVariance };
