import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeLedger, evaluateProjectedDecision } from './savings-engine.mjs';

const decision = evaluateProjectedDecision({
  baseline: { id: 'baseline', currency: 'GBP', costs: { downtime: 1000 } },
  alternatives: [{ id: 'approved', currency: 'GBP', costs: { downtime: 700 } }]
});
const actual = (key, refs) => ({ attributionKey: key, actualSelectedCost: 700,
  evidenceRefs: refs, observedAt: '2026-10-13T10:00:00.000Z' });

test('distinct source evidence can support separate synthetic outcomes', () => {
  const ledger = createOutcomeLedger();
  ledger.record(decision, actual('effect-1', ['fixture://receipt/1']));
  ledger.record(decision, actual('effect-2', ['fixture://receipt/2']));
  assert.equal(ledger.entries().length, 2);
});

test('same post-action source cannot be counted again under a new attribution key', () => {
  const ledger = createOutcomeLedger();
  ledger.record(decision, actual('effect-1', ['fixture://receipt/1', 'fixture://meter/1']));
  assert.throws(() => ledger.record(decision, actual('effect-2', ['fixture://meter/1'])), /duplicate realised evidenceRef/);
  assert.equal(ledger.entries().length, 1);
});

test('malformed source references fail closed and do not reserve attribution', () => {
  const ledger = createOutcomeLedger();
  assert.throws(() => ledger.record(decision, actual('effect-1', [{ sourceRef: 'fixture://receipt/1' }])),
    /evidenceRefs must be non-empty strings/);
  assert.throws(() => ledger.record(decision, actual('effect-1', ['  '])),
    /evidenceRefs must be non-empty strings/);
  assert.throws(() => ledger.record(decision, actual('effect-1', new Array(1))),
    /evidenceRefs must be non-empty strings/);
  assert.equal(ledger.entries().length, 0);
  assert.equal(ledger.record(decision, actual('effect-1', ['fixture://receipt/1'])).status, 'realised');
});
