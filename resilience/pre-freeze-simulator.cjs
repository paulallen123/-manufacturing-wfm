'use strict';

const DEFAULT_RUNTIME_VARS = Object.freeze(['WFM_DB', 'WFM_HOSTED_STAGING', 'WFM_PUBLIC_ORIGIN', 'WFM_STAGING_PASSWORD']);
const FIXED_READINESS_MODES = new Set(['fixed', 'sleep', 'delay', 'attempt-count']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function assessProofLane(lane = {}, options = {}) {
  const issues = [];
  const candidateSha = options.candidateSha || null;
  const providerState = String(lane.providerState || 'AVAILABLE').toUpperCase();
  const exactImage = lane.class === 'exact-image';
  const vars = new Set(Array.isArray(lane.variableNames) ? lane.variableNames : []);
  const requiredVars = Array.isArray(lane.requiredRuntimeVariables)
    ? lane.requiredRuntimeVariables
    : (exactImage ? DEFAULT_RUNTIME_VARS : []);

  if (!lane.id) issues.push({code:'LANE_ID_MISSING'});
  if (!lane.provider) issues.push({code:'PROVIDER_MISSING'});
  if (!lane.failureDomain) issues.push({code:'FAILURE_DOMAIN_MISSING'});
  if (['DEGRADED','UNAVAILABLE','NO_RUNNER','PREEXECUTION_FAILURE'].includes(providerState)) {
    issues.push({code:'PROVIDER_DEGRADED_PREEXECUTION', providerState});
  }

  if (exactImage) {
    const missing = requiredVars.filter(name => !vars.has(name));
    if (missing.length) issues.push({code:'RUNTIME_VARIABLE_CONTRACT_MISSING', missing});
    if (lane.hostedModeValue != null && String(lane.hostedModeValue) !== 'true') {
      issues.push({code:'HOSTED_MODE_NOT_ENABLED'});
    }
    if (lane.healthcheckPath && lane.healthcheckPath !== '/api/health') {
      issues.push({code:'HEALTHCHECK_CONTRACT_MISMATCH', actual:lane.healthcheckPath});
    }
    if (lane.publicProofRequired === true && !lane.domain) {
      issues.push({code:'PUBLIC_ENDPOINT_MISSING'});
    }
    const readinessMode = String(lane.readinessMode || '').toLowerCase();
    if (!readinessMode || FIXED_READINESS_MODES.has(readinessMode)) {
      issues.push({code:'READINESS_NOT_CONDITION_BASED', actual:lane.readinessMode || null});
    }
    if (lane.sourceSha && candidateSha && lane.sourceSha !== candidateSha) {
      issues.push({code:'CANDIDATE_SHA_DRIFT', expected:candidateSha, actual:lane.sourceSha});
    }
  }

  return Object.freeze({
    id: lane.id || null,
    provider: lane.provider || null,
    failureDomain: lane.failureDomain || null,
    class: lane.class || null,
    admitted: issues.length === 0,
    issues: Object.freeze(issues)
  });
}

function simulatePreFreeze(input = {}) {
  const lanes = Array.isArray(input.lanes) ? input.lanes : [];
  const candidateSha = input.candidateSha || null;
  const requiredDomains = Math.max(1, Number(input.requiredIndependentFailureDomains || 2));
  const assessments = lanes.map(lane => assessProofLane(lane, {candidateSha}));
  const admitted = assessments.filter(x => x.admitted);
  const rejected = assessments.filter(x => !x.admitted);
  const exactAdmitted = admitted.filter(x => x.class === 'exact-image');
  const failureDomains = unique(admitted.map(x => x.failureDomain));

  const domainCounts = new Map();
  for (const item of admitted) domainCounts.set(item.failureDomain, (domainCounts.get(item.failureDomain) || 0) + 1);
  const falseParallelism = [...domainCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([failureDomain, count]) => ({failureDomain, laneCount:count}));

  const candidateFreezeAdmitted = exactAdmitted.length > 0;
  const promotionTopologyReady = candidateFreezeAdmitted && failureDomains.length >= requiredDomains;
  const actions = [];

  for (const item of rejected) {
    actions.push({
      type:'REPAIR_LANE_BEFORE_FREEZE',
      laneId:item.id,
      issueCodes:item.issues.map(issue => issue.code),
      routeAroundProvider:item.issues.some(issue => issue.code === 'PROVIDER_DEGRADED_PREEXECUTION')
    });
  }
  if (falseParallelism.length) {
    actions.push({
      type:'ADD_DISTINCT_FAILURE_DOMAIN',
      reason:'FALSE_PARALLELISM_SHARED_FAILURE_DOMAIN',
      groups:falseParallelism
    });
  }
  if (!candidateFreezeAdmitted) {
    actions.push({type:'BLOCK_FREEZE', reason:'NO_ADMITTED_EXACT_IMAGE_LANE'});
  }
  if (!promotionTopologyReady) {
    actions.push({
      type:'KEEP_PROMOTION_BLOCKED',
      reason:'INSUFFICIENT_INDEPENDENT_FAILURE_DOMAINS',
      required:requiredDomains,
      observed:failureDomains.length
    });
  }

  return Object.freeze({
    contract:'VECTOR_PRE_FREEZE_SIMULATION_V1',
    candidateSha,
    idleWaitAllowed:false,
    assessments:Object.freeze(assessments),
    admittedLaneIds:Object.freeze(admitted.map(x => x.id)),
    rejectedLaneIds:Object.freeze(rejected.map(x => x.id)),
    independentFailureDomains:Object.freeze(failureDomains),
    falseParallelism:Object.freeze(falseParallelism),
    candidateFreezeAdmitted,
    promotionTopologyReady,
    actions:Object.freeze(actions)
  });
}

module.exports = { assessProofLane, simulatePreFreeze, DEFAULT_RUNTIME_VARS };
