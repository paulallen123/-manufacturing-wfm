#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  ['node', ['scripts/validate-deployment.mjs']],
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
  ['node', ['--test',
    'operations/runtime/decision-episode.test.cjs',
    'operations/runtime/customer-demand-intelligence.test.cjs',
    'operations/runtime/absence-recovery-shadow.test.cjs',
    'operations/runtime/demand-decision-service.test.cjs',
    'operations/runtime/decision-outcome-proof.test.cjs',
    'trust/runtime/vector-trust-spine.test.cjs',
    'operations/runtime/t9-autopilot-adapter.test.cjs',
    'operations/runtime/autopilot-execution-engine.test.cjs',
    'scripts/prove-vector-built-asset-provenance.test.mjs'
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
