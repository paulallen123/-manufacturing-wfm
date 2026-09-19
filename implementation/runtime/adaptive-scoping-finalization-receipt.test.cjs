'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileGraph, evaluateGraph } = require('./adaptive-scoping-graph.cjs');
const { createScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');
const {
  createScopeFinalizationReceipt,
  verifyScopeFinalizationReceipt,
  normaliseFinalScope
} = require('./adaptive-scoping-finalization-receipt.cjs');

const PROOF_KEY = 'scope-proof-key-0123456789abcdef0123456789abcdef';

function graph() {
  return compileGraph({
    version: '2026-09-19.2',
    questions: [
      {
        id: 'time-enabled',
        prompt: 'Enable time and attendance?',
        scope: ['time'],
        options: [
          { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
          { value: false, effects: [{ type: 'CONFIG', key: 'time.enabled', value: false }] }
        ]
      },
      {
        id: 'clocking-mode',
        prompt: 'Which clocking mode should be configured?',
        scope: ['time'],
        when: { question: 'time-enabled', equals: true },
        options: [
          { value: 'mobile', effects: [{ type: 'CONFIG', key: 'clocking.mode', value: 'mobile' }, { type: 'TEST', key: 'clocking.mobile-readiness' }] },
          { value: 'browser', effects: [{ type: 'CONFIG', key: 'clocking.mode', value: 'browser' }, { type: 'TEST', key: 'clocking.browser-readiness' }] }
        ]
      }
    ]
  });
}

function terminalScope(compiled = graph()) {
  return evaluateGraph(compiled, {
    purchasedScope: ['time'],
    answers: { 'time-enabled': true, 'clocking-mode': 'mobile' },
    nowMs: Date.parse('2026-09-19T22:50:00Z')
  });
}

function expectedScope(evaluation) {
  const normalised = normaliseFinalScope(evaluation);
  return {
    graphVersion: normalised.graphVersion,
    graphFingerprint: normalised.graphFingerprint,
    revision: normalised.revision,
    purchasedScope: normalised.purchasedScope,
    operationsDigest: normalised.operationsDigest
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('final scope receipt binds a reachable terminal customer scope to the exhaustively proven graph release', () => {
  const compiled = graph();
  const evaluation = terminalScope(compiled);
  const release = createScopeReleaseReceipt(compiled, { proofKey: PROOF_KEY });
  const receipt = createScopeFinalizationReceipt(compiled, evaluation, release, { proofKey: PROOF_KEY });
  const verified = verifyScopeFinalizationReceipt(receipt, expectedScope(evaluation), PROOF_KEY);

  assert.equal(verified.ok, true);
  assert.equal(verified.revision, evaluation.revision);
  assert.equal(verified.releaseProofDigest, release.proofDigest);
  assert.match(verified.finalizationDigest, /^[a-f0-9]{64}$/);
});

test('a fabricated terminal result that is not a reachable path cannot receive a finalization receipt', () => {
  const compiled = graph();
  const evaluation = terminalScope(compiled);
  const release = createScopeReleaseReceipt(compiled, { proofKey: PROOF_KEY });

  const impossible = structuredClone(evaluation);
  impossible.operations = impossible.operations.map(operation =>
    operation.key === 'clocking.mode' ? { ...operation, value: 'browser' } : operation
  );

  expectCode(
    () => createScopeFinalizationReceipt(compiled, impossible, release, { proofKey: PROOF_KEY }),
    'WFM_SCOPE_FINALIZATION_UNREACHABLE'
  );
});

test('unanswered scope cannot be finalized even when the graph release itself is trusted', () => {
  const compiled = graph();
  const incomplete = evaluateGraph(compiled, { purchasedScope: ['time'], answers: {}, nowMs: 1 });
  const release = createScopeReleaseReceipt(compiled, { proofKey: PROOF_KEY });

  expectCode(
    () => createScopeFinalizationReceipt(compiled, incomplete, release, { proofKey: PROOF_KEY }),
    'WFM_SCOPE_INCOMPLETE'
  );
});

test('revision, purchased scope or operation drift invalidates a previously finalized scope', () => {
  const compiled = graph();
  const evaluation = terminalScope(compiled);
  const release = createScopeReleaseReceipt(compiled, { proofKey: PROOF_KEY });
  const receipt = createScopeFinalizationReceipt(compiled, evaluation, release, { proofKey: PROOF_KEY });
  const expected = expectedScope(evaluation);

  expectCode(
    () => verifyScopeFinalizationReceipt(receipt, { ...expected, revision: 'changed-revision' }, PROOF_KEY),
    'WFM_SCOPE_FINALIZATION_SUBJECT_MISMATCH'
  );
  expectCode(
    () => verifyScopeFinalizationReceipt(receipt, { ...expected, purchasedScope: [] }, PROOF_KEY),
    'WFM_SCOPE_FINALIZATION_SUBJECT_MISMATCH'
  );
  expectCode(
    () => verifyScopeFinalizationReceipt(receipt, { ...expected, operationsDigest: 'f'.repeat(64) }, PROOF_KEY),
    'WFM_SCOPE_FINALIZATION_SUBJECT_MISMATCH'
  );
});

test('tampered finalization or detached graph-release evidence is rejected', () => {
  const compiled = graph();
  const evaluation = terminalScope(compiled);
  const release = createScopeReleaseReceipt(compiled, { proofKey: PROOF_KEY });
  const receipt = createScopeFinalizationReceipt(compiled, evaluation, release, { proofKey: PROOF_KEY });
  const expected = expectedScope(evaluation);

  expectCode(
    () => verifyScopeFinalizationReceipt({ ...receipt, mac: '0'.repeat(64) }, expected, PROOF_KEY),
    'WFM_SCOPE_FINALIZATION_PROOF_INVALID'
  );

  const detached = structuredClone(receipt);
  detached.releaseReceipt.graphFingerprint = 'f'.repeat(64);
  expectCode(
    () => verifyScopeFinalizationReceipt(detached, expected, PROOF_KEY),
    'WFM_SCOPE_PROOF_SUBJECT_MISMATCH'
  );
});