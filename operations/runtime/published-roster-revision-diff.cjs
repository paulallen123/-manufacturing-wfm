'use strict';

// Caller-supplied publication receipts require trusted source and role binding upstream.
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function id(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x.trim() === x; }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) fail('INVALID_INSTANT');
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('INVALID_INSTANT');
  return n;
}
function snapshot(raw, input, asOf) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    !id(raw.source) || !id(raw.recordId) || !id(raw.revision) ||
    typeof raw.recordSha256 !== 'string' || !SHA.test(raw.recordSha256) ||
    raw.tenantId !== input.tenantId || raw.siteId !== input.siteId ||
    raw.windowStart !== input.windowStart || raw.windowEnd !== input.windowEnd ||
    raw.state !== 'PUBLISHED' || raw.complete !== true || !Array.isArray(raw.slots) ||
    raw.slots.length < 1 || raw.slots.length > 10000) fail('INVALID_ROSTER');
  const publishedAt = instant(raw.publishedAt), observedAt = instant(raw.observedAt);
  if (publishedAt > observedAt || observedAt > asOf) fail('ROSTER_CHRONOLOGY');
  const slots = new Map();
  for (const s of raw.slots) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || !id(s.slotId) ||
      !(s.workerRef === null || id(s.workerRef)) || slots.has(s.slotId)) fail('INVALID_SLOT');
    const start = instant(s.start), end = instant(s.end);
    if (start < instant(input.windowStart) || end > instant(input.windowEnd) ||
      end <= start || start <= asOf) fail('INVALID_SLOT_WINDOW');
    slots.set(s.slotId, { workerRef: s.workerRef, start: s.start, end: s.end });
  }
  return { source: raw.source, recordId: raw.recordId, revision: raw.revision,
    recordSha256: raw.recordSha256, publishedAt, slots };
}
function comparePublishedRosters(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !id(input.tenantId) || !id(input.siteId)) fail('INVALID_SCOPE');
  const asOf = instant(input.asOf), start = instant(input.windowStart), end = instant(input.windowEnd);
  if (end <= start || start <= asOf || end - start > 30 * 86400000) fail('INVALID_WINDOW');
  const before = snapshot(input.before, input, asOf), after = snapshot(input.after, input, asOf);
  if (before.source !== after.source || before.recordSha256 === after.recordSha256 ||
    before.recordId === after.recordId && before.revision === after.revision ||
    after.publishedAt <= before.publishedAt ||
    input.after.previousRecordSha256 !== before.recordSha256) fail('REVISION_MISMATCH');
  const changed = [];
  const keys = [...new Set([...before.slots.keys(), ...after.slots.keys()])].sort();
  for (const slotId of keys) {
    const a = before.slots.get(slotId), b = after.slots.get(slotId);
    const kind = !a ? 'ADDED' : !b ? 'REMOVED' :
      a.workerRef !== b.workerRef && (a.start !== b.start || a.end !== b.end) ? 'ASSIGNMENT_AND_TIME' :
      a.workerRef !== b.workerRef ? 'ASSIGNMENT' :
      a.start !== b.start || a.end !== b.end ? 'TIME' : null;
    if (kind) changed.push(Object.freeze({ slotId, kind }));
  }
  return Object.freeze({
    tenantId: input.tenantId, siteId: input.siteId, windowStart: input.windowStart, windowEnd: input.windowEnd,
    beforeRecordSha256: before.recordSha256, afterRecordSha256: after.recordSha256,
    changedSlotCount: changed.length, changedSlots: Object.freeze(changed),
    claimBoundary: 'DECLARED_PUBLISHED_SLOT_CHURN_NOT_COST_OR_SAVINGS',
    sourceAuthenticated: false, completeSourceVerified: false, scheduleAuthority: false,
    payrollAuthority: false, executionAuthority: false
  });
}
module.exports = { comparePublishedRosters };
