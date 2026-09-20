import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');

const contract = JSON.parse(fs.readFileSync('resilience/support-tier-contract.json', 'utf8'));
const scenarios = JSON.parse(fs.readFileSync('resilience/failure-scenarios.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('resilience/security-baseline.json', 'utf8'));
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');

assert.equal(contract.schema_version, 1);
assert.equal(contract.mission.zero_vendor_engineer_required, true);
assert.equal(contract.mission.all_scenario_classes_must_reach_safe_terminal_state, true);
assert.equal(contract.mission.unknown_future_failures_must_fail_safe_and_enter_containment, true);
assert.equal(contract.global_invariants.language_model_direct_authority, false);
assert.equal(contract.global_invariants.customer_text_grants_authority, false);
assert.equal(contract.global_invariants.cross_tenant_action_allowed, false);
assert.equal(contract.global_invariants.reusable_credentials_visible_to_model, false);
assert.equal(contract.global_invariants.self_written_patch_is_self_approved, false);
assert.equal(contract.global_invariants.production_experimentation_for_unknown_faults, false);
assert.equal(baseline.autonomy.language_model_direct_authority, false);

const expectedTiers = ['T0','T1','T2','T3','T4'];
assert.deepEqual(Object.keys(contract.tiers), expectedTiers);
for (const [id,tier] of Object.entries(contract.tiers)) {
  assert.equal(tier.vendor_engineer_required, false, `${id} unexpectedly requires a vendor engineer`);
  assert.equal(tier.model_may_execute_consequential_actions, false, `${id} grants model execution authority`);
  assert.ok(Array.isArray(tier.allowed_terminal_outcomes) && tier.allowed_terminal_outcomes.length > 0, `${id} has no safe terminal outcomes`);
  for (const outcome of tier.allowed_terminal_outcomes) {
    assert.ok(contract.terminal_outcomes[outcome], `${id} references unknown terminal outcome ${outcome}`);
  }
}

assert.equal(contract.tiers.T2.production_mutation_from_patch_agent, false);
assert.deepEqual(contract.tiers.T3.current_autonomous_mutation_classes, []);

for (const action of contract.tiers.T1.allowlisted_action_prefixes) {
  for (const prohibited of baseline.autonomy.prohibited_action_prefixes) {
    assert.ok(!(action === prohibited || action.startsWith(`${prohibited}.`)), `T1 allowlist intersects prohibited authority: ${action}`);
  }
}

const coverage = [];
for (const scenario of scenarios.scenarios) {
  const tierId = contract.scenario_tier_overrides[scenario.id] || contract.category_defaults[scenario.category];
  assert.ok(tierId, `No tier mapping for scenario ${scenario.id} (${scenario.category})`);
  assert.ok(contract.tiers[tierId], `Scenario ${scenario.id} maps to unknown tier ${tierId}`);
  const tier = contract.tiers[tierId];

  if (scenario.autonomous_action) {
    for (const prohibited of baseline.autonomy.prohibited_action_prefixes) {
      assert.ok(!(scenario.autonomous_action === prohibited || scenario.autonomous_action.startsWith(`${prohibited}.`)), `${scenario.id} intersects prohibited action ${prohibited}`);
    }
    if (tierId === 'T1') {
      assert.ok(tier.allowlisted_action_prefixes.some(prefix => scenario.autonomous_action === prefix || scenario.autonomous_action.startsWith(`${prefix}.`)), `${scenario.id} T1 action is not allowlisted: ${scenario.autonomous_action}`);
    }
  }
  coverage.push({id: scenario.id, category: scenario.category, tier: tierId, hasAutonomousAction: Boolean(scenario.autonomous_action)});
}

const unknown = coverage.find(x => x.id === 'unknown-customer-reported-issue');
assert.ok(unknown && ['T2','T4'].includes(unknown.tier), 'Unknown customer issue must enter isolated repair/containment, not known-runbook authority.');
assert.ok(contract.tiers.T4.allowed_terminal_outcomes.includes('contained'));
assert.ok(contract.tiers.T4.allowed_terminal_outcomes.includes('rolled_back_to_known_good'));
assert.ok(contract.tiers.T3.allowed_terminal_outcomes.includes('customer_authorisation_required'));

// Contract-driven T1 audit. Every currently mapped T1 scenario is exercised through the
// same central autonomy control loop that owns terminal selection. This prevents a new
// scenario class from being added to the catalogue while silently escaping the allowed
// zero-engineer terminal set.
const t1Allowed = new Set(contract.tiers.T1.allowed_terminal_outcomes);
assert.deepEqual([...t1Allowed].sort(), ['contained', 'external_provider_authorisation_required', 'recovered']);
assert.equal(contract.tiers.T1.vendor_engineer_required, false);

let tick = 1000;
const t1ExecutorId = 'contract-t1-deterministic-recovery-executor';
const t1VerifierId = 'contract-t1-independent-readonly-verifier';
const recoveryExecutor = {
  executorId: t1ExecutorId,
  execute: async ({ incidentId, tenant, action, evidenceDigest }) => ({
    status: 'recovered',
    executorId: t1ExecutorId,
    executionDigest: digest(`t1-execution:${incidentId}:${tenant}:${action}:${evidenceDigest}`),
    productionAuthorityGranted: false,
    customerMutation: false,
  }),
};
const recoveryVerifier = {
  verifierId: t1VerifierId,
  verify: async (recovery) => ({
    verified: true,
    verifierId: t1VerifierId,
    executionDigest: recovery.executionDigest,
    verificationDigest: digest(`t1-verification:${recovery.executionDigest}`),
    productionAuthorityGranted: false,
    customerMutation: false,
    modelAuthorityGranted: false,
    actionAuthorityGranted: false,
  }),
};
const t1Loop = createAutonomyControlLoop({
  contract,
  failureScenarios: scenarios,
  recoveryExecutor,
  recoveryVerifier,
  now: () => ++tick,
  maxActions: 2,
});

const t1Scenarios = scenarios.scenarios.filter((scenario) => {
  const mapped = contract.scenario_tier_overrides[scenario.id] || contract.category_defaults[scenario.category];
  return mapped === 'T1';
});
assert.ok(t1Scenarios.length > 0, 'Expected at least one T1 scenario class.');

const t1TerminalCoverage = [];
for (const scenario of t1Scenarios) {
  const receipt = await t1Loop.run({
    incidentId: `contract-t1-${scenario.id}`,
    tenant: 'contract-tenant-a',
    targetTenant: 'contract-tenant-a',
    scenarioId: scenario.id,
    evidenceDigest: digest(`contract-evidence:${scenario.id}`),
  });
  const expectedOutcome = scenario.autonomous_action
    ? 'recovered'
    : scenario.id === 'provider-credential-expiry'
      ? 'external_provider_authorisation_required'
      : 'contained';

  assert.equal(receipt.tier, 'T1', `${scenario.id} must classify as T1.`);
  assert.ok(t1Allowed.has(receipt.outcome), `${scenario.id} escaped the T1 terminal allowlist with ${receipt.outcome}.`);
  assert.equal(receipt.outcome, expectedOutcome, `${scenario.id} did not reach its deterministic zero-engineer terminal.`);
  assert.equal(receipt.safeTerminal, true, `${scenario.id} did not establish a safe T1 terminal.`);
  assert.equal(receipt.productionMutation, false, `${scenario.id} reported production mutation.`);
  assert.equal(receipt.productionAuthorityGranted, false, `${scenario.id} reported production authority.`);
  assert.equal(receipt.customerMutation, false, `${scenario.id} reported customer mutation.`);
  assert.equal(receipt.actionCount, scenario.autonomous_action ? 1 : 0, `${scenario.id} action budget use drifted.`);
  assert.equal(t1Loop.verifyReceipt(receipt), true, `${scenario.id} terminal receipt failed verification.`);

  t1TerminalCoverage.push({
    scenarioId: scenario.id,
    autonomousAction: scenario.autonomous_action || null,
    expectedOutcome,
    actualOutcome: receipt.outcome,
    safeTerminal: receipt.safeTerminal,
    actionCount: receipt.actionCount,
  });
}

// Regression for the 2026-09-20 provider path defect: informal human-escalation
// terminal strings such as "review-required" must never become a T1 terminal. Even a
// deterministic executor presenting that value is rejected and the loop falls back to
// contract-approved containment without minting authority.
const informalTerminalLoop = createAutonomyControlLoop({
  contract,
  failureScenarios: scenarios,
  recoveryExecutor: {
    executorId: 'contract-hostile-informal-terminal-executor',
    execute: async ({ incidentId, tenant, action, evidenceDigest }) => ({
      status: 'review-required',
      executorId: 'contract-hostile-informal-terminal-executor',
      executionDigest: digest(`informal:${incidentId}:${tenant}:${action}:${evidenceDigest}`),
      productionAuthorityGranted: false,
      customerMutation: false,
    }),
  },
  recoveryVerifier,
  now: () => ++tick,
  maxActions: 2,
});
const informalTerminal = await informalTerminalLoop.run({
  incidentId: 'contract-t1-informal-terminal-regression',
  tenant: 'contract-tenant-a',
  scenarioId: 'integration-transient-failure',
  evidenceDigest: digest('contract-informal-terminal-evidence'),
});
assert.equal(informalTerminal.tier, 'T1');
assert.equal(informalTerminal.outcome, 'contained');
assert.equal(informalTerminal.containedErrorCode, 'WFM_AUTONOMY_TERMINAL');
assert.equal(informalTerminal.safeTerminal, true);
assert.ok(t1Allowed.has(informalTerminal.outcome));
assert.equal(informalTerminal.productionMutation, false);
assert.equal(informalTerminal.productionAuthorityGranted, false);
assert.equal(informalTerminal.customerMutation, false);
assert.equal(informalTerminalLoop.verifyReceipt(informalTerminal), true);

const counts = Object.fromEntries(expectedTiers.map(id => [id, coverage.filter(x => x.tier === id).length]));
const receipt = {
  schemaVersion: 2,
  proof: 'zero-engineer-support-tier-contract',
  status: 'PASS',
  scenarioCount: coverage.length,
  tierCounts: counts,
  t1ScenarioClassesExercised: t1TerminalCoverage.length,
  t1AllowedTerminalOutcomes: [...t1Allowed].sort(),
  t1EveryScenarioReachedContractTerminal: t1TerminalCoverage.every((entry) => entry.safeTerminal === true && t1Allowed.has(entry.actualOutcome)),
  t1InformalHumanEscalationTerminalRejected: true,
  t1VendorEngineerRequired: false,
  t1TerminalCoverage,
  zeroVendorEngineerRequired: true,
  unknownFutureFailuresFailSafe: true,
  languageModelDirectAuthority: false,
  t2PatchAgentProductionMutation: false,
  t3CurrentAutonomousMutationClasses: 0,
  allCatalogueScenariosMapped: true,
  generatedAt: new Date().toISOString()
};
fs.writeFileSync('support-tier-contract-proof.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
