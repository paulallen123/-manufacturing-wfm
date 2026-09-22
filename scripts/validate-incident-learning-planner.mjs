import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createIncidentLearningPlanner } = require('../resilience/incident-learning-planner.cjs');
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const planner = createIncidentLearningPlanner();

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    incidentId: 'inc-learning',
    tenant: 'tenant-a',
    scenarioId: 'integration-transient-failure',
    tier: 'T1',
    outcome: 'recovered',
    safeTerminal: true,
    evidenceDigest: d('evidence'),
    receiptDigest: d('terminal-receipt'),
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false,
    ...overrides,
  };
}

const recovered = planner.plan(receipt(), { defectDetected: true });
assert.equal(recovered.regressionFixture.required, true);
assert.match(recovered.regressionFixture.fixtureDigest, /^[a-f0-9]{64}$/);
assert.equal(recovered.regressionFixture.containsCustomerText, false);
assert.equal(recovered.regressionFixture.containsReusableSecret, false);
assert.equal(recovered.detectionRuleProposal.tenantScoped, true);
assert.equal(recovered.detectionRuleProposal.crossTenantMatching, false);
assert.equal(recovered.supportKnowledgeProposal.includeRawCustomerText, false);
assert.equal(recovered.supportKnowledgeProposal.includeModelOutputAsAuthority, false);
assert.equal(recovered.supportKnowledgeProposal.includeReusableCredential, false);
assert.equal(recovered.runbookDecision.decision, 'SAFE_RUNBOOK_CANDIDATE');
assert.equal(recovered.authority.productionAuthority, false);
assert.equal(recovered.authority.writeScope, 'proposal-only');
assert.equal(planner.verify(recovered), true);

const payroll = planner.plan(receipt({
  incidentId: 'inc-payroll-learning',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  tier: 'T3',
  outcome: 'customer_authorisation_required',
  receiptDigest: d('payroll-receipt'),
}), { defectDetected: true });
assert.equal(payroll.runbookDecision.decision, 'NEVER_AUTOMATE');
assert.equal(payroll.runbookDecision.customerAuthorisationStillRequiredForT3, true);
assert.equal(payroll.supportKnowledgeProposal.updateClass, 'record-never-automate-boundary');
assert.equal(planner.verify(payroll), true);

const security = planner.plan(receipt({
  incidentId: 'inc-security-learning',
  scenarioId: 'cross-tenant-access-attempt',
  tier: 'T4',
  outcome: 'contained',
  safeTerminal: true,
  receiptDigest: d('security-receipt'),
}), { novelFailure: true });
assert.equal(security.regressionFixture.required, true);
assert.equal(security.runbookDecision.decision, 'NEVER_AUTOMATE');
assert.equal(security.authority.crossTenantMutation, false);
assert.equal(planner.verify(security), true);

const unsafe = planner.plan(receipt({
  incidentId: 'inc-unsafe-learning',
  outcome: 'contained',
  safeTerminal: false,
  containedErrorCode: 'WFM_AUTONOMY_T1_VERIFY',
  receiptDigest: d('unsafe-receipt'),
}));
assert.equal(unsafe.regressionFixture.required, true);
assert.equal(unsafe.runbookDecision.decision, 'NEVER_AUTOMATE');
assert.equal(unsafe.detectionRuleProposal.signalClass, 'contained-error-code');
assert.equal(planner.verify(unsafe), true);

const informational = planner.plan(receipt({
  incidentId: 'inc-t0-info',
  scenarioId: 'support-guidance',
  tier: 'T0',
  outcome: 'answered',
  receiptDigest: d('t0-info-receipt'),
}), {});
assert.equal(informational.regressionFixture.required, false);
assert.equal(informational.supportKnowledgeProposal.required, false);
assert.equal(informational.runbookDecision.decision, 'SAFE_RUNBOOK_CANDIDATE');
assert.equal(planner.verify(informational), true);

