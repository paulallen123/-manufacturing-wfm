'use strict';

const { createHash } = require('node:crypto');

const GRAPH_VERSION = '1.0.0';
const TRUSTED_EVIDENCE_SOURCES = new Set(['contract', 'integration-fabric', 'system-discovery']);
const EFFECT_TYPES = new Set(['config', 'dependency', 'test', 'risk', 'decision', 'noop']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function isDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const GRAPH = Object.freeze([
  {
    id: 'country.primary',
    prompt: 'What is the primary operating country for this implementation?',
    effect: { type: 'config', target: 'compliance.primaryCountry' },
    validate: (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value),
  },
  {
    id: 'org.siteCount',
    prompt: 'How many manufacturing sites are in scope?',
    effect: { type: 'config', target: 'organisation.siteCount' },
    validate: (value) => Number.isInteger(value) && value > 0 && value <= 10000,
  },
  {
    id: 'workforce.employeeCount',
    prompt: 'How many workers are in scope?',
    effect: { type: 'test', target: 'capacity.employeeScale' },
    validate: (value) => Number.isInteger(value) && value > 0 && value <= 10000000,
  },
  {
    id: 'payroll.enabled',
    prompt: 'Will WFM produce payroll-ready outputs for this tenant?',
    effect: { type: 'decision', target: 'payroll.required' },
    validate: (value) => typeof value === 'boolean',
  },
  {
    id: 'payroll.provider',
    prompt: 'Which payroll provider will consume the payroll-ready output?',
    when: (facts) => facts['payroll.enabled'] === true,
    suppressedEffect: { type: 'noop', target: 'integration.payroll.provider', reason: 'payroll-disabled' },
    effect: { type: 'dependency', target: 'integration.payroll.provider' },
    validate: (value) => typeof value === 'string' && value.trim().length >= 2 && value.length <= 120,
  },
  {
    id: 'workforce.sourceSystem',
    prompt: 'Which authoritative HCM/HR system supplies workforce master data?',
    effect: { type: 'dependency', target: 'integration.workforce.authoritativeSource' },
    validate: (value) => typeof value === 'string' && value.trim().length >= 2 && value.length <= 120,
  },
  {
    id: 'time.captureMode',
    prompt: 'Which time-capture mode is required?',
    effect: { type: 'config', target: 'time.captureMode' },
    validate: (value) => ['existing-terminal', 'mobile', 'web', 'passive-evidence', 'mixed'].includes(value),
  },
  {
    id: 'agency.enabled',
    prompt: 'Is agency labour in scope?',
    effect: { type: 'decision', target: 'agency.required' },
    validate: (value) => typeof value === 'boolean',
  },
  {
    id: 'agency.system',
    prompt: 'Which agency/VMS system is authoritative for contingent workers?',
    when: (facts) => facts['agency.enabled'] === true,
    suppressedEffect: { type: 'noop', target: 'integration.agency.provider', reason: 'agency-disabled' },
    effect: { type: 'dependency', target: 'integration.agency.provider' },
    validate: (value) => typeof value === 'string' && value.trim().length >= 2 && value.length <= 120,
  },
  {
    id: 'training.roleGroups',
    prompt: 'Which role groups need environment-specific training?',
    effect: { type: 'test', target: 'training.roleCoverage' },
    validate: (value) => Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 80),
  },
]);

function assertGraph() {
  const ids = new Set();
  for (const node of GRAPH) {
    if (!node.id || ids.has(node.id)) throw new Error(`invalid duplicate graph node ${node.id}`);
    ids.add(node.id);
    if (!node.effect || !EFFECT_TYPES.has(node.effect.type) || !node.effect.target) throw new Error(`node ${node.id} has no machine-actionable effect`);
    if (node.suppressedEffect && (!EFFECT_TYPES.has(node.suppressedEffect.type) || !node.suppressedEffect.target)) throw new Error(`node ${node.id} has invalid suppressed effect`);
    if (typeof node.validate !== 'function') throw new Error(`node ${node.id} has no deterministic validator`);
  }
}
assertGraph();

