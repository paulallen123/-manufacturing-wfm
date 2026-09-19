import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const jsFiles = [
  'resilience/support-selfhelp.cjs',
  'resilience/autonomous-repair-factory.cjs',
  'resilience/isolated-repair-worker.cjs',
  'resilience/independent-repair-verifier.cjs',
  'resilience/disposable-staging-gate.cjs',
  'resilience/autonomous-repair-pipeline.cjs',
  'resilience/canary-rollback-controller.cjs',
  'resilience/autonomous-repair-canary-orchestrator.cjs',
  'resilience/provider-recovery-handoff.cjs',
  'resilience/canonical-release-boundary.cjs',
  'resilience/t3-shadow-simulator.cjs',
  'resilience/t3-shadow-verifier.cjs',
  'resilience/t3-customer-authorisation-gate.cjs',
  'resilience/t3-execution-preflight-verifier.cjs',
  'resilience/t3-execution-readiness-gate.cjs',
  'resilience/t3-deterministic-execution-sandbox.cjs',
  'resilience/t4-containment-controller.cjs',
  'resilience/autonomy-control-loop.cjs',
  'resilience/incident-learning-planner.cjs',
  'resilience/ci-provider-failover.cjs',
  'scripts/run-portable-autonomy-proof.mjs',
  'scripts/validate-autonomy-source-syntax.mjs',
  'scripts/validate-canonical-release-boundary.mjs',
  'scripts/validate-resilience-scenarios.mjs',
  'scripts/validate-support-tier-contract.mjs',
  'scripts/validate-support-selfhelp.mjs',
  'scripts/validate-provider-recovery-handoff.mjs',
  'scripts/validate-autonomous-repair-factory.mjs',
  'scripts/validate-isolated-repair-worker.mjs',
  'scripts/validate-independent-repair-verifier.mjs',
  'scripts/validate-disposable-staging-gate.mjs',
  'scripts/validate-autonomous-repair-pipeline.mjs',
  'scripts/validate-canary-rollback-controller.mjs',
  'scripts/validate-autonomous-repair-canary-orchestrator.mjs',
  'scripts/validate-t3-shadow-support.mjs',
  'scripts/validate-t3-customer-authorisation-gate.mjs',
  'scripts/validate-t3-execution-readiness.mjs',
  'scripts/validate-t3-deterministic-execution-sandbox.mjs',
  'scripts/validate-t4-containment-chaos.mjs',
  'scripts/validate-t4-outer-terminal-integrity.mjs',
  'scripts/validate-autonomy-control-loop.mjs',
  'scripts/validate-incident-learning-planner.mjs',
];

