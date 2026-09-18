import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const jsFiles = [
  'resilience/support-selfhelp.cjs',
  'resilience/autonomous-repair-factory.cjs',
  'resilience/provider-recovery-handoff.cjs',
  'resilience/autonomy-control-loop.cjs',
  'resilience/ci-provider-failover.cjs',
  'scripts/run-portable-autonomy-proof.mjs',
  'scripts/validate-autonomy-source-syntax.mjs',
  'scripts/validate-resilience-scenarios.mjs',
  'scripts/validate-support-tier-contract.mjs',
  'scripts/validate-support-selfhelp.mjs',
  'scripts/validate-provider-recovery-handoff.mjs',
  'scripts/validate-autonomous-repair-factory.mjs',
  'scripts/validate-autonomy-control-loop.mjs',
];

const checked = [];
for (const rel of jsFiles) {
  const file = path.join(root, rel);
  assert.equal(fs.existsSync(file), true, `Missing autonomy source: ${rel}`);
  const run = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${rel} failed syntax check: ${run.stderr || run.stdout}`);
  checked.push(rel);
}

const workflowRel = '.github/workflows/wfm-zero-engineer-support-contract.yml';
const workflow = fs.readFileSync(path.join(root, workflowRel), 'utf8');
assert.equal(workflow.includes('\\n      - '), false, 'Workflow contains a literal escaped newline before a path item.');

const requiredWorkflowPaths = [
  "      - 'resilience/autonomous-repair-factory.cjs'",
  "      - 'resilience/autonomy-control-loop.cjs'",
  "      - 'scripts/validate-autonomous-repair-factory.mjs'",
  "      - 'scripts/validate-autonomy-control-loop.mjs'",
  "      - 'scripts/validate-autonomy-source-syntax.mjs'",
  "      - 'scripts/run-portable-autonomy-proof.mjs'",
];
for (const line of requiredWorkflowPaths) {
  assert.equal(workflow.split('\n').includes(line), true, `Workflow is missing exact path trigger: ${line.trim()}`);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'autonomy-source-syntax-and-workflow-integrity',
  status: 'PASS',
  jsFilesChecked: checked.length,
  workflowLiteralEscapeCorruptionDenied: true,
  workflowCriticalPathsPresent: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
