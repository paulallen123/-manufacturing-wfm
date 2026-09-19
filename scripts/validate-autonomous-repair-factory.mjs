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
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('network-boundary-tamper'),changedPaths:['resilience/agent-network-boundary.json']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('release-policy-tamper'),changedPaths:['release/release-policy.json']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('release-boundary-tamper'),changedPaths:['resilience/canonical-release-boundary.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('release-boundary-validator-tamper'),changedPaths:['scripts/validate-canonical-release-boundary.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('control-loop-tamper'),changedPaths:['resilience/autonomy-control-loop.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('learning-planner-tamper'),changedPaths:['resilience/incident-learning-planner.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('learning-validator-tamper'),changedPaths:['scripts/validate-incident-learning-planner.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('historical-replay-validator-tamper'),changedPaths:['scripts/validate-historical-incident-replay.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('incident-corpus-tamper'),changedPaths:['resilience/incident-regression-corpus.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('incident-corpus-validator-tamper'),changedPaths:['scripts/validate-incident-regression-corpus.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('persistent-corpus-validator-tamper'),changedPaths:['scripts/validate-persistent-incident-corpus.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('handoff-tamper'),changedPaths:['resilience/provider-recovery-handoff.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('worker-tamper'),changedPaths:['resilience/isolated-repair-worker.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('pipeline-tamper'),changedPaths:['resilience/autonomous-repair-pipeline.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('pipeline-validator-tamper'),changedPaths:['scripts/validate-autonomous-repair-pipeline.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('pipeline-workflow-tamper'),changedPaths:['.github/workflows/wfm-autonomous-repair-pipeline.yml']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('syntax-gate-tamper'),changedPaths:['scripts/validate-autonomy-source-syntax.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-simulator-tamper'),changedPaths:['resilience/t3-shadow-simulator.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-verifier-tamper'),changedPaths:['resilience/t3-shadow-verifier.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-validator-tamper'),changedPaths:['scripts/validate-t3-shadow-support.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-customer-auth-gate-tamper'),changedPaths:['resilience/t3-customer-authorisation-gate.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-customer-auth-validator-tamper'),changedPaths:['scripts/validate-t3-customer-authorisation-gate.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-execution-sandbox-tamper'),changedPaths:['resilience/t3-deterministic-execution-sandbox.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t3-execution-sandbox-validator-tamper'),changedPaths:['scripts/validate-t3-deterministic-execution-sandbox.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t4-controller-tamper'),changedPaths:['resilience/t4-containment-controller.cjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t4-validator-tamper'),changedPaths:['scripts/validate-t4-containment-chaos.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
expect(()=>f.proposeCandidate({incidentId,tenant,proposerId:'repair-agent',patchDigest:d('t4-terminal-validator-tamper'),changedPaths:['scripts/validate-t4-outer-terminal-integrity.mjs']}),'WFM_REPAIR_PROTECTED_PATH');
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
expect(()=>f.containIncident({incidentId,tenant,reason:'worker-safety-violation',actorId:'repair-worker'}),'WFM_REPAIR_STATE');
expect(()=>f.issueProductionPermit({incidentId,tenant}),'WFM_REPAIR_PRODUCTION_DENIED');

const other=createFactory({maxAttempts:1});
other.openIncident({incidentId:'inc-budget',tenant,evidenceDigest:d('budget-evidence')});
other.registerReproducer({incidentId:'inc-budget',tenant,failingTestDigest:d('f1'),observedFailureDigest:d('o1')});
other.proposeCandidate({incidentId:'inc-budget',tenant,proposerId:'a',patchDigest:d('p1'),changedPaths:['lib/a.cjs']});
other.verifyCandidate({incidentId:'inc-budget',tenant,verifierId:'v',failingTestNowPasses:false,regressionPassed:true,securityPassed:true,tenantIsolationPassed:true,browserPassed:true,artifactDigest:d('a'),provenanceDigest:d('p'),rollbackDigest:d('r')});
expect(()=>other.proposeCandidate({incidentId:'inc-budget',tenant,proposerId:'a',patchDigest:d('p2'),changedPaths:['lib/a.cjs']}),'WFM_REPAIR_BUDGET');
assert.equal(other.snapshot('inc-budget').state,'contained');
assert.equal(other.snapshot('inc-budget').containment.reason,'repair-attempt-budget-exhausted');

const containment=createFactory();
containment.openIncident({incidentId:'inc-contain',tenant,evidenceDigest:d('contain-evidence')});
containment.registerReproducer({incidentId:'inc-contain',tenant,failingTestDigest:d('cf'),observedFailureDigest:d('co')});
const contained=containment.containIncident({incidentId:'inc-contain',tenant,reason:'worker-executor-failure',actorId:'isolated-repair-worker'});
assert.equal(contained.state,'contained');
assert.match(contained.containment.containmentDigest,/^[a-f0-9]{64}$/);
expect(()=>containment.proposeCandidate({incidentId:'inc-contain',tenant,proposerId:'repair-agent',patchDigest:d('late'),changedPaths:['lib/a.cjs']}),'WFM_REPAIR_STATE');

const receipt={schemaVersion:1,proof:'tier2-repair-factory-authority-separation',status:'PASS',reproducerRequired:true,protectedPolicyTamperDenied:true,agentNetworkBoundaryTamperDenied:true,canonicalReleasePolicyTamperDenied:true,canonicalReleaseBoundaryTamperDenied:true,authoritySurfaceTamperDenied:true,incidentLearningAuthorityTamperDenied:true,historicalReplayAuthorityTamperDenied:true,incidentRegressionCorpusAuthorityTamperDenied:true,persistentIncidentCorpusAuthorityTamperDenied:true,isolatedWorkerAuthorityTamperDenied:true,repairPipelineAuthorityTamperDenied:true,repairPipelineValidatorTamperDenied:true,repairPipelineWorkflowTamperDenied:true,syntaxGateTamperDenied:true,t3ShadowAuthorityTamperDenied:true,t3CustomerAuthorisationAuthorityTamperDenied:true,t3DeterministicExecutionSandboxAuthorityTamperDenied:true,t4ContainmentAuthorityTamperDenied:true,t4ContainmentValidatorTamperDenied:true,t4OuterTerminalValidatorTamperDenied:true,newRuntimeDependencyDenied:true,selfVerificationDenied:true,failedSecurityScanRejected:true,independentReleaseAuthorityRequired:true,artifactDriftDenied:true,stagingOnlyPermit:true,postStagingContainmentRequiresStagingController:true,deterministicContainmentRecorded:true,productionPermitDenied:true,repairBudgetContainment:true};
console.log(JSON.stringify(receipt,null,2));