'use strict';

const { types: { isProxy } } = require('node:util');
const { freeze, getOwnPropertyDescriptor, hasOwn } = Object;
const isArray = Array.isArray;
const finite = Number.isFinite;
const parseDate = Date.parse;
const DateCtor = Date;
const max = Math.max;
const SetCtor = Set;
const trim = Function.prototype.call.bind(String.prototype.trim);
const toISOString = Function.prototype.call.bind(Date.prototype.toISOString);
const setHas = Function.prototype.call.bind(Set.prototype.has);
const setAdd = Function.prototype.call.bind(Set.prototype.add);
const push = Function.prototype.call.bind(Array.prototype.push);
const regexTest = Function.prototype.call.bind(RegExp.prototype.test);
const replace = Function.prototype.call.bind(String.prototype.replace);
const CONTRACT_VERSION = 'VECTOR_DEMAND_PEAK_EVIDENCE_V1';
const MAX_WINDOW_MS = 31 * 86400000;

function own(object, field) {
  if (!object || typeof object !== 'object' || isProxy(object) || isArray(object)) throw Error(`${field} needs an evidence object.`);
  const descriptor = getOwnPropertyDescriptor(object, field);
  if (!descriptor || !hasOwn(descriptor, 'value')) throw Error(`${field} must be an own data field.`);
  return descriptor.value;
}
function label(value, field) {
  if (typeof value !== 'string' || !trim(value) || value.length > 200) throw Error(`${field} needs bounded text.`);
  return trim(value);
}
function instant(value, field) {
  if (typeof value !== 'string' || !regexTest(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/, value)) throw Error(`${field} needs a UTC ISO second.`);
  const ms = parseDate(value);
  if (!finite(ms) || replace(toISOString(new DateCtor(ms)), '.000Z', 'Z') !== value) throw Error(`${field} is not a real UTC instant.`);
  return ms;
}
function number(value, field, maximum) {
  if (typeof value !== 'number' || !finite(value) || value < 0 || value > maximum) throw Error(`${field} is outside the supported numeric range.`);
  return value;
}
function scope(row, tenantId, siteId, field) {
  if (own(row, 'tenantId') !== tenantId || own(row, 'siteId') !== siteId) throw Error(`${field} tenant/site differs from requested scope.`);
}