const tampered = structuredClone(recovered);
tampered.runbookDecision.decision = 'AUTOMATE';
assert.equal(planner.verify(tampered), false);

const authorityTampered = structuredClone(recovered);
authorityTampered.authority.productionAuthority = true;
assert.equal(planner.verify(authorityTampered), false);

assert.throws(() => planner.plan(receipt({ productionMutation: true })), /evidence-only terminal receipts/);
assert.throws(() => planner.plan(receipt({ receiptDigest: 'bad' })), /SHA-256/);

// Prove the planner is composed directly behind the central autonomy controller.
const integratedContract = {
  tiers: {
    T0: { allowed_terminal_outcomes: ['answered', 'safe_abstention'] },
    T1: {
      allowed_terminal_outcomes: ['recovered', 'contained', 'external_provider_authorisation_required'],
      allowlisted_action_prefixes: ['integration.recover'],
    },
    T2: { allowed_terminal_outcomes: ['verified_candidate_staged', 'contained'] },
    T3: { allowed_terminal_outcomes: ['customer_authorisation_required', 'contained'] },
    T4: { allowed_terminal_outcomes: ['contained', 'rolled_back_to_known_good', 'security_or_legal_authority_required'] },
  },
  scenario_tier_overrides: {
    'learning-t1': 'T1',
    'learning-t2': 'T2',
    'learning-t3': 'T3',
    'learning-t4': 'T4',
  },
  category_defaults: {},
};
const integratedScenarios = {
  scenarios: [
    { id: 'learning-t1', category: 'integration', autonomous_action: 'integration.recover' },
    { id: 'learning-t2', category: 'defect' },
    { id: 'learning-t3', category: 'workforce-control' },
    { id: 'learning-t4', category: 'security' },
  ],
};
let tick = 5000;
const integratedLoop = createAutonomyControlLoop({
  contract: integratedContract,
  failureScenarios: integratedScenarios,
  selfHelp: {
    answer: () => ({ status: 'answered', actionAuthority: false, intent: 'learning-proof' }),
  },
  recoveryExecutor: {
    execute: async () => ({
      status: 'recovered',
      verified: true,
      verificationDigest: d('learning-t1-verification'),
      productionAuthorityGranted: false,
      customerMutation: false,
    }),
  },
  repairCoordinator: {
    process: async () => ({
      status: 'verified_candidate_staged',
      independentlyVerified: true,
      productionAuthorityGranted: false,
      productionMutation: false,
    }),
  },
  t3ShadowSimulator: {
    simulate: () => ({
      status: 'customer_authorisation_required',
      customerMutation: false,
      productionMutation: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      proposalDigest: d('learning-t3-proposal'),
      simulationDigest: d('learning-t3-simulation'),
      affectedRecords: 1,
    }),
  },
  t3ShadowVerifier: {
    verify: () => ({
      verified: true,
      verificationDigest: d('learning-t3-verification'),
      productionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    }),
  },
  t4ContainmentController: {
    handle: async () => ({
      safeTerminal: true,
      outcome: 'contained',
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      crossTenantMutation: false,
      requestedActionExecuted: false,
      receiptDigest: d('learning-t4-controller'),
      actionCount: 1,
    }),
    verifyReceipt: () => true,
  },
  now: () => ++tick,
  maxActions: 2,
});

const integratedBase = { tenant: 'tenant-a', evidenceDigest: d('integrated-evidence') };
const integratedReceipts = [
  await integratedLoop.run({
    ...integratedBase,
    incidentId: 'inc-integrated-t0',
    scenarioId: 'support-guidance',
    question: 'How do I read this support status?',
    role: 'manager',
  }),
  await integratedLoop.run({ ...integratedBase, incidentId: 'inc-integrated-t1', scenarioId: 'learning-t1' }),
  await integratedLoop.run({ ...integratedBase, incidentId: 'inc-integrated-t2', scenarioId: 'learning-t2' }),
  await integratedLoop.run({ ...integratedBase, incidentId: 'inc-integrated-t3', scenarioId: 'learning-t3' }),
  await integratedLoop.run({ ...integratedBase, incidentId: 'inc-integrated-t4', scenarioId: 'learning-t4' }),
];

