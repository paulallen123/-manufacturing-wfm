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
  'resilience/deployment-proof-provenance-verifier.cjs',
  'resilience/t3-shadow-simulator.cjs',
  'resilience/t3-shadow-verifier.cjs',
  'resilience/t3-customer-authorisation-gate.cjs',
  'resilience/t3-execution-preflight-verifier.cjs',
  'resilience/t3-execution-readiness-gate.cjs',
  'resilience/t3-deterministic-execution-sandbox.cjs',
  'resilience/t4-containment-controller.cjs',
  'resilience/autonomy-control-loop.cjs',
  'resilience/incident-learning-planner.cjs',
  'resilience/incident-regression-corpus.cjs',
  'resilience/prior-corpus-evidence-verifier.cjs',
  'resilience/ci-provider-failover.cjs',
  'scripts/run-portable-autonomy-proof.mjs',
  'scripts/select-prior-corpus-evidence.mjs',
  'scripts/hydrate-prior-corpus-github.mjs',
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
  'scripts/validate-ci-provider-failover.mjs',
  'scripts/validate-deployment-proof-provenance.mjs',
  'scripts/validate-t3-shadow-support.mjs',
  'scripts/validate-t3-customer-authorisation-gate.mjs',
  'scripts/validate-t3-execution-readiness.mjs',
  'scripts/validate-t3-deterministic-execution-sandbox.mjs',
  'scripts/validate-t4-containment-chaos.mjs',
  'scripts/validate-t4-outer-terminal-integrity.mjs',
  'scripts/validate-autonomy-control-loop.mjs',
  'scripts/validate-incident-learning-planner.mjs',
  'scripts/validate-historical-incident-replay.mjs',
  'scripts/validate-incident-regression-corpus.mjs',
  'scripts/validate-persistent-incident-corpus.mjs',
  'scripts/validate-prior-corpus-evidence-verifier.mjs',
  'scripts/validate-prior-corpus-selection-adapter.mjs',
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
  'resilience/deployment-proof-provenance-verifier.cjs',
  'resilience/t3-shadow-simulator.cjs',
  'resilience/t3-shadow-verifier.cjs',
  'resilience/t3-customer-authorisation-gate.cjs',
  'resilience/t3-execution-preflight-verifier.cjs',
  'resilience/t3-execution-readiness-gate.cjs',
  'resilience/t3-deterministic-execution-sandbox.cjs',
  'resilience/t4-containment-controller.cjs',
  'resilience/incident-learning-planner.cjs',
  'resilience/incident-regression-corpus.cjs',
  'resilience/prior-corpus-evidence-verifier.cjs',
]) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const forbidden of ["require('node:http')", "require('node:https')", "require('node:net')", 'process.env', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `${rel} contains forbidden direct network/ambient-secret surface: ${forbidden}`);
  }
}

