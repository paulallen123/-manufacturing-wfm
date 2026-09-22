import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GRAPH_VERSION, GRAPH, compileAdaptiveScope, verifyScopeReceipt, digest } = require('../resilience/adaptive-implementation-scope.cjs');

const d = (label) => digest({ label });
const contractEvent = { authenticated: true, completed: true, eventDigest: d('contract-10000-50') };
const ev = (key, value, source = 'contract', label = `${source}:${key}`) => ({ key, value, source, verified: true, evidenceDigest: d(label) });

assert.equal(GRAPH_VERSION, '1.0.0');
assert.equal(GRAPH.length, 10);
for (const node of GRAPH) {
  assert.ok(node.effect?.type, `${node.id} missing effect type`);
  assert.ok(node.effect?.target, `${node.id} missing effect target`);
}

const fullEvidence = [
  ev('country.primary', 'GB'),
  ev('org.siteCount', 50),
  ev('workforce.employeeCount', 10000),
  ev('payroll.enabled', true),
  ev('payroll.provider', 'Synthetic Payroll', 'integration-fabric'),
  ev('workforce.sourceSystem', 'Synthetic HCM', 'integration-fabric'),
  ev('time.captureMode', 'mixed', 'system-discovery'),
  ev('agency.enabled', true),
  ev('agency.system', 'Synthetic VMS', 'integration-fabric'),
  ev('training.roleGroups', ['employee', 'manager', 'ops-manager', 'finance', 'admin']),
];
const full = compileAdaptiveScope({ contractEvent, evidence: fullEvidence });
assert.equal(full.status, 'SCOPED');
assert.equal(full.questions.length, 0);
assert.equal(full.facts['org.siteCount'], 50);
assert.equal(full.facts['workforce.employeeCount'], 10000);
assert.equal(full.metrics.questionsRemoved, 10);
assert.equal(full.metrics.repeatedDataEntryAvoided, 10);
assert.equal(full.metrics.manualScopingStepsRemoved, 1);
assert.equal(full.authority.productionMutation, false);
assert.equal(full.authority.payrollMutation, false);
assert.equal(full.authority.environmentProvisioningAuthorityGranted, false);
assert.equal(full.authority.modelAuthorityGranted, false);
assert.equal(verifyScopeReceipt(full), true);

const repeat = compileAdaptiveScope({ contractEvent, evidence: fullEvidence });
assert.equal(repeat.stateDigest, full.stateDigest, 'same evidence must compile deterministically');

const partial = compileAdaptiveScope({
  contractEvent,
  evidence: fullEvidence.filter((item) => !['time.captureMode', 'training.roleGroups'].includes(item.key)),
});
assert.equal(partial.status, 'NEEDS_INPUT');
assert.deepEqual(partial.questions.map((q) => q.id), ['time.captureMode', 'training.roleGroups']);
assert.equal(partial.metrics.questionsRemoved, 8);
assert.equal(verifyScopeReceipt(partial), true);

const priorPayroll = compileAdaptiveScope({
  contractEvent,
  answers: {
    'country.primary': 'GB',
    'org.siteCount': 2,
    'workforce.employeeCount': 200,
    'payroll.enabled': true,
    'payroll.provider': 'Old Payroll',
    'workforce.sourceSystem': 'Old HCM',
    'time.captureMode': 'web',
    'agency.enabled': false,
    'training.roleGroups': ['employee', 'manager'],
  },
});
assert.equal(priorPayroll.status, 'SCOPED');
const payrollDisabled = compileAdaptiveScope({
  contractEvent,
  evidence: [ev('payroll.enabled', false, 'contract', 'payroll-now-disabled')],
  previousState: priorPayroll,
  answers: {
    'country.primary': 'GB',
    'org.siteCount': 2,
    'workforce.employeeCount': 200,
    'workforce.sourceSystem': 'Old HCM',
    'time.captureMode': 'web',
    'agency.enabled': false,
    'training.roleGroups': ['employee', 'manager'],
  },
});
assert.equal(payrollDisabled.status, 'SCOPED');
assert.equal(Object.prototype.hasOwnProperty.call(payrollDisabled.facts, 'payroll.provider'), false);
assert.ok(payrollDisabled.noOps.some((x) => x.questionId === 'payroll.provider' && x.reason === 'payroll-disabled'));
assert.ok(payrollDisabled.invalidatedAnswers.some((x) => x.key === 'payroll.provider' && x.reason === 'hidden-question-no-longer-reachable'));
assert.ok(payrollDisabled.invalidatedAnswers.some((x) => x.key === 'payroll.enabled' && x.reason === 'verified-evidence-supersedes-prior-answer'));