function normalizeEvidence(evidence = []) {
  const byKey = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!item || typeof item !== 'object') continue;
    if (!GRAPH.some((node) => node.id === item.key)) continue;
    if (item.verified !== true || !TRUSTED_EVIDENCE_SOURCES.has(item.source) || !isDigest(item.evidenceDigest)) continue;
    const list = byKey.get(item.key) || [];
    list.push({ key: item.key, value: clone(item.value), source: item.source, evidenceDigest: item.evidenceDigest });
    byKey.set(item.key, list);
  }
  return byKey;
}

function selectEvidence(node, candidates) {
  if (!candidates || candidates.length === 0) return { status: 'none' };
  const valid = candidates.filter((item) => node.validate(item.value));
  if (valid.length === 0) return { status: 'invalid' };
  const valueDigests = new Map();
  for (const item of valid) {
    const valueDigest = digest(item.value);
    const list = valueDigests.get(valueDigest) || [];
    list.push(item);
    valueDigests.set(valueDigest, list);
  }
  if (valueDigests.size > 1) {
    return {
      status: 'conflict',
      evidenceDigests: valid.map((item) => item.evidenceDigest).sort(),
      sources: [...new Set(valid.map((item) => item.source))].sort(),
    };
  }
  const chosen = valid.slice().sort((a, b) => a.source.localeCompare(b.source) || a.evidenceDigest.localeCompare(b.evidenceDigest))[0];
  return { status: 'selected', ...chosen };
}