const workflowRel = '.github/workflows/wfm-zero-engineer-support-contract.yml';
const workflow = fs.readFileSync(path.join(root, workflowRel), 'utf8');
assert.equal(workflow.includes('\\n      - '), false, 'Workflow contains a literal escaped newline before a path item.');
for (const forbiddenPermission of ['contents: write', 'actions: write', 'id-token: write']) {
  assert.equal(workflow.includes(forbiddenPermission), false, `Autonomy proof workflow must remain read-only: ${forbiddenPermission}`);
}
assert.ok(workflow.includes('contents: read'), 'Workflow must retain read-only repository access.');
assert.ok(workflow.includes('actions: read'), 'Workflow must retain read-only Actions access.');

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
  "      - 'resilience/deployment-proof-provenance-verifier.cjs'",
  "      - 'resilience/t3-shadow-simulator.cjs'",
  "      - 'resilience/t3-shadow-verifier.cjs'",
  "      - 'resilience/t3-customer-authorisation-gate.cjs'",
  "      - 'resilience/t3-execution-preflight-verifier.cjs'",
  "      - 'resilience/t3-execution-readiness-gate.cjs'",
  "      - 'resilience/t3-deterministic-execution-sandbox.cjs'",
  "      - 'resilience/t4-containment-controller.cjs'",
  "      - 'resilience/autonomy-control-loop.cjs'",
  "      - 'resilience/incident-learning-planner.cjs'",
  "      - 'resilience/incident-regression-corpus.cjs'",
  "      - 'resilience/prior-corpus-evidence-verifier.cjs'",
  "      - 'resilience/ci-provider-failover.cjs'",
  "      - 'scripts/validate-autonomous-repair-factory.mjs'",
  "      - 'scripts/validate-isolated-repair-worker.mjs'",
  "      - 'scripts/validate-independent-repair-verifier.mjs'",
  "      - 'scripts/validate-disposable-staging-gate.mjs'",
  "      - 'scripts/validate-autonomous-repair-pipeline.mjs'",
  "      - 'scripts/validate-canary-rollback-controller.mjs'",
  "      - 'scripts/validate-autonomous-repair-canary-orchestrator.mjs'",
  "      - 'scripts/validate-canonical-release-boundary.mjs'",
  "      - 'scripts/validate-ci-provider-failover.mjs'",
  "      - 'scripts/validate-deployment-proof-provenance.mjs'",
  "      - 'scripts/validate-t3-shadow-support.mjs'",
  "      - 'scripts/validate-t3-customer-authorisation-gate.mjs'",
  "      - 'scripts/validate-t3-execution-readiness.mjs'",
  "      - 'scripts/validate-t3-deterministic-execution-sandbox.mjs'",
  "      - 'scripts/validate-t4-containment-chaos.mjs'",
  "      - 'scripts/validate-t4-outer-terminal-integrity.mjs'",
  "      - 'scripts/validate-autonomy-control-loop.mjs'",
  "      - 'scripts/validate-incident-learning-planner.mjs'",
  "      - 'scripts/validate-historical-incident-replay.mjs'",
  "      - 'scripts/validate-incident-regression-corpus.mjs'",
  "      - 'scripts/validate-persistent-incident-corpus.mjs'",
  "      - 'scripts/validate-prior-corpus-evidence-verifier.mjs'",
  "      - 'scripts/validate-prior-corpus-selection-adapter.mjs'",
  "      - 'scripts/select-prior-corpus-evidence.mjs'",
  "      - 'scripts/hydrate-prior-corpus-github.mjs'",
  "      - 'scripts/validate-autonomy-source-syntax.mjs'",
  "      - 'scripts/run-portable-autonomy-proof.mjs'",
];
for (const line of requiredWorkflowPaths) {
  assert.equal(workflow.split('\n').includes(line), true, `Workflow is missing exact path trigger: ${line.trim()}`);
}

const setupNodeIndex = workflow.indexOf('- name: Set up exact Node runtime');
const hydrateCorpusIndex = workflow.indexOf('- name: Hydrate prior verified incident regression corpus');
const classifyAnchorIndex = workflow.indexOf('- name: Classify canonical trust anchor');
const portableProofIndex = workflow.indexOf('- name: Run canonical portable autonomy proof');
const revalidateIndex = workflow.indexOf('- name: Revalidate canonical binding at proof completion');
const receiptIndex = workflow.indexOf('- name: Assert portable proof receipt');
const releaseFailClosedIndex = workflow.indexOf('- name: Enforce release evidence fail-closed boundary');
assert.ok(setupNodeIndex >= 0 && hydrateCorpusIndex > setupNodeIndex, 'Exact approved Node runtime must be established before prior-corpus hydration.');
assert.ok(classifyAnchorIndex > hydrateCorpusIndex, 'Canonical trust-anchor classification must follow bounded prior-corpus hydration.');
assert.ok(portableProofIndex > classifyAnchorIndex, 'Portable proof must execute after canonical trust-anchor classification.');
assert.ok(revalidateIndex > portableProofIndex, 'Canonical binding must be revalidated after the portable proof.');
assert.ok(receiptIndex > revalidateIndex, 'Proof receipt assertion must happen after canonical revalidation.');
assert.ok(releaseFailClosedIndex > receiptIndex, 'Release fail-closed enforcement must happen after portable logic proof and receipt assertion.');

const hydrationSection = workflow.slice(hydrateCorpusIndex, classifyAnchorIndex);
assert.ok(hydrationSection.includes('node scripts/hydrate-prior-corpus-github.mjs'), 'Workflow hydration must delegate retrieval to the protected read-only GitHub adapter.');
for (const duplicatedTrustLogic of [
  "portable.get('status')",
  'snapshot_raw',
  'continuity.get(',
  'accepted_envelope_states',
  'workflow-proof-hash-or-authority-binding-failed',
]) {
  assert.equal(hydrationSection.includes(duplicatedTrustLogic), false, `Workflow must not duplicate provider-neutral verification semantics: ${duplicatedTrustLogic}`);
}