const conflict = compileAdaptiveScope({
  contractEvent,
  evidence: [
    ev('country.primary', 'GB', 'contract', 'country-contract'),
    ev('country.primary', 'DE', 'integration-fabric', 'country-integration'),
  ],
});
assert.equal(conflict.status, 'NEEDS_INPUT');
assert.equal(conflict.questions[0].id, 'country.primary');
assert.equal(conflict.questions[0].reason, 'verified-evidence-conflict');
assert.equal(conflict.conflicts.length, 1);
assert.equal(Object.prototype.hasOwnProperty.call(conflict.facts, 'country.primary'), false);

const ignoredUntrusted = compileAdaptiveScope({
  contractEvent,
  evidence: [
    { key: 'org.siteCount', value: 50, source: 'llm', verified: true, evidenceDigest: d('llm') },
    { key: 'workforce.employeeCount', value: 10000, source: 'contract', verified: false, evidenceDigest: d('unverified') },
  ],
});
assert.ok(ignoredUntrusted.questions.some((q) => q.id === 'org.siteCount'));
assert.ok(ignoredUntrusted.questions.some((q) => q.id === 'workforce.employeeCount'));

const versionChanged = compileAdaptiveScope({
  contractEvent,
  previousState: {
    graphVersion: '0.9.0',
    stateDigest: d('old-state'),
    answers: { 'country.primary': 'GB', 'org.siteCount': 1 },
  },
});
assert.ok(versionChanged.invalidatedAnswers.some((x) => x.key === 'country.primary' && x.reason === 'decision-graph-version-changed'));
assert.ok(versionChanged.invalidatedAnswers.some((x) => x.key === 'org.siteCount' && x.reason === 'decision-graph-version-changed'));
assert.ok(versionChanged.questions.some((q) => q.id === 'country.primary'));

assert.throws(
  () => compileAdaptiveScope({ contractEvent: { authenticated: false, eventDigest: d('bad') }, evidence: fullEvidence }),
  (error) => error?.code === 'WFM_IMPLEMENTATION_CONTRACT_EVIDENCE',
);

const tampered = structuredClone(full);
tampered.authority.environmentProvisioningAuthorityGranted = true;
assert.equal(verifyScopeReceipt(tampered), false);
const resealed = structuredClone(full);
resealed.authority.modelAuthorityGranted = true;
const core = structuredClone(resealed);
delete core.stateDigest;
delete core.answers;
resealed.stateDigest = digest(core);
assert.equal(verifyScopeReceipt(resealed), false, 're-sealing must not mint model authority');

const output = {
  schemaVersion: 1,
  proof: 'adaptive-implementation-scope',
  status: 'PASS',
  graphVersion: GRAPH_VERSION,
  graphQuestionCount: GRAPH.length,
  syntheticEnterprise: {
    employees: full.facts['workforce.employeeCount'],
    sites: full.facts['org.siteCount'],
    questionsAsked: full.metrics.questionsAsked,
    questionsRemoved: full.metrics.questionsRemoved,
    repeatedDataEntryAvoided: full.metrics.repeatedDataEntryAvoided,
    manualScopingStepsRemoved: full.metrics.manualScopingStepsRemoved,
    scopedWithoutHumanQuestion: full.status === 'SCOPED' && full.questions.length === 0,
  },
  partialEvidenceQuestionsAsked: partial.metrics.questionsAsked,
  staleHiddenAnswerInvalidationProven: true,
  verifiedEvidenceConflictFailsClosed: true,
  untrustedEvidenceCannotPrefill: true,
  graphVersionInvalidationProven: true,
  authorityEscalationDenied: true,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  releaseAuthorityGranted: false,
  modelAuthorityGranted: false,
};
console.log(JSON.stringify(output, null, 2));
