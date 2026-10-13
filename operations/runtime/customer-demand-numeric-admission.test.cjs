'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDemandSignal, rankDemandProblems } = require('./customer-demand-intelligence.cjs');

function signal(overrides = {}) {
  return {
    signalId: 'synthetic-1', accountRef: 'synthetic-account', decisionKey: 'absence-recovery',
    persona: 'plant-manager', sourceType: 'workaround', evidenceType: 'revealed',
    observedAt: '2026-10-13T08:00:00Z', outcomeKpis: ['decision-latency'],
    falsification: 'Reject unless approved replay improves the measured outcome.',
    ...overrides
  };
}

const scores = ['severity','frequency','economicImpact','productionImpact','adminImpact','implementationEffort','adoptionBurden','risk'];
const ratios = ['evidenceConfidence','strategicFit','differentiation','reusePotential','integrationReadiness','outcomeProvability'];
for (const field of [...scores, ...ratios]) {
  test(`${field} rejects coerced values before demand ranking`, () => {
    for (const value of [true, false, '', '1', [], [1], {}, { valueOf() { throw new Error('COERCION_EXECUTED'); } }]) {
      assert.throws(() => normaliseDemandSignal(signal({ [field]: value })), new RegExp(`${field} must be a finite number`));
    }
  });
  test(`${field} preserves finite numeric boundaries and nullish defaults`, () => {
    const max = ratios.includes(field) ? 1 : 5;
    for (const value of [0, max / 2, max]) assert.equal(normaliseDemandSignal(signal({ [field]: value }))[field], value);
    const fallback = ['implementationEffort', 'adoptionBurden'].includes(field) ? 5 : 0;
    for (const value of [undefined, null]) assert.equal(normaliseDemandSignal(signal({ [field]: value }))[field], fallback);
    for (const value of [NaN, Infinity, -Infinity, -1, max + 1]) assert.throws(() => normaliseDemandSignal(signal({ [field]: value })), /must be/);
  });
}

test('ranker cannot inflate evidence strength with a boolean confidence', () => {
  assert.throws(() => rankDemandProblems([signal({ evidenceConfidence: true })]), /evidenceConfidence must be a finite number/);
});