function assessDemandPeakEvidence(input) {
  const tenantId = label(own(input, 'tenantId'), 'tenantId');
  const siteId = label(own(input, 'siteId'), 'siteId');
  const asOfValue = own(input, 'asOf');
  const asOf = instant(asOfValue, 'asOf');
  const period = own(input, 'period');
  const startValue = own(period, 'start');
  const endValue = own(period, 'end');
  const start = instant(startValue, 'period.start');
  const end = instant(endValue, 'period.end');
  if (end <= start || end - start > MAX_WINDOW_MS || end > asOf) throw Error('Completed period must be positive and bounded.');
  const intervalMinutes = own(input, 'intervalMinutes');
  if (intervalMinutes !== 15 && intervalMinutes !== 30 && intervalMinutes !== 60) throw Error('Supported meter interval required.');
  const intervalMs = intervalMinutes * 60000;
  if ((end - start) % intervalMs !== 0) throw Error('Period must consist of whole meter intervals.');

  const meter = own(input, 'meter');
  scope(meter, tenantId, siteId, 'Meter');
  if (own(meter, 'complete') !== true) throw Error('Complete meter snapshot required.');
  const meterId = label(own(meter, 'meterId'), 'meter.meterId');
  const meterSource = label(own(meter, 'source'), 'meter.source');
  const meterRevision = label(own(meter, 'revision'), 'meter.revision');
  const meterDigest = label(own(meter, 'digest'), 'meter.digest');
  const meterObservedAt = own(meter, 'observedAt');
  const observedAt = instant(meterObservedAt, 'meter.observedAt');
  if (observedAt < end || observedAt > asOf) throw Error('Meter snapshot must cover the completed period.');

  const tariff = own(input, 'tariff');
  scope(tariff, tenantId, siteId, 'Tariff');
  const tariffId = label(own(tariff, 'tariffId'), 'tariff.tariffId');
  const tariffRevision = label(own(tariff, 'revision'), 'tariff.revision');
  const tariffDigest = label(own(tariff, 'digest'), 'tariff.digest');
  const tariffObservedAtValue = own(tariff, 'observedAt');
  const tariffObservedAt = instant(tariffObservedAtValue, 'tariff.observedAt');
  const effectiveStart = instant(own(tariff, 'effectiveStart'), 'tariff.effectiveStart');
  const effectiveEnd = instant(own(tariff, 'effectiveEnd'), 'tariff.effectiveEnd');
  if (tariffObservedAt > asOf || effectiveStart > start || effectiveEnd < end || effectiveEnd <= effectiveStart) throw Error('Tariff must be observed and effective for the entire period.');
  const thresholdKw = number(own(tariff, 'thresholdKw'), 'tariff.thresholdKw', 1000000);

  const samples = own(input, 'samples');
  const expectedCount = (end - start) / intervalMs;
  if (isProxy(samples) || !isArray(samples) || samples.length !== expectedCount || expectedCount > 2976) throw Error('Complete bounded meter interval list required.');
  const seenRefs = new SetCtor();
  const refs = [];
  let peakKw = 0;
  let peakStart = null;
  for (let index = 0; index < samples.length; index++) {
    const descriptor = getOwnPropertyDescriptor(samples, index);
    if (!descriptor || !hasOwn(descriptor, 'value')) throw Error('Meter samples must be explicit data entries.');
    const sample = descriptor.value;
    scope(sample, tenantId, siteId, 'Sample');
    if (own(sample, 'meterId') !== meterId || own(sample, 'sourceRevision') !== meterRevision) throw Error('Sample meter identity/revision differs.');
    const sampleStartValue = own(sample, 'start');
    const sampleEndValue = own(sample, 'end');
    const sampleStart = instant(sampleStartValue, 'sample.start');
    const sampleEnd = instant(sampleEndValue, 'sample.end');
    if (sampleStart !== start + index * intervalMs || sampleEnd !== sampleStart + intervalMs) throw Error('Samples must cover contiguous exact meter intervals.');
    const kw = number(own(sample, 'kw'), 'sample.kw', 1000000);
    const evidenceRef = label(own(sample, 'evidenceRef'), 'sample.evidenceRef');
    const evidenceDigest = label(own(sample, 'evidenceDigest'), 'sample.evidenceDigest');
    if (setHas(seenRefs, evidenceRef) || setHas(seenRefs, evidenceDigest)) throw Error('Repeated meter sample evidence.');
    setAdd(seenRefs, evidenceRef);
    setAdd(seenRefs, evidenceDigest);
    push(refs, freeze({ evidenceRef, evidenceDigest }));
    if (peakStart === null || kw > peakKw) { peakKw = kw; peakStart = sampleStartValue; }
  }
  return freeze({
    contractVersion: CONTRACT_VERSION,
    status: peakKw > thresholdKw ? 'DECLARED_PEAK_ABOVE_THRESHOLD' : 'NO_DECLARED_THRESHOLD_EXCESS',
    tenantId, siteId, asOf: asOfValue, period: freeze({ start: startValue, end: endValue }), intervalMinutes,
    meter: freeze({ meterId, source: meterSource, revision: meterRevision, digest: meterDigest, observedAt: meterObservedAt }),
    tariff: freeze({ tariffId, revision: tariffRevision, digest: tariffDigest, observedAt: tariffObservedAtValue, thresholdKw }),
    peakKw, peakStart, excessKw: max(0, peakKw - thresholdKw), sampleCount: expectedCount,
    evidence: freeze(refs), claimedSavingsPence: null, sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessDemandPeakEvidence, CONTRACT_VERSION };
