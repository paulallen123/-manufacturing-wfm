'use strict';

// Read-only comparison of supplied MES handover records. Authentication stays upstream.
const HASH = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function identifier(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x); }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) fail('INVALID_TIME');
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('INVALID_TIME');
  return n;
}
function issueSet(items) {
  if (!Array.isArray(items) || items.length > 500) fail('INVALID_ISSUE_SET');
  const seen = new Set();
  for (const item of items) {
    if (!identifier(item) || seen.has(item)) fail('INVALID_ISSUE_SET');
    seen.add(item);
  }
  return seen;
}
function receipt(row, input) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.source !== 'MES' ||
    row.tenantId !== input.tenantId || row.siteId !== input.siteId || row.lineId !== input.lineId ||
    row.handoverId !== input.handoverId || !identifier(row.recordId) || !identifier(row.revision) ||
    typeof row.recordSha256 !== 'string' || !HASH.test(row.recordSha256) || row.complete !== true) fail('INVALID_RECEIPT');
  const eventAt = instant(row.eventAt), observedAt = instant(row.observedAt);
  if (eventAt > observedAt || observedAt > input.asOfMs || input.asOfMs - observedAt > input.maxAgeMinutes * 60000) fail('STALE_OR_CONTRADICTORY_RECEIPT');
  return { eventAt, observedAt };
}
function assessLineHandoverAcknowledgement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !identifier(input.tenantId) || !identifier(input.siteId) || !identifier(input.lineId) || !identifier(input.handoverId) ||
    !Number.isSafeInteger(input.maxAgeMinutes) || input.maxAgeMinutes < 1 || input.maxAgeMinutes > 1440) fail('INVALID_SCOPE');
  const asOfMs = instant(input.asOf), handoverAt = instant(input.handoverAt);
  if (handoverAt > asOfMs) fail('INVALID_HANDOVER_TIME');
  const context = { ...input, asOfMs }, outgoing = input.outgoing, incoming = input.incoming;
  const outTime = receipt(outgoing, context), inTime = receipt(incoming, context);
  if (outgoing.state !== 'PUBLISHED' || incoming.state !== 'ACKNOWLEDGED' ||
    outgoing.recordSha256 === incoming.recordSha256 ||
    outgoing.recordId === incoming.recordId && outgoing.revision === incoming.revision ||
    !identifier(outgoing.shiftId) || !identifier(incoming.shiftId) || outgoing.shiftId === incoming.shiftId ||
    incoming.outgoingRecordSha256 !== outgoing.recordSha256 || incoming.outgoingRevision !== outgoing.revision ||
    outTime.eventAt > handoverAt || inTime.eventAt < handoverAt || outTime.observedAt > inTime.eventAt) fail('HANDOVER_LINK_MISMATCH');
  const open = issueSet(outgoing.openIssueIds), acknowledged = issueSet(incoming.acknowledgedIssueIds);
  for (const id of acknowledged) if (!open.has(id)) fail('UNKNOWN_ACKNOWLEDGEMENT');
  const unacknowledged = [...open].filter(id => !acknowledged.has(id)).sort();
  return Object.freeze({
    tenantId: input.tenantId, siteId: input.siteId, lineId: input.lineId, handoverId: input.handoverId,
    outgoingRecordSha256: outgoing.recordSha256, incomingRecordSha256: incoming.recordSha256,
    openIssueCount: open.size, acknowledgedIssueCount: acknowledged.size,
    unacknowledgedIssueIds: Object.freeze(unacknowledged),
    status: unacknowledged.length ? 'ACKNOWLEDGEMENT_GAP' : 'DECLARED_ACKNOWLEDGED',
    sourceAuthenticated: false, issueResolved: false, operationalRiskScored: false,
    scheduleAuthority: false, executionAuthority: false,
    claimBoundary: 'DECLARED_MES_HANDOVER_ACKNOWLEDGEMENT_ONLY'
  });
}
module.exports = { assessLineHandoverAcknowledgement };