const hydratorSource = fs.readFileSync(path.join(root, 'scripts/hydrate-prior-corpus-github.mjs'), 'utf8');
for (const required of [
  "import { selectFromManifest } from './select-prior-corpus-evidence.mjs'",
  "actions/workflows/${WORKFLOW_FILE}/runs",
  'MAX_RUN_PAGES = 10',
  'RUNS_PER_PAGE = 100',
  'portable-autonomy-proof-${run.runId}',
  "redirect: 'manual'",
  "target.protocol !== 'https:'",
  "spawnSync('unzip', ['-p'",
  "unavailableReason: expired ? 'artifact-expired'",
  'durableHistoryHint: Boolean(expired)',
  'selectFromManifest({ manifestPath, receiptPath, selectedSnapshotPath })',
  "appendEnvironment(githubEnv, 'WFM_INCIDENT_CORPUS_INPUT'",
  "String(result.receipt.status).startsWith('FAIL_CLOSED_')",
]) {
  assert.ok(hydratorSource.includes(required), `GitHub hydration adapter lost required read-only/fail-closed behavior: ${required}`);
}
assert.equal(hydratorSource.includes('console.log(context.token)'), false, 'Hydration adapter must not print the ephemeral workflow token.');
assert.equal(hydratorSource.includes('console.error(context.token)'), false, 'Hydration adapter must not print the ephemeral workflow token.');

const receiptSection = workflow.slice(receiptIndex, releaseFailClosedIndex);
assert.ok(receiptSection.includes('verifySelectionReceipt'), 'Proof receipt must validate hydration with the shared provider-neutral receipt verifier.');
assert.ok(receiptSection.includes('hydration.selectedSnapshotSha256'), 'Proof receipt must bind the selected predecessor snapshot bytes.');
assert.ok(receiptSection.includes('WFM_INCIDENT_CORPUS_INPUT'), 'Proof receipt must independently confirm whether a verified prior corpus was injected.');
assert.ok(receiptSection.includes('p.incidentRegressionCorpus.priorSnapshotLoaded === priorCorpusExpected'), 'Portable proof must agree with workflow hydration state.');
assert.ok(workflow.includes('incidentCorpusHydrationSha256'), 'Workflow-bound envelope must bind hydration receipt bytes.');
assert.ok(workflow.includes('incidentCorpusHydrationSelectionDigest'), 'Workflow-bound envelope must bind shared selection receipt integrity.');
assert.ok(workflow.includes('incidentCorpusHydrationSelectedEvidenceProofDigest'), 'Workflow-bound envelope must bind the selected predecessor evidence proof digest.');
assert.ok(workflow.includes('incident-regression-corpus.snapshot.json'), 'Workflow must persist verified incident regression corpus snapshot.');
assert.ok(workflow.includes('incident-regression-corpus-continuity.json'), 'Workflow must persist continuity evidence with corpus snapshot.');
assert.ok(workflow.includes('incident-regression-corpus-hydration.json'), 'Workflow must persist provider-neutral hydration/selection evidence.');
assert.ok(workflow.includes('WFM_CANONICAL_TRUST_ANCHOR_PROTECTED'), 'Workflow must carry canonical trust-anchor state into proof.');
assert.ok(workflow.includes('FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_UNPROTECTED'), 'Workflow must preserve explicit unprotected-anchor release blocker.');

const revalidateSection = workflow.slice(revalidateIndex, receiptIndex);
assert.equal(revalidateSection.includes('git fetch --no-tags origin integration/canonical'), false, 'Revalidation must not depend on unauthenticated git fetch after persist-credentials:false checkout.');
assert.ok(revalidateSection.includes('GH_TOKEN: ${{ github.token }}'), 'Revalidation must use read-only workflow token explicitly.');
assert.ok(revalidateSection.includes('/branches/integration/canonical'), 'Revalidation must query live canonical branch state.');
assert.ok(revalidateSection.includes('FINAL_CANONICAL_SHA'), 'Revalidation must compare live canonical SHA with proof binding.');
assert.ok(revalidateSection.includes('$WFM_CANONICAL_BASE_SHA:release/release-policy.json'), 'Revalidation must recompute policy blob from immutable bound canonical SHA.');
assert.ok(revalidateSection.includes('$WFM_CANONICAL_BASE_SHA'), 'Revalidation must recompute merge tree from immutable bound canonical SHA.');

