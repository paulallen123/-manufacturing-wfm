#!/usr/bin/env node
import { spawn } from 'node:child_process';

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
  'scripts/validate-release-policy.mjs'
];

function runCheck(check) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const proc = spawn(process.execPath, [check], { env: process.env });
    proc.stdout.on('data', chunk => stdoutChunks.push(chunk));
    proc.stderr.on('data', chunk => stderrChunks.push(chunk));
    proc.on('close', code => resolve({
      check,
      status: code ?? 1,
      stdout: Buffer.concat(stdoutChunks).toString(),
      stderr: Buffer.concat(stderrChunks).toString(),
    }));
    proc.on('error', reject);
  });
}

const results = await Promise.all(checks.map(runCheck));

let failed = false;
for (const { check, status, stdout, stderr } of results) {
  console.log(`\n=== ${check} ===`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (status !== 0) {
    console.error(`FAILED with exit code ${status}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('\nZERO_COST_CORE_CI=PASS');
