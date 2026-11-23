'use strict';

const { types } = require('node:util');

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const snapshotObject = (value, fields) => {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return null;
    const snapshot = Object.create(null);
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      Object.defineProperty(snapshot, field, { value: descriptor.value, enumerable: true });
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
};
const snapshotArray = value => {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) ||
        !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10000) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;
    const snapshot = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      Object.defineProperty(snapshot, String(index), {
        value: descriptor.value, enumerable: true, writable: true, configurable: true
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
};
const scope = ['tenantId', 'siteId', 'workCentreId', 'productId', 'orderId'];
const rootFields = [...scope, 'windowStart', 'windowEnd', 'asOf', 'sourceKind', 'sourceId',
  'sourceRevision', 'complete', 'evidenceRef', 'events'];
const eventFields = [...scope, 'eventId', 'kind', 'sourceRevision', 'occurredAt',
  'observedAt', 'evidenceRef', 'recordSha256', 'declaredCostPence'];

// Read-only addition of caller-declared QMS cost records. Authentication, cost
// accounting, quality causality and realised savings remain outside this boundary.
module.exports = function assessQualityLossCostEvidence(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null });
  const root = snapshotObject(input, rootFields);
  if (!root) return blocked('SOURCE_OR_SCOPE_INVALID');
  const events = snapshotArray(root.events);
  if (!events || !scope.every(key => id(root[key])) ||
      root.sourceKind !== 'QMS' || !id(root.sourceId) || !id(root.sourceRevision) ||
      !id(root.evidenceRef) || root.complete !== true)
    return blocked('SOURCE_OR_SCOPE_INVALID');
  const start = timestamp(root.windowStart), end = timestamp(root.windowEnd), asOf = timestamp(root.asOf);
  if (start === null || end === null || asOf === null || !(start < end && end <= asOf))
    return blocked('WINDOW_INVALID');
  const eventIds = new Set(), evidenceRefs = new Set(), recordHashes = new Set();
  const eventEvidence = [];
  let rework = 0, scrap = 0;
  for (const eventInput of events) {
    const event = snapshotObject(eventInput, eventFields);
    if (!event || !scope.every(key => event[key] === root[key]) ||
        !id(event.eventId) || !id(event.evidenceRef) ||
        event.sourceRevision !== root.sourceRevision ||
        !['REWORK', 'SCRAP'].includes(event.kind) ||
        typeof event.recordSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.recordSha256) ||
        !Number.isSafeInteger(event.declaredCostPence) || event.declaredCostPence < 0)
      return blocked('EVENT_INVALID');
    const occurred = timestamp(event.occurredAt), observed = timestamp(event.observedAt);
    if (occurred === null || observed === null || !(start <= occurred && occurred < end &&
        occurred <= observed && observed <= asOf)) return blocked('EVENT_TIME_INVALID');
    if (eventIds.has(event.eventId) || evidenceRefs.has(event.evidenceRef) ||
        recordHashes.has(event.recordSha256) ||
        event.evidenceRef === root.evidenceRef) return blocked('DUPLICATE_EVIDENCE');
    eventIds.add(event.eventId);
    evidenceRefs.add(event.evidenceRef);
    recordHashes.add(event.recordSha256);
    Object.defineProperty(eventEvidence, String(eventEvidence.length), {
      value: { eventId: event.eventId, kind: event.kind, evidenceRef: event.evidenceRef,
        recordSha256: event.recordSha256, declaredCostPence: event.declaredCostPence },
      enumerable: true, writable: true, configurable: true
    });
    if (event.kind === 'REWORK') rework += event.declaredCostPence;
    else scrap += event.declaredCostPence;
    if (!Number.isSafeInteger(rework) || !Number.isSafeInteger(scrap) ||
        !Number.isSafeInteger(rework + scrap)) return blocked('COST_OVERFLOW');
  }
  return { status: 'REVIEW_DECLARED_COST', ...Object.fromEntries(scope.map(key => [key, root[key]])),
    windowStart: root.windowStart, windowEnd: root.windowEnd, asOf: root.asOf,
    sourceId: root.sourceId, sourceRevision: root.sourceRevision,
    evidenceRef: root.evidenceRef, eventCount: events.length,
    eventEvidence: eventEvidence.sort((a, b) => a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    declaredCostPence: { rework, scrap, total: rework + scrap },
    claimBoundary: 'SUPPLIED_QMS_AGGREGATE_ONLY', sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null };
};
