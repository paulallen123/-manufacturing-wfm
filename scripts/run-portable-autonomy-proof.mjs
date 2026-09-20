import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyCanonicalTrustAnchorGovernanceEvidence } = require('../resilience/canonical-release-boundary.cjs');

const ROOT = process.cwd();
const strictRuntime = process.argv.includes('--strict-runtime');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'resilience/security-baseline.json'), 'utf8'));
const expectedNode = String(baseline?.node?.minimum || '22.23.2');
const actualNode = process.version.replace(/^v/, '');
const exactRuntime = actualNode === expectedNode;
const corpusSnapshotPath = path.resolve(process.env.WFM_INCIDENT_CORPUS_OUTPUT || path.join(ROOT, 'incident-regression-corpus.snapshot.json'));
const corpusContinuityPath = path.resolve(process.env.WFM_INCIDENT_CORPUS_CONTINUITY_OUTPUT || path.join(ROOT, 'incident-regression-corpus-continuity.json'));

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function validGitSha(value) {
  return /^[a-f0-9]{40}$/.test(String(value ?? '').toLowerCase());
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? '').toLowerCase());
}

function gitHeadSha() {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return run.status === 0 ? String(run.stdout || '').trim().toLowerCase() : '';
}

function gitObjectBlobSha(commitSha, repoPath) {
  if (!validGitSha(commitSha)) return '';
  const run = spawnSync('git', ['rev-parse', `${commitSha}:${repoPath}`], { cwd: ROOT, encoding: 'utf8' });
  return run.status === 0 ? String(run.stdout || '').trim().toLowerCase() : '';
}

function loadCanonicalGovernanceEvidence() {
  const evidencePath = String(process.env.WFM_CANONICAL_GOVERNANCE_EVIDENCE_FILE || '').trim();
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return { evidence: null, valid: false, error: 'canonical-governance-evidence-unavailable' };
  }
  try {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const valid = verifyCanonicalTrustAnchorGovernanceEvidence(evidence);
    return {
      evidence: valid ? evidence : null,
      valid,
      error: valid ? null : 'canonical-governance-evidence-invalid',
    };
  } catch (error) {
    return { evidence: null, valid: false, error: String(error?.message || error) };
  }
}

const canonicalBaseSha = String(process.env.WFM_CANONICAL_BASE_SHA || '').trim().toLowerCase();
function resolveCanonicalControlBlob(envName, repoPath) {
  const supplied = String(process.env[envName] || '').trim().toLowerCase();
  const derived = gitObjectBlobSha(canonicalBaseSha, repoPath);
  if (supplied && derived && supplied !== derived) return '';
  return supplied || derived;
}

const governanceLoad = loadCanonicalGovernanceEvidence();
const canonicalGovernanceEvidence = governanceLoad.evidence;
const canonicalGovernanceEvidenceDigest = canonicalGovernanceEvidence?.governanceEvidenceDigest || null;
const canonicalGovernanceEvidenceMatchesCanonical = governanceLoad.valid
  && validGitSha(canonicalGovernanceEvidence?.branchSha)
  && canonicalGovernanceEvidence.branchSha === canonicalBaseSha;
const canonicalTrustAnchorProtected = canonicalGovernanceEvidenceMatchesCanonical
  && canonicalGovernanceEvidence?.governance?.protected === true;
const canonicalTrustAnchorGovernanceVerified = canonicalTrustAnchorProtected
  && canonicalGovernanceEvidence?.governanceVerified === true;
const releaseGradeCanonicalTrustAnchor = canonicalTrustAnchorProtected && canonicalTrustAnchorGovernanceVerified;

