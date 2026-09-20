'use strict';

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function materialOperation(operation) {
  if (!operation || operation.type === 'NO_OP') return null;
  const normalized = {};
  for (const [key, value] of Object.entries(operation)) {
    if (key === 'questionId' || key === 'answerSource') continue;
    normalized[key] = value;
  }
  return normalized;
}

function terminalOutcomeSignature(evaluation) {
  const material = (evaluation.operations || [])
    .map(materialOperation)
    .filter(Boolean)
    .map(stable)
    .sort();
  return stable(material);
}

function createProofContext(compiled, purchasedScope, options = {}) {
  const evaluateGraph = options.evaluateGraph || require('./adaptive-scoping-graph.cjs').evaluateGraph;
  if (typeof evaluateGraph !== 'function') fail('Adaptive scoping evaluator is required.', 'MISSING_SCOPE_EVALUATOR');
  const maxStates = Number.isInteger(options.maxNecessityStates) && options.maxNecessityStates > 0
    ? options.maxNecessityStates
    : 100000;
  return {
    compiled,
    purchasedScope: [...purchasedScope],
    evaluateGraph,
    maxStates,
    visitedStates: new Set(),
    outcomeMemo: new Map(),
    stateCount: 0,
    checkedQuestions: 0
  };
}

function evaluateState(context, answers) {
  return context.evaluateGraph(context.compiled, {
    purchasedScope: context.purchasedScope,
    answers,
    priorAnswers: answers,
    nowMs: 1
  });
}

function canonicalState(evaluation, purchasedScope) {
  return stable({
    purchasedScope: [...purchasedScope].sort(),
    answers: evaluation.answers || {},
    questions: (evaluation.questions || []).map(question => question.id)
  });
}

function guardStateBudget(context, stateKey) {
  if (context.visitedStates.has(stateKey) || context.outcomeMemo.has(stateKey)) return;
  context.stateCount += 1;
  if (context.stateCount > context.maxStates) {
    fail(
      'Question-necessity proof exceeded ' + context.maxStates + ' reachable states. Refuse to sample silently.',
      'QUESTION_NECESSITY_STATE_LIMIT_EXCEEDED'
    );
  }
}

function collectTerminalOutcomes(context, seedAnswers) {
  const evaluation = evaluateState(context, seedAnswers);
  const stateKey = canonicalState(evaluation, context.purchasedScope);
  if (context.outcomeMemo.has(stateKey)) return context.outcomeMemo.get(stateKey);
  guardStateBudget(context, stateKey);

  if (!Array.isArray(evaluation.questions) || evaluation.questions.length === 0) {
    const terminal = new Set([terminalOutcomeSignature(evaluation)]);
    context.outcomeMemo.set(stateKey, terminal);
    return terminal;
  }

  const next = evaluation.questions[0];
  const outcomes = new Set();
  for (const option of next.options || []) {
    const childAnswers = { ...(evaluation.answers || {}), [next.id]: option.value };
    for (const signature of collectTerminalOutcomes(context, childAnswers)) outcomes.add(signature);
  }
  context.outcomeMemo.set(stateKey, outcomes);
  return outcomes;
}

function outcomeSetSignature(outcomes) {
  return stable([...outcomes].sort());
}

function proveEveryVisibleQuestionNecessary(compiled, purchasedScope = [], options = {}) {
  const context = createProofContext(compiled, purchasedScope, options);

  function walk(seedAnswers) {
    const evaluation = evaluateState(context, seedAnswers);
    const stateKey = canonicalState(evaluation, context.purchasedScope);
    if (context.visitedStates.has(stateKey)) return;
    guardStateBudget(context, stateKey);
    context.visitedStates.add(stateKey);

    if (!Array.isArray(evaluation.questions) || evaluation.questions.length === 0) return;

    const question = evaluation.questions[0];
    if (!Array.isArray(question.options) || question.options.length < 2) {
      fail(
        'Visible question ' + question.id + ' has fewer than two meaningful choices and should not be asked.',
        'REDUNDANT_VISIBLE_QUESTION'
      );
    }

    const branchSignatures = [];
    for (const option of question.options) {
      const childAnswers = { ...(evaluation.answers || {}), [question.id]: option.value };
      branchSignatures.push(outcomeSetSignature(collectTerminalOutcomes(context, childAnswers)));
    }

    if (branchSignatures.every(signature => signature === branchSignatures[0])) {
      fail(
        'Visible question ' + question.id + ' does not change any material configuration, test, dependency, risk or decision outcome and should be removed or pre-resolved.',
        'REDUNDANT_VISIBLE_QUESTION'
      );
    }

    context.checkedQuestions += 1;
    for (const option of question.options) {
      walk({ ...(evaluation.answers || {}), [question.id]: option.value });
    }
  }

  walk({});
  return Object.freeze({
    checkedQuestions: context.checkedQuestions,
    reachableStates: context.visitedStates.size
  });
}

module.exports = {
  materialOperation,
  terminalOutcomeSignature,
  proveEveryVisibleQuestionNecessary
};
