'use strict';

const { proveEveryVisibleQuestionNecessary } = require('./adaptive-scoping-question-necessity-proof.cjs');

const ACTION_TYPES = new Set(['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP']);

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

function declaredScopeTokens(compiled) {
  if (!compiled || !Array.isArray(compiled.questions)) fail('Compiled scoping graph is required.', 'INVALID_COMPILED_GRAPH');
  const scopes = new Set();
  for (const question of compiled.questions) {
    if (question.scope == null) continue;
    if (!Array.isArray(question.scope)) fail('Question ' + question.id + ' scope must be an array.', 'INVALID_SCOPE_DECLARATION');
    for (const raw of question.scope) {
      const scope = typeof raw === 'string' ? raw.trim() : '';
      if (!scope) fail('Question ' + question.id + ' contains an invalid purchased-scope token.', 'INVALID_SCOPE_TOKEN');
      scopes.add(scope);
    }
  }
  return [...scopes].sort();
}

function enumeratePurchasedScopeVariants(compiled, options = {}) {
  const scopes = declaredScopeTokens(compiled);
  const maxVariants = Number.isInteger(options.maxVariants) && options.maxVariants > 0 ? options.maxVariants : 65536;
  const total = 1n << BigInt(scopes.length);
  if (total > BigInt(maxVariants)) {
    fail('Declared purchased scopes create ' + total.toString() + ' variants, above the exhaustive proof limit of ' + maxVariants + '. Refuse to sample silently.', 'SCOPE_VARIANT_LIMIT_EXCEEDED');
  }

  const variants = [];
  for (let mask = 0n; mask < total; mask += 1n) {
    const variant = [];
    for (let index = 0; index < scopes.length; index += 1) {
      if ((mask & (1n << BigInt(index))) !== 0n) variant.push(scopes[index]);
    }
    variants.push(variant);
  }
  return variants;
}

function effectMatches(actual, expected) {
  if (!actual || !expected) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (stable(actual[key]) !== stable(value)) return false;
  }
  return true;
}

function assertMachineAction(operation, context) {
  if (!operation || !ACTION_TYPES.has(operation.type)) fail(context + ' produced an unsupported operation.', 'NON_ACTIONABLE_OPERATION');
  if (operation.type !== 'NO_OP' && !operation.key) fail(context + ' produced an operation without a key.', 'UNKEYED_OPERATION');
}

function assertQuestionResolved(compiled, path, question) {
  const answered = path.answers && Object.prototype.hasOwnProperty.call(path.answers, question.id);
  const suppressed = Array.isArray(path.suppressed) && path.suppressed.includes(question.id);

  if (answered && suppressed) fail('Question ' + question.id + ' is both answered and suppressed.', 'AMBIGUOUS_QUESTION_STATE');
  if (!answered && !suppressed) fail('Question ' + question.id + ' is neither answered nor explicitly suppressed.', 'UNRESOLVED_QUESTION');

  if (answered) {
    const option = question.options.find(item => stable(item.value) === stable(path.answers[question.id]));
    if (!option) fail('Question ' + question.id + ' ended with an answer outside its declared options.', 'UNDECLARED_TERMINAL_ANSWER');
    for (const expectedEffect of option.effects) {
      const found = path.operations.some(operation => operation.questionId === question.id && effectMatches(operation, expectedEffect));
      if (!found) fail('Question ' + question.id + ' did not emit its declared machine action.', 'MISSING_ANSWER_EFFECT');
    }
    return;
  }

  const expectedSuppressedEffect = question.suppressedEffect || { type: 'NO_OP', key: question.id };
  const found = path.operations.some(operation => effectMatches(operation, expectedSuppressedEffect));
  if (!found) fail('Suppressed question ' + question.id + ' did not emit its declared machine action or no-op.', 'MISSING_SUPPRESSED_EFFECT');
}

function assertTerminalPath(compiled, path, purchasedScope) {
  if (!path || typeof path !== 'object') fail('Reachable-path enumerator returned an invalid path.', 'INVALID_PATH');
  if (Array.isArray(path.questions) && path.questions.length !== 0) fail('Reachable path ended with unanswered questions.', 'NON_TERMINAL_PATH');
  if (!Array.isArray(path.operations) || path.operations.length === 0) fail('Reachable path produced no machine actions.', 'EMPTY_OPERATION_PATH');

  const actualScope = Array.isArray(path.purchasedScope) ? [...path.purchasedScope].sort() : [];
  const expectedScope = [...purchasedScope].sort();
  if (stable(actualScope) !== stable(expectedScope)) fail('Reachable-path enumerator returned a path for the wrong purchased scope.', 'PURCHASED_SCOPE_MISMATCH');

  for (const operation of path.operations) assertMachineAction(operation, 'Reachable path');
  for (const question of compiled.questions) assertQuestionResolved(compiled, path, question);
}

function proveEveryDeclaredReachablePath(compiled, options = {}) {
  const enumerateReachablePaths = options.enumerateReachablePaths || require('./adaptive-scoping-graph.cjs').enumerateReachablePaths;
  if (typeof enumerateReachablePaths !== 'function') fail('Reachable-path enumerator is required.', 'MISSING_PATH_ENUMERATOR');

  const scopeVariants = enumeratePurchasedScopeVariants(compiled, options);
  let terminalPathCount = 0;

  for (const purchasedScope of scopeVariants) {
    proveEveryVisibleQuestionNecessary(compiled, purchasedScope, options);
    const paths = enumerateReachablePaths(compiled, purchasedScope);
    if (!Array.isArray(paths) || paths.length === 0) fail('No reachable terminal paths for purchased scope ' + JSON.stringify(purchasedScope) + '.', 'NO_REACHABLE_PATH');
    for (const path of paths) {
      assertTerminalPath(compiled, path, purchasedScope);
      terminalPathCount += 1;
    }
  }

  return Object.freeze({
    declaredScopes: declaredScopeTokens(compiled),
    purchasedScopeVariants: scopeVariants.length,
    terminalPaths: terminalPathCount
  });
}

module.exports = {
  declaredScopeTokens,
  enumeratePurchasedScopeVariants,
  proveEveryDeclaredReachablePath
};
