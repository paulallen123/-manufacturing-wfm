'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessDemandPeakEvidence } = require('./demand-peak-evidence.cjs');

function fixture() {
  const tenantId = 'synthetic-tenant', siteId = 'site-a', meterId = 'meter-a', sourceRevision = 'meter-r2';
  const make = (start, end, kw, evidenceRef) => ({ tenantId, siteId, meterId, sourceRevision, start, end, kw,
    evidenceRef, evidenceDigest: `sha256:${evidenceRef}` });
  return {
    tenantId, siteId, asOf: '2026-10-23T11:00:00Z',
    period: { start: '2026-10-23T09:00:00Z', end: '2026-10-23T10:00:00Z' }, intervalMinutes: 30,
    meter: { tenantId, siteId, meterId, source: 'SITE_METER', revision: sourceRevision,
      digest: 'sha256:meter-snapshot', complete: true, observedAt: '2026-10-23T10:30:00Z' },
    tariff: { tenantId, siteId, tariffId: 'tariff-a', revision: 'tariff-r1', digest: 'sha256:tariff',
      observedAt: '2026-10-23T08:00:00Z', effectiveStart: '2026-10-23T00:00:00Z',
      effectiveEnd: '2026-10-24T00:00:00Z', thresholdKw: 100 },
    samples: [
      make('2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z', 95, 'sample-a'),
      make('2026-10-23T09:30:00Z', '2026-10-23T10:00:00Z', 125, 'sample-b')
    ]
  };
}

test('reports the declared exact-interval peak and evidence without cost or action authority', () => {
  const result = assessDemandPeakEvidence(fixture());
  assert.equal(result.status, 'DECLARED_PEAK_ABOVE_THRESHOLD');
  assert.equal(result.peakKw, 125);
  assert.equal(result.excessKw, 25);
  assert.equal(result.peakStart, '2026-10-23T09:30:00Z');
  assert.deepEqual(result.evidence.map(x => x.evidenceRef), ['sample-a', 'sample-b']);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
});

test('an at-threshold peak is not classified as excess', () => {
  const input = fixture(); input.samples[1].kw = 100;
  assert.equal(assessDemandPeakEvidence(input).status, 'NO_DECLARED_THRESHOLD_EXCESS');
});

test('rejects incomplete, foreign, inconsistent or coerced evidence', () => {
  const mutations = [
    x => { x.meter.complete = false; },
    x => { x.meter.siteId = 'other'; },
    x => { x.tariff.tenantId = 'other'; },
    x => { x.samples[0].tenantId = 'other'; },
    x => { x.samples[0].meterId = 'other'; },
    x => { x.samples[0].sourceRevision = 'old'; },
    x => { x.samples[0].evidenceDigest = x.samples[1].evidenceDigest; },
    x => { x.samples[0].kw = '95'; },
    x => { x.samples[1].kw = Infinity; },
    x => { x.tariff.thresholdKw = -1; },
    x => { x.tariff.thresholdKw = '100'; },
    x => { x.meter.observedAt = '2026-10-23T09:59:59Z'; },
    x => { x.tariff.observedAt = '2026-10-23T11:00:01Z'; },
    x => { x.tariff.effectiveEnd = '2026-10-23T09:30:00Z'; },
    x => { x.samples[1].start = '2026-10-23T09:15:00Z'; },
    x => { x.samples[1].end = '2026-10-23T10:15:00Z'; },
    x => { x.samples.pop(); },
    x => { x.period.end = '2026-02-30T10:00:00Z'; },
    x => { x.intervalMinutes = 20; }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => assessDemandPeakEvidence(input));
  }
});

test('rejects accessor fields and sparse sample arrays', () => {
  const accessor = fixture();
  Object.defineProperty(accessor.samples[0], 'kw', { get() { throw Error('accessor ran'); } });
  assert.throws(() => assessDemandPeakEvidence(accessor), /own data field/);
  const sparse = fixture(); delete sparse.samples[1];
  assert.throws(() => assessDemandPeakEvidence(sparse), /explicit data entries/);
});
