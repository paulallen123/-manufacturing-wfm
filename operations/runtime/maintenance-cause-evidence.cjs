'use strict';

// Consistency check for PR #421's source-declared failure event and a separate
// CMMS cause record. Source authentication remains the caller's responsibility.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/i;
const id = value => typeof value === 'string' && ID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}
function blocked(reason) { return Object.freeze({ status: 'BLOCKED', reason }); }

function assessMaintenanceCauseEvidence(input) {
  const result = input?.reliability;
  const scope = result?.scope;
  const snapshot = result?.evidence?.snapshot;
  const events = result?.evidence?.events;
  const now = instant(input?.now);
  const evaluated = instant(result?.evaluatedAt);
  const snapshotObserved = instant(snapshot?.observedAt);
  const maxAge = input?.maxEvidenceAgeMs;
  if (result?.contractVersion !== 'VECTOR_MAINTENANCE_RELIABILITY_V1' ||
      result.status !== 'METRICS_ADVISORY' || result.executionAuthority !== false ||
      !id(scope?.tenant) || !id(scope?.site) || !id(scope?.assetId) ||
      !id(snapshot?.id) || !id(snapshot?.source) || !id(snapshot?.revision) ||
      !hash(snapshot?.recordHash) || !Array.isArray(events) || events.length > 10000 ||
      !id(input?.failureEventId) || !Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 86400000 ||
      now === null || evaluated !== now || snapshotObserved === null ||
      snapshotObserved > now || now - snapshotObserved > maxAge)
    return blocked('RELIABILITY_EVIDENCE_UNVERIFIED');

  const matches = events.filter(event => event?.id === input.failureEventId);
  if (matches.length !== 1) return blocked('FAILURE_EVENT_UNVERIFIED');
  const event = matches[0];
  const started = instant(event.startedAt);
  const ended = instant(event.endedAt);
  if (!id(event.revision) || !hash(event.recordHash) || started === null || ended === null ||
      started >= ended || ended > snapshotObserved)
    return blocked('FAILURE_EVENT_UNVERIFIED');

  const declaredCode = event.rootCauseCode;
  const declaredRef = event.rootCauseEvidenceRef;
  if (declaredCode == null && declaredRef == null && input.cause == null)
    return Object.freeze({ status: 'UNKNOWN', failureEventId: event.id,
      causalStatus: 'UNVERIFIED', executionAuthority: false,
      sourceAuthenticated: false, currentRevisionVerified: false });
  if (!id(declaredCode) || !id(declaredRef)) return blocked('CAUSE_NOT_DECLARED');

  const cause = input.cause;
  const causeObserved = instant(cause?.observedAt);
  if (!cause || cause.tenant !== scope.tenant || cause.site !== scope.site || cause.assetId !== scope.assetId ||
      cause.source !== snapshot.source || cause.failureEventId !== event.id ||
      cause.failureEventRevision !== event.revision || cause.failureRecordHash !== event.recordHash ||
      cause.rootCauseCode !== declaredCode || cause.evidenceRef !== declaredRef ||
      cause.status !== 'RECORDED' || !id(cause.revision) || !hash(cause.recordHash) ||
      causeObserved === null || causeObserved < started || causeObserved > now ||
      now - causeObserved > maxAge)
    return blocked('CAUSE_RECORD_UNVERIFIED');

  return Object.freeze({
    status: 'SOURCE_RECORDED', failureEventId: event.id, sourceRecordedCauseCode: declaredCode,
    evidenceRef: declaredRef, causalStatus: 'UNVERIFIED', executionAuthority: false,
    sourceAuthenticated: false, currentRevisionVerified: false,
    evidence: Object.freeze({
      source: snapshot.source, snapshotRecordHash: snapshot.recordHash,
      failureRevision: event.revision, failureRecordHash: event.recordHash,
      causeRevision: cause.revision, causeRecordHash: cause.recordHash,
      causeObservedAt: cause.observedAt,
    }),
  });
}

module.exports = { assessMaintenanceCauseEvidence };
