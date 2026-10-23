'use strict';

const { createHash } = require('node:crypto');
const money = require('./payroll-money.cjs')();
const CONTRACT_VERSION = 'VECTOR_SHIFT_PREMIUM_EVIDENCE_V1';
const RATE_EVIDENCE_VERSION = 'VECTOR_RATE_EVIDENCE_V1';
const POLICY_EVIDENCE_VERSION = 'VECTOR_PREMIUM_POLICY_EVIDENCE_V1';

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
function currency(value, field) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw Error(`${field} needs an uppercase three-letter currency.`);
  return value;
}
function digest(value) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function assertedDigest(value, expected, field) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value) || value !== expected) {
    throw Error(`${field} does not bind the declared monetary evidence.`);
  }
  return value;
}

function assessShiftPremiumEvidence(input) {
  const tenantId = label(own(input, 'tenantId'), 'tenantId');
  const siteId = label(own(input, 'siteId'), 'siteId');
  const scopeCurrency = currency(own(input, 'currency'), 'currency');
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
  const rateEvidenceRefs = [];
  const policyEvidenceRefs = [];
  const rateEvidenceOutput = [];
  const policyEvidenceOutput = [];
  const rateIdentities = new Map();
  const policyIdentities = new Map();
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
    const premiumCode = label(own(segment, 'premiumCode'), 'premiumCode');
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
    const rateEvidence = own(segment, 'rateEvidence');
    const rateRef = label(own(rateEvidence, 'ref'), 'rateEvidence.ref');
    const rateFromText = own(rateEvidence, 'validFrom');
    const rateToText = own(rateEvidence, 'validTo');
    const rateFrom = instant(rateFromText, 'rateEvidence.validFrom');
    const rateTo = instant(rateToText, 'rateEvidence.validTo');
    const rateCurrency = currency(own(rateEvidence, 'currency'), 'rateEvidence.currency');
    const evidencedRate = cost(own(rateEvidence, 'hourlyRate'), 'rateEvidence.hourlyRate', 0, 100000);
    if (rateCurrency !== scopeCurrency || evidencedRate !== hourlyRate || rateFrom > segmentStart || rateTo < segmentEnd || rateTo <= rateFrom) {
      throw Error('Rate evidence does not cover the segment monetary input.');
    }
    const rateDigest = assertedDigest(own(rateEvidence, 'digest'), digest([
      RATE_EVIDENCE_VERSION, tenantId, siteId, rateRef, rateFromText, rateToText, rateCurrency, evidencedRate
    ]), 'rateEvidence.digest');
    if (rateIdentities.has(rateRef) && rateIdentities.get(rateRef) !== rateDigest) throw Error('Rate evidence identity changed within the snapshot.');
    rateIdentities.set(rateRef, rateDigest);

    const premiumEvidence = own(segment, 'premiumEvidence');
    const policyRef = label(own(premiumEvidence, 'ref'), 'premiumEvidence.ref');
    const policyFromText = own(premiumEvidence, 'validFrom');
    const policyToText = own(premiumEvidence, 'validTo');
    const policyFrom = instant(policyFromText, 'premiumEvidence.validFrom');
    const policyTo = instant(policyToText, 'premiumEvidence.validTo');
    const policyCurrency = currency(own(premiumEvidence, 'currency'), 'premiumEvidence.currency');
    const evidencedRevision = label(own(premiumEvidence, 'policyRevision'), 'premiumEvidence.policyRevision');
    const evidencedCode = label(own(premiumEvidence, 'premiumCode'), 'premiumEvidence.premiumCode');
    const evidencedMultiplier = cost(own(premiumEvidence, 'multiplier'), 'premiumEvidence.multiplier', 1, 10);
    if (policyCurrency !== scopeCurrency || evidencedRevision !== policyRevision || evidencedCode !== premiumCode ||
        evidencedMultiplier !== multiplier || policyFrom > segmentStart || policyTo < segmentEnd || policyTo <= policyFrom) {
      throw Error('Premium-policy evidence does not cover the segment monetary input.');
    }
    const policyDigest = assertedDigest(own(premiumEvidence, 'digest'), digest([
      POLICY_EVIDENCE_VERSION, tenantId, siteId, policyRef, policyFromText, policyToText, policyCurrency,
      evidencedRevision, evidencedCode, evidencedMultiplier
    ]), 'premiumEvidence.digest');
    if (policyIdentities.has(policyRef) && policyIdentities.get(policyRef) !== policyDigest) throw Error('Premium-policy evidence identity changed within the snapshot.');
    policyIdentities.set(policyRef, policyDigest);
    const priced = money.components({ durationMs: segmentEnd - segmentStart, rate: hourlyRate, multiplier });
    basePence += priced.basePence;
    grossPence += priced.grossPence;
    premiumPence += priced.otherPremiumPence;
    if (![basePence, grossPence, premiumPence].every(Number.isSafeInteger)) throw Error('Premium aggregate exceeds safe pence.');
    refs.push(evidenceRef);
    rateEvidenceRefs.push(rateRef);
    policyEvidenceRefs.push(policyRef);
    rateEvidenceOutput.push(Object.freeze({ ref: rateRef, digest: rateDigest }));
    policyEvidenceOutput.push(Object.freeze({ ref: policyRef, digest: policyDigest }));
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION, status: premiumPence > 0 ? 'SUPPLIED_PLANNED_PREMIUM' : 'NO_DECLARED_PREMIUM',
    tenantId, siteId, asOf: input.asOf,
    period: Object.freeze({ start: period.start, end: period.end }),
    source: Object.freeze({ tenantId, siteId, name: sourceName, revision: sourceRevision, digest: sourceDigest, observedAt: source.observedAt }),
    currency: scopeCurrency, policyRevision, segmentCount: segments.length, basePence, grossPence, premiumPence,
    evidenceRefs: Object.freeze(refs), claimedSavingsPence: null,
    rateEvidenceRefs: Object.freeze(rateEvidenceRefs), policyEvidenceRefs: Object.freeze(policyEvidenceRefs),
    rateEvidence: Object.freeze(rateEvidenceOutput), premiumPolicyEvidence: Object.freeze(policyEvidenceOutput),
    sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessShiftPremiumEvidence, CONTRACT_VERSION };
