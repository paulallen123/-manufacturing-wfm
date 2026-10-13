import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {classifyGitHubJobs,selectProofLane}=require('../resilience/ci-provider-failover.cjs');

const healthy=[{
  workflow:'Security Gate',status:'completed',conclusion:'success',
  runner_id:42,runner_name:'GitHub Actions 42',
  steps:[{name:'checkout',conclusion:'success'},{name:'test',conclusion:'success'}]
}];
assert.equal(classifyGitHubJobs(healthy).health,'EXECUTING');

const outage=[
  {workflow:'Security Gate',status:'completed',conclusion:'failure',runner_id:0,runner_name:'',steps:[]},
  {workflow:'Identity Guard',status:'completed',conclusion:'failure',runner_id:0,runner_name:'',steps:[]}
];
assert.equal(classifyGitHubJobs(outage).health,'SYSTEMIC_PREEXECUTION_FAILURE');

// A successful historical canary cannot clear a newer runner-acquisition outage.
const oldSuccess={...healthy[0],created_at:'2026-10-12T10:00:00Z'};
const latestOutage=outage.map(job=>({...job,created_at:'2026-10-13T10:00:00Z'}));
for (const jobs of [[oldSuccess,...latestOutage],[...latestOutage,oldSuccess]]) {
  const current=classifyGitHubJobs(jobs);
  assert.equal(current.health,'SYSTEMIC_PREEXECUTION_FAILURE');
  assert.equal(current.productEvidenceAvailable,false);
  assert.equal(selectProofLane({githubJobs:jobs}).releaseGate,'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE');
}
assert.equal(classifyGitHubJobs([
  ...outage.map(job=>({...job,created_at:'2026-10-12T10:00:00Z'})),
  {...healthy[0],created_at:'2026-10-13T10:00:00Z'}
]).health,'EXECUTING');

const localLogic={
  id:'local-agent-node22',
  priority:10,
  available:true,
  preExisting:true,
  incrementalCostZero:true,
  customerImpactNone:true,
  isolated:true,
  productionWriteAuthority:false,
  modelVisibleReusableSecrets:false,
  supportsPortableProof:true,
  exactRuntime:false,
  logicEvidenceAllowed:true,
  releaseEvidenceAllowed:false
};

const logicOnly=selectProofLane({githubJobs:outage,alternatives:[localLogic]});
assert.equal(logicOnly.mode,'FAILOVER_LOGIC_ONLY');
assert.equal(logicOnly.logicLane,'local-agent-node22');
assert.equal(logicOnly.releaseLane,null);
assert.equal(logicOnly.releaseGate,'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE');
assert.equal(logicOnly.createNewResourcesAllowed,false);

const exactFree={
  ...localLogic,
  id:'preexisting-exact-node-worker',
  priority:5,
  exactRuntime:true,
  releaseEvidenceAllowed:true
};
const release=selectProofLane({githubJobs:outage,alternatives:[localLogic,exactFree]});
assert.equal(release.mode,'FAILOVER_RELEASE_AND_LOGIC');
assert.equal(release.releaseLane,'preexisting-exact-node-worker');
assert.equal(release.createNewResourcesAllowed,false);

const railwayUnknownCost={
  ...exactFree,
  id:'railway-existing-but-cost-unattested',
  priority:1,
  incrementalCostZero:false
};
const costGuard=selectProofLane({githubJobs:outage,alternatives:[railwayUnknownCost,localLogic]});
assert.equal(costGuard.mode,'FAILOVER_LOGIC_ONLY');
assert.equal(costGuard.logicLane,'local-agent-node22');

const customerRisk={...exactFree,id:'customer-shared-runner',priority:1,customerImpactNone:false};
const prodAuthority={...exactFree,id:'prod-capable-runner',priority:2,productionWriteAuthority:true};
const noUnsafe=selectProofLane({githubJobs:outage,alternatives:[customerRisk,prodAuthority]});
assert.equal(noUnsafe.mode,'NO_EXECUTION_LANE');
assert.equal(noUnsafe.releaseGate,'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE');
assert.equal(noUnsafe.createNewResourcesAllowed,false);
assert.equal(noUnsafe.continueNonExecutionEngineering,true);

const primary=selectProofLane({githubJobs:healthy,alternatives:[exactFree]});
assert.equal(primary.mode,'PRIMARY');
assert.equal(primary.releaseLane,'github-hosted');

console.log(JSON.stringify({
  schemaVersion:1,
  proof:'ci-provider-failover-policy',
  status:'PASS',
  detectsSystemicPreexecutionFailure:true,
  zeroCostAttestationRequired:true,
  preExistingLaneRequired:true,
  customerImpactMustBeNone:true,
  productionWriteAuthorityDenied:true,
  exactRuntimeRequiredForReleaseEvidence:true,
  logicCanContinueOnNonExactFreeLane:true,
  releaseFailsClosedWithoutExactFreeLane:true,
  automaticResourceCreationDenied:true
},null,2));
