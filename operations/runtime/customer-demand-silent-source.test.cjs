'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
function fresh() {
  delete require.cache[require.resolve('./customer-demand-intelligence.cjs')];
  return require('./customer-demand-intelligence.cjs');
}
function signal(sourceType) {
  return { signalId: 'silent-synthetic', decisionKey: 'absence-recovery', persona: 'plant-manager', sourceType,
    evidenceType: 'stated', observedAt: '2026-10-13T08:00:00Z', outcomeKpis: ['decision-latency'],
    falsification: 'Reject unless measured replay improves the outcome.' };
}
test('public metadata addition cannot turn stated sales demand into silent evidence', () => {
  const m = fresh();
  m.SILENT_SOURCES.add('sales');
  assert.equal(m.normaliseDemandSignal(signal('sales')).silentDemand, false);
  assert.equal(m.rankDemandProblems([signal('sales')])[0].silentDemandSignals, 0);
});
test('public metadata clearing cannot erase existing silent evidence', () => {
  const m = fresh();
  m.SILENT_SOURCES.clear();
  for (const source of ['workaround', 'manual-override', 'workflow-abandonment', 'integration-failure', 'training-search']) {
    assert.equal(m.normaliseDemandSignal(signal(source)).silentDemand, true);
    assert.equal(m.rankDemandProblems([signal(source)])[0].silentDemandSignals, 1);
  }
});
test('public has override cannot bypass the private silent source classifier', () => {
  const m = fresh();
  m.SILENT_SOURCES.has = () => true;
  assert.equal(m.normaliseDemandSignal(signal('sales')).silentDemand, false);
  m.SILENT_SOURCES.has = () => false;
  assert.equal(m.normaliseDemandSignal(signal('workaround')).silentDemand, true);
});
test('public instance prototype replacement cannot replace the classifier', () => {
  const m = fresh();
  Object.setPrototypeOf(m.SILENT_SOURCES, { has() { return true; } });
  assert.equal(m.normaliseDemandSignal(signal('sales')).silentDemand, false);
  assert.equal(m.normaliseDemandSignal(signal('workaround')).silentDemand, true);
});
