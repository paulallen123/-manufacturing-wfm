'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDemandSignal, rankDemandProblems } = require('./customer-demand-intelligence.cjs');

function signal(observedAt) {
  return {
    signalId: 'calendar-synthetic', decisionKey: 'absence-recovery', persona: 'plant-manager',
    sourceType: 'workaround', evidenceType: 'revealed', observedAt,
    outcomeKpis: ['decision-latency'], falsification: 'Reject unless replay improves the measured outcome.'
  };
}

for (const observedAt of [
  '2026-02-29T08:00:00Z', '2026-02-30T08:00:00Z', '2026-02-31T08:00:00Z',
  '2026-04-31T08:00:00+01:00', '2026-06-31T08:00:00-02:00',
  '1900-02-29T08:00:00Z', '2100-02-29T08:00:00Z',
  '0001-02-29T08:00:00Z', '2026-02-30', '2026-2-30',
  '2026-02-30 08:00:00Z', '2026-02-30Z', '2026-02-030',
  '-000000-02-29T08:00:00Z', '-000000-02-29'
]) {
  test(`reject impossible observation ${observedAt} rather than rewrite its calendar day`, () => {
    assert.throws(() => normaliseDemandSignal(signal(observedAt)), /Valid observedAt is required/);
    assert.throws(() => rankDemandProblems([signal(observedAt)]), /Valid observedAt is required/);
  });
}

const valid = [
  ['2024-02-29T08:00:00Z', '2024-02-29T08:00:00.000Z'],
  ['2000-02-29T08:00:00Z', '2000-02-29T08:00:00.000Z'],
  ['0000-02-29T08:00:00Z', '0000-02-29T08:00:00.000Z'],
  ['2026-04-30T23:45:00-02:00', '2026-05-01T01:45:00.000Z'],
  ['2026-03-01T00:30:00+01:00', '2026-02-28T23:30:00.000Z'],
  ['2026-10-13T08:00:00.123Z', '2026-10-13T08:00:00.123Z'],
  ['2026-10-13', '2026-10-13T00:00:00.000Z'],
  ['2026-2-28', '2026-02-28T00:00:00.000Z'],
  ['2026-10-13T24:00:00Z', '2026-10-14T00:00:00.000Z'],
  ['+010000-02-29T00:00:00Z', '+010000-02-29T00:00:00.000Z'],
  ['-000004-02-29T00:00:00Z', '-000004-02-29T00:00:00.000Z']
];
for (const [observedAt, expected] of valid) {
  test(`preserve valid observation ${observedAt}`, () => {
    assert.equal(normaliseDemandSignal(signal(observedAt)).observedAt, expected);
  });
}
