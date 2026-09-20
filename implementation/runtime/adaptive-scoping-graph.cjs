'use strict';

const { createHash } = require('node:crypto');

const ACTION_TYPES = new Set(['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP']);
const PREFILL_TRUST = new Set(['VERIFIED', 'AUTHORITATIVE']);
const PREDICATE_STATES = Object.freeze({ TRUE: 'TRUE', FALSE: 'FALSE', UNKNOWN: 'UNKNOWN' });

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function validateEffect(effect, context) {
  if (!effect || typeof effect !== 'object' || !ACTION_TYPES.has(effect.type)) {
    throw new Error(context + ' must declare a machine-actionable effect type.');
  }
  if (!effect.key && effect.type !== 'NO_OP') {
    throw new Error(context + ' must declare an effect key.');
  }
  return true;
}

function validatePrefillPolicy(policy, context) {
  if (policy == null) return true;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(context + ' prefillPolicy must be an object.');
  }
  if (policy.maxAgeMs != null && (!Number.isFinite(Number(policy.maxAgeMs)) || Number(policy.maxAgeMs) <= 0)) {
    throw new Error(context + ' prefillPolicy.maxAgeMs must be a positive number.');
  }
  if (policy.maxFutureSkewMs != null && (!Number.isFinite(Number(policy.maxFutureSkewMs)) || Number(policy.maxFutureSkewMs) < 0)) {
    throw new Error(context + ' prefillPolicy.maxFutureSkewMs must be zero or a positive number.');
  }
  if (policy.allowedSources != null) {
    if (!Array.isArray(policy.allowedSources) || policy.allowedSources.length === 0 || policy.allowedSources.some(source => typeof source !== 'string' || source.trim() === '')) {
      throw new Error(context + ' prefillPolicy.allowedSources must contain non-empty source names.');
    }
  }
  return true;
}

function validatePredicate(predicate, questionIds, context) {
  if (predicate == null) return;
  if (typeof predicate !== 'object') throw new Error(context + ' predicate must be an object.');
  if (Array.isArray(predicate.all)) {
    for (const item of predicate.all) validatePredicate(item, questionIds, context);
    return;
  }
  if (Array.isArray(predicate.any)) {
    for (const item of predicate.any) validatePredicate(item, questionIds, context);
    return;
  }
  if (predicate.not) {
    validatePredicate(predicate.not, questionIds, context);
    return;
  }
  if (!predicate.question || !questionIds.has(predicate.question)) {
    throw new Error(context + ' predicate references an unknown question.');
  }
  if (!Object.prototype.hasOwnProperty.call(predicate, 'equals') && !Array.isArray(predicate.in)) {
    throw new Error(context + ' predicate must declare equals or in.');
  }
}

function predicateDependencies(predicate, out = new Set()) {
  if (predicate == null || typeof predicate !== 'object') return out;
  if (Array.isArray(predicate.all)) {
    for (const item of predicate.all) predicateDependencies(item, out);
    return out;
  }
  if (Array.isArray(predicate.any)) {
    for (const item of predicate.any) predicateDependencies(item, out);
    return out;
  }
  if (predicate.not) return predicateDependencies(predicate.not, out);
  if (predicate.question) out.add(predicate.question);
  return out;
}

function validateDependencyOrder(question, predicate, positions, context) {
  const questionIndex = positions.get(question.id);
  for (const dependencyId of predicateDependencies(predicate)) {
    const dependencyIndex = positions.get(dependencyId);
    if (dependencyIndex >= questionIndex) {
      throw new Error(context + ' predicate must reference an earlier question so the controlling answer is valid before this question is evaluated.');
    }
  }
}

