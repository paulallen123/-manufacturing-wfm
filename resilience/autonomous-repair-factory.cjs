'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const PROTECTED_PATHS = Object.freeze([
  'resilience/security-baseline.json',
  'resilience/agent-network-boundary.json',
  'DEPLOYMENT_MANIFEST.json',
  'STAGING_FREEZE.json',
  '.dockerignore',
  'Dockerfile',
  'Dockerfile.proof-runner',
  'release/release-policy.json',
  'release/deployment-pointer.json',
  'scripts/validate-release-policy.mjs',
  '.github/workflows/canonical-staging-release.yml',
  'resilience/canonical-release-boundary.cjs',
  'resilience/canonical-release-policy-snapshot.json',
  'scripts/validate-canonical-release-boundary.mjs',
  'scripts/collect-canonical-governance-evidence.mjs',
  'resilience/failure-scenarios.json',
  'resilience/ci-provider-failover.cjs',
  'resilience/provider-recovery-handoff.cjs',
  'resilience/autonomy-control-loop.cjs',
  'resilience/incident-learning-planner.cjs',
  'resilience/incident-regression-corpus.cjs',
  'resilience/prior-corpus-evidence-verifier.cjs',
  'resilience/deployment-proof-provenance-verifier.cjs',
  'resilience/railway-deployment-config-binding.cjs',
  'resilience/railway-hosted-origin-preflight.cjs',
  'resilience/railway-hosted-staging-proof-receipt.cjs',
  'resilience/railway-proof-failure-classifier.cjs',
  'resilience/build-secret-boundary.cjs',
  'resilience/evidence-bound-data-import-plan.cjs',
  'resilience/isolated-data-import-executor.cjs',
  'resilience/authorised-staging-import-readiness.cjs',
  'resilience/authorised-staging-import-executor.cjs',
  'resilience/support-selfhelp.cjs',
  'resilience/isolated-repair-worker.cjs',
  'resilience/independent-repair-verifier.cjs',
  'resilience/disposable-staging-gate.cjs',
  'resilience/autonomous-repair-pipeline.cjs',
  'resilience/canary-rollback-controller.cjs',
  'resilience/autonomous-repair-canary-orchestrator.cjs',
  'resilience/t3-shadow-simulator.cjs',
  'resilience/t3-shadow-verifier.cjs',
  'resilience/t3-customer-authorisation-gate.cjs',
  'resilience/t3-execution-preflight-verifier.cjs',
  'resilience/t3-execution-readiness-gate.cjs',
  'resilience/t3-deterministic-execution-sandbox.cjs',
  'resilience/t4-containment-controller.cjs',
  'resilience/t4-forensic-failover-store.cjs',
  'scripts/run-portable-autonomy-proof.mjs',
  'scripts/select-prior-corpus-evidence.mjs',
  'scripts/hydrate-prior-corpus-github.mjs',
  'scripts/validate-autonomy-source-syntax.mjs',
  'scripts/validate-autonomy-proof-coverage.mjs',
  'scripts/validate-resilience-scenarios.mjs',
  'scripts/validate-ci-provider-failover.mjs',
  'scripts/validate-provider-recovery-handoff.mjs',
  'scripts/validate-autonomy-control-loop.mjs',
  'scripts/validate-incident-learning-planner.mjs',
  'scripts/validate-historical-incident-replay.mjs',
  'scripts/validate-incident-regression-corpus.mjs',
  'scripts/validate-persistent-incident-corpus.mjs',
  'scripts/validate-prior-corpus-evidence-verifier.mjs',
  'scripts/validate-prior-corpus-selection-adapter.mjs',
  'scripts/validate-deployment.mjs',
  'scripts/validate-deployment-proof-provenance.mjs',
  'scripts/validate-railway-deployment-config-binding.mjs',
  'scripts/validate-railway-hosted-origin-preflight.mjs',
  'scripts/validate-railway-hosted-staging-proof-receipt.mjs',
  'scripts/validate-railway-proof-failure-classifier.mjs',
  'scripts/validate-build-secret-boundary.mjs',
  'scripts/validate-evidence-bound-data-import-plan.mjs',
  'scripts/validate-isolated-data-import-executor.mjs',
  'scripts/validate-authorised-staging-import-readiness.mjs',
  'scripts/validate-authorised-staging-import-executor.mjs',
  'scripts/validate-support-selfhelp.mjs',
  'scripts/validate-t3-shadow-support.mjs',
  'scripts/validate-t3-customer-authorisation-gate.mjs',
  'scripts/validate-t3-consent-receipt-integrity.mjs',
  'scripts/validate-t3-execution-readiness.mjs',
  'scripts/validate-t3-deterministic-execution-sandbox.mjs',
  'scripts/validate-t3-sandbox-component-binding.mjs',
  'scripts/validate-t3-capability-poisoning.mjs',
  'scripts/validate-t4-containment-chaos.mjs',
  'scripts/validate-t4-outer-terminal-integrity.mjs',
  'resilience/support-tier-contract.json',
  'scripts/validate-support-tier-contract.mjs',
  'resilience/autonomous-repair-factory.cjs',
  'scripts/validate-autonomous-repair-factory.mjs',
  'scripts/validate-repair-path-canonicalization.mjs',
  'scripts/validate-isolated-repair-worker.mjs',
  'scripts/validate-independent-repair-verifier.mjs',
  'scripts/validate-disposable-staging-gate.mjs',
  'scripts/validate-autonomous-repair-pipeline.mjs',
  'scripts/validate-canary-rollback-controller.mjs',
  'scripts/validate-autonomous-repair-canary-orchestrator.mjs',
  '.github/workflows/wfm-every-push-security.yml',
  '.github/workflows/wfm-zero-engineer-support-contract.yml',
  '.github/workflows/wfm-autonomous-repair-pipeline.yml'
]);

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function deny(code, message) {
  const err = new Error(message); err.code = code; throw err;
}
function canonicalRepairPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.includes('\0')) {
    deny('WFM_REPAIR_INPUT', 'invalid changed path');
  }
  const slash = value.replace(/\\/g, '/');
  if (slash.startsWith('/') || /^[A-Za-z]:\//.test(slash)) {
    deny('WFM_REPAIR_PROTECTED_PATH', 'candidate path must remain inside repository');
  }
  const clean = path.posix.normalize(slash);
  if (clean === '.' || clean === '..' || clean.startsWith('../')) {
    deny('WFM_REPAIR_PROTECTED_PATH', 'candidate path must remain inside repository');
  }
  return clean;
}
function touchesProtected(value) {
  const normalized = canonicalRepairPath(value);
  return PROTECTED_PATHS.some(p => normalized === p || normalized.startsWith(p + '/'));
}

