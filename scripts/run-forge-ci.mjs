#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  ['node', ['--test', '--test-timeout=10000', '--test-concurrency=1', 'ux-overlay/vector-leave-review-boundary.test.cjs']],
  ['node', ['--test', '--test-timeout=30000', '--test-concurrency=1', 'reporting/runtime/vector-reporting-persisted-no-adapter.test.cjs', 'reporting/runtime/vector-reporting-resume-no-adapter.test.cjs', 'reporting/runtime/v079-schedule-role-drift.test.cjs']],
  ['node', ['integration/runtime/nango-credential-provider.test.cjs']],
  ['node', ['integration/runtime/nango-metadata-broker.test.cjs']],
  ['node', ['scripts/nango-metadata-wiring.test.cjs']],
  ['node', ['integration/runtime/provider-metadata-review.test.cjs']],
  ['node', ['ux-overlay/vector-provider-metadata.test.cjs']],
  ['node', ['--test', 'integration/runtime/autonomous-integration-hub.identity-consumer.test.cjs']],
  ['node', ['--test', 'integration/runtime/autonomous-integration-hub.audit-atomicity.test.cjs']],
  ['node', ['verification/vector-pr542-receiving/run-isolated.cjs']],
  ['node', ['--test', 'reporting/ui/vector-reporting-saved-filter-refusal.test.cjs']],
  ['node', ['--test', 'ux-overlay/vector-action-queue.test.cjs', 'ux-overlay/vector-settings-navigation.test.cjs', 'ux-overlay/vector-leave-balance-display.test.cjs']],
  ['node', ['scripts/validate-deployment.mjs']],
  ['node', ['scripts/validate-proof-lane-policy.mjs']],
  ['node', ['scripts/validate-research-convergence-ledger.mjs']],
  ['node', ['--test','resilience/research-convergence-theory-simulator.test.cjs']],
  ['node', ['scripts/validate-product-factory.mjs']],
  ['node', ['scripts/validate-isolated-environment-provisioning-plan.mjs']],
  ['node', ['scripts/validate-resilience-scenarios.mjs']],
  ['node', ['scripts/validate-autonomous-recovery-proof.mjs']],
  ['node', ['scripts/validate-autonomous-recovery-matrix.mjs']],
  ['node', ['scripts/validate-support-incident-recovery-proof.mjs']],
  ['node', ['scripts/validate-provider-recovery-authority-proof.mjs']],
  ['node', ['scripts/validate-provider-recovery-handoff-prototype.mjs']],
  ['node', ['scripts/validate-vector-only-ui.mjs']],
  ['node', ['scripts/validate-onedrive-sync-guardian.mjs']],
  ['node', ['--experimental-sqlite', '--test', '--test-concurrency=1',
    'implementation/runtime/one-day-enterprise-engine.test.cjs',
    'implementation/runtime/readiness-evidence-contract.test.cjs',
    'implementation/runtime/readiness-evidence-wrapper.test.cjs',
    'implementation/runtime/implementation-active-controller.integration.test.cjs',
    'implementation/runtime/implementation-work-controller.test.cjs',
    'implementation/runtime/implementation-work-fencing.test.cjs',
    'scripts/vector-repair-regressions.test.mjs',
    'tests/vector-payroll-release-proof.test.mjs',
    'docs/execution/proof-runner-activation/launcher.test.cjs',
    'docs/execution/proof-runner-activation/preflight.test.cjs',
    'docs/execution/proof-runner-activation/child-environment.test.cjs',
    'docs/execution/proof-runner-activation/source-binding.test.cjs',
    'scripts/current-candidate-role-browser-proof.environment.test.mjs',
    'scripts/current-candidate-role-browser-proof.auth.test.mjs',
    'security/runtime/proof-runner-auth.test.cjs',
    'scripts/current-candidate-role-browser-proof-server.test.mjs'
  ]],
  ['node', ['--test',
    'ux-overlay/vector-civil-date.test.cjs',
    'ux-overlay/vector-leave-balance-display.test.cjs',
    'operations/runtime/decision-episode.test.cjs',
    'operations/runtime/capacity-rescue-frozen-simulation.test.cjs',
    'operations/runtime/customer-demand-intelligence.test.cjs',
    'operations/runtime/absence-recovery-shadow.test.cjs',
    'operations/runtime/demand-decision-service.test.cjs',
    'operations/runtime/decision-outcome-proof.test.cjs',
    'operations/runtime/order-start-variance.test.cjs',
    'operations/runtime/order-start-variance-inert.test.cjs',
    'operations/runtime/order-start-variance-inert-heldouts.test.cjs',
    'operations/runtime/order-start-variance-service.test.cjs',
    'operations/runtime/production-output-gap.test.cjs',
    'operations/runtime/order-material-availability.test.cjs',
    'operations/runtime/factory-assessment-scenarios-service.test.cjs',
    'adaptive-intelligence/engine.test.mjs',
    'adaptive-intelligence/durable-outcome-ledger.test.mjs',
    'adaptive-intelligence/durable-outcome-ledger-heldouts.test.mjs',
    'adaptive-intelligence/durable-outcome-ledger-inert-input.test.mjs',
    'adaptive-intelligence/durable-incident-memory.test.mjs',
    'adaptive-intelligence/durable-incident-memory-freshness.test.mjs',
    'adaptive-intelligence/durable-incident-memory-process.test.mjs',
    'scripts/prove-vector-built-asset-provenance.test.mjs',
    'scripts/validate-staffology-canonical-assembly.test.mjs',
    'scripts/runtime-artifact-manifest.test.mjs',
    'scripts/proof-access-preflight.test.cjs',
    'integrations/staffology/canonical-runtime-bridge.test.cjs',
    'integrations/staffology/staffology-adapter.test.cjs',
    'integrations/staffology/canonical-production-boundaries.test.cjs',
    'integrations/staffology/consumed-permit-retry.test.cjs',
    'operations/runtime/autopilot-expiry-readback.regression.test.cjs',
    'reporting/ui/vector-reporting-ui.test.cjs',
    'reporting/ui/vector-reporting-export-safety.test.cjs',
    'reporting/ui/vector-reporting-export-heldout.test.cjs',
    'reporting/ui/vector-reporting-multirow-export.test.cjs',
    'reporting/ui/vector-reporting-mapping-integrity.test.cjs',
    'reporting/ui/vector-reporting-lifecycle.test.cjs',
    'policy/runtime/country-policy-pack-registry.test.cjs',
    'policy/runtime/jurisdiction-policy-graph.test.cjs',
    'policy/runtime/global-site-policy-preflight.test.cjs',
    'policy/runtime/authoritative-policy-source-registry.test.cjs',
    'policy/runtime/regulatory-change-candidate.test.cjs',
    'policy/runtime/v026-tenant-policy-scope.test.cjs'
  ]]
];

for (const [command, args] of checks) {
  console.log('\n=== ' + command + ' ' + args.join(' ') + ' ===');
  const result = spawnSync(command === 'node' ? process.execPath : command, args, {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nVECTOR_FORGE_CORE_CI=PASS');
