'use strict';

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
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
  if (!exact(input, rootFields) || !scope.every(key => id(input[key])) ||
      input.sourceKind !== 'QMS' || !id(input.sourceId) || !id(input.sourceRevision) ||
      !id(input.evidenceRef) || input.complete !== true || !Array.isArray(input.events) ||
      input.events.length > 10000) return blocked('SOURCE_OR_SCOPE_INVALID');
  const start = timestamp(input.windowStart), end = timestamp(input.windowEnd), asOf = timestamp(input.asOf);
  if (start === null || end === null || asOf === null || !(start < end && end <= asOf))
    return blocked('WINDOW_INVALID');
  const eventIds = new Set(), evidenceRefs = new Set(), recordHashes = new Set();
  const eventEvidence = [];
  let rework = 0, scrap = 0;
  for (const event of input.events) {
    if (!exact(event, eventFields) || !scope.every(key => event[key] === input[key]) ||
        !id(event.eventId) || !id(event.evidenceRef) ||
        event.sourceRevision !== input.sourceRevision ||
        !['REWORK', 'SCRAP'].includes(event.kind) ||
        !/^[a-f0-9]{64}$/.test(event.recordSha256 || '') ||
        !Number.isSafeInteger(event.declaredCostPence) || event.declaredCostPence < 0)
      return blocked('EVENT_INVALID');
    const occurred = timestamp(event.occurredAt), observed = timestamp(event.observedAt);
    if (occurred === null || observed === null || !(start <= occurred && occurred < end &&
        occurred <= observed && observed <= asOf)) return blocked('EVENT_TIME_INVALID');
    if (eventIds.has(event.eventId) || evidenceRefs.has(event.evidenceRef) ||
        recordHashes.has(event.recordSha256) ||
        event.evidenceRef === input.evidenceRef) return blocked('DUPLICATE_EVIDENCE');
    eventIds.add(event.eventId);
    evidenceRefs.add(event.evidenceRef);
    recordHashes.add(event.recordSha256);
    eventEvidence.push({ eventId: event.eventId, kind: event.kind, evidenceRef: event.evidenceRef,
      recordSha256: event.recordSha256, declaredCostPence: event.declaredCostPence });
    if (event.kind === 'REWORK') rework += event.declaredCostPence;
    else scrap += event.declaredCostPence;
    if (!Number.isSafeInteger(rework) || !Number.isSafeInteger(scrap) ||
        !Number.isSafeInteger(rework + scrap)) return blocked('COST_OVERFLOW');
  }
  return { status: 'REVIEW_DECLARED_COST', ...Object.fromEntries(scope.map(key => [key, input[key]])),
    windowStart: input.windowStart, windowEnd: input.windowEnd, asOf: input.asOf,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    evidenceRef: input.evidenceRef, eventCount: input.events.length,
    eventEvidence: eventEvidence.sort((a, b) => a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    declaredCostPence: { rework, scrap, total: rework + scrap },
    claimBoundary: 'SUPPLIED_QMS_AGGREGATE_ONLY', sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null };
};