function createFactory({ maxAttempts = 3 } = {}) {
  const incidents = new Map();

  function openIncident({ incidentId, tenant, evidenceDigest }) {
    if (!incidentId || !tenant || !/^[a-f0-9]{64}$/.test(evidenceDigest || '')) deny('WFM_REPAIR_INPUT', 'invalid incident input');
    if (incidents.has(incidentId)) deny('WFM_REPAIR_DUPLICATE', 'incident already exists');
    const rec = { incidentId, tenant, evidenceDigest, state: 'diagnosing', attempts: 0, reproducer: null, candidate: null, verification: null, stagingPermit: null, containment: null };
    incidents.set(incidentId, rec); return structuredClone(rec);
  }

  function registerReproducer({ incidentId, tenant, failingTestDigest, observedFailureDigest }) {
    const r = incidents.get(incidentId); if (!r || r.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (r.state !== 'diagnosing') deny('WFM_REPAIR_STATE', 'reproducer state');
    if (!/^[a-f0-9]{64}$/.test(failingTestDigest || '') || !/^[a-f0-9]{64}$/.test(observedFailureDigest || '')) deny('WFM_REPAIR_INPUT', 'bad reproducer digest');
    r.reproducer = { failingTestDigest, observedFailureDigest }; r.state = 'reproduced'; return structuredClone(r);
  }

  function proposeCandidate({ incidentId, tenant, proposerId, patchDigest, changedPaths = [], runtimeDependenciesAdded = [] }) {
    const r = incidents.get(incidentId); if (!r || r.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (!r.reproducer) deny('WFM_REPAIR_NO_REPRODUCER', 'reproducible failing test required');
    if (r.state !== 'reproduced' && r.state !== 'candidate-rejected') deny('WFM_REPAIR_STATE', 'candidate state');
    if (r.attempts >= maxAttempts) {
      r.state = 'contained';
      r.containment = { reason: 'repair-attempt-budget-exhausted', actorId: 'repair-factory', containmentDigest: sha({ incidentId, tenant, reason: 'repair-attempt-budget-exhausted' }) };
      deny('WFM_REPAIR_BUDGET', 'repair attempt budget exhausted');
    }
    if (!proposerId) deny('WFM_REPAIR_INPUT', 'proposer required');
    if (!/^[a-f0-9]{64}$/.test(patchDigest || '')) deny('WFM_REPAIR_INPUT', 'patch digest required');
    if (!Array.isArray(changedPaths) || changedPaths.length === 0) deny('WFM_REPAIR_INPUT', 'changed paths required');
    const canonicalChangedPaths = [...new Set(changedPaths.map(canonicalRepairPath))];
    if (canonicalChangedPaths.some(touchesProtected)) deny('WFM_REPAIR_PROTECTED_PATH', 'candidate touches repair authority/policy path');
    if (runtimeDependenciesAdded.length > 0) deny('WFM_REPAIR_RUNTIME_DEPENDENCY', 'new runtime dependency requires separate supply-chain approval');
    r.attempts++;
    r.candidate = {
      proposerId,
      patchDigest,
      changedPaths: canonicalChangedPaths,
      runtimeDependenciesAdded: [],
      candidateDigest: sha({ incidentId, tenant, patchDigest, changedPaths: canonicalChangedPaths })
    };
    r.verification = null; r.state = 'candidate-proposed'; return structuredClone(r);
  }

  function verifyCandidate({ incidentId, tenant, verifierId, failingTestNowPasses, regressionPassed, securityPassed, tenantIsolationPassed, browserPassed, artifactDigest, provenanceDigest, rollbackDigest }) {
    const r = incidents.get(incidentId); if (!r || r.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (r.state !== 'candidate-proposed' || !r.candidate) deny('WFM_REPAIR_STATE', 'no candidate to verify');
    if (!verifierId || verifierId === r.candidate.proposerId) deny('WFM_REPAIR_SELF_VERIFY', 'proposer cannot verify own candidate');
    const checks = { failingTestNowPasses, regressionPassed, securityPassed, tenantIsolationPassed, browserPassed };
    if (Object.values(checks).some(v => v !== true)) { r.state = 'candidate-rejected'; r.verification = { verifierId, checks, status: 'rejected' }; return structuredClone(r); }
    for (const d of [artifactDigest, provenanceDigest, rollbackDigest]) if (!/^[a-f0-9]{64}$/.test(d || '')) deny('WFM_REPAIR_INPUT', 'verification digests required');
    r.verification = { verifierId, checks, status: 'verified', artifactDigest, provenanceDigest, rollbackDigest, verificationDigest: sha({ verifierId, checks, artifactDigest, provenanceDigest, rollbackDigest }) };
    r.state = 'verified'; return structuredClone(r);
  }

  function issueStagingPermit({ incidentId, tenant, authorityId, artifactDigest }) {
    const r = incidents.get(incidentId); if (!r || r.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (r.state !== 'verified' || r.verification?.status !== 'verified') deny('WFM_REPAIR_UNVERIFIED', 'candidate is not independently verified');
    if (!authorityId || authorityId === r.candidate.proposerId || authorityId === r.verification.verifierId) deny('WFM_REPAIR_AUTHORITY_SEPARATION', 'release authority must be independent');
    if (artifactDigest !== r.verification.artifactDigest) deny('WFM_REPAIR_ARTIFACT_DRIFT', 'artifact differs from independently verified digest');
    r.stagingPermit = { authorityId, artifactDigest, permitDigest: sha({ incidentId, tenant, authorityId, artifactDigest, verificationDigest: r.verification.verificationDigest }), scope: 'isolated-staging-only' };
    r.state = 'staging-authorised'; return structuredClone(r.stagingPermit);
  }

  function containIncident({ incidentId, tenant, reason, actorId = 'deterministic-controller' }) {
    const r = incidents.get(incidentId); if (!r || r.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (!reason || !/^[a-z0-9][a-z0-9:_-]{2,127}$/.test(reason)) deny('WFM_REPAIR_INPUT', 'invalid containment reason');
    if (!actorId || actorId.length > 128) deny('WFM_REPAIR_INPUT', 'invalid containment actor');
    if (r.state === 'staging-authorised') deny('WFM_REPAIR_STATE', 'staging-authorised incident requires staging controller rollback/containment');
    r.state = 'contained';
    r.containment = { reason, actorId, containmentDigest: sha({ incidentId, tenant, reason, actorId, evidenceDigest: r.evidenceDigest, candidateDigest: r.candidate?.candidateDigest || null }) };
    return structuredClone(r);
  }

  function issueProductionPermit() {
    deny('WFM_REPAIR_PRODUCTION_DENIED', 'repair factory cannot mint production authority');
  }

  function snapshot(incidentId) { const r = incidents.get(incidentId); return r ? structuredClone(r) : null; }

  return { openIncident, registerReproducer, proposeCandidate, verifyCandidate, issueStagingPermit, containIncident, issueProductionPermit, snapshot, protectedPaths: [...PROTECTED_PATHS] };
}

module.exports = { createFactory, PROTECTED_PATHS, canonicalRepairPath };
