'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compileGraph,
  evaluateGraph,
  applyAnswer
} = require('./adaptive-scoping-graph.cjs');
const { reviseAnswer } = require('./adaptive-scoping-answer-revision.cjs');

const graph = compileGraph({
  version: '2026-09-19.revision.1',
  questions: [
    {
      id: 'payroll-enabled',
      prompt: 'Will WFM produce payroll-ready outputs?',
      scope: ['time'],
      options: [
        { value: true, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: true }] },
        { value: false, effects: [{ type: 'CONFIG', key: 'payroll.enabled', value: false }] }
      ]
    },
    {
      id: 'payroll-system',
      prompt: 'Which payroll system is authoritative?',
      scope: ['time'],
      when: { question: 'payroll-enabled', equals: true },
      options: [
        { value: 'api', effects: [{ type: 'DEPENDENCY', key: 'integration.payrollApi' }] },
        { value: 'file', effects: [{ type: 'CONFIG', key: 'payroll.exportMode', value: 'file' }] }
      ]
    },
    {
      id: 'payroll-api-test',
      prompt: 'Should API round-trip validation be required?',
      scope: ['time'],
      when: { question: 'payroll-system', equals: 'api' },
      options: [
        { value: true, effects: [{ type: 'TEST', key: 'payroll-api-roundtrip' }] },
        { value: false, effects: [{ type: 'RISK', key: 'payroll-api-roundtrip-skipped', severity: 'HIGH' }] }
      ]
    }
  ]
});

function completedManualPath() {
  let state = evaluateGraph(graph, { purchasedScope: ['time'], nowMs: 1000 });
  state = applyAnswer(graph, state, {
    expectedRevision: state.revision,
    questionId: 'payroll-enabled',
    value: true,
    nowMs: 1000
  });
  state = applyAnswer(graph, state, {
    expectedRevision: state.revision,
    questionId: 'payroll-system',
    value: 'api',
    nowMs: 1000
  });
  state = applyAnswer(graph, state, {
    expectedRevision: state.revision,
    questionId: 'payroll-api-test',
    value: true,
    nowMs: 1000
  });
  return state;
}

test('revising an active controlling answer clears every newly hidden downstream answer', () => {
  const before = completedManualPath();
  const after = reviseAnswer(graph, before, {
    expectedRevision: before.revision,
    questionId: 'payroll-enabled',
    value: false,
    nowMs: 1000
  });

  assert.equal(after.answers['payroll-enabled'], false);
  assert.equal(Object.prototype.hasOwnProperty.call(after.answers, 'payroll-system'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(after.answers, 'payroll-api-test'), false);
  assert.ok(after.invalidated.some(item => item.questionId === 'payroll-system' && item.reason === 'BRANCH_HIDDEN'));
  assert.ok(after.invalidated.some(item => item.questionId === 'payroll-api-test'));
  assert.ok(after.operations.some(item => item.type === 'NO_OP' && item.key === 'payroll-system'));
  assert.deepEqual(after.revisionEvent.invalidatedQuestionIds.sort(), ['payroll-api-test', 'payroll-system'].sort());
});

test('a stale browser cannot revise an answer after the scoping revision changed', () => {
  const before = completedManualPath();
  assert.throws(() => reviseAnswer(graph, before, {
    expectedRevision: 'stale-revision',
    questionId: 'payroll-enabled',
    value: false,
    nowMs: 1000
  }), error => error.code === 'STALE_SCOPE_REVISION' && error.statusCode === 412);
});

test('hidden or otherwise inactive answers cannot be revived through the revision endpoint', () => {
  const before = completedManualPath();
  const after = reviseAnswer(graph, before, {
    expectedRevision: before.revision,
    questionId: 'payroll-enabled',
    value: false,
    nowMs: 1000
  });

  assert.throws(() => reviseAnswer(graph, after, {
    expectedRevision: after.revision,
    questionId: 'payroll-system',
    value: 'file',
    nowMs: 1000
  }), error => error.code === 'QUESTION_NOT_ACTIVE_ANSWER' && error.statusCode === 409);
});

test('verified prefilled answers cannot be silently overwritten by a manual revision', () => {
  const state = evaluateGraph(graph, {
    purchasedScope: ['time'],
    nowMs: 1000,
    prefills: {
      'payroll-enabled': {
        value: true,
        trust: 'VERIFIED',
        source: 'signed-order',
        evidenceId: 'order-1',
        observedAt: 900,
        expiresAt: 5000
      }
    }
  });

  assert.equal(state.answers['payroll-enabled'], true);
  assert.throws(() => reviseAnswer(graph, state, {
    expectedRevision: state.revision,
    questionId: 'payroll-enabled',
    value: false,
    nowMs: 1000
  }), error => error.code === 'PREFILLED_ANSWER_REQUIRES_SOURCE_REEVALUATION' && error.statusCode === 409);
});

test('an invalid replacement value fails instead of mutating scoping state', () => {
  const before = completedManualPath();
  assert.throws(() => reviseAnswer(graph, before, {
    expectedRevision: before.revision,
    questionId: 'payroll-system',
    value: 'unknown-provider',
    nowMs: 1000
  }), error => error.code === 'INVALID_ANSWER_VALUE' && error.statusCode === 422);
});
