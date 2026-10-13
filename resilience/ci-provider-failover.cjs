'use strict';

function runnerAssigned(job) {
  return Boolean(job?.runner_id && job.runner_id !== 0) || Boolean(String(job?.runner_name || '').trim());
}

function classifyGitHubJobs(jobs = []) {
  // Only the newest attempt can establish current runner availability. If
  // attempts cannot be ordered, a pre-execution failure takes precedence.
  const times = jobs.map((job) => Date.parse(job?.created_at || ''));
  const ordered = jobs.length > 0 && times.every(Number.isFinite);
  const latest = ordered ? Math.max(...times) : null;
  const currentJobs = ordered ? jobs.filter((_, index) => times[index] === latest) : jobs;
  const classified = currentJobs.map((job) => {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    if (job.status === 'completed' && job.conclusion === 'failure' && steps.length === 0 && !runnerAssigned(job)) {
      return { ...job, class: 'PREEXECUTION_FAILURE' };
    }
    if (job.status === 'completed' && job.conclusion === 'success' && steps.length > 0 && runnerAssigned(job)) {
      return { ...job, class: 'EXECUTED_SUCCESS' };
    }
    if (job.status === 'completed' && job.conclusion === 'failure' && steps.length > 0 && runnerAssigned(job)) {
      return { ...job, class: 'EXECUTED_FAILURE' };
    }
    return { ...job, class: 'OTHER' };
  });

  const pre = classified.filter((j) => j.class === 'PREEXECUTION_FAILURE');
  const executed = classified.filter((j) => j.class === 'EXECUTED_SUCCESS' || j.class === 'EXECUTED_FAILURE');
  const workflows = new Set(pre.map((j) => j.workflow || j.workflow_name || j.name || '<unknown>'));

  if (executed.length > 0 && (ordered || pre.length === 0)) {
    return {
      health: 'EXECUTING',
      provider: 'github-hosted',
      preexecutionFailures: pre.length,
      uniqueAffectedWorkflows: workflows.size,
      productEvidenceAvailable: true,
    };
  }
  if (pre.length > 0) {
    return {
      health: workflows.size >= 2 ? 'SYSTEMIC_PREEXECUTION_FAILURE' : 'PREEXECUTION_FAILURE',
      provider: 'github-hosted',
      preexecutionFailures: pre.length,
      uniqueAffectedWorkflows: workflows.size,
      productEvidenceAvailable: false,
    };
  }
  return {
    health: 'UNKNOWN_OR_IDLE',
    provider: 'github-hosted',
    preexecutionFailures: 0,
    uniqueAffectedWorkflows: 0,
    productEvidenceAvailable: false,
  };
}

function eligibleBase(lane) {
  return lane &&
    lane.available === true &&
    lane.preExisting === true &&
    lane.incrementalCostZero === true &&
    lane.customerImpactNone === true &&
    lane.isolated === true &&
    lane.productionWriteAuthority === false &&
    lane.modelVisibleReusableSecrets === false &&
    lane.supportsPortableProof === true;
}

function byPriority(a,b) {
  return Number(a.priority ?? 100) - Number(b.priority ?? 100);
}

function selectProofLane({ githubJobs = [], alternatives = [] } = {}) {
  const github = classifyGitHubJobs(githubJobs);

  if (github.health === 'EXECUTING') {
    return {
      mode: 'PRIMARY',
      logicLane: 'github-hosted',
      releaseLane: 'github-hosted',
      releaseGate: 'USE_NORMAL_CI_RESULT',
      createNewResourcesAllowed: false,
      reason: 'github-runner-executing',
      github,
    };
  }

  const safe = alternatives.filter(eligibleBase).sort(byPriority);
  const release = safe.find((lane) => lane.exactRuntime === true && lane.releaseEvidenceAllowed === true);
  const logic = safe.find((lane) => lane.logicEvidenceAllowed === true);

  if (release) {
    return {
      mode: 'FAILOVER_RELEASE_AND_LOGIC',
      logicLane: release.id,
      releaseLane: release.id,
      releaseGate: 'USE_FAILOVER_EXACT_RUNTIME_EVIDENCE',
      createNewResourcesAllowed: false,
      reason: 'github-preexecution-unavailable-zero-cost-exact-runtime-failover-selected',
      github,
    };
  }

  if (logic) {
    return {
      mode: 'FAILOVER_LOGIC_ONLY',
      logicLane: logic.id,
      releaseLane: null,
      releaseGate: 'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE',
      createNewResourcesAllowed: false,
      reason: 'continue-zero-cost-logic-proof-but-no-exact-runtime-release-lane',
      github,
    };
  }

  return {
    mode: 'NO_EXECUTION_LANE',
    logicLane: null,
    releaseLane: null,
    releaseGate: 'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE',
    createNewResourcesAllowed: false,
    continueNonExecutionEngineering: true,
    reason: 'no-preexisting-zero-incremental-cost-safe-proof-lane',
    github,
  };
}

module.exports = { classifyGitHubJobs, selectProofLane };
