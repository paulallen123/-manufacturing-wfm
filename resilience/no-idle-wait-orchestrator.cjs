'use strict';

const { simulatePreFreeze } = require('./pre-freeze-simulator.cjs');
const WAIT_LIKE = new Set(['PENDING','WAITING','QUEUED','RUNNING','BUILDING','DEPLOYING','NEEDS_APPROVAL']);
const FAILURE_LIKE = new Set(['FAILED','CRASHED','ERROR','CANCELLED']);
const EVIDENCE_BLOCK = new Set(['INSUFFICIENT_EVIDENCE','STALE','EXPIRED','NO_PROOF']);

function n(v, fallback=0){
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : fallback;
}

function ceilDiv(a,b){ return Math.ceil(a / Math.max(1,b)); }

function planNoIdleWait(input={}){
  const dependency = input.dependency || {id:'unknown',status:'UNKNOWN',kind:'unknown'};
  const status = String(dependency.status || 'UNKNOWN').toUpperCase();
  const lanes = Array.isArray(input.availableLanes) ? input.availableLanes : [];
  const independentWork = Array.isArray(input.independentWork) ? input.independentWork.filter(Boolean) : [];
  const queue = input.queue || {};
  const workers = input.workers || {};
  const preFreeze = input.preFreeze ? simulatePreFreeze(input.preFreeze) : null;
  const capacityLanes = preFreeze
    ? lanes.filter(lane => preFreeze.admittedLaneIds.includes(lane.id))
    : lanes;

  const depth = n(queue.depth);
  const arrival = n(queue.arrivalPerMinute);
  const drain = n(queue.drainPerMinute);
  const netGrowth = Math.max(0, arrival - drain);
  const idleLaneCount = capacityLanes.filter(l=>['IDLE','READY','AVAILABLE'].includes(String(l.status||'').toUpperCase())).length;
  const allBusy = capacityLanes.length > 0 && idleLaneCount === 0;
  const queueSaturationPredicted = netGrowth > 0 || (depth > 0 && allBusy);
  const requestedAdditionalLanes = queueSaturationPredicted
    ? Math.max(1, Math.ceil((depth + netGrowth) / Math.max(1, drain || 1)) - idleLaneCount)
    : 0;
  const failureDomainHeadroomKnown = queue.failureDomainHeadroomKnown === true;
  const failureDomainHeadroom = failureDomainHeadroomKnown ? n(queue.failureDomainHeadroom) : 0;
  const sameFailureDomainScaleAllowed = failureDomainHeadroomKnown && failureDomainHeadroom > 0;
  const requestedSameDomainLanes = queueSaturationPredicted && sameFailureDomainScaleAllowed
    ? Math.min(requestedAdditionalLanes, failureDomainHeadroom)
    : 0;

  const activeWorkers = n(workers.active, capacityLanes.length);
  const span = Math.max(1, n(workers.targetSpanPerManager, 8));
  const requiredManagers = Math.max(1, ceilDiv(Math.max(activeWorkers, capacityLanes.length), span));

  const actions = [];
  actions.push(Object.freeze({
    type:'SIMULATE_AHEAD',
    target:dependency.id || 'dependency',
    scenarios:Object.freeze(['SUCCESS','PRODUCT_FAILURE','PROVIDER_FAILURE','SECURITY_OR_INTEGRITY_FAILURE','ROLLBACK_OR_RECOVERY_REQUIRED']),
    bindCandidateSha:input.candidate?.sha || null
  }));

  if (preFreeze) {
    for (const action of preFreeze.actions) actions.push(Object.freeze({...action}));
  }

  if (independentWork.length) {
    actions.push(Object.freeze({type:'CONTINUE_INDEPENDENT_WORK',work:Object.freeze([...independentWork])}));
  }

  if (requestedSameDomainLanes > 0) {
    actions.push(Object.freeze({
      type:'PROVISION_THROUGHPUT_LANE',
      trigger:'MEASURED_FAILURE_DOMAIN_HEADROOM',
      requestedLanes:requestedSameDomainLanes,
      exactCandidateSha:input.candidate?.sha || null,
      countsAsIndependentResilience:false,
      equivalentProofRequired:true,
      weakerEvidenceMaySubstitute:false
    }));
  }

  if ((queueSaturationPredicted && !sameFailureDomainScaleAllowed) || WAIT_LIKE.has(status)) {
    actions.push(Object.freeze({
      type:'ROUTE_DISTINCT_FAILURE_DOMAIN',
      trigger:queueSaturationPredicted ? 'PREDICTED_SATURATION_WITHOUT_MEASURED_HEADROOM' : 'DEPENDENCY_PENDING',
      requestedAdditionalLanes:Math.max(1, requestedAdditionalLanes),
      exactCandidateSha:input.candidate?.sha || null,
      equivalentProofRequired:true,
      distinctFailureDomainRequired:true,
      weakerEvidenceMaySubstitute:false
    }));
  }

  if (FAILURE_LIKE.has(status)) {
    actions.push(Object.freeze({type:'ISOLATE_AND_REPAIR',target:dependency.id || 'dependency',preserveEvidence:true}));
    if (capacityLanes.some(l => !FAILURE_LIKE.has(String(l.status||'').toUpperCase()))) {
      actions.push(Object.freeze({type:'KEEP_HEALTHY_LANES_RUNNING'}));
    }
  }

  if (EVIDENCE_BLOCK.has(status)) {
    actions.push(Object.freeze({type:'CONTAIN_UNPROVEN_SCOPE',target:dependency.id || 'dependency',promotionBlocked:true}));
  }

  actions.push(Object.freeze({
    type:'PREPARE_NEXT_STATE',
    target:dependency.id || 'dependency',
    includes:Object.freeze(['preflight','fix-candidate','rollback-plan','recovery-plan','downstream-proof-inputs'])
  }));

  return Object.freeze({
    contract:'VECTOR_NO_IDLE_WAIT_V1',
    idleWaitAllowed:false,
    blockingState:false,
    simulationAheadRequired:true,
    promotionBlocked:EVIDENCE_BLOCK.has(status) || FAILURE_LIKE.has(status) || Boolean(preFreeze && !preFreeze.promotionTopologyReady),
    preFreeze,
    prediction:Object.freeze({
      queueSaturationPredicted,
      queueDepth:depth,
      arrivalPerMinute:arrival,
      drainPerMinute:drain,
      netGrowthPerMinute:netGrowth,
      failureDomainHeadroomKnown,
      failureDomainHeadroom
    }),
    capacity:Object.freeze({
      mode:'ELASTIC',
      fixedLaneLimit:false,
      fixedWorkerLimit:false,
      fixedManagerLimit:false,
      admittedLaneCount:capacityLanes.length,
      independentFailureDomainCount:preFreeze ? preFreeze.independentFailureDomains.length : null,
      requestedAdditionalLanes,
      requestedSameDomainLanes,
      sameFailureDomainScaleAllowed,
      requiredManagers,
      targetWorkersPerManager:span
    }),
    safety:Object.freeze({
      exactCandidateIdentityRequired:true,
      tenantSecurityPayrollAuditRollbackGatesMayNotWeaken:true,
      simulationNeverCountsAsProductionProof:true,
      skippedOrStaleEvidenceNeverCountsAsPass:true,
      falseParallelismNeverCountsAsIndependentCapacity:true,
      unknownFailureDomainHeadroomNeverCreatesOverflow:true
    }),
    actions:Object.freeze(actions)
  });
}

module.exports = { planNoIdleWait };
