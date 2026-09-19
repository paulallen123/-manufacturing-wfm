'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  declaredScopeTokens,
  enumeratePurchasedScopeVariants,
  proveEveryDeclaredReachablePath
} = require('./adaptive-scoping-exhaustive-proof.cjs');

const compiled = {
  version: '2026-09-19.exhaustive.1',
  graphFingerprint: 'fixture',
  questions: [
    {
      id: 'time-enabled',
      scope: ['time'],
      options: [
        { value: true, effects: [{ type: 'CONFIG', key: 'time.enabled', value: true }] },
        { value: false, effects: [{ type: 'CONFIG', key: 'time.enabled', value: false }] }
      ]
    },
    {
      id: 'payroll-mode',
      scope: ['payroll'],
      options: [
        { value: 'api', effects: [{ type: 'DEPENDENCY', key: 'payroll.api' }] },
        { value: 'file', effects: [{ type: 'CONFIG', key: 'payroll.mode', value: 'file' }] }
      ]
    }
  ]
};

function oneTerminalPath(_compiled, purchasedScope) {
  const bought = new Set(purchasedScope);
  const answers = {};
  const suppressed = [];
  const operations = [];

  if (bought.has('time')) {
    answers['time-enabled'] = true;
    operations.push({ type: 'CONFIG', key: 'time.enabled', value: true, questionId: 'time-enabled' });
  } else {
    suppressed.push('time-enabled');
    operations.push({ type: 'NO_OP', key: 'time-enabled', reason: 'outside-purchased-scope' });
  }

  if (bought.has('payroll')) {
    answers['payroll-mode'] = 'api';
    operations.push({ type: 'DEPENDENCY', key: 'payroll.api', questionId: 'payroll-mode' });
  } else {
    suppressed.push('payroll-mode');
    operations.push({ type: 'NO_OP', key: 'payroll-mode', reason: 'outside-purchased-scope' });
  }

  return [{ purchasedScope: [...purchasedScope].sort(), answers, suppressed, operations, questions: [] }];
}

test('derives every declared purchased-scope combination instead of relying on a hand-maintained list', () => {
  assert.deepEqual(declaredScopeTokens(compiled), ['payroll', 'time']);
  assert.deepEqual(enumeratePurchasedScopeVariants(compiled), [[], ['payroll'], ['time'], ['payroll', 'time']]);
});

test('proves every scope combination and terminal path resolves every question to an action or no-op', () => {
  const summary = proveEveryDeclaredReachablePath(compiled, { enumerateReachablePaths: oneTerminalPath });
  assert.deepEqual(summary, {
    declaredScopes: ['payroll', 'time'],
    purchasedScopeVariants: 4,
    terminalPaths: 4
  });
});

test('fails closed rather than silently sampling when exhaustive scope coverage would exceed the configured bound', () => {
  const tooWide = {
    questions: Array.from({ length: 5 }, (_, index) => ({
      id: 'q' + index,
      scope: ['scope-' + index],
      options: [{ value: true, effects: [{ type: 'CONFIG', key: 'k' + index }] }]
    }))
  };

  assert.throws(
    () => enumeratePurchasedScopeVariants(tooWide, { maxVariants: 16 }),
    error => error.code === 'SCOPE_VARIANT_LIMIT_EXCEEDED'
  );
});

test('fails when a terminal path drops a question without an answer or explicit suppression', () => {
  const brokenEnumerator = (_compiled, purchasedScope) => [{
    purchasedScope: [...purchasedScope].sort(),
    answers: {},
    suppressed: ['payroll-mode'],
    operations: [{ type: 'NO_OP', key: 'payroll-mode' }],
    questions: []
  }];

  assert.throws(
    () => proveEveryDeclaredReachablePath(compiled, { enumerateReachablePaths: brokenEnumerator }),
    error => error.code === 'UNRESOLVED_QUESTION'
  );
});

test('fails when an answered question does not emit the effect declared by the selected option', () => {
  const brokenEnumerator = (_compiled, purchasedScope) => {
    const paths = oneTerminalPath(_compiled, purchasedScope);
    const path = paths[0];
    if (purchasedScope.includes('time')) {
      path.operations = path.operations.filter(operation => operation.questionId !== 'time-enabled');
    }
    return [path];
  };

  assert.throws(
    () => proveEveryDeclaredReachablePath(compiled, { enumerateReachablePaths: brokenEnumerator }),
    error => error.code === 'MISSING_ANSWER_EFFECT'
  );
});
