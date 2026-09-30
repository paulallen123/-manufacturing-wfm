'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compileGraph,
  evaluateGraph,
  applyAnswer,
  enumerateReachablePaths,
  assertEveryReachablePathActionable
} = require('./adaptive-scoping-graph.cjs');

const graph = compileGraph({
  version: '2026-09-19.1',
  questions: [
    {
      id: 'payroll-enabled',
      prompt: 'Will WFM produce payroll-ready outputs?',
      scope: ['time'],
      options: [
        { value: true, label: 'Yes', effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: true }, { type: 'TEST', key: 'payroll-reconciliation' }] },
        { value: false, label: 'No', effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: false }] }
      ]
    },
    {
      id: 'payroll-system',
      prompt: 'Which payroll system is authoritative?',
      scope: ['time'],
      when: { question: 'payroll-enabled', equals: true },
      options: [
        { value: 'api', label: 'API-connected payroll', effects: [{ type: 'DEPENDENCY', key: 'integration.payrollApi' }, { type: 'TEST', key: 'payroll-api-roundtrip' }] },
        { value: 'file', label: 'File export', effects: [{ type: 'CONFIG', key: 'payroll.exportMode', value: 'file' }, { type: 'TEST', key: 'payroll-file-reconciliation' }] }
      ]
    },
    {
      id: 'clocking-mode',
      prompt: 'How will attendance be captured?',
      scope: ['attendance'],
      options: [
        { value: 'access', label: 'Access-control evidence', effects: [{ type: 'DEPENDENCY', key: 'integration.accessControl' }, { type: 'TEST', key: 'attendance-evidence-coverage' }] },
        { value: 'manual', label: 'Manager entry', effects: [{ type: 'RISK', key: 'attendance.manual-entry', severity: 'MEDIUM' }] }
      ]
    }
  ]
});

test('verified current prefills remove customer questions and emit machine actions', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['time'],
    nowMs: 100,
    prefills: {
      'payroll-enabled': { value: true, trust: 'VERIFIED', source: 'signed-order', evidenceId: 'e1', expiresAt: 1000 },
      'payroll-system': { value: 'api', trust: 'AUTHORITATIVE', source: 'integration-discovery', evidenceId: 'e2', expiresAt: 1000 }
    }
  });

  assert.deepEqual(result.questions, []);
  assert.equal(result.answers['payroll-enabled'], true);
  assert.equal(result.answers['payroll-system'], 'api');
  assert.ok(result.operations.some(item => item.type === 'DEPENDENCY' && item.key === 'integration.payrollApi'));
  assert.ok(result.operations.some(item => item.type === 'NO_OP' && item.key === 'clocking-mode'));
});

test('expired or ambiguous prefills cannot suppress a needed question', () => {
  const expired = evaluateGraph(graph, {
    purchasedScope: ['time'],
    nowMs: 1000,
    prefills: {
      'payroll-enabled': { value: true, trust: 'VERIFIED', source: 'crm', evidenceId: 'e1', expiresAt: 999 }
    }
  });
  assert.equal(expired.questions[0].id, 'payroll-enabled');

  const ambiguous = evaluateGraph(graph, {
    purchasedScope: ['time'],
    nowMs: 100,
    prefills: {
      'payroll-enabled': { value: true, trust: 'VERIFIED', source: 'crm', evidenceId: 'e2', ambiguous: true, expiresAt: 999 }
    }
  });
  assert.equal(ambiguous.questions[0].id, 'payroll-enabled');
});

test('changing an upstream answer invalidates stale hidden downstream answers', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['time'],
    priorAnswers: { 'payroll-enabled': true, 'payroll-system': 'api' },
    answers: { 'payroll-enabled': false }
  });

  assert.equal(result.answers['payroll-enabled'], false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.answers, 'payroll-system'), false);
  assert.ok(result.invalidated.some(item => item.questionId === 'payroll-system' && item.reason === 'BRANCH_HIDDEN'));
  assert.ok(result.operations.some(item => item.type === 'NO_OP' && item.key === 'payroll-system'));
});

test('out-of-scope answers are invalidated rather than retained invisibly', () => {
  const result = evaluateGraph(graph, {
    purchasedScope: ['attendance'],
    priorAnswers: { 'payroll-enabled': true, 'payroll-system': 'file' }
  });
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].id, 'clocking-mode');
  assert.equal(Object.keys(result.answers).length, 0);
  assert.ok(result.invalidated.some(item => item.questionId === 'payroll-enabled' && item.reason === 'OUTSIDE_PURCHASED_SCOPE'));
});

test('stale browser submissions fail closed using the prior evaluation revision', () => {
  const first = evaluateGraph(graph, { purchasedScope: ['time'] });
  const second = applyAnswer(graph, first, {
    expectedRevision: first.revision,
    questionId: 'payroll-enabled',
    value: true
  });
  assert.notEqual(second.revision, first.revision);
  assert.throws(() => applyAnswer(graph, second, {
    expectedRevision: first.revision,
    questionId: 'payroll-system',
    value: 'api'
  }), error => error.code === 'STALE_SCOPE_REVISION' && error.statusCode === 412);
});

test('a hidden question cannot be answered from a stale client', () => {
  const first = evaluateGraph(graph, { purchasedScope: ['time'] });
  assert.throws(() => applyAnswer(graph, first, {
    expectedRevision: first.revision,
    questionId: 'payroll-system',
    value: 'api'
  }), error => error.code === 'QUESTION_NOT_ACTIONABLE' && error.statusCode === 409);
});

test('every reachable purchased-scope path terminates in machine-actionable effects or explicit no-ops', () => {
  assert.equal(assertEveryReachablePathActionable(graph, [
    ['time'],
    ['attendance'],
    ['time', 'attendance']
  ]), true);

  const paths = enumerateReachablePaths(graph, ['time', 'attendance']);
  assert.ok(paths.length > 0);
  assert.ok(paths.every(path => path.questions.length === 0));
  assert.ok(paths.every(path => path.operations.every(op => ['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP'].includes(op.type))));
});

test('graph compilation rejects questions without machine effects', () => {
  assert.throws(() => compileGraph({
    version: 'bad.1',
    questions: [{ id: 'orphan', prompt: 'Orphan?', options: [{ value: true, effects: [] }] }]
  }), /at least one effect/);
});
