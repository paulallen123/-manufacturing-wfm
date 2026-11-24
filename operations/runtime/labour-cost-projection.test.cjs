'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { forecastDemand } = require('./manufacturing-demand-forecast.cjs');

const modulePath = path.join(__dirname, 'labour-cost-projection.cjs');
function project(input) {
  assert.equal(fs.existsSync(modulePath), true, 'labour cost projection module must exist');
  return require(modulePath).projectLabourCost(input);
}
function requireImplementation() { assert.equal(fs.existsSync(modulePath), true, 'labour cost projection module must exist'); }
function rateHash(rate) {
  const fields = ['tenant', 'site', 'sourceRef', 'observedAt', 'effectiveFrom', 'effectiveUntil', 'hourlyRateGBP', 'oncostPercent'];
  return createHash('sha256').update(JSON.stringify(fields.map(field => rate[field]))).digest('hex');
}
function fixture() {
  const forecastInput = { observations: [8, 16, 24, 16].map((value, index) => ({ value, at: new Date(Date.UTC(2026, 9, index + 10)).toISOString(), evidenceRef: `synthetic:mes:${index}` })),
    horizonPeriods: 1, seasonLength: 2, periodMinutes: 480 };
  const demandForecast = structuredClone(forecastDemand(forecastInput));
  const input = {
    tenant: 'synthetic-tenant', site: 'tamworth', now: '2026-10-13T10:00:00.000Z', maxEvidenceAgeMs: 86400000,
    forecastInput, demandForecast,
    unitsPerLabourHour: 1, shiftHours: 8, periodStarts: ['2026-10-14T06:00:00.000Z'],
    rateEvidence: { tenant: 'synthetic-tenant', site: 'tamworth', sourceRef: 'synthetic:approved-rate-1',
      observedAt: '2026-10-13T09:00:00.000Z', effectiveFrom: '2026-10-14T00:00:00.000Z', effectiveUntil: '2026-10-15T00:00:00.000Z',
      hourlyRateGBP: 20, oncostPercent: 10 }
  };
  input.rateEvidence.recordHash = rateHash(input.rateEvidence);
  return input;
}

test('projects bounded GBP labour cost from the existing demand-to-headcount translation', () => {
  const result = project(fixture());
  assert.equal(result.status, 'ADVISORY_PROJECTION');
  assert.equal(result.forecastId, fixture().demandForecast.forecastId);
  assert.deepEqual(result.steps, [{ period: 1, p50Headcount: 3, p90Headcount: 4, p50CostPence: 52800, p90CostPence: 70400 }]);
  assert.deepEqual(result.periodStarts, ['2026-10-14T06:00:00.000Z']);
  assert.equal(result.rateObservedAt, '2026-10-13T09:00:00.000Z');
  assert.equal(result.unitsPerLabourHour, 1);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.claimBoundary, 'PROJECTED_BASE_LABOUR_COST_NOT_PAYROLL_OR_REALISED_SAVING');
});

test('rejects wrong scope, stale or ineffective rate evidence', () => {
  requireImplementation();
  for (const change of [
    x => { x.rateEvidence.tenant = 'other'; },
    x => { x.rateEvidence.site = 'other'; },
    x => { x.rateEvidence.observedAt = '2026-10-10T00:00:00.000Z'; },
    x => { x.rateEvidence.effectiveUntil = '2026-10-14T10:00:00.000Z'; },
    x => { x.rateEvidence.recordHash = 'invalid'; }
  ]) { const input = fixture(); change(input); assert.throws(() => project(input)); }
});

test('rejects malformed forecast, unsafe headcounts and money overflow', () => {
  requireImplementation();
  for (const change of [
    x => { x.demandForecast.forecastId = 'bad'; },
    x => { x.demandForecast.steps[0].p90 = -1; },
    x => { x.demandForecast.steps[0].p50 = Number.MAX_VALUE; },
    x => { x.rateEvidence.hourlyRateGBP = Number.MAX_VALUE; },
    x => { x.rateEvidence.oncostPercent = -1; }
  ]) { const input = fixture(); change(input); assert.throws(() => project(input)); }
});

test('rejects swapped forecast steps under a previously valid forecast ID', () => {
  const input = fixture();
  input.demandForecast.steps[0].p50 += 8;
  assert.throws(() => project(input), /forecast/i);
});

test('does not accept mixed or unordered period coverage', () => {
  requireImplementation();
  const input = fixture();
  input.demandForecast.steps.push({ period: 2, p50: 24, p90: 32 });
  input.periodStarts.push('2026-10-14T05:00:00.000Z');
  assert.throws(() => project(input));
});

test('does not price a forecast period as a different shift duration', () => {
  const input = fixture();
  input.shiftHours = 4;
  assert.throws(() => project(input), /period|duration/i);
});

test('does not treat future source observations as current evidence', () => {
  const input = fixture();
  input.forecastInput.observations[0].at = '2026-10-15T00:00:00.000Z';
  input.demandForecast = structuredClone(forecastDemand(input.forecastInput));
  assert.throws(() => project(input), /observation|source/i);
});

test('rejects changed rate amount under the same evidence hash', () => {
  const input = fixture();
  input.rateEvidence.hourlyRateGBP = 40;
  assert.throws(() => project(input), /rate|hash/i);
});

test('rejects a forecast built only from stale observations', () => {
  const input = fixture();
  input.forecastInput.observations.forEach((row, index) => { row.at = new Date(Date.UTC(2026, 9, index + 1)).toISOString(); });
  input.demandForecast = structuredClone(forecastDemand(input.forecastInput));
  assert.throws(() => project(input), /stale|observation/i);
});

test('rejects unbounded demand history before recomputing the forecast', () => {
  const input = fixture();
  input.forecastInput.observations = Array.from({ length: 1001 }, (_, index) => ({ ...input.forecastInput.observations[index % 4] }));
  input.demandForecast = structuredClone(forecastDemand(input.forecastInput));
  assert.throws(() => project(input), /bounded|history/i);
});
