'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessProofLane, simulatePreFreeze } = require('./pre-freeze-simulator.cjs');

function exactLane(overrides={}){
  return {
    id:'railway-a', provider:'railway', failureDomain:'railway:workspace-a', class:'exact-image',
    variableNames:['WFM_DB','WFM_HOSTED_STAGING'], hostedModeValue:'true',
    healthcheckPath:'/api/health', readinessMode:'condition', sourceSha:'sha-1',
    ...overrides
  };
}

test('rejects a hosted exact-image lane before freeze when runtime variables are missing', () => {
  const result = assessProofLane(exactLane({variableNames:[]}), {candidateSha:'sha-1'});
  assert.equal(result.admitted, false);
  assert.deepEqual(result.issues[0], {code:'RUNTIME_VARIABLE_CONTRACT_MISSING', missing:['WFM_DB','WFM_HOSTED_STAGING']});
});

test('rejects fixed readiness assumptions before they become flaky build waits', () => {
  const result = assessProofLane(exactLane({readinessMode:'attempt-count'}), {candidateSha:'sha-1'});
  assert.equal(result.admitted, false);
  assert.ok(result.issues.some(x => x.code === 'READINESS_NOT_CONDITION_BASED'));
});

test('rejects candidate identity drift before execution', () => {
  const result = assessProofLane(exactLane({sourceSha:'old-sha'}), {candidateSha:'sha-1'});
  assert.equal(result.admitted, false);
  assert.ok(result.issues.some(x => x.code === 'CANDIDATE_SHA_DRIFT'));
});

test('multiple lanes in the same provider failure domain do not count as independent resilience', () => {
  const result = simulatePreFreeze({
    candidateSha:'sha-1', requiredIndependentFailureDomains:2,
    lanes:[exactLane({id:'a'}), exactLane({id:'b'})]
  });
  assert.equal(result.candidateFreezeAdmitted, true);
  assert.equal(result.promotionTopologyReady, false);
  assert.equal(result.independentFailureDomains.length, 1);
  assert.equal(result.falseParallelism[0].laneCount, 2);
  assert.ok(result.actions.some(x => x.type === 'ADD_DISTINCT_FAILURE_DOMAIN'));
});

test('distinct admitted failure domains satisfy promotion topology', () => {
  const result = simulatePreFreeze({
    candidateSha:'sha-1', requiredIndependentFailureDomains:2,
    lanes:[
      exactLane({id:'railway',failureDomain:'railway:workspace-a'}),
      exactLane({id:'circleci',provider:'circleci',failureDomain:'circleci:org-a'})
    ]
  });
  assert.equal(result.candidateFreezeAdmitted, true);
  assert.equal(result.promotionTopologyReady, true);
  assert.deepEqual(new Set(result.independentFailureDomains), new Set(['railway:workspace-a','circleci:org-a']));
});

test('inadmissible overflow lanes are repaired before freeze and never counted as capacity', () => {
  const result = simulatePreFreeze({
    candidateSha:'sha-1',
    lanes:[
      exactLane({id:'canonical'}),
      exactLane({id:'bad-overflow', variableNames:['WFM_DB'], readinessMode:'condition'})
    ]
  });
  assert.deepEqual(result.admittedLaneIds, ['canonical']);
  assert.deepEqual(result.rejectedLaneIds, ['bad-overflow']);
  assert.ok(result.actions.some(x => x.type === 'REPAIR_LANE_BEFORE_FREEZE' && x.laneId === 'bad-overflow'));
});

test('pre-execution provider failure is excluded before it can count as proof capacity', () => {
  const result = simulatePreFreeze({
    candidateSha:'sha-1', requiredIndependentFailureDomains:2,
    lanes:[
      exactLane({id:'railway',failureDomain:'railway:a'}),
      exactLane({id:'github',provider:'github-actions',failureDomain:'github:repo',providerState:'PREEXECUTION_FAILURE'})
    ]
  });
  assert.deepEqual(result.admittedLaneIds,['railway']);
  assert.deepEqual(result.rejectedLaneIds,['github']);
  assert.equal(result.promotionTopologyReady,false);
  const repair=result.actions.find(x=>x.type==='REPAIR_LANE_BEFORE_FREEZE'&&x.laneId==='github');
  assert.equal(repair.routeAroundProvider,true);
  assert.ok(repair.issueCodes.includes('PROVIDER_DEGRADED_PREEXECUTION'));
});
