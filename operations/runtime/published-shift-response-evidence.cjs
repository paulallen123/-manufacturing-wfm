'use strict';

// Advisory consistency check. The caller must authenticate the schedule and response producers.
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && value === value.trim(); }
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('INVALID_INSTANT');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('INVALID_INSTANT');
  return ms;
}
function identity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !['tenantId', 'siteId', 'shiftId', 'slotId', 'workerRef'].every(key => id(value[key]))) fail('INVALID_SCOPE');
}
function ref(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !id(value.source) || !id(value.recordId) || !id(value.revision) ||
    typeof value.recordSha256 !== 'string' || !SHA.test(value.recordSha256)) fail('INVALID_SOURCE_REF');
}
function assessPublishedShiftResponse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT');
  const { published, response } = input;
  identity(input); identity(published); ref(published);
  const asOf = instant(input.asOf), start = instant(input.windowStart), end = instant(input.windowEnd);
  if (end <= start || start <= asOf || end - start > 86400000) fail('INVALID_WINDOW');
  const publishedAt = instant(published.eventAt), observedAt = instant(published.observedAt);
  if (publishedAt > observedAt || observedAt > asOf || publishedAt > start ||
    published.windowStart !== input.windowStart || published.windowEnd !== input.windowEnd ||
    ['tenantId', 'siteId', 'shiftId', 'slotId', 'workerRef'].some(key => published[key] !== input[key]) ||
    published.state !== 'PUBLISHED') fail('PUBLISHED_SHIFT_MISMATCH');
  const base = {
    status: 'UNKNOWN', tenantId: input.tenantId, siteId: input.siteId, shiftId: input.shiftId,
    slotId: input.slotId, windowStart: input.windowStart, windowEnd: input.windowEnd,
    publishedRecordSha256: published.recordSha256, responseRecordSha256: null,
    sourceAuthenticated: false, scheduleAuthority: false, attendanceAuthority: false,
    payrollAuthority: false, decisionAuthority: false
  };
  if (response == null) return Object.freeze(base);
  identity(response); ref(response);
  const responseAt = instant(response.eventAt), responseObservedAt = instant(response.observedAt);
  if (responseAt < publishedAt || responseAt > responseObservedAt || responseObservedAt > asOf ||
    responseAt >= start || response.publishedRecordSha256 !== published.recordSha256 ||
    response.windowStart !== input.windowStart || response.windowEnd !== input.windowEnd ||
    ['tenantId', 'siteId', 'shiftId', 'slotId', 'workerRef'].some(key => response[key] !== input[key]) ||
    !['ACKNOWLEDGED', 'DECLINED'].includes(response.state) ||
    (response.source === published.source && response.recordId === published.recordId) ||
    response.recordSha256 === published.recordSha256) fail('RESPONSE_MISMATCH');
  return Object.freeze({ ...base, status: response.state, responseRecordSha256: response.recordSha256 });
}
module.exports = { assessPublishedShiftResponse };
