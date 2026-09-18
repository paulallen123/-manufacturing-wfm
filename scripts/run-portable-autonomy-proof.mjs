import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const strictRuntime = process.argv.includes('--strict-runtime');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'resilience/security-baseline.json'), 'utf8'));
const expectedNode = String(baseline?.node?.minimum || '22.23.2');
const actualNode = process.version.replace(/^v/, '');
const exactRuntime = actualNode === expectedNode;

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

const checks = [
  ['source-syntax-and-workflow-integrity', 'scripts/validate-autonomy-source-syntax.mjs', true],
  ['ci-provider-failover', 'scripts/validate-ci-provider-failover.mjs', true],
  ['deployment-provenance', 'scripts/validate-deployment.mjs', false],
  ['resilience-policy', 'scripts/validate-resilience-scenarios.mjs', true],
  ['support-tier-contract', 'scripts/validate-support-tier-contract.mjs', true],
  ['tier0-selfhelp', 'scripts/validate-support-selfhelp.mjs', true],
  ['tier1-provider-recovery-handoff', 'scripts/validate-provider-recovery-handoff.mjs', true],
  ['tier2-repair-authority-separation', 'scripts/validate-autonomous-repair-factory.mjs', true],
  ['tier2-isolated-repair-worker', 'scripts/validate-isolated-repair-worker.mjs', true],
  ['closed-loop-autonomy-controller', 'scripts/validate-autonomy-control-loop.mjs', true],
];

const results = [];
let failed = false;

if (strictRuntime && !exactRuntime) {
  failed = true;
  results.push({
    id: 'runtime-identity',
    status: 'FAIL',
    reason: 'exact-node-runtime-required',
    expectedNode,
    actualNode,
  });
} else {
  results.push({
    id: 'runtime-identity',
    status: exactRuntime ? 'PASS' : 'NON_RELEASE_LOGIC_RUNTIME',
    expectedNode,
    actualNode,
  });
}

for (const [id, rel, required] of checks) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    results.push({ id, script: rel, status: required ? 'FAIL' : 'SKIP', reason: 'script-missing' });
    if (required) failed = true;
    continue;
  }

  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'test',
      WFM_PORTABLE_PROOF: '1',
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const stdout = run.stdout || '';
  const stderr = run.stderr || '';
  const exitCode = Number.isInteger(run.status) ? run.status : 1;
  const status = exitCode === 0 ? 'PASS' : 'FAIL';

  process.stdout.write(`\n=== ${id} ===\n`);
  if (stdout) process.stdout.write(stdout.endsWith('\n') ? stdout : stdout + '\n');
  if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : stderr + '\n');

  results.push({
    id,
    script: rel,
    status,
    exitCode,
    durationMs: Math.round(durationMs),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  });
  if (exitCode !== 0) failed = true;
}

const receipt = {
  schemaVersion: 1,
  proof: 'portable-zero-engineer-autonomy-gate',
  status: failed ? 'FAIL' : 'PASS',
  strictRuntime,
  exactRuntime,
  expectedNode,
  actualNode,
  providerNeutral: true,
  requiresGitHubHostedRunner: false,
  productionMutation: false,
  customerMutation: false,
  checks: results,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(ROOT, 'portable-autonomy-proof.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('\n' + JSON.stringify(receipt, null, 2));

if (failed) process.exit(1);
