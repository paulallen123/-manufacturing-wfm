'use strict';

// Read-only aggregation of a complete, source-owned CMMS failure window.
// No operating-time denominator, cost, cause inference, or work-order authority.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/i;
const id = value => typeof value === 'string' && ID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function assessMaintenanceReliability(input) {
  const scope = input?.scope || {};
  const now = instant(input?.now);
  const from = instant(input?.window?.from);
  const until = instant(input?.window?.until);
  const age = input?.maxEvidenceAgeMs;
  if (!id(scope.tenant) || !id(scope.site) || !id(input?.assetId)
      || now === null || from === null || until === null || from >= until || until > now
      || !Number.isSafeInteger(age) || age < 1 || age > 86400000) {
    throw new Error('Exact scope, asset, closed UTC window, evaluation time and bounded evidence age required.');
  }
  const snapshot = input.snapshot;
  const observed = instant(snapshot?.observedAt);
  const blockers = [];
  if (!id(input?.expectedSource) || !snapshot || !id(snapshot.id)
      || snapshot.tenant !== scope.tenant || snapshot.site !== scope.site
      || snapshot.assetId !== input.assetId || snapshot.complete !== true
      || snapshot.window?.from !== input.window.from || snapshot.window?.until !== input.window.until
      || snapshot.provenance?.source !== input.expectedSource || !id(snapshot.revision)
      || snapshot.provenance?.revision !== snapshot.revision
      || !hash(snapshot.provenance?.recordHash)
      || observed === null || observed < until || observed > now || now - observed > age
      || !Array.isArray(snapshot.events) || snapshot.events.length > 10000) {
    blockers.push('CMMS_WINDOW_UNPROVEN');
  }
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const seen = new Set();
  const intervals = [];
  const references = [];
  for (const event of events) {
    const start = instant(event?.startedAt);
    const end = instant(event?.endedAt);
    if (!id(event?.id) || seen.has(event.id) || event.tenant !== scope.tenant
        || event.site !== scope.site || event.assetId !== input.assetId
        || event.kind !== 'UNPLANNED_FAILURE' || event.source !== input.expectedSource
        || !id(event.revision) || !hash(event.recordHash)
        || start === null || end === null || start >= end || start >= until || end <= from
        || end > observed) {
      blockers.push('FAILURE_EVENT_UNPROVEN');
      break;
    }
    seen.add(event.id);
    intervals.push([Math.max(start, from), Math.min(end, until)]);
    const causeReferenced = id(event.rootCauseCode) && id(event.rootCauseEvidenceRef);
    references.push(Object.freeze({ id: event.id, revision: event.revision,
      recordHash: event.recordHash, startedAt: event.startedAt, endedAt: event.endedAt,
      rootCauseCode: causeReferenced ? event.rootCauseCode : null,
      rootCauseEvidenceRef: causeReferenced ? event.rootCauseEvidenceRef : null }));
  }
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.some((range, index) => index > 0 && range[0] < intervals[index - 1][1])) {
    blockers.push('OVERLAPPING_FAILURE_EVENTS');
  }
  const supported = blockers.length === 0;
  const downtimeMinutes = supported ? intervals.reduce((sum, [start, end]) => sum + (end - start) / 60000, 0) : null;
  const startedFailureCount = supported ? events.filter(event => instant(event.startedAt) >= from).length : null;
  return Object.freeze({
    contractVersion: 'VECTOR_MAINTENANCE_RELIABILITY_V1',
    status: supported ? 'METRICS_ADVISORY' : 'BLOCKED',
    scope: Object.freeze({ tenant: scope.tenant, site: scope.site, assetId: input.assetId }),
    window: Object.freeze({ from: input.window.from, until: input.window.until }),
    evaluatedAt: input.now,
    blockers: Object.freeze([...new Set(blockers)]),
    metrics: supported ? Object.freeze({ unplannedFailuresStarted: startedFailureCount,
      unplannedDowntimeMinutes: downtimeMinutes }) : null,
    evidence: supported ? Object.freeze({ snapshot: Object.freeze({ id: snapshot.id,
      source: snapshot.provenance.source, revision: snapshot.revision,
      recordHash: snapshot.provenance.recordHash, observedAt: snapshot.observedAt }),
      events: Object.freeze(references) }) : null,
    executionAuthority: false,
    claimBoundary: 'Counts source-declared failures starting in the window and clipped downtime in a complete CMMS window; no MTBF, MTTR, root-cause inference, cost or savings claim.'
  });
}

module.exports = { assessMaintenanceReliability };
