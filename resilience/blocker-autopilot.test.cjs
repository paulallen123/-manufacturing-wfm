'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  classifyObservation,classifyWithBaseline,createPreventionCandidate,selectAlternativeLane,groupFailureBatch,fiveMinutePlan,createBlockerReceipt
}=require('./blocker-autopilot.cjs');

const policy={
  lanes:[
    {id:'github-actions-ui',provider:'github-actions',class:'supplemental',exactSourceSha:true,requiredForDevelopment:false},
    {id:'circleci-runtime',provider:'circleci',class:'exact-image',exactSourceSha:true,requiredForDevelopment:false},
    {id:'railway-forge-current-proof',provider:'railway',class:'exact-image',exactSourceSha:true,requiredForDevelopment:false}
  ],
  fallbackOrder:['railway-forge-current-proof','circleci-runtime','github-actions-ui']
};

test('GitHub no-runner is provider degradation, not a product failure',()=>{
  const c=classifyObservation({provider:'github-actions',kind:'github-job',conclusion:'failure',runnerId:0,steps:[]});
  assert.equal(c.failureClass,'PROVIDER_DEGRADED');
  assert.equal(c.proofState,'NO_RUNNER');
  assert.equal(c.reroute,true);
  assert.equal(c.productionAuthorityGranted,false);
});

test('SKIPPED is never proof',()=>{
  const c=classifyObservation({provider:'railway',deploymentStatus:'SKIPPED'});
  assert.equal(c.proofState,'SKIPPED');
  assert.equal(c.promotionBlocked,true);
  assert.equal(c.reroute,true);
});

test('Railway scheduling without product execution is capacity failure',()=>{
  const c=classifyObservation({provider:'railway',message:'scheduling build on Metal builder',productExecutionStarted:false});
  assert.equal(c.failureClass,'CAPACITY_OR_QUEUE');
  assert.equal(c.proofState,'INFRA_FAIL');
});

test('catalog mismatch is deterministic evidence drift',()=>{
  const c=classifyObservation({phase:'test',message:'Expected spec-verified but got discovery-queued for ifs-cloud'});
  assert.equal(c.failureClass,'EVIDENCE_OR_CATALOG_DRIFT');
  assert.equal(c.deterministic,true);
  assert.equal(c.reroute,false);
});

test('fixture ENOENT is test defect rather than product outage',()=>{
  const c=classifyObservation({phase:'test',message:"ENOENT /tmp/vector/repo/ux-overlay/vector-realtime.js"});
  assert.equal(c.failureClass,'TEST_DEFECT');
  assert.equal(c.retry,'FIX_TEST_OR_FIXTURE_THEN_REPROVE');
});

test('reproduced assertion is product defect and is not blind-retried',()=>{
  const c=classifyObservation({phase:'test',message:'AssertionError ERR_ASSERTION not ok 42',independentReproductions:2});
  assert.equal(c.failureClass,'PRODUCT_DEFECT');
  assert.equal(c.retry,'DO_NOT_BLIND_RETRY');
  assert.equal(c.reroute,false);
});

test('branch drift is detected before merge crisis',()=>{
  const c=classifyObservation({branchBehindCommits:21,branchDriftLimit:10});
  assert.equal(c.failureClass,'BRANCH_OR_CONVERGENCE_DRIFT');
  assert.equal(c.retry,'SYNC_THEN_REPROVE');
});

test('reroute excludes failed provider and keeps exact source binding',()=>{
  const c=classifyObservation({provider:'railway',deploymentStatus:'SKIPPED'});
  const lane=selectAlternativeLane(policy,c,{provider:'railway'});
  assert.equal(lane.laneId,'circleci-runtime');
  assert.equal(lane.exactSourceSha,true);
});

test('batching groups identical root causes',()=>{
  const groups=groupFailureBatch([
    {phase:'test',message:'Expected spec-verified for ifs-cloud sha abcdef1'},
    {phase:'test',message:'Expected spec-verified for ifs-cloud sha 1234567'}
  ]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].count,2);
});

test('five minute plan preserves fail-closed promotion',()=>{
  const c=classifyObservation({provider:'github-actions',kind:'github-job',conclusion:'failure',runnerId:0,steps:[]});
  const lane=selectAlternativeLane(policy,c,{provider:'github-actions'});
  const plan=fiveMinutePlan(c,lane);
  assert.ok(plan.byFiveMinutes.includes('keep production promotion fail-closed'));
});

test('receipt is tamper-evident and never carries production authority',()=>{
  const classification=classifyObservation({provider:'railway',deploymentStatus:'SKIPPED'});
  const receipt=createBlockerReceipt({
    candidateId:'a'.repeat(64),
    sourceSha:'abcdef1',
    observation:{provider:'railway',deploymentStatus:'SKIPPED'},
    classification,
    alternateLane:selectAlternativeLane(policy,classification,{provider:'railway'}),
    at:'2026-09-23T12:00:00.000Z'
  });
  assert.match(receipt.receiptDigest,/^[a-f0-9]{64}$/);
  assert.equal(receipt.productionMutation,false);
  assert.equal(receipt.productionAuthorityGranted,false);
});


test('guard cannot invent a capability floor above the canonical baseline',()=>{
  const observation={phase:'test',message:'Integration evidence continuity regression: overlays=57 required>=58'};
  const c=classifyWithBaseline(observation,{
    candidateOverlayFiles:57,
    canonicalOverlayFiles:57,
    declaredOverlayFloor:58,
    canonicalCapabilitySetPasses:true,
    candidateCapabilitySetPasses:true
  });
  assert.equal(c.failureClass,'PROOF_GUARD_DEFECT');
  assert.equal(c.proofState,'GUARD_FAIL');
  assert.equal(c.reason,'proof-guard-requires-more-than-canonical-baseline');
  assert.equal(c.productionAuthorityGranted,false);
});

test('real capability loss remains a product/evidence blocker',()=>{
  const observation={phase:'test',message:'Required provider evidence missing: ifs-cloud'};
  const c=classifyWithBaseline(observation,{
    candidateOverlayFiles:57,
    canonicalOverlayFiles:57,
    declaredOverlayFloor:58,
    canonicalCapabilitySetPasses:true,
    candidateCapabilitySetPasses:false
  });
  assert.equal(c.failureClass,'EVIDENCE_OR_CATALOG_DRIFT');
  assert.equal(c.promotionBlocked,true);
});

test('prevention learning is review-only and cannot self-authorise',()=>{
  const observation={phase:'test',message:'Integration evidence continuity regression: overlays=57 required>=58'};
  const baseline={
    candidateOverlayFiles:57,
    canonicalOverlayFiles:57,
    declaredOverlayFloor:58,
    canonicalCapabilitySetPasses:true,
    candidateCapabilitySetPasses:true
  };
  const c=classifyWithBaseline(observation,baseline);
  const prevention=createPreventionCandidate({classification:c,observation,baseline});
  assert.equal(prevention.proposedControl,'prefer-effective-capability-set-over-repository-shape');
  assert.equal(prevention.status,'REVIEW_REQUIRED');
  assert.equal(prevention.autoApply,false);
  assert.equal(prevention.productionMutation,false);
  assert.equal(prevention.productionAuthorityGranted,false);
});