const releaseEvidence = {
  headSha: String(process.env.WFM_AUTONOMY_HEAD_SHA || '').trim().toLowerCase(),
  canonicalBaseSha,
  canonicalPolicyBlobSha: resolveCanonicalControlBlob('WFM_CANONICAL_POLICY_BLOB_SHA', 'release/release-policy.json'),
  canonicalDeploymentPointerBlobSha: resolveCanonicalControlBlob('WFM_CANONICAL_DEPLOYMENT_POINTER_BLOB_SHA', 'release/deployment-pointer.json'),
  canonicalStagingWorkflowBlobSha: resolveCanonicalControlBlob('WFM_CANONICAL_STAGING_WORKFLOW_BLOB_SHA', '.github/workflows/canonical-staging-release.yml'),
  canonicalReleaseValidatorBlobSha: resolveCanonicalControlBlob('WFM_CANONICAL_RELEASE_VALIDATOR_BLOB_SHA', 'scripts/validate-release-policy.mjs'),
  mergeTreeSha: String(process.env.WFM_CANONICAL_MERGE_TREE_SHA || '').trim().toLowerCase(),
};
const releaseBindingComplete = Object.values(releaseEvidence).every(validGitSha);
const actualHeadSha = gitHeadSha();
const releaseHeadMatchesCheckout = releaseBindingComplete && actualHeadSha === releaseEvidence.headSha;
const releaseBindingCore = releaseBindingComplete ? {
  ...releaseEvidence,
  canonicalGovernanceEvidenceDigest: validDigest(canonicalGovernanceEvidenceDigest) ? canonicalGovernanceEvidenceDigest : null,
  canonicalGovernanceEvidenceBound: governanceLoad.valid,
  canonicalGovernanceEvidenceMatchesCanonical,
} : null;
const releaseBinding = releaseBindingCore ? {
  ...releaseBindingCore,
  bindingDigest: sha256(JSON.stringify(releaseBindingCore)),
} : null;

