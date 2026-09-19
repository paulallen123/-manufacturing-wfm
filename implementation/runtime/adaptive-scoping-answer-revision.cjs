'use strict';

const { evaluateGraph, validPrefill } = require('./adaptive-scoping-graph.cjs');

function fail(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function reviseAnswer(compiled, priorEvaluation, input = {}) {
  if (!compiled || !compiled.version || !compiled.graphFingerprint || !Array.isArray(compiled.questions)) {
    throw new Error('Compiled scoping graph is required.');
  }
  if (!priorEvaluation || typeof priorEvaluation !== 'object') {
    throw new Error('Prior evaluation is required.');
  }
  if (!input.expectedRevision || input.expectedRevision !== priorEvaluation.revision) {
    fail('Scoping state changed; re-evaluate before revising this answer.', 'STALE_SCOPE_REVISION', 412);
  }
  if (priorEvaluation.graphVersion !== compiled.version) {
    fail('Scoping graph version changed; re-evaluate before revising this answer.', 'STALE_GRAPH_VERSION', 412);
  }
  if (priorEvaluation.graphFingerprint !== compiled.graphFingerprint) {
    fail('Scoping graph definition changed; re-evaluate before revising this answer.', 'STALE_GRAPH_DEFINITION', 412);
  }

  const questionId = input.questionId;
  const priorAnswers = priorEvaluation.answers || {};
  if (!questionId || !Object.prototype.hasOwnProperty.call(priorAnswers, questionId)) {
    fail('Only a currently active answered question can be revised.', 'QUESTION_NOT_ACTIVE_ANSWER', 409);
  }

  const question = compiled.questions.find(item => item.id === questionId);
  if (!question) {
    fail('Question does not exist in the active graph.', 'UNKNOWN_QUESTION', 409);
  }

  if (priorEvaluation.provenance && Object.prototype.hasOwnProperty.call(priorEvaluation.provenance, questionId)) {
    fail('This answer came from verified evidence; re-evaluate the source before allowing a manual replacement.', 'PREFILLED_ANSWER_REQUIRES_SOURCE_REEVALUATION', 409);
  }

  if (!Object.prototype.hasOwnProperty.call(input, 'value') || !question.options.some(option => option.value === input.value)) {
    fail('Revised answer is not a valid option for this question.', 'INVALID_ANSWER_VALUE', 422);
  }

  const nowMs = Number(input.nowMs || Date.now());
  const prefills = { ...(input.prefills || {}) };
  if (Object.prototype.hasOwnProperty.call(prefills, questionId) && validPrefill(prefills[questionId], nowMs, question.prefillPolicy || {})) {
    fail('Verified evidence now controls this question; re-evaluate before changing it manually.', 'QUESTION_NOW_PREFILLED', 409);
  }

  const evaluation = evaluateGraph(compiled, {
    nowMs,
    purchasedScope: priorEvaluation.purchasedScope,
    priorAnswers,
    answers: { [questionId]: input.value },
    prefills
  });

  return {
    ...evaluation,
    revisionEvent: {
      type: 'ANSWER_REVISED',
      questionId,
      previousValue: priorAnswers[questionId],
      newValue: input.value,
      priorRevision: priorEvaluation.revision,
      newRevision: evaluation.revision,
      invalidatedQuestionIds: evaluation.invalidated.map(item => item.questionId)
    }
  };
}

module.exports = {
  reviseAnswer
};
