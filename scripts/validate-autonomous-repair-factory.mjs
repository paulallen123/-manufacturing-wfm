import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createFactory}=require('../resilience/autonomous-repair-factory.cjs');
const d=v=>createHash('sha256').update(String(v)).digest('hex');
const expect=(fn,code)=>{try{fn();}catch(e){assert.equal(e.code,code);return;}assert.fail('Expected '+code);};

const f=createFactory({maxAttempts:3});
const incidentId='inc-tier2-001',tenant='tenant-a';
f.openIncident({incidentId,tenant,evidenceDigest:d('evidence')});

expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('patch0'),changedPaths:['lib/fix.cjs']}),'WFM_REPAIR_NO_REPRODUCER');

f.registerReproducer({incidentId,tenant,failingTestDigest:d('failing-test'),observedFailureDigest:d('observed-failure')});

expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('policy-tamper'),changedPaths:['resilience/security-baseline.json']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('control-loop-tamper'),changedPaths:['resilience/autonomy-control-loop.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('handoff-tamper'),changedPaths:['resilience/provider-recovery-handoff.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('syntax-gate-tamper'),changedPaths:['scripts/validate-autonomy-source-syntax.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('dep-add'),changedPaths:['lib/fix.cjs'],runtimeDependenciesAdded:['some-package']}),'WFM_REPAIR_RUNTIME_DEPENDENCY');

f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('patch1'),changedPaths:['lib/fix.cjs','tests/fix.test.cjs']});
expect(()=>f.verifyCandidate({incidentId,tenant,verifierId:'repair-agent',failingTestNowPasses:true,regressionPassed:true,securityPassed:true,tenantIsolationPassed:true,browserPassed:true,artifactDigest:d('artifact'),provenanceDigest:d('provenance'),rollbackDigest:d('rollback')}),'WFM_REPAIR_SELF_VERIFY');

let rejected=f.verifyCandidate({incidentId,tenant,verifierId:'independent-verifier',failingTestNowPasses:true,regressionPassed:true,securityPassed:false,tenantIsolationPassed:true,browserPassed:true,artifactDigest:d('artifact'),provenanceDigest:d('provenance'),rollbackDigest:d('rollback')});
assert.equal(rejected.state,'candidate-rejected');

f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('patch2'),changedPaths:['lib/fix.cjs','tests/fix.test.cjs']});
const verified=f.verifyCandidate({incidentId,tenant,verifierId:'independent-verifier',failingTestNowPasses:true,regressionPassed:true,securityPassed:true,tenantIsolationPassed:true,browserPassed:true,artifactDigest:d('artifact2'),provenanceDigest:d('provenance2'),rollbackDigest:d('rollback2')});
assert.equal(verified.state,'verified');
assert.equal(verified.verification.status,'verified');

expect(()=>f.issueStagingPermit({incidentId,tenant,authorityId:'repair-agent',artifactDigest:d('artifact2')}),'WFM_REPAIR_AUTHORITY_SEPARATION');
expect(()=>f.issueStagingPermit({incidentId,tenant,authorityId:'release-authority',artifactDigest:d('changed-artifact')}),'WFM_REPAIR_ARTIFACT_DRIFT');
const permit=f.issueStagingPermit({incidentId,tenant,authorityId:'release-authority',artifactDigest:d('artifact2')});
assert.equal(permit.scope,'isolated-staging-only');
expect(()=>f.issueProductionPermit({incidentId,tenant}),'WFM_REPAIR_PRODUCTION_DENIED');

const other=createFactory({maxAttempts:1});
other.openIncident({incidentId:'inc-budget',tenant,evidenceDigest:d('budget-evidence')});
other.registerReproducer({incidentId:'inc-budget',tenant,failingTestDigest:d('f1'),observedFailureDigest:d('o1')});
other.proposeCandidate({incidentId:'inc-budget',tenant,proposerId:'a',patchDigest:d('p1'),changedPaths:['lib/a.cjs']});
other.verifyCandidate({incidentId:'inc-budget',tenant,verifierId:'v',failingTestNowPasses:false,regressionPassed:true,securityPassed:true,tenantIsolationPassed:true,browserPassed:true,artifactDigest:d('a'),provenanceDigest:d('p'),rollbackDigest:d('r')});
expect(()=>other.proposeCandidate({incidentId:'inc-budget',tenant,proposerId:'a',patchDigest:d('p2'),changedPaths:['lib/a.cjs']}),'WFM_REPAIR_BUDGET');
assert.equal(other.snapshot('inc-budget').state,'contained');

const receipt={schemaVersion:1,proof:'tier2-repair-factory-authority-separation',status:'PASS',reproducerRequired:true,protectedPolicyTamperDenied:true,authoritySurfaceTamperDenied:true,syntaxGateTamperDenied:true,newRuntimeDependencyDenied:true,selfVerificationDenied:true,failedSecurityScanRejected:true,independentReleaseAuthorityRequired:true,artifactDriftDenied:true,stagingOnlyPermit:true,productionPermitDenied:true,repairBudgetContainment:true};
console.log(JSON.stringify(receipt,null,2));
