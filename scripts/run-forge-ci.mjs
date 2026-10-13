#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  ['node', ['scripts/validate-deployment.mjs']],
  ['node', ['scripts/validate-proof-lane-policy.mjs']],
  ['node', ['scripts/validate-hosted-auth-harness.mjs', '--fixtures', 'reliability/fixtures/hosted-auth-harness.json']],
  ['node', ['scripts/validate-hosted-auth-harness.mjs', '--scan', '.github/workflows']],
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
  ['node', ['--test', 'security/runtime/crawler-boundary.test.cjs', 'tests/vector-runtime-packaging.test.cjs']],
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
    'scripts/current-candidate-role-browser-proof-server.test.mjs'
  ]],
  ['node', ['--test',
    'operations/runtime/decision-episode.test.cjs',
    'operations/runtime/customer-demand-intelligence.test.cjs',
    'operations/runtime/absence-recovery-shadow.test.cjs',
    'operations/runtime/demand-decision-service.test.cjs',
    'operations/runtime/decision-outcome-proof.test.cjs',
    'scripts/prove-vector-built-asset-provenance.test.mjs',
    'policy/runtime/country-policy-pack-registry.test.cjs',
    'policy/runtime/jurisdiction-policy-graph.test.cjs',
    'policy/runtime/global-site-policy-preflight.test.cjs',
    'policy/runtime/authoritative-policy-source-registry.test.cjs',
    'policy/runtime/regulatory-change-candidate.test.cjs'
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
