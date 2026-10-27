'use strict';

// Pairwise declared overlap only. Source authentication and release authority stay upstream.
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function id(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x.trim() === x; }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) fail('INVALID_INSTANT');
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('INVALID_INSTANT');
  return n;
}
function receipt(x, input, asOf) {
  if (!x || typeof x !== 'object' || Array.isArray(x) ||
    !id(x.source) || !id(x.recordId) || !id(x.revision) ||
    typeof x.recordSha256 !== 'string' || !SHA.test(x.recordSha256) ||
    x.tenantId !== input.tenantId || x.siteId !== input.siteId ||
    x.workerRef !== input.workerRef) fail('RECEIPT_SCOPE_MISMATCH');
  const start = instant(x.start), end = instant(x.end), eventAt = instant(x.eventAt), observedAt = instant(x.observedAt);
  if (start <= asOf || end <= start || end - start > 86400000 ||
    eventAt > observedAt || observedAt > asOf || eventAt > start) fail('RECEIPT_CHRONOLOGY');
  return { source: x.source, recordId: x.recordId, revision: x.revision,
    recordSha256: x.recordSha256, start, end };
}
function assessTrainingShiftCollision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !id(input.tenantId) || !id(input.siteId) || !id(input.workerRef)) fail('INVALID_SCOPE');
  const asOf = instant(input.asOf);
  const shift = receipt(input.publishedShift, input, asOf);
  const training = receipt(input.trainingSession, input, asOf);
  if (!id(input.publishedShift.shiftId) || !id(input.publishedShift.slotId) ||
    input.publishedShift.state !== 'PUBLISHED' ||
    !id(input.trainingSession.sessionId) || input.trainingSession.state !== 'CONFIRMED' ||
    input.trainingSession.attendanceRequired !== true ||
    shift.source === training.source || shift.recordSha256 === training.recordSha256) fail('INCOMPATIBLE_RECEIPTS');
  const overlapMs = Math.max(0, Math.min(shift.end, training.end) - Math.max(shift.start, training.start));
  return Object.freeze({
    tenantId: input.tenantId, siteId: input.siteId,
    shiftId: input.publishedShift.shiftId, slotId: input.publishedShift.slotId,
    sessionId: input.trainingSession.sessionId,
    shiftRecordSha256: shift.recordSha256, trainingRecordSha256: training.recordSha256,
    declaredOverlapMinutes: overlapMs / 60000,
    status: overlapMs > 0 ? 'DECLARED_CONFLICT' : 'NO_DECLARED_OVERLAP',
    claimBoundary: 'PAIRWISE_DECLARED_TRAINING_SHIFT_OVERLAP_ONLY',
    sourceAuthenticated: false, rosterCompleteVerified: false,
    scheduleAuthority: false, trainingAuthority: false, payrollAuthority: false,
    executionAuthority: false
  });
}
module.exports = { assessTrainingShiftCollision };
