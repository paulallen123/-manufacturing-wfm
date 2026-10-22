'use strict';

const money = require('./payroll-money.cjs')();
const CONTRACT_VERSION = 'VECTOR_SHIFT_PREMIUM_EVIDENCE_V1';

function own(row, key) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error(`${key} needs an evidence object.`);
  const descriptor = Object.getOwnPropertyDescriptor(row, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error(`${key} must be an own data field.`);
  return descriptor.value;
}
function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(`${field} needs bounded text.`);
  return value.trim();
}
function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(value)) {
    throw Error(`${field} needs a UTC ISO second.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value) throw Error(`${field} is not a real UTC instant.`);
  return time;
}
function cost(value, field, lower, upper) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lower || value > upper) throw Error(`${field} is outside the supported numeric range.`);
  return value;
}

function assessShiftPremiumEvidence(input) {
  const tenantId = label(own(input, 'tenantId'), 'tenantId');
  const siteId = label(own(input, 'siteId'), 'siteId');
  const asOf = instant(own(input, 'asOf'), 'asOf');
  const period = own(input, 'period');
  const start = instant(own(period, 'start'), 'period.start');
  const end = instant(own(period, 'end'), 'period.end');
  if (end <= start || end - start > 31 * 86400000 || end > asOf) throw Error('The completed period must be positive and bounded.');
  const policyRevision = label(own(input, 'policyRevision'), 'policyRevision');
  const source = own(input, 'source');
  if (own(source, 'tenantId') !== tenantId || own(source, 'siteId') !== siteId) throw Error('Source tenant/site differs from requested scope.');
  if (own(source, 'complete') !== true) throw Error('The source snapshot must be complete.');
  const sourceName = label(own(source, 'name'), 'source.name');
  const sourceRevision = label(own(source, 'revision'), 'source.revision');
  const sourceDigest = label(own(source, 'digest'), 'source.digest');
  const observedAt = instant(own(source, 'observedAt'), 'source.observedAt');
  if (observedAt < end || observedAt > asOf) throw Error('The source observation must cover the period and precede asOf.');
  const segments = own(input, 'segments');
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 1000) throw Error('A bounded segment list is required.');
  const refs = [];
  const seenRefs = new Set();
  const assignments = new Map();
  let basePence = 0, grossPence = 0, premiumPence = 0;
  for (let index = 0; index < segments.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(segments, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Segments must be explicit own data entries.');
    const segment = descriptor.value;
    if (own(segment, 'tenantId') !== tenantId || own(segment, 'siteId') !== siteId) throw Error('Segment tenant/site differs from requested scope.');
    const assignmentRef = label(own(segment, 'assignmentRef'), 'assignmentRef');
    const evidenceRef = label(own(segment, 'evidenceRef'), 'evidenceRef');
    if (seenRefs.has(evidenceRef)) throw Error('Duplicate segment evidence.');
    seenRefs.add(evidenceRef);
    if (own(segment, 'policyRevision') !== policyRevision) throw Error('Segment premium policy revision differs.');
    label(own(segment, 'premiumCode'), 'premiumCode');
    const segmentStart = instant(own(segment, 'start'), 'segment.start');
    const segmentEnd = instant(own(segment, 'end'), 'segment.end');
    if (segmentStart < start || segmentEnd > end || segmentEnd <= segmentStart || segmentEnd - segmentStart > 24 * 3600000) {
      throw Error('A premium segment must be positive, at most 24 hours and inside the period.');
    }
    const previous = assignments.get(assignmentRef) || [];
    if (previous.some(([a, b]) => segmentStart < b && a < segmentEnd)) throw Error('Overlapping segments for one assignment.');
    previous.push([segmentStart, segmentEnd]);
    assignments.set(assignmentRef, previous);
    const hourlyRate = cost(own(segment, 'hourlyRate'), 'hourlyRate', 0, 100000);
    const multiplier = cost(own(segment, 'multiplier'), 'multiplier', 1, 10);
    const priced = money.components({ durationMs: segmentEnd - segmentStart, rate: hourlyRate, multiplier });
    basePence += priced.basePence;
    grossPence += priced.grossPence;
    premiumPence += priced.otherPremiumPence;
    if (![basePence, grossPence, premiumPence].every(Number.isSafeInteger)) throw Error('Premium aggregate exceeds safe pence.');
    refs.push(evidenceRef);
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION, status: premiumPence > 0 ? 'SUPPLIED_PLANNED_PREMIUM' : 'NO_DECLARED_PREMIUM',
    tenantId, siteId, asOf: input.asOf,
    period: Object.freeze({ start: period.start, end: period.end }),
    source: Object.freeze({ tenantId, siteId, name: sourceName, revision: sourceRevision, digest: sourceDigest, observedAt: source.observedAt }),
    policyRevision, segmentCount: segments.length, basePence, grossPence, premiumPence,
    evidenceRefs: Object.freeze(refs), claimedSavingsPence: null,
    sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessShiftPremiumEvidence, CONTRACT_VERSION };
