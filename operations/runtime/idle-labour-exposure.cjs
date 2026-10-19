'use strict';

const CONTRACT_VERSION = 'VECTOR_IDLE_LABOUR_EXPOSURE_V1';

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${field} must be nonempty text.`);
  return value.trim();
}

function minute(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00Z$/.test(value)) {
    throw new Error(`${field} must be a UTC ISO minute.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value) throw new Error(`${field} is not a real UTC minute.`);
  return time;
}

function count(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100000) {
    throw new Error(`${field} must be a nonnegative safe count.`);
  }
  return value;
}

function assessIdleLabourExposure(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A staffing snapshot is required.');
  const tenantId = requiredText(input.tenantId, 'tenantId');
  const siteId = requiredText(input.siteId, 'siteId');
  const asOf = minute(input.asOf, 'asOf');
  const windowStart = minute(input.window?.start, 'window.start');
  const windowEnd = minute(input.window?.end, 'window.end');
  if (windowEnd <= windowStart || windowEnd - windowStart > 31 * 86400000 || windowEnd > asOf) {
    throw new Error('Window must be positive, at most 31 days and observed by asOf.');
  }
  const source = input.source;
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      ['name', 'revision', 'digest', 'observedAt', 'complete'].some(key => !Object.hasOwn(source, key)) ||
      source.complete !== true) {
    throw new Error('A complete source snapshot is required.');
  }
  const sourceName = requiredText(source.name, 'source.name');
  const sourceRevision = requiredText(source.revision, 'source.revision');
  const sourceDigest = requiredText(source.digest, 'source.digest');
  const observedAt = minute(source.observedAt, 'source.observedAt');
  if (observedAt < windowEnd || observedAt > asOf) throw new Error('Source observation must cover the window and precede asOf.');
  if (!Array.isArray(input.intervals) || input.intervals.length < 1 || input.intervals.length > 10000) {
    throw new Error('A bounded, complete interval collection is required.');
  }
  let cursor = windowStart;
  let surplus = 0;
  let shortfall = 0;
  const evidenceRefs = [];
  const seen = new Set();
  for (const row of input.intervals) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        ['tenantId', 'siteId', 'start', 'end', 'assignedCount', 'requiredCount', 'evidenceRef'].some(key => !Object.hasOwn(row, key)) ||
        row.tenantId !== tenantId || row.siteId !== siteId) {
      throw new Error('Every staffing interval must belong to the requested tenant and site.');
    }
    const start = minute(row.start, 'interval.start');
    const end = minute(row.end, 'interval.end');
    if (start !== cursor || end <= start || end > windowEnd) throw new Error('Staffing intervals must exactly cover the window without gaps or overlap.');
    const evidenceRef = requiredText(row.evidenceRef, 'interval.evidenceRef');
    if (seen.has(evidenceRef)) throw new Error('Staffing interval evidence must be distinct.');
    seen.add(evidenceRef);
    evidenceRefs.push(evidenceRef);
    const assigned = count(row.assignedCount, 'assignedCount');
    const required = count(row.requiredCount, 'requiredCount');
    const minutes = (end - start) / 60000;
    surplus += Math.max(0, assigned - required) * minutes;
    shortfall += Math.max(0, required - assigned) * minutes;
    if (!Number.isSafeInteger(surplus) || !Number.isSafeInteger(shortfall)) throw new Error('Staffing exposure exceeds safe integer minutes.');
    cursor = end;
  }
  if (cursor !== windowEnd) throw new Error('Staffing intervals must cover the entire window.');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION, status: surplus > 0 ? 'REVIEW' : 'NO_SURPLUS',
    tenantId, siteId, asOf: input.asOf,
    window: Object.freeze({ start: input.window.start, end: input.window.end }),
    source: Object.freeze({ name: sourceName, revision: sourceRevision, digest: sourceDigest, observedAt: source.observedAt }),
    potentialSurplusWorkerMinutes: surplus, shortfallWorkerMinutes: shortfall,
    evidenceRefs: Object.freeze(evidenceRefs), sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessIdleLabourExposure, CONTRACT_VERSION };
