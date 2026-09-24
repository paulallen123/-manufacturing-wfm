#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const p=JSON.parse(fs.readFileSync(new URL('../release/proof-lane-policy.json',import.meta.url),'utf8'));
assert.equal(p.schemaVersion,1);
assert.equal(p.name,'VECTOR_PROOF_LANE_INDEPENDENCE_V1');
assert.equal(p.rules.neverSkipTestsToUnblock,true);
assert.equal(p.rules.skippedNeverCountsAsPass,true);
assert.equal(p.rules.noRunnerNeverCountsAsProductFailure,true);
assert.equal(p.rules.providerFailureNeverCountsAsPass,true);
assert.equal(p.rules.exactSourceShaRequired,true);
assert.equal(p.rules.immutableEvidenceRequired,true);
assert.equal(p.rules.developmentContinuesIfAnyExecutableLaneExists,true);
assert.ok(Number(p.rules.productionPromotionRequiresIndependentProviders)>=2);
assert.equal(p.rules.noIdleWaitAllowed,true);
assert.equal(p.rules.simulateAheadOnEveryPendingDependency,true);
assert.equal(p.rules.predictQueueSaturationBeforeBlock,true);
assert.equal(p.rules.provisionEquivalentLaneBeforeSaturation,true);
assert.equal(p.rules.fixedLaneLimit,false);
assert.equal(p.rules.fixedWorkerLimit,false);
assert.equal(p.rules.fixedManagerLimit,false);
assert.equal(p.rules.failedLaneMustNotBlockHealthyLanes,true);
assert.equal(p.rules.simulationNeverCountsAsProductionProof,true);
assert.equal(p.rules.weakerEvidenceMayNotSubstitute,true);
assert.equal(p.rules.proofDeploysRequireExplicitFreezeTrigger,true);
assert.equal(p.rules.preFreezeSimulationRequired,true);
assert.equal(p.rules.sharedFailureDomainNeverCountsAsIndependent,true);
assert.equal(p.rules.fixedReadinessWindowsForbidden,true);
assert.equal(p.rules.liveRuntimeContractRequiredBeforeLaneAdmission,true);
assert.equal(p.rules.confirmedFailuresBecomeRegressionRules,true);
assert.equal(p.orchestration?.preFreezeAdmission?.required,true);
assert.equal(p.orchestration?.preFreezeAdmission?.simulatorContract,'VECTOR_PRE_FREEZE_SIMULATION_V1');
assert.equal(p.orchestration?.preFreezeAdmission?.rejectInadmissibleLanesBeforeFreeze,true);
assert.equal(p.orchestration?.preFreezeAdmission?.sharedFailureDomainsCountOnce,true);
assert.equal(p.orchestration?.preFreezeAdmission?.fixedReadinessWindowsForbidden,true);
assert.equal(p.orchestration?.preFreezeAdmission?.liveConfigMustMatchContract,true);
assert.equal(p.orchestration?.preFreezeAdmission?.confirmedFailuresBecomeRegressionRules,true);
assert.equal(p.orchestration?.contract,'VECTOR_NO_IDLE_WAIT_V1');
assert.equal(p.orchestration?.idleWaitState,'FORBIDDEN');
assert.equal(p.orchestration?.capacityMode,'ELASTIC');
assert.equal(p.orchestration?.softwareImposedLaneLimit,null);
assert.equal(p.orchestration?.softwareImposedWorkerLimit,null);
assert.equal(p.orchestration?.softwareImposedManagerLimit,null);
assert.equal(p.orchestration?.providerAndAccountLimitsStillApply,true);

const ids=new Set(),providers=new Set(),failureDomains=new Set(),promotionFailureDomains=new Set();
let exactImage=0;
for(const lane of p.lanes||[]){
  assert.ok(lane.id&&lane.provider&&lane.class);
  assert.ok(!ids.has(lane.id),'Duplicate proof lane: '+lane.id);ids.add(lane.id);
  providers.add(lane.provider);
  assert.ok(lane.failureDomain,'Every proof lane must declare a failure domain: '+lane.id);
  failureDomains.add(lane.failureDomain);
  if(lane.requiredForPromotion) promotionFailureDomains.add(lane.failureDomain);
  assert.equal(lane.exactSourceSha,true,'Every proof lane must bind the exact source SHA: '+lane.id);
  if(lane.class==='exact-image') {
    exactImage++;
    assert.ok(lane.runtimeContract,'Exact-image lane missing runtime contract: '+lane.id);
    assert.equal(lane.runtimeContract.healthcheckPath,'/api/health');
    assert.equal(lane.runtimeContract.readinessMode,'condition');
    if(lane.provider==='railway'){
      assert.equal(lane.runtimeContract.hostedModeRequired,true);
      assert.ok(lane.runtimeContract.requiredVariables.includes('WFM_DB'));
      assert.ok(lane.runtimeContract.requiredVariables.includes('WFM_HOSTED_STAGING'));
    }
  }
  if(lane.provider==='railway'&&lane.class==='exact-image'){
    assert.equal(lane.watchPattern,'artifact/vector-proof-freeze.trigger');
    assert.equal(lane.triggerMode,'explicit-frozen-candidate');
  }
}
assert.ok(providers.size>=3,'Proof topology must span at least three providers/signals.');
assert.ok(exactImage>=2,'At least two exact-image lanes are required.');
assert.ok(promotionFailureDomains.size>=2,'Promotion topology must span at least two independent failure domains.');
for(const id of p.fallbackOrder||[]) assert.ok(ids.has(id),'Unknown fallback lane: '+id);
assert.match(p.developmentRule,/Continue coding/);
assert.match(p.promotionRule,/two providers/);
console.log('VECTOR_PROOF_LANE_INDEPENDENCE=PASS providers='+providers.size+' exactImageLanes='+exactImage);