function compileGraph(graph) {
  if (!graph || typeof graph !== 'object') throw new Error('Scoping graph is required.');
  if (!/^[A-Za-z0-9._-]+$/.test(String(graph.version || ''))) throw new Error('Scoping graph requires a version.');
  if (!Array.isArray(graph.questions) || graph.questions.length === 0) throw new Error('Scoping graph requires questions.');

  const ids = new Set();
  const positions = new Map();
  graph.questions.forEach((q, index) => {
    if (!q.id || ids.has(q.id)) throw new Error('Scoping question ids must be unique and non-empty.');
    ids.add(q.id);
    positions.set(q.id, index);
  });

  for (const q of graph.questions) {
    if (!q.prompt) throw new Error('Question ' + q.id + ' requires a prompt.');
    if (!Array.isArray(q.options) || q.options.length === 0) throw new Error('Question ' + q.id + ' requires options.');
    validatePrefillPolicy(q.prefillPolicy, 'Question ' + q.id);
    validatePredicate(q.when, ids, 'Question ' + q.id);
    validateDependencyOrder(q, q.when, positions, 'Question ' + q.id);
    validatePredicate(q.scopeWhen, ids, 'Question ' + q.id + ' scope');
    validateDependencyOrder(q, q.scopeWhen, positions, 'Question ' + q.id + ' scope');
    if (q.suppressedEffect) validateEffect(q.suppressedEffect, 'Question ' + q.id + ' suppressedEffect');
    for (const option of q.options) {
      if (!Object.prototype.hasOwnProperty.call(option, 'value')) throw new Error('Question ' + q.id + ' option requires a value.');
      if (!Array.isArray(option.effects) || option.effects.length === 0) throw new Error('Question ' + q.id + ' option requires at least one effect.');
      for (const effect of option.effects) validateEffect(effect, 'Question ' + q.id + ' option ' + String(option.value));
    }
  }

  const version = String(graph.version);
  const questions = clone(graph.questions);
  const graphFingerprint = digest({ version, questions });
  return Object.freeze({ version, graphFingerprint, questions });
}

function predicateState(predicate, values) {
  if (predicate == null) return PREDICATE_STATES.TRUE;
  if (Array.isArray(predicate.all)) {
    const states = predicate.all.map(item => predicateState(item, values));
    if (states.some(state => state === PREDICATE_STATES.FALSE)) return PREDICATE_STATES.FALSE;
    if (states.every(state => state === PREDICATE_STATES.TRUE)) return PREDICATE_STATES.TRUE;
    return PREDICATE_STATES.UNKNOWN;
  }
  if (Array.isArray(predicate.any)) {
    const states = predicate.any.map(item => predicateState(item, values));
    if (states.some(state => state === PREDICATE_STATES.TRUE)) return PREDICATE_STATES.TRUE;
    if (states.every(state => state === PREDICATE_STATES.FALSE)) return PREDICATE_STATES.FALSE;
    return PREDICATE_STATES.UNKNOWN;
  }
  if (predicate.not) {
    const state = predicateState(predicate.not, values);
    if (state === PREDICATE_STATES.TRUE) return PREDICATE_STATES.FALSE;
    if (state === PREDICATE_STATES.FALSE) return PREDICATE_STATES.TRUE;
    return PREDICATE_STATES.UNKNOWN;
  }
  if (!Object.prototype.hasOwnProperty.call(values, predicate.question)) return PREDICATE_STATES.UNKNOWN;
  const value = values[predicate.question];
  const matched = Object.prototype.hasOwnProperty.call(predicate, 'equals')
    ? value === predicate.equals
    : predicate.in.includes(value);
  return matched ? PREDICATE_STATES.TRUE : PREDICATE_STATES.FALSE;
}

function predicateMatches(predicate, values) {
  return predicateState(predicate, values) === PREDICATE_STATES.TRUE;
}

function validPrefill(prefill, nowMs, policy = {}) {
  if (!prefill || !PREFILL_TRUST.has(String(prefill.trust || '').toUpperCase())) return false;
  if (!prefill.source || !prefill.evidenceId) return false;
  if (prefill.conflicted === true || prefill.ambiguous === true) return false;
  if (prefill.expiresAt != null && Number(prefill.expiresAt) <= nowMs) return false;

  if (Array.isArray(policy.allowedSources) && !policy.allowedSources.includes(prefill.source)) return false;

  const requiresObservedAt = policy.maxAgeMs != null || policy.requireObservedAt === true;
  if (requiresObservedAt) {
    const observedAt = Number(prefill.observedAt);
    if (!Number.isFinite(observedAt) || observedAt <= 0) return false;
    const maxFutureSkewMs = policy.maxFutureSkewMs == null ? 60 * 1000 : Number(policy.maxFutureSkewMs);
    if (observedAt > nowMs + maxFutureSkewMs) return false;
    if (policy.maxAgeMs != null && nowMs - observedAt > Number(policy.maxAgeMs)) return false;
  }

  return true;
}