function compileAdaptiveScope({
  contractEvent,
  evidence = [],
  answers = {},
  previousState = null,
} = {}) {
  if (!contractEvent || contractEvent.authenticated !== true || !isDigest(contractEvent.eventDigest)) {
    const error = new Error('authenticated completed-order/contract evidence is required');
    error.code = 'WFM_IMPLEMENTATION_CONTRACT_EVIDENCE';
    throw error;
  }

  const evidenceByKey = normalizeEvidence(evidence);
  const facts = {};
  const provenance = {};
  const questions = [];
  const conflicts = [];
  const invalidatedAnswers = [];
  const noOps = [];
  const machineActions = [];
  const previousAnswers = previousState && typeof previousState === 'object' && previousState.answers && typeof previousState.answers === 'object'
    ? previousState.answers
    : {};
  const graphVersionChanged = previousState && previousState.graphVersion && previousState.graphVersion !== GRAPH_VERSION;

  if (graphVersionChanged) {
    for (const key of Object.keys(previousAnswers).sort()) {
      invalidatedAnswers.push({ key, reason: 'decision-graph-version-changed' });
    }
  }

  for (const node of GRAPH) {
    const reachable = typeof node.when === 'function' ? node.when(facts) === true : true;
    if (!reachable) {
      noOps.push({ questionId: node.id, ...clone(node.suppressedEffect) });
      machineActions.push({ questionId: node.id, ...clone(node.suppressedEffect) });
      if (!graphVersionChanged && Object.prototype.hasOwnProperty.call(previousAnswers, node.id)) {
        invalidatedAnswers.push({ key: node.id, reason: 'hidden-question-no-longer-reachable' });
      }
      continue;
    }

    const selectedEvidence = selectEvidence(node, evidenceByKey.get(node.id));
    if (selectedEvidence.status === 'conflict') {
      conflicts.push({ key: node.id, evidenceDigests: selectedEvidence.evidenceDigests, sources: selectedEvidence.sources });
      questions.push({ id: node.id, prompt: node.prompt, reason: 'verified-evidence-conflict', effect: clone(node.effect) });
      machineActions.push({ questionId: node.id, ...clone(node.effect), status: 'awaiting-input' });
      continue;
    }

    if (selectedEvidence.status === 'selected') {
      facts[node.id] = clone(selectedEvidence.value);
      provenance[node.id] = { kind: 'verified-evidence', source: selectedEvidence.source, evidenceDigest: selectedEvidence.evidenceDigest };
      machineActions.push({ questionId: node.id, ...clone(node.effect), status: 'prefilled' });
      if (!graphVersionChanged && Object.prototype.hasOwnProperty.call(previousAnswers, node.id)
        && digest(previousAnswers[node.id]) !== digest(selectedEvidence.value)) {
        invalidatedAnswers.push({ key: node.id, reason: 'verified-evidence-supersedes-prior-answer' });
      }
      continue;
    }

    const hasExplicit = Object.prototype.hasOwnProperty.call(answers || {}, node.id);
    if (hasExplicit && node.validate(answers[node.id])) {
      facts[node.id] = clone(answers[node.id]);
      provenance[node.id] = { kind: 'explicit-answer' };
      machineActions.push({ questionId: node.id, ...clone(node.effect), status: 'answered' });
      continue;
    }

    if (!graphVersionChanged && Object.prototype.hasOwnProperty.call(previousAnswers, node.id) && node.validate(previousAnswers[node.id])) {
      facts[node.id] = clone(previousAnswers[node.id]);
      provenance[node.id] = { kind: 'prior-answer', priorStateDigest: isDigest(previousState?.stateDigest) ? previousState.stateDigest : null };
      machineActions.push({ questionId: node.id, ...clone(node.effect), status: 'reused-prior-answer' });
      continue;
    }

    questions.push({
      id: node.id,
      prompt: node.prompt,
      reason: selectedEvidence.status === 'invalid' ? 'verified-evidence-invalid' : hasExplicit ? 'invalid-explicit-answer' : 'missing-machine-actionable-fact',
      effect: clone(node.effect),
    });
    machineActions.push({ questionId: node.id, ...clone(node.effect), status: 'awaiting-input' });
  }

  const reachableQuestionCount = GRAPH.length - noOps.length;
  const answeredQuestionCount = Object.keys(facts).length;
  const questionsRemoved = reachableQuestionCount - questions.length;
  const stateCore = {
    schemaVersion: 1,
    graphVersion: GRAPH_VERSION,
    contractEventDigest: contractEvent.eventDigest,
    status: questions.length === 0 && conflicts.length === 0 ? 'SCOPED' : 'NEEDS_INPUT',
    facts,
    provenance,
    questions,
    conflicts,
    invalidatedAnswers,
    noOps,
    machineActions,
    metrics: {
      graphQuestionCount: GRAPH.length,
      reachableQuestionCount,
      answeredQuestionCount,
      questionsAsked: questions.length,
      questionsRemoved,
      repeatedDataEntryAvoided: Object.values(provenance).filter((entry) => entry.kind === 'verified-evidence' || entry.kind === 'prior-answer').length,
      manualScopingMeetingRequired: questions.length > 0,
      manualScopingStepsRemoved: questions.length === 0 ? 1 : 0,
    },
    authority: {
      productionMutation: false,
      customerMutation: false,
      payrollMutation: false,
      identityMutation: false,
      environmentProvisioningAuthorityGranted: false,
      integrationWriteAuthorityGranted: false,
      modelAuthorityGranted: false,
      releaseAuthorityGranted: false,
    },
  };

  const stateDigest = digest(stateCore);
  return { ...stateCore, stateDigest, answers: clone(facts) };
}

function verifyScopeReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.graphVersion !== GRAPH_VERSION || !isDigest(receipt.stateDigest)) return false;
  const authority = receipt.authority || {};
  if (Object.values(authority).some((value) => value !== false)) return false;
  if (!Array.isArray(receipt.questions) || !Array.isArray(receipt.machineActions) || !Array.isArray(receipt.noOps) || !Array.isArray(receipt.invalidatedAnswers)) return false;
  if (receipt.questions.some((q) => !q.effect || !EFFECT_TYPES.has(q.effect.type) || !q.effect.target)) return false;
  if (receipt.machineActions.some((action) => !EFFECT_TYPES.has(action.type) || !action.target)) return false;
  if (receipt.status === 'SCOPED' && receipt.questions.length !== 0) return false;
  if (receipt.status === 'SCOPED' && receipt.conflicts?.length) return false;
  if (receipt.metrics?.questionsAsked !== receipt.questions.length) return false;
  const core = clone(receipt);
  delete core.stateDigest;
  delete core.answers;
  return digest(core) === receipt.stateDigest;
}

module.exports = {
  GRAPH_VERSION,
  GRAPH,
  compileAdaptiveScope,
  verifyScopeReceipt,
  digest,
};
