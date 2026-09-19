'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScopeReleaseReceipt, verifyScopeReleaseReceipt } = require('./adaptive-scoping-release-receipt.cjs');

const PROOF_KEY = 'scope-proof-key-0123456789abcdef0123456789abcdef';

function compiled() {
  return {
    version: '2026-09-19.1',
    graphFingerprint: 'a'.repeat(64),
    questions: [
      {
        id: 'time-enabled',
        scope: ['time'],
        options: [
          { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
          { value: false, effects: [{ type: 'CONFIG', key: 'time.enabled', value: false }] }
        ]
      }
    ]
  };
}

function enumerateReachablePaths(_compiled, purchasedScope) {
  if (purchasedScope.includes('time')) {
    return [{
      purchasedScope: [...purchasedScope],
      answers: { 'time-enabled': true },
      suppressed: [],
      operations: [{ type: 'CONFIG', key: 'time.enabled', value: true, questionId: 'time-enabled' }],
      questions: []
    }];
  }
  return [{
    purchasedScope: [...purchasedScope],
    answers: {},
    suppressed: ['time-enabled'],
    operations: [{ type: 'NO_OP', key: 'time-enabled', reason: 'outside-purchased-scope' }],
    questions: []
  }];
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('exhaustive scoping proof emits a signed receipt bound to the exact graph', () => {
  const receipt = createScopeReleaseReceipt(compiled(), { proofKey: PROOF_KEY, enumerateReachablePaths });
  const verified = verifyScopeReleaseReceipt(receipt, {
    graphVersion: '2026-09-19.1',
    graphFingerprint: 'a'.repeat(64)
  }, PROOF_KEY);

  assert.equal(verified.ok, true);
  assert.equal(receipt.purchasedScopeVariants, 2);
  assert.equal(receipt.terminalPaths, 2);
  assert.match(receipt.proofDigest, /^[a-f0-9]{64}$/);
});

test('a receipt cannot be reused after graph version or fingerprint drift', () => {
  const receipt = createScopeReleaseReceipt(compiled(), { proofKey: PROOF_KEY, enumerateReachablePaths });
  expectCode(() => verifyScopeReleaseReceipt(receipt, {
    graphVersion: '2026-09-19.2',
    graphFingerprint: 'a'.repeat(64)
  }, PROOF_KEY), 'WFM_SCOPE_PROOF_SUBJECT_MISMATCH');

  expectCode(() => verifyScopeReleaseReceipt(receipt, {
    graphVersion: '2026-09-19.1',
    graphFingerprint: 'b'.repeat(64)
  }, PROOF_KEY), 'WFM_SCOPE_PROOF_SUBJECT_MISMATCH');
});

test('tampered proof summary or signature is rejected', () => {
  const receipt = createScopeReleaseReceipt(compiled(), { proofKey: PROOF_KEY, enumerateReachablePaths });
  const tampered = { ...receipt, terminalPaths: receipt.terminalPaths + 1 };
  expectCode(() => verifyScopeReleaseReceipt(tampered, {
    graphVersion: '2026-09-19.1',
    graphFingerprint: 'a'.repeat(64)
  }, PROOF_KEY), 'WFM_SCOPE_PROOF_DIGEST_MISMATCH');

  const forged = { ...receipt, mac: '0'.repeat(64) };
  expectCode(() => verifyScopeReleaseReceipt(forged, {
    graphVersion: '2026-09-19.1',
    graphFingerprint: 'a'.repeat(64)
  }, PROOF_KEY), 'WFM_SCOPE_PROOF_INVALID');
});

test('a graph with an unresolved reachable path cannot emit a release receipt', () => {
  const brokenEnumerator = (_compiled, purchasedScope) => [{
    purchasedScope: [...purchasedScope],
    answers: {},
    suppressed: [],
    operations: [{ type: 'NO_OP', key: 'placeholder' }],
    questions: []
  }];
  expectCode(() => createScopeReleaseReceipt(compiled(), {
    proofKey: PROOF_KEY,
    enumerateReachablePaths: brokenEnumerator
  }), 'UNRESOLVED_QUESTION');
});
