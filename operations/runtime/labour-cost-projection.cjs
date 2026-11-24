'use strict';

const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { FORECAST_VERSION, forecastDemand, toHeadcountForecast } = require('./manufacturing-demand-forecast.cjs');
const { components } = require('./payroll-money.cjs')();
const hex64 = /^[a-f0-9]{64}$/i;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : null;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const rateFields = ['tenant', 'site', 'sourceRef', 'observedAt', 'effectiveFrom', 'effectiveUntil', 'hourlyRateGBP', 'oncostPercent'];
const rateHash = rate => createHash('sha256').update(JSON.stringify(rateFields.map(field => rate[field]))).digest('hex');

function projectLabourCost(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Projection input required.');
  const { tenant, site, now, maxEvidenceAgeMs, forecastInput, demandForecast, unitsPerLabourHour, shiftHours, periodStarts, rateEvidence } = input;
  const at = utc(now);
  if (!id(tenant) || !id(site) || at === null || !Number.isSafeInteger(maxEvidenceAgeMs) || maxEvidenceAgeMs < 1 || maxEvidenceAgeMs > 86400000) throw new Error('Exact scope, UTC time and evidence age required.');
  if (demandForecast?.version !== FORECAST_VERSION || !hex64.test(String(demandForecast.forecastId || '')) ||
      !Array.isArray(demandForecast.steps) || demandForecast.steps.length < 1 || demandForecast.steps.length > 96) throw new Error('Bounded demand forecast required.');
  if (!forecastInput || !Array.isArray(forecastInput.observations) || forecastInput.observations.length < 4 || forecastInput.observations.length > 1000) throw new Error('Bounded demand history required.');
  if (
      forecastInput.observations.some(row => !id(row?.evidenceRef) || utc(row?.at) === null || utc(row.at) > at) ||
      !isDeepStrictEqual(forecastDemand(forecastInput), demandForecast)) throw new Error('Demand forecast differs from source observations.');
  if (at - Math.max(...forecastInput.observations.map(row => utc(row.at))) > maxEvidenceAgeMs) throw new Error('Stale demand observations.');
  for (const [index, step] of demandForecast.steps.entries()) {
    if (step?.period !== index + 1 || typeof step.p50 !== 'number' || !Number.isFinite(step.p50) || step.p50 < 0 || step.p50 > 1e9 ||
        typeof step.p90 !== 'number' || !Number.isFinite(step.p90) || step.p90 < step.p50 || step.p90 > 1e9) throw new Error('Unsafe demand forecast step.');
  }
  if (typeof unitsPerLabourHour !== 'number' || !Number.isFinite(unitsPerLabourHour) || unitsPerLabourHour <= 0 || unitsPerLabourHour > 1e6 ||
      typeof shiftHours !== 'number' || !Number.isFinite(shiftHours) || shiftHours <= 0 || shiftHours > 24 || !Number.isSafeInteger(shiftHours * 3600000)) throw new Error('Bounded labour translation required.');
  if (demandForecast.periodMinutes !== shiftHours * 60) throw new Error('Forecast period and priced shift duration differ.');
  if (!Array.isArray(periodStarts) || periodStarts.length !== demandForecast.steps.length) throw new Error('One start time per forecast period required.');
  const starts = periodStarts.map(utc);
  if (starts.some(value => value === null || value < at)) throw new Error('Future UTC forecast periods required.');
  const durationMs = shiftHours * 3600000;
  for (let index = 1; index < starts.length; index++) {
    if (starts[index] < starts[index - 1] + durationMs) throw new Error('Forecast periods overlap or are unordered.');
  }
  const evidenceAt = utc(rateEvidence?.observedAt), from = utc(rateEvidence?.effectiveFrom), until = utc(rateEvidence?.effectiveUntil);
  if (rateEvidence?.tenant !== tenant || rateEvidence?.site !== site || !id(rateEvidence?.sourceRef) ||
      !hex64.test(String(rateEvidence?.recordHash || '')) || evidenceAt === null || evidenceAt > at || at - evidenceAt > maxEvidenceAgeMs ||
      from === null || until === null || until <= from || starts.some(start => start < from || start + durationMs > until)) throw new Error('Current source-bound rate evidence required.');
  if (typeof rateEvidence.hourlyRateGBP !== 'number' || !Number.isFinite(rateEvidence.hourlyRateGBP) || rateEvidence.hourlyRateGBP <= 0 || rateEvidence.hourlyRateGBP > 10000 ||
      typeof rateEvidence.oncostPercent !== 'number' || !Number.isFinite(rateEvidence.oncostPercent) || rateEvidence.oncostPercent < 0 || rateEvidence.oncostPercent > 100) throw new Error('Bounded GBP rate and on-cost required.');
  if (rateHash(rateEvidence) !== rateEvidence.recordHash) throw new Error('Rate evidence hash differs from supplied fields.');

  const headcount = toHeadcountForecast({ forecast: demandForecast, unitsPerLabourHour, shiftHours });
  const perWorker = components({ durationMs, rate: rateEvidence.hourlyRateGBP, oncostPercent: rateEvidence.oncostPercent });
  const costFor = count => {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new Error('Unsafe forecast headcount.');
    const total = BigInt(perWorker.totalPence) * BigInt(count);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Projected labour cost exceeds safe pence.');
    return Number(total);
  };
  const steps = headcount.steps.map(step => Object.freeze({ period: step.period, p50Headcount: step.p50Headcount,
    p90Headcount: step.p90Headcount, p50CostPence: costFor(step.p50Headcount), p90CostPence: costFor(step.p90Headcount) }));
  return Object.freeze({ contractVersion: 'VECTOR_LABOUR_COST_PROJECTION_V1', status: 'ADVISORY_PROJECTION', tenant, site,
    currency: 'GBP', forecastId: demandForecast.forecastId, rateSourceRef: rateEvidence.sourceRef, rateRecordHash: rateEvidence.recordHash,
    asOf: now, unitsPerLabourHour, shiftHours, periodStarts: Object.freeze([...periodStarts]),
    hourlyRateGBP: rateEvidence.hourlyRateGBP, oncostPercent: rateEvidence.oncostPercent,
    rateObservedAt: rateEvidence.observedAt, rateEffectiveFrom: rateEvidence.effectiveFrom, rateEffectiveUntil: rateEvidence.effectiveUntil,
    steps: Object.freeze(steps), executionAuthority: false,
    claimBoundary: 'PROJECTED_BASE_LABOUR_COST_NOT_PAYROLL_OR_REALISED_SAVING' });
}

module.exports = { projectLabourCost };