function optionFor(question, value) {
  return question.options.find(item => item.value === value) || null;
}

function evaluateGraph(compiled, input = {}) {
  if (!compiled || !compiled.version || !compiled.graphFingerprint || !Array.isArray(compiled.questions)) throw new Error('Compiled scoping graph is required.');
  const nowMs = Number(input.nowMs || Date.now());
  const purchasedScope = new Set(Array.isArray(input.purchasedScope) ? input.purchasedScope : []);
  const providedAnswers = { ...(input.answers || {}) };
  const prefills = input.prefills || {};
  const priorAnswers = input.priorAnswers || {};
  const priorProvenance = input.priorProvenance || {};
  const values = {};
  const provenance = {};
  const visibleQuestions = [];
  const operations = [];
  const invalidated = [];
  const suppressed = [];

  for (const question of compiled.questions) {
    const scopeEligible = !Array.isArray(question.scope) || question.scope.length === 0 || question.scope.some(item => purchasedScope.has(item));
    const scopeConditionState = predicateState(question.scopeWhen, values);
    const branchState = predicateState(question.when, values);
    const visible = scopeEligible && scopeConditionState === PREDICATE_STATES.TRUE && branchState === PREDICATE_STATES.TRUE;

    if (!visible) {
      const waitingOnDependency = scopeEligible && (scopeConditionState === PREDICATE_STATES.UNKNOWN || branchState === PREDICATE_STATES.UNKNOWN);
      const hiddenReason = !scopeEligible
        ? 'OUTSIDE_PURCHASED_SCOPE'
        : waitingOnDependency
          ? 'WAITING_ON_DEPENDENCY'
          : scopeConditionState !== PREDICATE_STATES.TRUE
            ? 'SCOPE_CONDITION_HIDDEN'
            : 'BRANCH_HIDDEN';
      if (Object.prototype.hasOwnProperty.call(priorAnswers, question.id) || Object.prototype.hasOwnProperty.call(providedAnswers, question.id)) {
        invalidated.push({ questionId: question.id, reason: hiddenReason });
      }
      suppressed.push(question.id);
      operations.push(clone(question.suppressedEffect || {
        type: 'NO_OP',
        key: question.id,
        reason: hiddenReason === 'OUTSIDE_PURCHASED_SCOPE'
          ? 'outside-purchased-scope'
          : hiddenReason === 'WAITING_ON_DEPENDENCY'
            ? 'waiting-on-valid-dependency'
            : hiddenReason === 'SCOPE_CONDITION_HIDDEN'
              ? 'scope-condition-not-reachable'
              : 'branch-not-reachable'
      }));
      continue;
    }

    let value;
    let source = 'UNANSWERED';
    const prefill = prefills[question.id];
    if (validPrefill(prefill, nowMs, question.prefillPolicy || {})) {
      value = prefill.value;
      source = 'PREFILL';
      provenance[question.id] = {
        source: prefill.source,
        evidenceId: prefill.evidenceId,
        observedAt: prefill.observedAt || null,
        expiresAt: prefill.expiresAt || null
      };
    } else if (Object.prototype.hasOwnProperty.call(providedAnswers, question.id)) {
      value = providedAnswers[question.id];
      source = 'ANSWER';
    } else if (Object.prototype.hasOwnProperty.call(priorAnswers, question.id)) {
      if (Object.prototype.hasOwnProperty.call(priorProvenance, question.id)) {
        invalidated.push({ questionId: question.id, reason: 'PREFILL_EVIDENCE_STALE_OR_UNAVAILABLE' });
      } else {
        value = priorAnswers[question.id];
        source = 'PRIOR_ANSWER';
      }
    }

    const option = optionFor(question, value);
    if (value !== undefined && !option) {
      invalidated.push({ questionId: question.id, reason: source === 'PREFILL' ? 'INVALID_PREFILL_VALUE' : 'INVALID_ANSWER_VALUE' });
      value = undefined;
      source = 'UNANSWERED';
      delete provenance[question.id];
    }

    if (value === undefined) {
      visibleQuestions.push({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map(item => ({ value: clone(item.value), label: item.label || String(item.value) })),
        reason: question.reason || null
      });
      operations.push({ type: 'DECISION', key: question.id, reason: 'customer-input-required' });
      continue;
    }

    values[question.id] = value;
    for (const effect of option.effects) operations.push({ ...clone(effect), questionId: question.id, answerSource: source });
  }

  const inputAnswerIds = new Set([...Object.keys(priorAnswers), ...Object.keys(providedAnswers)]);
  for (const id of inputAnswerIds) {
    if (!compiled.questions.some(q => q.id === id)) invalidated.push({ questionId: id, reason: 'UNKNOWN_GRAPH_VERSION_QUESTION' });
  }

  const activeAnswers = {};
  for (const [id, value] of Object.entries(values)) activeAnswers[id] = clone(value);

  const revisionPayload = {
    graphVersion: compiled.version,
    graphFingerprint: compiled.graphFingerprint,
    purchasedScope: [...purchasedScope].sort(),
    activeAnswers,
    provenance
  };
  const revision = digest(revisionPayload);

  return {
    graphVersion: compiled.version,
    graphFingerprint: compiled.graphFingerprint,
    revision,
    purchasedScope: [...purchasedScope].sort(),
    answers: activeAnswers,
    provenance,
    questions: visibleQuestions,
    operations,
    invalidated,
    suppressed
  };
}

