import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createIncidentLearningPlanner } = require('../resilience/incident-learning-planner.cjs');

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

console.log(JSON.stringify({
  schemaVersion: 1,
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
  tamperEvidence: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
