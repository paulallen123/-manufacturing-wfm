import fs from 'node:fs';
import assert from 'node:assert/strict';

const contract = JSON.parse(fs.readFileSync('resilience/support-tier-contract.json', 'utf8'));
const scenarios = JSON.parse(fs.readFileSync('resilience/failure-scenarios.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('resilience/security-baseline.json', 'utf8'));

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

const counts = Object.fromEntries(expectedTiers.map(id => [id, coverage.filter(x => x.tier === id).length]));
const receipt = {
  schemaVersion: 1,
  proof: 'zero-engineer-support-tier-contract',
  status: 'PASS',
  scenarioCount: coverage.length,
  tierCounts: counts,
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
