'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planNoIdleWait } = require('./no-idle-wait-orchestrator.cjs');

test('pending dependency never produces an idle wait state', () => {
  const plan = planNoIdleWait({
    dependency:{id:'railway-proof',status:'PENDING',kind:'provider'},
    independentWork:['golden-journey-preflight','tenant-attack-prep'],
    candidate:{sha:'abc123'},
    queue:{depth:4,arrivalPerMinute:2,drainPerMinute:1},
    availableLanes:[{id:'lane-a',status:'BUSY'}]
  });
  assert.equal(plan.idleWaitAllowed,false);
  assert.equal(plan.blockingState,false);
  assert.ok(plan.actions.some(x=>x.type==='SIMULATE_AHEAD'));
  assert.ok(plan.actions.some(x=>x.type==='CONTINUE_INDEPENDENT_WORK'));
  assert.ok(plan.actions.some(x=>x.type==='ROUTE_DISTINCT_FAILURE_DOMAIN'));
});

test('predicted queue saturation opens capacity before blocking', () => {
  const plan = planNoIdleWait({
    dependency:{id:'proof',status:'RUNNING',kind:'provider'},
    candidate:{sha:'def456'},
    queue:{depth:2,arrivalPerMinute:3,drainPerMinute:1},
    availableLanes:[{id:'lane-a',status:'BUSY'},{id:'lane-b',status:'BUSY'}]
  });
  assert.equal(plan.prediction.queueSaturationPredicted,true);
  const scale = plan.actions.find(x=>x.type==='ROUTE_DISTINCT_FAILURE_DOMAIN');
  assert.ok(scale);
  assert.equal(scale.trigger,'PREDICTED_SATURATION_WITHOUT_MEASURED_HEADROOM');
});

test('failed lane is isolated while other lanes continue', () => {
  const plan = planNoIdleWait({
    dependency:{id:'lane-c',status:'FAILED',kind:'proof-lane'},
    candidate:{sha:'ghi789'},
    availableLanes:[
      {id:'lane-a',status:'RUNNING'},
      {id:'lane-b',status:'RUNNING'},
      {id:'lane-c',status:'FAILED'}
    ]
  });
  assert.equal(plan.blockingState,false);
  assert.ok(plan.actions.some(x=>x.type==='ISOLATE_AND_REPAIR' && x.target==='lane-c'));
  assert.ok(plan.actions.some(x=>x.type==='KEEP_HEALTHY_LANES_RUNNING'));
});

test('insufficient evidence contains risk but still advances safe work', () => {
  const plan = planNoIdleWait({
    dependency:{id:'provider-evidence',status:'INSUFFICIENT_EVIDENCE',kind:'evidence'},
    candidate:{sha:'jkl012'},
    independentWork:['restart-recovery-simulation']
  });
  assert.equal(plan.promotionBlocked,true);
  assert.equal(plan.blockingState,false);
  assert.ok(plan.actions.some(x=>x.type==='CONTAIN_UNPROVEN_SCOPE'));
  assert.ok(plan.actions.some(x=>x.type==='SIMULATE_AHEAD'));
});

test('manager capacity scales with worker and lane pressure', () => {
  const plan = planNoIdleWait({
    dependency:{id:'proof',status:'PENDING',kind:'provider'},
    candidate:{sha:'mno345'},
    workers:{active:40,targetSpanPerManager:8},
    availableLanes:Array.from({length:9},(_,i)=>({id:`lane-${i}`,status:'BUSY'})),
    queue:{depth:9,arrivalPerMinute:4,drainPerMinute:1}
  });
  assert.ok(plan.capacity.requiredManagers >= 5);
  assert.ok(plan.capacity.requestedAdditionalLanes >= 1);
  assert.equal(plan.capacity.mode,'ELASTIC');
  assert.equal(plan.capacity.fixedLaneLimit,false);
  assert.equal(plan.capacity.fixedWorkerLimit,false);
  assert.equal(plan.capacity.fixedManagerLimit,false);
});

test('pre-freeze rejected lanes are excluded from elastic capacity', () => {
  const plan=planNoIdleWait({
    dependency:{id:'proof',status:'PENDING'},
    availableLanes:[{id:'good',status:'READY'},{id:'bad',status:'READY'}],
    preFreeze:{candidateSha:'sha',requiredIndependentFailureDomains:2,lanes:[
      {id:'good',provider:'railway',failureDomain:'railway:a',class:'exact-image',variableNames:['WFM_DB','WFM_HOSTED_STAGING','WFM_PUBLIC_ORIGIN','WFM_STAGING_PASSWORD','WFM_REQUIRE_DURABLE_STATE'],durableStateRequired:true,durableVolumeMountPath:'/data',durableVolumeWritable:true,applicationRuntimeUser:'node',hostedModeValue:'true',healthcheckPath:'/api/health',readinessMode:'condition',sourceSha:'sha',domain:'https://good.example',endpointReachable:true,healthcheckReady:true,listenAddress:'0.0.0.0',sleepApplication:false,deploymentStatus:'SUCCESS'},
      {id:'bad',provider:'railway',failureDomain:'railway:a',class:'exact-image',variableNames:[],hostedModeValue:'true',healthcheckPath:'/api/health',readinessMode:'condition',sourceSha:'sha',domain:'https://bad.example',endpointReachable:true,healthcheckReady:true,listenAddress:'0.0.0.0',sleepApplication:false,deploymentStatus:'SUCCESS'}
    ]}
  });
  assert.equal(plan.capacity.admittedLaneCount,1);
  assert.equal(plan.promotionBlocked,true);
  assert.ok(plan.actions.some(x=>x.type==='REPAIR_LANE_BEFORE_FREEZE'&&x.laneId==='bad'));
});

test('unknown provider headroom never creates same-domain overflow under saturation', () => {
  const plan=planNoIdleWait({
    dependency:{id:'railway-domain',status:'QUEUED',kind:'provider'},
    candidate:{sha:'sha'},
    queue:{depth:6,arrivalPerMinute:3,drainPerMinute:1,failureDomainHeadroomKnown:false},
    availableLanes:[{id:'a',status:'BUSY'},{id:'b',status:'BUSY'}]
  });
  assert.equal(plan.prediction.queueSaturationPredicted,true);
  assert.equal(plan.capacity.requestedSameDomainLanes,0);
  assert.equal(plan.capacity.sameFailureDomainScaleAllowed,false);
  assert.ok(plan.actions.some(x=>x.type==='ROUTE_DISTINCT_FAILURE_DOMAIN'));
  assert.ok(!plan.actions.some(x=>x.type==='PROVISION_THROUGHPUT_LANE'));
});

test('measured provider headroom can add throughput without pretending it adds resilience', () => {
  const plan=planNoIdleWait({
    dependency:{id:'railway-domain',status:'RUNNING',kind:'provider'},
    candidate:{sha:'sha'},
    queue:{depth:5,arrivalPerMinute:4,drainPerMinute:2,failureDomainHeadroomKnown:true,failureDomainHeadroom:2},
    availableLanes:[{id:'a',status:'BUSY'}]
  });
  assert.equal(plan.capacity.sameFailureDomainScaleAllowed,true);
  assert.equal(plan.capacity.requestedSameDomainLanes,2);
  const scale=plan.actions.find(x=>x.type==='PROVISION_THROUGHPUT_LANE');
  assert.equal(scale.requestedLanes,2);
  assert.equal(scale.countsAsIndependentResilience,false);
});
