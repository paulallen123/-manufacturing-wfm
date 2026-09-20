#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  'scripts/validate-deployment.mjs',
  'scripts/validate-resilience-scenarios.mjs',
  'scripts/validate-autonomous-recovery-proof.mjs',
  'scripts/validate-autonomous-recovery-matrix.mjs',
  'scripts/validate-support-incident-recovery-proof.mjs',
  'scripts/validate-provider-recovery-authority-proof.mjs',
  'scripts/validate-provider-recovery-handoff-prototype.mjs',
  'scripts/validate-vector-only-ui.mjs',
  'scripts/validate-onedrive-sync-guardian.mjs',
  'scripts/validate-factory-decision-kernel.mjs',
  'scripts/validate-engineering-memory.mjs',
  'scripts/validate-operational-history.mjs',
  'scripts/validate-global-operating-context.mjs',
  'scripts/validate-release-policy.mjs'
];

for (const check of checks) {
  console.log(`\n=== ${check} ===`);
  const result = spawnSync(process.execPath, [check], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nZERO_COST_CORE_CI=PASS');
