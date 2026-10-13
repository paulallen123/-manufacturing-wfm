'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMeterContext } = require('./maintenance-meter-context.cjs');

function fixture() {
  return { scope: { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE' },
    source: { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE',
      sourceRef: 'synthetic:cmms:meter-4', sourceRevision: 'r8', observedAt: '2026-10-13T08:00:00.000Z', complete: true },
    readings: [
      { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE', at: '2026-10-12T08:00:00.000Z', value: 100 },
      { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE', at: '2026-10-13T07:00:00.000Z', value: 109 }
    ], now: '2026-10-13T09:00:00.000Z', maxAgeMs: 129600000 };
}

test('computes a scoped cumulative change without an alert or maintenance authority', () => {
  const result = evaluateMeterContext(fixture());
  assert.equal(result.status, 'OBSERVED_CONTEXT');
  assert.equal(result.latestValue, 109);
  assert.equal(result.observedChange, 9);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.maintenanceDue, undefined);
});

test('a counter decrease needs source-owned reset evidence, not a negative usage claim', () => {
  const input = fixture(); input.readings[1].value = 4;
  const result = evaluateMeterContext(input);
  assert.equal(result.status, 'RESET_OR_ROLLOVER_UNVERIFIED');
  assert.equal(result.observedChange, undefined);
});

test('denies foreign, incomplete, stale, future and duplicate observations', () => {
  for (const change of [
    x => { x.readings[1].site = 'other'; },
    x => { x.source.asset = 'other'; },
    x => { x.source.kind = 'INSTANTANEOUS'; },
    x => { x.readings[1].kind = 'INSTANTANEOUS'; },
    x => { x.readings[0].at = '2026-10-01T08:00:00.000Z'; },
    x => { x.source.complete = false; },
    x => { x.source.observedAt = '2026-10-10T00:00:00.000Z'; },
    x => { x.readings[1].at = '2026-10-14T00:00:00.000Z'; },
    x => { x.readings[1].at = x.readings[0].at; }
  ]) { const input = fixture(); change(input); assert.throws(() => evaluateMeterContext(input)); }
});

test('instantaneous condition keeps a source value without treating it as usage or failure', () => {
  const input = fixture(); input.scope.kind = 'INSTANTANEOUS'; input.scope.meter = 'bearing-temperature'; input.scope.unit = 'C';
  for (const reading of input.readings) { reading.meter = 'bearing-temperature'; reading.unit = 'C'; reading.kind = 'INSTANTANEOUS'; }
  input.source.meter = 'bearing-temperature'; input.source.unit = 'C'; input.source.kind = 'INSTANTANEOUS';
  input.readings[0].value = -13; input.readings[1].value = -8;
  const result = evaluateMeterContext(input);
  assert.equal(result.status, 'OBSERVED_CONTEXT');
  assert.equal(result.latestValue, -8);
  assert.equal(result.observedChange, undefined);
  assert.equal(result.conditionState, undefined);
});
