'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compileGraph,
  evaluateGraph,
  enumerateReachablePaths,
  assertEveryReachablePathActionable
} = require('./adaptive-scoping-graph.cjs');

const graph = compileGraph({
  version: '2026-09-19.3',
  questions: [
    {
      id: 'payroll-output',
      prompt: 'Will WFM produce payroll-ready outputs?',
      scope: ['time'],
      options: [
        { value: true, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: true }] },
        { value: false, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: false }] }
      ]
    },
    {
      id: 'payroll-authority',
      prompt: 'Which payroll system is authoritative?',
      scope: ['time'],
      scopeWhen: { question: 'payroll-output', equals: true },
      options: [
        { value: 'api', effects: [{ type: 'DEPENDENCY', key: 'integration.payrollApi' }, { type: 'TEST', key: 'payroll-api-roundtrip' }] },
        { value: 'file', effects: [{ type: 'CONFIG', key: 'payroll.exportMode', value: 'file' }, { type: 'TEST', key: 'payroll-file-reconciliation' }] }
      ]
    }
  ]
});

test('scopeWhen suppresses an irrelevant question and invalidates its stale answer', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['time'],
    priorAnswers: { 'payroll-output': true, 'payroll-authority': 'api' },
    answers: { 'payroll-output': false }
  });

  assert.deepEqual(result.questions, []);
  assert.equal(result.answers['payroll-output'], false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.answers, 'payroll-authority'), false);
  assert.ok(result.invalidated.some(item => item.questionId === 'payroll-authority' && item.reason === 'SCOPE_CONDITION_HIDDEN'));
  assert.ok(result.operations.some(item => item.type === 'NO_OP' && item.key === 'payroll-authority' && item.reason === 'scope-condition-not-reachable'));
});

test('scopeWhen exposes the question only when its controlling answer requires it', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['time'],
    answers: { 'payroll-output': true }
  });

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].id, 'payroll-authority');
});

test('verified prefill can safely remove a scope-conditional question', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['time'],
    nowMs: 100,
    priorAnswers: { 'payroll-authority': 'file' },
    prefills: {
      'payroll-output': {
        value: false,
        trust: 'VERIFIED',
        source: 'signed-order',
        evidenceId: 'contract-scope-1',
        expiresAt: 1000
      }
    }
  });

  assert.deepEqual(result.questions, []);
  assert.equal(result.answers['payroll-output'], false);
  assert.ok(result.invalidated.some(item => item.questionId === 'payroll-authority' && item.reason === 'SCOPE_CONDITION_HIDDEN'));
});

test('scope-conditional graph still proves every reachable path machine-actionable', () => {
  assert.equal(assertEveryReachablePathActionable(graph, [['time']]), true);
  const paths = enumerateReachablePaths(graph, ['time']);
  assert.equal(paths.length, 3);
  assert.ok(paths.every(path => path.questions.length === 0));
  assert.ok(paths.every(path => path.operations.every(op => ['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP'].includes(op.type))));
});

test('compile rejects a scope condition that depends on a later unanswered question', () => {
  assert.throws(() => compileGraph({
    version: 'forward-ref',
    questions: [
      {
        id: 'integration-detail',
        prompt: 'Integration detail?',
        scopeWhen: { question: 'integration-enabled', equals: true },
        options: [{ value: 'api', effects: [{ type: 'CONFIG', key: 'integration.mode', value: 'api' }] }]
      },
      {
        id: 'integration-enabled',
        prompt: 'Enable integration?',
        options: [{ value: true, effects: [{ type: 'CONFIG', key: 'integration.enabled', value: true }] }]
      }
    ]
  }), /earlier question/);
});

test('compile rejects self-referential and nested forward branch dependencies', () => {
  assert.throws(() => compileGraph({
    version: 'self-ref',
    questions: [{
      id: 'clocking',
      prompt: 'Clocking?',
      when: { question: 'clocking', equals: true },
      options: [{ value: true, effects: [{ type: 'CONFIG', key: 'clocking.enabled', value: true }] }]
    }]
  }), /earlier question/);

  assert.throws(() => compileGraph({
    version: 'nested-forward-ref',
    questions: [
      {
        id: 'first',
        prompt: 'First?',
        when: { any: [{ question: 'second', equals: true }] },
        options: [{ value: true, effects: [{ type: 'CONFIG', key: 'first.enabled', value: true }] }]
      },
      {
        id: 'second',
        prompt: 'Second?',
        options: [{ value: true, effects: [{ type: 'CONFIG', key: 'second.enabled', value: true }] }]
      }
    ]
  }), /earlier question/);
});

test('backward nested dependencies are accepted and remain sequential', () => {
  const nested = compileGraph({
    version: 'backward-nested',
    questions: [
      {
        id: 'purchased-payroll',
        prompt: 'Payroll?',
        options: [
          { value: true, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: true }] },
          { value: false, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: false }] }
        ]
      },
      {
        id: 'needs-api',
        prompt: 'Needs API?',
        when: { all: [{ question: 'purchased-payroll', equals: true }] },
        options: [
          { value: true, effects: [{ type: 'DEPENDENCY', key: 'payroll.api' }] },
          { value: false, effects: [{ type: 'NO_OP', key: 'payroll.api', reason: 'file-export-sufficient' }] }
        ]
      }
    ]
  });

  const first = evaluateGraph(nested, {});
  assert.deepEqual(first.questions.map(item => item.id), ['purchased-payroll']);
  const second = evaluateGraph(nested, { answers: { 'purchased-payroll': true } });
  assert.deepEqual(second.questions.map(item => item.id), ['needs-api']);
});
