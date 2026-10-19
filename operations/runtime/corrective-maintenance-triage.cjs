'use strict';
const { createHash } = require('node:crypto');

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
const SNAPSHOT = ['tenantId','siteId','sourceRevision','complete','observedAt','validUntil','evidenceRef','contentDigest'];
const ORDER = ['tenantId','siteId','sourceRevision','id','assetId','kind','status','severity','reportedAt','responseDueAt','observedAt','evidenceRef'];
const SEVERITY = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SOON_MS = 60 * 60 * 1000;

// Read-only CMMS review queue. Source custody, role admission and any work-order
// change remain the responsibility of the authenticated canonical application.
module.exports = function assessCorrectiveMaintenance(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false, executionAuthority: false });
  if (!input || !id(input.tenantId) || !id(input.siteId) || time(input.asOf) === null) return blocked('SCOPE_INVALID');
  const snapshot = input.snapshot, now = time(input.asOf);
  if (!fields(snapshot, SNAPSHOT) || snapshot.tenantId !== input.tenantId || snapshot.siteId !== input.siteId ||
      !id(snapshot.sourceRevision) || !id(snapshot.evidenceRef) || snapshot.complete !== true ||
      !/^[a-f0-9]{64}$/.test(snapshot.contentDigest || '') ||
      time(snapshot.observedAt) === null || time(snapshot.validUntil) === null ||
      !(time(snapshot.observedAt) <= now && now < time(snapshot.validUntil))) return blocked('SNAPSHOT_UNPROVEN');
  if (!Array.isArray(input.workOrders) || input.workOrders.length > 256) return blocked('ORDERS_INVALID');
  const seen = new Set(), queue = [];
  let openCount = 0;
  for (const row of input.workOrders) {
    if (!fields(row, ORDER) || row.tenantId !== input.tenantId || row.siteId !== input.siteId ||
        row.sourceRevision !== snapshot.sourceRevision || !id(row.id) || !id(row.assetId) ||
        !id(row.evidenceRef) || row.kind !== 'CORRECTIVE' || !['OPEN','CLOSED'].includes(row.status) ||
        !Object.hasOwn(SEVERITY, row.severity) || seen.has(row.id)) return blocked('ORDER_UNPROVEN');
    seen.add(row.id);
    const reported = time(row.reportedAt), due = time(row.responseDueAt), observed = time(row.observedAt);
    if (reported === null || due === null || observed === null ||
        reported > due || reported > observed || observed > time(snapshot.observedAt)) return blocked('ORDER_TIME_INVALID');
    if (row.status !== 'OPEN') continue;
    openCount++;
    const urgency = due <= now ? 'OVERDUE' : due <= now + SOON_MS ? 'DUE_SOON' : null;
    if (urgency) queue.push({ workOrderId: row.id, assetId: row.assetId, urgency,
      severity: row.severity, responseDueAt: row.responseDueAt, evidenceRef: row.evidenceRef });
  }
  const canonical = input.workOrders.map(row => Object.keys(row).sort().map(key => [key, row[key]]))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  if (digest !== snapshot.contentDigest) return blocked('SNAPSHOT_CONTENT_MISMATCH');
  queue.sort((a,b) => (a.urgency === b.urgency ? 0 : a.urgency === 'OVERDUE' ? -1 : 1) ||
    time(a.responseDueAt) - time(b.responseDueAt) || SEVERITY[a.severity] - SEVERITY[b.severity] ||
    a.workOrderId.localeCompare(b.workOrderId));
  return { status: 'ASSESSED', tenantId: input.tenantId, siteId: input.siteId,
    sourceRevision: snapshot.sourceRevision, snapshotEvidenceRef: snapshot.evidenceRef,
    openCount, reviewQueue: queue, sourceAuthenticated: false, executionAuthority: false };
};