for (const integrated of integratedReceipts) {
  assert.ok(integrated.learning, `${integrated.tier} terminal receipt must include incident learning.`);
  assert.equal(integrated.learning.sourceReceiptDigest, integrated.receiptDigest);
  assert.equal(integrated.learning.authority.actionAuthority, false);
  assert.equal(integrated.learning.authority.productionAuthority, false);
  assert.equal(integrated.learning.authority.releaseAuthority, false);
  assert.equal(integrated.learning.authority.credentialAuthority, false);
  assert.equal(integrated.learning.authority.customerMutation, false);
  assert.equal(integrated.learning.authority.crossTenantMutation, false);
  assert.equal(planner.verify(integrated.learning), true);
  assert.equal(integratedLoop.verifyReceipt(integrated), true);
}
assert.equal(integratedReceipts[3].learning.runbookDecision.decision, 'NEVER_AUTOMATE');
assert.equal(integratedReceipts[4].learning.runbookDecision.decision, 'NEVER_AUTOMATE');

const integratedLearningTampered = structuredClone(integratedReceipts[1]);
integratedLearningTampered.learning.runbookDecision.decision = 'AUTOMATE';
assert.equal(integratedLoop.verifyReceipt(integratedLearningTampered), false);

const failingPlanner = {
  plan: () => {
    const error = new Error('synthetic learning subsystem failure');
    error.code = 'WFM_LEARNING_SYNTHETIC_FAILURE';
    throw error;
  },
  verify: () => false,
};
const failClosedLearningLoop = createAutonomyControlLoop({
  contract: integratedContract,
  failureScenarios: integratedScenarios,
  selfHelp: {
    answer: () => ({ status: 'answered', actionAuthority: false, intent: 'learning-fallback-proof' }),
  },
  incidentLearningPlanner: failingPlanner,
  now: () => ++tick,
});
const failClosedLearning = await failClosedLearningLoop.run({
  ...integratedBase,
  incidentId: 'inc-learning-subsystem-failure',
  scenarioId: 'support-guidance',
  question: 'Show status',
  role: 'manager',
});
assert.equal(failClosedLearning.outcome, 'answered');
assert.equal(failClosedLearning.safeTerminal, true);
assert.equal(failClosedLearning.learning.status, 'LEARNING_FAILED_CLOSED');
assert.equal(failClosedLearning.learning.errorCode, 'WFM_LEARNING_SYNTHETIC_FAILURE');
assert.equal(failClosedLearning.learning.authority.productionAuthority, false);
assert.equal(failClosedLearningLoop.verifyReceipt(failClosedLearning), true);

const fallbackTampered = structuredClone(failClosedLearning);
fallbackTampered.learning.errorCode = 'HIDDEN';
assert.equal(failClosedLearningLoop.verifyReceipt(fallbackTampered), false);

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'deterministic-incident-learning-planner',
  status: 'PASS',
  regressionFixtureGeneratedForDefects: true,
  deterministicDetectionRuleProposed: true,
  supportKnowledgeUpdateProposalBoundToEvidence: true,
  t3AndT4NeverAutomateDecision: true,
  unsafeTerminalNeverAutomateDecision: true,
  rawCustomerTextExcluded: true,
  reusableSecretsExcluded: true,
  modelOutputCannotMintAuthority: true,
  noProductionAuthority: true,
  noCrossTenantMutation: true,
  centralAutonomyLoopConnected: true,
  everyTierTerminalGeneratesLearningRecord: true,
  learningRecordBoundToTerminalReceipt: true,
  learningSubsystemFailurePreservesSafeTerminal: true,
  learningSubsystemFailureFailsClosedWithoutAuthority: true,
  learningTamperEvidence: true,
  tamperEvidence: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