const checked = [];
for (const rel of jsFiles) {
  const file = path.join(root, rel);
  assert.equal(fs.existsSync(file), true, `Missing autonomy source: ${rel}`);
  const run = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${rel} failed syntax check: ${run.stderr || run.stdout}`);
  checked.push(rel);
}

for (const rel of [
  'resilience/isolated-repair-worker.cjs',
  'resilience/independent-repair-verifier.cjs',
  'resilience/disposable-staging-gate.cjs',
  'resilience/autonomous-repair-pipeline.cjs',
  'resilience/canary-rollback-controller.cjs',
  'resilience/autonomous-repair-canary-orchestrator.cjs',
  'resilience/canonical-release-boundary.cjs',
  'resilience/t3-shadow-simulator.cjs',
  'resilience/t3-shadow-verifier.cjs',
  'resilience/t3-customer-authorisation-gate.cjs',
  'resilience/t3-execution-preflight-verifier.cjs',
  'resilience/t3-execution-readiness-gate.cjs',
  'resilience/t3-deterministic-execution-sandbox.cjs',
  'resilience/t4-containment-controller.cjs',
  'resilience/incident-learning-planner.cjs',
]) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const forbidden of ["require('node:http')", "require('node:https')", "require('node:net')", 'process.env', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `${rel} contains forbidden direct network/ambient-secret surface: ${forbidden}`);
  }
}

const workflowRel = '.github/workflows/wfm-zero-engineer-support-contract.yml';
const workflow = fs.readFileSync(path.join(root, workflowRel), 'utf8');
assert.equal(workflow.includes('\\n      - '), false, 'Workflow contains a literal escaped newline before a path item.');

const requiredWorkflowPaths = [
  "      - 'resilience/autonomous-repair-factory.cjs'",
  "      - 'resilience/isolated-repair-worker.cjs'",
  "      - 'resilience/independent-repair-verifier.cjs'",
  "      - 'resilience/disposable-staging-gate.cjs'",
  "      - 'resilience/autonomous-repair-pipeline.cjs'",
  "      - 'resilience/canary-rollback-controller.cjs'",
  "      - 'resilience/autonomous-repair-canary-orchestrator.cjs'",
  "      - 'resilience/canonical-release-boundary.cjs'",
  "      - 'resilience/canonical-release-policy-snapshot.json'",
  "      - 'resilience/t3-shadow-simulator.cjs'",
  "      - 'resilience/t3-shadow-verifier.cjs'",
  "      - 'resilience/t3-customer-authorisation-gate.cjs'",
  "      - 'resilience/t3-execution-preflight-verifier.cjs'",
  "      - 'resilience/t3-execution-readiness-gate.cjs'",
  "      - 'resilience/t3-deterministic-execution-sandbox.cjs'",
  "      - 'resilience/t4-containment-controller.cjs'",
  "      - 'resilience/autonomy-control-loop.cjs'",
  "      - 'resilience/incident-learning-planner.cjs'",
  "      - 'scripts/validate-autonomous-repair-factory.mjs'",
  "      - 'scripts/validate-isolated-repair-worker.mjs'",
  "      - 'scripts/validate-independent-repair-verifier.mjs'",
  "      - 'scripts/validate-disposable-staging-gate.mjs'",
  "      - 'scripts/validate-autonomous-repair-pipeline.mjs'",
  "      - 'scripts/validate-canary-rollback-controller.mjs'",
  "      - 'scripts/validate-autonomous-repair-canary-orchestrator.mjs'",
  "      - 'scripts/validate-canonical-release-boundary.mjs'",
  "      - 'scripts/validate-t3-shadow-support.mjs'",
  "      - 'scripts/validate-t3-customer-authorisation-gate.mjs'",
  "      - 'scripts/validate-t3-execution-readiness.mjs'",
  "      - 'scripts/validate-t3-deterministic-execution-sandbox.mjs'",
  "      - 'scripts/validate-t4-containment-chaos.mjs'",
  "      - 'scripts/validate-t4-outer-terminal-integrity.mjs'",
  "      - 'scripts/validate-autonomy-control-loop.mjs'",
  "      - 'scripts/validate-incident-learning-planner.mjs'",
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
  isolatedWorkerDirectNetworkSurfaceDenied: true,
  isolatedWorkerAmbientEnvironmentDenied: true,
  independentVerifierDirectNetworkSurfaceDenied: true,
  independentVerifierAmbientEnvironmentDenied: true,
  disposableStagingDirectNetworkSurfaceDenied: true,
  disposableStagingAmbientEnvironmentDenied: true,
  repairPipelineDirectNetworkSurfaceDenied: true,
  repairPipelineAmbientEnvironmentDenied: true,
  canaryRollbackDirectNetworkSurfaceDenied: true,
  canaryRollbackAmbientEnvironmentDenied: true,
  repairToCanaryOrchestratorDirectNetworkSurfaceDenied: true,
  repairToCanaryOrchestratorAmbientEnvironmentDenied: true,
  canonicalReleaseBoundaryDirectNetworkSurfaceDenied: true,
  canonicalReleaseBoundaryAmbientEnvironmentDenied: true,
  t3ShadowDirectNetworkSurfaceDenied: true,
  t3ShadowAmbientEnvironmentDenied: true,
  t3CustomerAuthorisationDirectNetworkSurfaceDenied: true,
  t3CustomerAuthorisationAmbientEnvironmentDenied: true,
  t3ExecutionReadinessDirectNetworkSurfaceDenied: true,
  t3ExecutionReadinessAmbientEnvironmentDenied: true,
  t3DeterministicExecutionSandboxDirectNetworkSurfaceDenied: true,
  t3DeterministicExecutionSandboxAmbientEnvironmentDenied: true,
  t4ContainmentDirectNetworkSurfaceDenied: true,
  t4ContainmentAmbientEnvironmentDenied: true,
  incidentLearningDirectNetworkSurfaceDenied: true,
  incidentLearningAmbientEnvironmentDenied: true,
  workflowLiteralEscapeCorruptionDenied: true,
  workflowCriticalPathsPresent: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