const checks = [
  ['source-syntax-and-workflow-integrity', 'scripts/validate-autonomy-source-syntax.mjs', true],
  ['proof-surface-coverage', 'scripts/validate-autonomy-proof-coverage.mjs', true],
  ['docker-build-secret-boundary', 'scripts/validate-build-secret-boundary.mjs', true],
  ['canonical-release-boundary-compatibility', 'scripts/validate-canonical-release-boundary.mjs', true],
  ['ci-provider-failover', 'scripts/validate-ci-provider-failover.mjs', true],
  ['deployment-provenance', 'scripts/validate-deployment.mjs', true],
  ['external-deployment-proof-provenance', 'scripts/validate-deployment-proof-provenance.mjs', true],
  ['railway-deployment-config-evidence-binding', 'scripts/validate-railway-deployment-config-binding.mjs', true],
  ['railway-hosted-origin-preflight', 'scripts/validate-railway-hosted-origin-preflight.mjs', true],
  ['railway-hosted-staging-proof-receipt', 'scripts/validate-railway-hosted-staging-proof-receipt.mjs', true],
  ['railway-proof-failure-and-durability-classification', 'scripts/validate-railway-proof-failure-classifier.mjs', true],
  ['resilience-policy', 'scripts/validate-resilience-scenarios.mjs', true],
  ['support-tier-contract', 'scripts/validate-support-tier-contract.mjs', true],
  ['tier0-selfhelp', 'scripts/validate-support-selfhelp.mjs', true],
  ['tier1-provider-recovery-handoff', 'scripts/validate-provider-recovery-handoff.mjs', true],
  ['tier2-repair-authority-separation', 'scripts/validate-autonomous-repair-factory.mjs', true],
  ['tier2-repair-path-canonicalization', 'scripts/validate-repair-path-canonicalization.mjs', true],
  ['tier2-isolated-repair-worker', 'scripts/validate-isolated-repair-worker.mjs', true],
  ['tier2-independent-repair-verifier', 'scripts/validate-independent-repair-verifier.mjs', true],
  ['tier2-exact-artifact-disposable-staging', 'scripts/validate-disposable-staging-gate.mjs', true],
  ['tier2-autonomous-repair-pipeline-composition', 'scripts/validate-autonomous-repair-pipeline.mjs', true],
  ['tier2-canary-blast-radius-known-good-rollback', 'scripts/validate-canary-rollback-controller.mjs', true],
  ['tier2-repair-to-canary-decision-composition', 'scripts/validate-autonomous-repair-canary-orchestrator.mjs', true],
  ['tier3-shadow-simulation', 'scripts/validate-t3-shadow-support.mjs', true],
  ['tier3-customer-authorisation-consent-gate', 'scripts/validate-t3-customer-authorisation-gate.mjs', true],
  ['tier3-consent-receipt-integrity', 'scripts/validate-t3-consent-receipt-integrity.mjs', true],
  ['tier3-execution-readiness-boundary', 'scripts/validate-t3-execution-readiness.mjs', true],
  ['tier3-deterministic-execution-sandbox', 'scripts/validate-t3-deterministic-execution-sandbox.mjs', true],
  ['tier3-deterministic-sandbox-component-binding', 'scripts/validate-t3-sandbox-component-binding.mjs', true],
  ['tier3-capability-graph-poisoning-safe-terminal', 'scripts/validate-t3-capability-poisoning.mjs', true],
  ['tier4-adversarial-containment-chaos', 'scripts/validate-t4-containment-chaos.mjs', true],
  ['tier4-outer-terminal-integrity', 'scripts/validate-t4-outer-terminal-integrity.mjs', true],
  ['closed-loop-autonomy-controller', 'scripts/validate-autonomy-control-loop.mjs', true],
  ['incident-learning-and-never-automate-boundary', 'scripts/validate-incident-learning-planner.mjs', true],
  ['historical-incident-replay-and-learning', 'scripts/validate-historical-incident-replay.mjs', true],
  ['append-only-incident-regression-corpus', 'scripts/validate-incident-regression-corpus.mjs', true],
  ['persistent-incident-regression-corpus-continuity', 'scripts/validate-persistent-incident-corpus.mjs', true],
  ['provider-neutral-prior-corpus-evidence-selection', 'scripts/validate-prior-corpus-evidence-verifier.mjs', true],
  ['provider-neutral-prior-corpus-selection-adapter', 'scripts/validate-prior-corpus-selection-adapter.mjs', true],
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

if (strictRuntime && (!releaseBindingComplete || !releaseHeadMatchesCheckout)) {
  failed = true;
  results.push({
    id: 'canonical-proof-binding',
    status: 'FAIL',
    reason: !releaseBindingComplete ? 'canonical-release-evidence-incomplete' : 'proof-head-does-not-match-checkout',
    actualHeadSha,
    releaseEvidence,
  });
} else {
  results.push({
    id: 'canonical-proof-binding',
    status: releaseBindingComplete && releaseHeadMatchesCheckout ? 'PASS' : 'NON_RELEASE_UNBOUND_LOGIC_PROOF',
    actualHeadSha,
    releaseBinding,
  });
}

results.push({
  id: 'canonical-trust-anchor',
  status: releaseGradeCanonicalTrustAnchor ? 'PASS' : 'RELEASE_BLOCKED',
  reason: !governanceLoad.valid
    ? 'canonical-trust-anchor-governance-evidence-unavailable-or-invalid'
    : !canonicalGovernanceEvidenceMatchesCanonical
      ? 'canonical-trust-anchor-governance-evidence-drift'
      : !canonicalTrustAnchorProtected
        ? 'canonical-trust-anchor-unprotected'
        : canonicalTrustAnchorGovernanceVerified
          ? 'protected-and-governance-verified-canonical-trust-anchor'
          : 'canonical-trust-anchor-governance-unverified',
  protected: canonicalTrustAnchorProtected,
  governanceVerified: canonicalTrustAnchorGovernanceVerified,
  governanceEvidenceBound: governanceLoad.valid,
  governanceEvidenceMatchesCanonical: canonicalGovernanceEvidenceMatchesCanonical,
  governanceEvidenceDigest: validDigest(canonicalGovernanceEvidenceDigest) ? canonicalGovernanceEvidenceDigest : null,
  governanceEvidenceError: governanceLoad.error,
  releaseAuthorityGranted: false,
});

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
      WFM_INCIDENT_CORPUS_OUTPUT: corpusSnapshotPath,
      WFM_INCIDENT_CORPUS_CONTINUITY_OUTPUT: corpusContinuityPath,
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

let incidentRegressionCorpus = null;
try {
  const snapshotRaw = fs.readFileSync(corpusSnapshotPath, 'utf8');
  const continuityRaw = fs.readFileSync(corpusContinuityPath, 'utf8');
  const snapshot = JSON.parse(snapshotRaw);
  const continuity = JSON.parse(continuityRaw);
  const continuityCore = { ...continuity };
  delete continuityCore.continuityDigest;
  const continuityDigestValid = /^[a-f0-9]{64}$/.test(String(continuity.continuityDigest || ''))
    && sha256(JSON.stringify(continuityCore)) === continuity.continuityDigest;
  const snapshotDigestValid = /^[a-f0-9]{64}$/.test(String(snapshot.corpusDigest || ''))
    && snapshot.corpusDigest === continuity.outputCorpusDigest
    && sha256(snapshotRaw) === continuity.outputSnapshotSha256;
  const authoritySafe = continuity.actionAuthorityGranted === false
    && continuity.productionAuthorityGranted === false
    && continuity.releaseAuthorityGranted === false
    && continuity.crossTenantMutation === false
    && continuity.productionMutation === false
    && continuity.customerMutation === false;
  const valid = continuity.status === 'PASS'
    && continuity.proof === 'provider-neutral-incident-regression-corpus-continuity'
    && continuityDigestValid
    && snapshotDigestValid
    && authoritySafe
    && Number.isSafeInteger(snapshot.entryCount)
    && snapshot.entryCount >= continuity.currentScenarioClasses;
  if (!valid) throw new Error('Persistent incident corpus continuity evidence failed verification.');
  incidentRegressionCorpus = {
    schemaVersion: snapshot.schemaVersion,
    priorSnapshotLoaded: continuity.priorSnapshotLoaded === true,
    priorSnapshotSha256: continuity.priorSnapshotSha256,
    priorCorpusDigest: continuity.priorCorpusDigest,
    entryCount: snapshot.entryCount,
    corpusDigest: snapshot.corpusDigest,
    snapshotSha256: sha256(snapshotRaw),
    continuityDigest: continuity.continuityDigest,
  };
  results.push({
    id: 'persistent-incident-corpus-artifact-binding',
    status: 'PASS',
    priorSnapshotLoaded: incidentRegressionCorpus.priorSnapshotLoaded,
    entryCount: incidentRegressionCorpus.entryCount,
    corpusDigest: incidentRegressionCorpus.corpusDigest,
    snapshotSha256: incidentRegressionCorpus.snapshotSha256,
  });
} catch (error) {
  failed = true;
  results.push({
    id: 'persistent-incident-corpus-artifact-binding',
    status: 'FAIL',
    reason: String(error?.message || error),
  });
}

let releaseEvidenceStatus = 'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE';
if (!releaseBindingComplete) {
  releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_RELEASE_EVIDENCE_INCOMPLETE';
} else if (!releaseHeadMatchesCheckout) {
  releaseEvidenceStatus = 'FAIL_CLOSED_PROOF_HEAD_MISMATCH';
} else if (!governanceLoad.valid) {
  releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_GOVERNANCE_EVIDENCE_INVALID';
} else if (!canonicalGovernanceEvidenceMatchesCanonical) {
  releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_GOVERNANCE_DRIFT';
} else if (!canonicalTrustAnchorProtected) {
  releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_UNPROTECTED';
} else if (!canonicalTrustAnchorGovernanceVerified) {
  releaseEvidenceStatus = 'FAIL_CLOSED_CANONICAL_TRUST_ANCHOR_GOVERNANCE_UNVERIFIED';
} else if (!exactRuntime) {
  releaseEvidenceStatus = 'FAIL_CLOSED_EXACT_RUNTIME_REQUIRED';
} else {
  releaseEvidenceStatus = 'ELIGIBLE_EXACT_RELEASE_EVIDENCE';
}

const releaseClaimAllowed = !failed && releaseEvidenceStatus === 'ELIGIBLE_EXACT_RELEASE_EVIDENCE';
const proofScope = releaseClaimAllowed
  ? 'EXACT_RUNTIME_RELEASE_ELIGIBLE'
  : exactRuntime ? 'EXACT_RUNTIME_LOGIC_ONLY' : 'NON_EXACT_LOGIC_ONLY';

const receipt = {
  schemaVersion: 7,
  proof: 'portable-zero-engineer-autonomy-gate',
  status: failed ? 'FAIL' : 'PASS',
  proofScope,
  releaseEvidenceStatus,
  releaseClaimAllowed,
  strictRuntime,
  exactRuntime,
  expectedNode,
  actualNode,
  providerNeutral: true,
  requiresGitHubHostedRunner: false,
  priorCorpusEvidenceContinuityDigestRequired: true,
  priorCorpusSelectionAdapterRequired: true,
  canonicalTrustAnchorProtected,
  canonicalTrustAnchorGovernanceVerified,
  canonicalGovernanceEvidenceBound: governanceLoad.valid,
  canonicalGovernanceEvidenceMatchesCanonical,
  canonicalGovernanceEvidenceDigest: validDigest(canonicalGovernanceEvidenceDigest) ? canonicalGovernanceEvidenceDigest : null,
  releaseGradeCanonicalTrustAnchor,
  canonicalReleaseEvidenceBound: releaseClaimAllowed,
  canonicalControlBundleReceiptBound: releaseBindingComplete,
  releaseBinding,
  incidentRegressionCorpus,
  productionMutation: false,
  customerMutation: false,
  checks: results,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(ROOT, 'portable-autonomy-proof.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('\n' + JSON.stringify(receipt, null, 2));

if (failed) process.exit(1);