const repairFactorySource = fs.readFileSync(path.join(root, 'resilience/autonomous-repair-factory.cjs'), 'utf8');
assert.ok(repairFactorySource.includes("'scripts/hydrate-prior-corpus-github.mjs'"), 'Autonomous repair worker must not be able to rewrite the prior-corpus retrieval adapter.');
assert.ok(repairFactorySource.includes("'resilience/deployment-proof-provenance-verifier.cjs'"), 'Autonomous repair worker must not be able to rewrite deployment proof provenance semantics.');
assert.ok(repairFactorySource.includes("'scripts/validate-deployment-proof-provenance.mjs'"), 'Autonomous repair worker must not be able to rewrite deployment proof provenance validation.');

const portableProofSource = fs.readFileSync(path.join(root, 'scripts/run-portable-autonomy-proof.mjs'), 'utf8');
for (const required of [
  "releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_UNPROTECTED'",
  "releaseEvidenceStatus = 'ELIGIBLE_EXACT_RELEASE_EVIDENCE'",
  "? 'EXACT_RUNTIME_RELEASE_ELIGIBLE'",
  ": exactRuntime ? 'EXACT_RUNTIME_LOGIC_ONLY' : 'NON_EXACT_LOGIC_ONLY'",
  'canonicalReleaseEvidenceBound: releaseClaimAllowed',
  "['deployment-provenance', 'scripts/validate-deployment.mjs', true]",
  "['external-deployment-proof-provenance', 'scripts/validate-deployment-proof-provenance.mjs', true]",
  "['historical-incident-replay-and-learning', 'scripts/validate-historical-incident-replay.mjs', true]",
  "['persistent-incident-regression-corpus-continuity', 'scripts/validate-persistent-incident-corpus.mjs', true]",
  "['provider-neutral-prior-corpus-evidence-selection', 'scripts/validate-prior-corpus-evidence-verifier.mjs', true]",
  'incidentRegressionCorpus,',
  "id: 'persistent-incident-corpus-artifact-binding'",
]) {
  assert.ok(portableProofSource.includes(required), `Portable proof lost release-trust/regression guard: ${required}`);
}

console.log(JSON.stringify({
  schemaVersion: 6,
  proof: 'autonomy-source-syntax-and-workflow-integrity',
  status: 'PASS',
  jsFilesChecked: checked.length,
  authorityModulesDirectNetworkSurfaceDenied: true,
  authorityModulesAmbientEnvironmentDenied: true,
  workflowReadOnlyPermissionsRequired: true,
  workflowCriticalPathsPresent: true,
  exactRuntimeEstablishedBeforeHydration: true,
  githubHydrationRetrievalOnly: true,
  providerNeutralSelectionVerifierReusedByWorkflow: true,
  duplicateInlinePriorCorpusTrustLogicDenied: true,
  artifactRedirectCredentialSeparationRequired: true,
  archivePathTraversalSurfaceAvoidedByNamedExtraction: true,
  expiredPriorEvidenceFailsClosed: true,
  selectedSnapshotDigestRecheckedByReceipt: true,
  hydrationEvidencePersistedAndBound: true,
  historicalReplayRequiredByPortableProof: true,
  persistentCorpusContinuityRequiredByPortableProof: true,
  priorCorpusEvidenceVerifierRequiredByPortableProof: true,
  deploymentProvenanceRequiredByPortableProof: true,
  externalDeploymentProofProvenanceRequiredByPortableProof: true,
  deploymentProofVerifierProtectedFromRepairAgent: true,
  priorCorpusHydratorProtectedFromRepairAgent: true,
  canonicalTrustAnchorClassificationRequired: true,
  exactRuntimeLogicProofContinuesWhenReleaseTrustBlocked: true,
  authenticatedCanonicalRevalidationRequired: true,
  unauthenticatedPostCheckoutGitFetchDenied: true,
  unprotectedCanonicalReleaseEvidenceFailsClosed: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));