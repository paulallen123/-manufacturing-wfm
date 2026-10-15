'use strict';

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OBSERVATION_AGE_MS = 15 * 60 * 1000;

function id(value) {
  return typeof value === 'string' && value.length <= 120 && value.trim() === value && value.length > 0;
}

function instant(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const number = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +fraction.padEnd(3, '0'));
  const date = new Date(number);
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() + 1 !== +month ||
      date.getUTCDate() !== +day || date.getUTCHours() !== +hour ||
      date.getUTCMinutes() !== +minute || date.getUTCSeconds() !== +second) return null;
  return number;
}

function blocked(reason) {
  return Object.freeze({ status: 'BLOCKED', reason });
}

/** Read-only consistency assessment. Source refs and completeness are caller claims. */
function assessMaintenanceProductionImpact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return blocked('INVALID_INPUT');
  const { tenantId, siteId, assetId, workOrder, window, production } = input;
  if (![tenantId, siteId, assetId].every(id) || !workOrder || !window || !production)
    return blocked('INVALID_SCOPE');
  if (![workOrder, production].every(source => source && typeof source === 'object' && !Array.isArray(source) &&
      source.tenantId === tenantId && source.siteId === siteId && source.assetId === assetId))
    return blocked('SCOPE_MISMATCH');
  if (workOrder.status !== 'OPEN' || !id(workOrder.id) ||
      ![workOrder.sourceRevision, workOrder.evidenceRef, production.sourceRevision, production.evidenceRef].every(id))
    return blocked('SOURCE_UNVERIFIED');
  if (production.complete !== true || !Array.isArray(production.runs) || production.runs.length > 100)
    return blocked('PRODUCTION_INCOMPLETE');

  const now = instant(input.now);
  const start = instant(window.start);
  const end = instant(window.end);
  const plannedStart = instant(workOrder.plannedStart);
  const plannedEnd = instant(workOrder.plannedEnd);
  const workOrderObserved = instant(workOrder.observedAt);
  const workOrderValidUntil = instant(workOrder.validUntil);
  const observed = instant(production.observedAt);
  const validUntil = instant(production.validUntil);
  if ([now, start, end, plannedStart, plannedEnd, workOrderObserved, workOrderValidUntil, observed, validUntil]
    .some(time => time === null) ||
      start < now || end <= start || end - start > MAX_WINDOW_MS ||
      plannedStart !== start || plannedEnd !== end ||
      workOrderObserved > now || now - workOrderObserved > MAX_OBSERVATION_AGE_MS ||
      workOrderValidUntil < end || observed > now ||
      now - observed > MAX_OBSERVATION_AGE_MS || validUntil < end)
    return blocked('TIME_UNVERIFIED');

  const runs = [];
  for (const run of production.runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run) || !id(run.orderId) ||
        run.tenantId !== tenantId || run.siteId !== siteId || run.assetId !== assetId)
      return blocked('RUN_INVALID');
    const runStart = instant(run.start);
    const runEnd = instant(run.end);
    if (runStart === null || runEnd === null || runEnd <= runStart)
      return blocked('RUN_INVALID');
    runs.push({ orderId: run.orderId, start: runStart, end: runEnd });
  }
  runs.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < runs.length; i++)
    if (runs[i].start < runs[i - 1].end) return blocked('PRODUCTION_OVERLAP');

  let overlapMs = 0;
  const orderIds = new Set();
  for (const run of runs) {
    const amount = Math.max(0, Math.min(end, run.end) - Math.max(start, run.start));
    if (amount > 0) {
      overlapMs += amount;
      orderIds.add(run.orderId);
    }
  }
  return Object.freeze({
    status: 'ADVISORY_ONLY', tenantId, siteId, assetId, workOrderId: workOrder.id,
    overlapMinutes: overlapMs / 60000,
    affectedOrderIds: Object.freeze([...orderIds].sort()),
    evidenceRefs: Object.freeze([workOrder.evidenceRef, production.evidenceRef]),
    sourceAuthenticated: false,
  });
}

module.exports = { assessMaintenanceProductionImpact };
