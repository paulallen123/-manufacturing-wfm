'use strict';

const { createHash } = require('node:crypto');

const PROTECTED_PATHS = Object.freeze([
  'resilience/security-baseline.json',\n  'DEPLOYMENT_MANIFEST.json',\n  'STAGING_FREEZE.json',\n  'Dockerfile',\n  'Dockerfile.proof-runner',\n  'resilience/failure-scenarios.json',\n  'resilience/ci-provider-failover.cjs',\n  'resilience/provider-recovery-handoff.cjs',\n  'resilience/autonomy-control-loop.cjs',\n  'resilience/support-selfhelp.cjs',\n  'scripts/run-portable-autonomy-proof.mjs',\n  'scripts/validate-resilience-scenarios.mjs',\n  'scripts/validate-ci-provider-failover.mjs',\n  'scripts/validate-provider-recovery-handoff.mjs',\n  'scripts/validate-autonomy-control-loop.mjs',\n  'scripts/validate-support-selfhelp.mjs',
  'resilience/support-tier-contract.json',
  'scripts/validate-support-tier-contract.mjs',
  'resilience/autonomous-repair-factory.cjs',
  'scripts/validate-autonomous-repair-factory.mjs',
  '.github/workflows/wfm-every-push-security.yml',
  '.github/workflows/wfm-zero-engineer-support-contract.yml'
]);

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function deny(code, message) {
  const err = new Error(message); err.code = code; throw err;
}
function touchesProtected(path) {
  return PROTECTED_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

function createFactory({ maxAttempts = 3 } = {}) {
  const incidents = new Map();

  function openIncident({ incidentId, tenant, evidenceDigest }) {
    if (!incidentId || !tenant || !/^[a-f0-9]{64}$/.test(evidenceDigest||'')) deny('WFM_REPAIR_INPUT','invalid incident input');
    if (incidents.has(incidentId)) deny('WFM_REPAIR_DUPLICATE','incident already exists');
    const rec={incidentId,tenant,evidenceDigest,state:'diagnosing',attempts:0,reproducer:null,candidate:null,verification:null,stagingPermit:null};
    incidents.set(incidentId,rec); return structuredClone(rec);
  }

  function registerReproducer({ incidentId, tenant, failingTestDigest, observedFailureDigest }) {
    const r=incidents.get(incidentId); if(!r||r.tenant!==tenant) deny('WFM_REPAIR_SCOPE','incident scope');
    if(r.state!=='diagnosing') deny('WFM_REPAIR_STATE','reproducer state');
    if(!/^[a-f0-9]{64}$/.test(failingTestDigest||'')||!/^[a-f0-9]{64}$/.test(observedFailureDigest||'')) deny('WFM_REPAIR_INPUT','bad reproducer digest');
    r.reproducer={failingTestDigest,observedFailureDigest}; r.state='reproduced'; return structuredClone(r);
  }

  function proposeCandidate({ incidentId, tenant, proposerId, patchDigest, changedPaths=[], runtimeDependenciesAdded=[] }) {
    const r=incidents.get(incidentId); if(!r||r.tenant!==tenant) deny('WFM_REPAIR_SCOPE','incident scope');
    if(!r.reproducer) deny('WFM_REPAIR_NO_REPRODUCER','reproducible failing test required');
    if(r.state!=='reproduced'&&r.state!=='candidate-rejected') deny('WFM_REPAIR_STATE','candidate state');
    if(r.attempts>=maxAttempts) { r.state='contained'; deny('WFM_REPAIR_BUDGET','repair attempt budget exhausted'); }
    if(!proposerId) deny('WFM_REPAIR_INPUT','proposer required');
    if(!/^[a-f0-9]{64}$/.test(patchDigest||'')) deny('WFM_REPAIR_INPUT','patch digest required');
    if(!Array.isArray(changedPaths)||changedPaths.length===0) deny('WFM_REPAIR_INPUT','changed paths required');
    if(changedPaths.some(touchesProtected)) deny('WFM_REPAIR_PROTECTED_PATH','candidate touches repair authority/policy path');
    if(runtimeDependenciesAdded.length>0) deny('WFM_REPAIR_RUNTIME_DEPENDENCY','new runtime dependency requires separate supply-chain approval');
    r.attempts++;
    r.candidate={proposerId,patchDigest,changedPaths:[...changedPaths],runtimeDependenciesAdded:[],candidateDigest:sha({incidentId,tenant,patchDigest,changedPaths})};
    r.verification=null; r.state='candidate-proposed'; return structuredClone(r);
  }

  function verifyCandidate({ incidentId, tenant, verifierId, failingTestNowPasses, regressionPassed, securityPassed, tenantIsolationPassed, browserPassed, artifactDigest, provenanceDigest, rollbackDigest }) {
    const r=incidents.get(incidentId); if(!r||r.tenant!==tenant) deny('WFM_REPAIR_SCOPE','incident scope');
    if(r.state!=='candidate-proposed'||!r.candidate) deny('WFM_REPAIR_STATE','no candidate to verify');
    if(!verifierId||verifierId===r.candidate.proposerId) deny('WFM_REPAIR_SELF_VERIFY','proposer cannot verify own candidate');
    const checks={failingTestNowPasses,regressionPassed,securityPassed,tenantIsolationPassed,browserPassed};
    if(Object.values(checks).some(v=>v!==true)) { r.state='candidate-rejected'; r.verification={verifierId,checks,status:'rejected'}; return structuredClone(r); }
    for(const d of [artifactDigest,provenanceDigest,rollbackDigest]) if(!/^[a-f0-9]{64}$/.test(d||'')) deny('WFM_REPAIR_INPUT','verification digests required');
    r.verification={verifierId,checks,status:'verified',artifactDigest,provenanceDigest,rollbackDigest,verificationDigest:sha({verifierId,checks,artifactDigest,provenanceDigest,rollbackDigest})};
    r.state='verified'; return structuredClone(r);
  }

  function issueStagingPermit({ incidentId, tenant, authorityId, artifactDigest }) {
    const r=incidents.get(incidentId); if(!r||r.tenant!==tenant) deny('WFM_REPAIR_SCOPE','incident scope');
    if(r.state!=='verified'||r.verification?.status!=='verified') deny('WFM_REPAIR_UNVERIFIED','candidate is not independently verified');
    if(!authorityId||authorityId===r.candidate.proposerId||authorityId===r.verification.verifierId) deny('WFM_REPAIR_AUTHORITY_SEPARATION','release authority must be independent');
    if(artifactDigest!==r.verification.artifactDigest) deny('WFM_REPAIR_ARTIFACT_DRIFT','artifact differs from independently verified digest');
    r.stagingPermit={authorityId,artifactDigest,permitDigest:sha({incidentId,tenant,authorityId,artifactDigest,verificationDigest:r.verification.verificationDigest}),scope:'isolated-staging-only'};
    r.state='staging-authorised'; return structuredClone(r.stagingPermit);
  }

  function issueProductionPermit() {
    deny('WFM_REPAIR_PRODUCTION_DENIED','repair factory cannot mint production authority');
  }

  function snapshot(incidentId){const r=incidents.get(incidentId); return r?structuredClone(r):null;}

  return { openIncident, registerReproducer, proposeCandidate, verifyCandidate, issueStagingPermit, issueProductionPermit, snapshot, protectedPaths:[...PROTECTED_PATHS] };
}

module.exports={createFactory,PROTECTED_PATHS};
