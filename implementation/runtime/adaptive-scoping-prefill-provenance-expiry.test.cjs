'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileGraph, evaluateGraph, applyAnswer } = require('./adaptive-scoping-graph.cjs');
const { reviseAnswer } = require('./adaptive-scoping-answer-revision.cjs');

function graph() {
  return compileGraph({
    version: '2026-09-20.prefill-provenance-expiry.1',
    questions: [
      {
        id: 'integration-mode',
        prompt: 'Which payroll integration mode applies?',
        scope: ['payroll'],
        prefillPolicy: { maxAgeMs: 500, allowedSources: ['signed-order'] },
        options: [
          { value: 'api', effects: [{ type: 'CONFIG', key: 'payroll.integrationMode', value: 'api' }] },
          { value: 'file', effects: [{ type: 'CONFIG', key: 'payroll.integrationMode', value: 'file' }] }
        ]
      },
      {
        id: 'launch-validation',
        prompt: 'Which launch validation profile is required?',
        scope: ['payroll'],
        when: { question: 'integration-mode', equals: 'api' },
        options: [
          { value: 'strict', effects: [{ type: 'TEST', key: 'payroll.launchValidation', value: 'strict' }] },
          { value: 'basic', effects: [{ type: 'TEST', key: 'payroll.launchValidation', value: 'basic' }] }
        ]
      }
    ]
  });
}

function prefill(overrides = {}) {
  return {
    value: 'api',
    trust: 'AUTHORITATIVE',
    source: 'signed-order',
    evidenceId: 'order-42',
    observedAt: 1_000,
    ...overrides
  };
}

function freshStart(compiled) {
  return evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 1_200,
    prefills: { 'integration-mode': prefill() }
  });
}

test('expired prefill evidence cannot be resurrected as an ordinary prior answer', () => {
  const compiled = graph();
  const first = freshStart(compiled);

  const resumed = evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 2_000,
    priorAnswers: first.answers,
    priorProvenance: first.provenance,
    prefills: { 'integration-mode': prefill() }
  });

  assert.deepEqual(resumed.questions.map(question => question.id), ['integration-mode']);
  assert.equal(Object.prototype.hasOwnProperty.call(resumed.answers, 'integration-mode'), false);
  assert.ok(resumed.invalidated.some(item => item.questionId === 'integration-mode' && item.reason === 'PREFILL_EVIDENCE_STALE_OR_UNAVAILABLE'));
  assert.ok(resumed.operations.some(operation => operation.type === 'DECISION' && operation.key === 'integration-mode'));
  assert.ok(resumed.operations.some(operation => operation.type === 'NO_OP' && operation.key === 'launch-validation'));
});

test('a new valid prefill replaces the old evidence instead of forcing a question', () => {
  const compiled = graph();
  const first = freshStart(compiled);
  const resumed = evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 2_000,
    priorAnswers: first.answers,
    priorProvenance: first.provenance,
    prefills: {
      'integration-mode': prefill({ evidenceId: 'order-43', observedAt: 1_900 })
    }
  });

  assert.equal(resumed.answers['integration-mode'], 'api');
  assert.equal(resumed.provenance['integration-mode'].evidenceId, 'order-43');
  assert.deepEqual(resumed.questions.map(question => question.id), ['launch-validation']);
  assert.equal(resumed.invalidated.some(item => item.questionId === 'integration-mode'), false);
});

test('ordinary customer answers remain reusable when they have no prefill provenance', () => {
  const compiled = graph();
  const first = evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 1_200,
    answers: { 'integration-mode': 'api' }
  });
  const resumed = evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 2_000,
    priorAnswers: first.answers,
    priorProvenance: first.provenance
  });

  assert.equal(resumed.answers['integration-mode'], 'api');
  assert.deepEqual(resumed.questions.map(question => question.id), ['launch-validation']);
});

test('answer submission rechecks upstream prefill freshness before accepting a downstream answer', () => {
  const compiled = graph();
  const first = freshStart(compiled);

  const resumed = applyAnswer(compiled, first, {
    expectedRevision: first.revision,
    questionId: 'launch-validation',
    value: 'strict',
    nowMs: 2_000,
    prefills: { 'integration-mode': prefill() }
  });

  assert.deepEqual(resumed.questions.map(question => question.id), ['integration-mode']);
  assert.equal(Object.prototype.hasOwnProperty.call(resumed.answers, 'launch-validation'), false);
  assert.ok(resumed.invalidated.some(item => item.questionId === 'integration-mode' && item.reason === 'PREFILL_EVIDENCE_STALE_OR_UNAVAILABLE'));
  assert.ok(resumed.invalidated.some(item => item.questionId === 'launch-validation' && item.reason === 'WAITING_ON_DEPENDENCY'));
});

test('answer revision also rechecks upstream prefill freshness before retaining the revised branch', () => {
  const compiled = graph();
  const first = evaluateGraph(compiled, {
    purchasedScope: ['payroll'],
    nowMs: 1_200,
    answers: { 'launch-validation': 'strict' },
    prefills: { 'integration-mode': prefill() }
  });

  assert.equal(first.questions.length, 0);
  const revised = reviseAnswer(compiled, first, {
    expectedRevision: first.revision,
    questionId: 'launch-validation',
    value: 'basic',
    nowMs: 2_000,
    prefills: { 'integration-mode': prefill() }
  });

  assert.deepEqual(revised.questions.map(question => question.id), ['integration-mode']);
  assert.equal(Object.prototype.hasOwnProperty.call(revised.answers, 'launch-validation'), false);
  assert.ok(revised.revisionEvent.invalidatedQuestionIds.includes('integration-mode'));
  assert.ok(revised.revisionEvent.invalidatedQuestionIds.includes('launch-validation'));
});
