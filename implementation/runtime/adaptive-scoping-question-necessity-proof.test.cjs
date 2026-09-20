'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { proveEveryVisibleQuestionNecessary } = require('./adaptive-scoping-question-necessity-proof.cjs');

function evaluatorFor(question) {
  return (_compiled, input = {}) => {
    const answers = { ...(input.answers || {}) };
    if (!Object.prototype.hasOwnProperty.call(answers, question.id)) {
      return {
        answers: {},
        questions: [{ id: question.id, options: question.options }],
        operations: [{ type: 'DECISION', key: question.id, reason: 'customer-input-required' }]
      };
    }
    const selected = question.options.find(option => option.value === answers[question.id]);
    return {
      answers: { [question.id]: answers[question.id] },
      questions: [],
      operations: selected.effects.map(effect => ({ ...effect, questionId: question.id, answerSource: 'ANSWER' }))
    };
  };
}

test('rejects a visible question when every choice produces the same material outcome', () => {
  const question = {
    id: 'redundant-choice',
    options: [
      { value: 'a', effects: [{ type: 'CONFIG', key: 'launch.mode', value: 'safe' }] },
      { value: 'b', effects: [{ type: 'CONFIG', key: 'launch.mode', value: 'safe' }] }
    ]
  };

  assert.throws(
    () => proveEveryVisibleQuestionNecessary({ questions: [question] }, ['core'], {
      evaluateGraph: evaluatorFor(question)
    }),
    error => error && error.code === 'REDUNDANT_VISIBLE_QUESTION'
  );
});

test('accepts a visible question when choices change a machine-actionable outcome', () => {
  const question = {
    id: 'integration-mode',
    options: [
      { value: 'api', effects: [{ type: 'DEPENDENCY', key: 'integration.api', value: true }] },
      { value: 'file', effects: [{ type: 'CONFIG', key: 'integration.mode', value: 'file' }] }
    ]
  };

  const result = proveEveryVisibleQuestionNecessary({ questions: [question] }, ['integration'], {
    evaluateGraph: evaluatorFor(question)
  });
  assert.equal(result.checkedQuestions, 1);
});

test('ignores bookkeeping metadata when deciding whether two outcomes are materially different', () => {
  const question = {
    id: 'metadata-only',
    options: [
      { value: 'a', effects: [{ type: 'CONFIG', key: 'x', value: 1 }] },
      { value: 'b', effects: [{ type: 'CONFIG', key: 'x', value: 1 }] }
    ]
  };

  const evaluateGraph = (_compiled, input = {}) => {
    const answers = input.answers || {};
    if (!Object.prototype.hasOwnProperty.call(answers, question.id)) {
      return { answers: {}, questions: [{ id: question.id, options: question.options }], operations: [] };
    }
    return {
      answers: { [question.id]: answers[question.id] },
      questions: [],
      operations: [{
        type: 'CONFIG', key: 'x', value: 1,
        questionId: question.id,
        answerSource: answers[question.id] === 'a' ? 'ANSWER' : 'PRIOR_ANSWER'
      }]
    };
  };

  assert.throws(
    () => proveEveryVisibleQuestionNecessary({ questions: [question] }, [], { evaluateGraph }),
    error => error && error.code === 'REDUNDANT_VISIBLE_QUESTION'
  );
});

test('exhaustive proof rejects redundant questions before accepting terminal paths', () => {
  const { proveEveryDeclaredReachablePath } = require('./adaptive-scoping-exhaustive-proof.cjs');
  const question = {
    id: 'unneeded',
    options: [
      { value: true, effects: [{ type: 'CONFIG', key: 'same', value: 1 }] },
      { value: false, effects: [{ type: 'CONFIG', key: 'same', value: 1 }] }
    ]
  };
  const compiled = { version: 'v1', graphFingerprint: 'fixture', questions: [question] };

  assert.throws(
    () => proveEveryDeclaredReachablePath(compiled, {
      evaluateGraph: evaluatorFor(question),
      enumerateReachablePaths: () => [{
        purchasedScope: [],
        answers: { unneeded: true },
        suppressed: [],
        operations: [{ type: 'CONFIG', key: 'same', value: 1, questionId: 'unneeded' }],
        questions: []
      }]
    }),
    error => error && error.code === 'REDUNDANT_VISIBLE_QUESTION'
  );
});
