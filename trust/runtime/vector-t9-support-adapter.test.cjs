'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EvidenceLedger } = require('./vector-trust-spine.cjs');
const { createT9SupportLoop, recordSupportReceipt } = require('./vector-t9-support-adapter.cjs');

const hex = value => createHash('sha256').update(String(value)).digest('hex');

function terminal(overrides = {}) {
  return {
    schemaVersion: 1,
    incidentId: 'incident-1',
    tenant: 'tenant-a',
    scenarioId: 'integration-transient-failure',
    tier: 'T1',
    outcome: 'recovered',
    safeTerminal: true,
    actionCount: 1,
    maxActions: 3,
    evidenceDigest: hex('incident-evidence'),
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false,
    startedAt: Date.parse('2026-09-23T09:00:00.000Z'),
    endedAt: Date.parse('2026-09-23T09:00:01.000Z'),
    trace: [],
    traceHeadDigest: hex('trace'),
    resultDigest: hex('result'),
    receiptDigest: hex('receipt'),
    ...overrides,
  };
}

test('support recovery becomes T9 evidence plus proposal-only causal learning', async () => {
  const receipt = terminal();
  const controlLoop = {
    async run() { return receipt; },
    verifyReceipt(candidate) { return candidate.receiptDigest === receipt.receiptDigest; },
  };
  const wrapped = createT9SupportLoop({ controlLoop, ledger: new EvidenceLedger() });
  const result = await wrapped.run({ tenant: 'tenant-a', targetTenant: 'tenant-a' });

  assert.equal(result.t9.contractVersion, 'VECTOR_T9_SUPPORT_EVIDENCE_V1');
  assert.equal(result.t9.causalEpisode.promotion.mode, 'PROPOSAL_ONLY');
  assert.equal(result.t9.causalEpisode.promotion.maySelfPromote, false);
  assert.equal(result.t9.causalEpisode.counterfactualStatus, 'NOT_EVALUATED');
  assert.equal(wrapped.ledger.verifyChain(), true);
  assert.equal(wrapped.verifyReceipt(result), true);
});

test('unknown containment is recorded but never promoted into causal learning', () => {
  const ledger = new EvidenceLedger();
  const result = recordSupportReceipt({
    ledger,
    receipt: terminal({
      scenarioId: 'unknown-future-failure',
      tier: 'T4',
      outcome: 'contained',
      actionCount: 0,
    }),
    input: { tenant: 'tenant-a', targetTenant: 'tenant-a' },
  });
  assert.equal(result.causalEpisode, null);
  assert.equal(ledger.verifyChain(), true);
});

test('support adapter refuses a receipt that crosses the incident tenant boundary', () => {
  assert.throws(() => recordSupportReceipt({
    ledger: new EvidenceLedger(),
    receipt: terminal({ tenant: 'tenant-b' }),
    input: { tenant: 'tenant-a', targetTenant: 'tenant-b' },
  }), /tenant does not match/i);
});

test('support adapter refuses non-terminal or unverifiable support state', () => {
  assert.throws(() => recordSupportReceipt({
    ledger: new EvidenceLedger(),
    receipt: terminal({ safeTerminal: false }),
    input: { tenant: 'tenant-a' },
  }), /safe terminal/i);
});