function applyAnswer(compiled, priorEvaluation, input = {}) {
  if (!priorEvaluation || typeof priorEvaluation !== 'object') throw new Error('Prior evaluation is required.');
  if (!input.expectedRevision || input.expectedRevision !== priorEvaluation.revision) {
    const error = new Error('Scoping state changed; re-evaluate before applying this answer.');
    error.code = 'STALE_SCOPE_REVISION';
    error.statusCode = 412;
    throw error;
  }
  if (priorEvaluation.graphVersion !== compiled.version) {
    const error = new Error('Scoping graph version changed; re-evaluate before applying this answer.');
    error.code = 'STALE_GRAPH_VERSION';
    error.statusCode = 412;
    throw error;
  }
  if (priorEvaluation.graphFingerprint !== compiled.graphFingerprint) {
    const error = new Error('Scoping graph definition changed without a version migration; re-evaluate before applying this answer.');
    error.code = 'STALE_GRAPH_DEFINITION';
    error.statusCode = 412;
    throw error;
  }
  if (!priorEvaluation.questions.some(question => question.id === input.questionId)) {
    const error = new Error('Question is not currently actionable.');
    error.code = 'QUESTION_NOT_ACTIONABLE';
    error.statusCode = 409;
    throw error;
  }

  return evaluateGraph(compiled, {
    nowMs: input.nowMs,
    purchasedScope: priorEvaluation.purchasedScope,
    priorAnswers: priorEvaluation.answers,
    priorProvenance: priorEvaluation.provenance,
    answers: { [input.questionId]: input.value },
    prefills: input.prefills || {}
  });
}

function enumerateReachablePaths(compiled, purchasedScope = []) {
  const results = [];
  const seen = new Set();

  function walk(answers) {
    const evaluation = evaluateGraph(compiled, { purchasedScope, answers, priorAnswers: answers, nowMs: 1 });
    const key = stable(evaluation.answers) + '|' + evaluation.questions.map(q => q.id).join(',');
    if (seen.has(key)) return;
    seen.add(key);

    if (evaluation.questions.length === 0) {
      results.push(evaluation);
      return;
    }

    const next = evaluation.questions[0];
    for (const option of next.options) walk({ ...answers, [next.id]: option.value });
  }

  walk({});
  return results;
}

function assertEveryReachablePathActionable(compiled, purchasedScopes) {
  for (const scope of purchasedScopes) {
    const paths = enumerateReachablePaths(compiled, scope);
    if (!paths.length) throw new Error('No reachable scoping paths for purchased scope.');
    for (const path of paths) {
      if (path.questions.length !== 0) throw new Error('Reachable path ended with unanswered questions.');
      if (!path.operations.length) throw new Error('Reachable path produced no machine actions.');
      for (const operation of path.operations) validateEffect(operation, 'Reachable path operation');
    }
  }
  return true;
}

module.exports = {
  ACTION_TYPES,
  PREDICATE_STATES,
  compileGraph,
  evaluateGraph,
  applyAnswer,
  enumerateReachablePaths,
  assertEveryReachablePathActionable,
  predicateState,
  predicateMatches,
  validPrefill
};
