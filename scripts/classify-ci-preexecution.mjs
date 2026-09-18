import fs from 'node:fs';

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

function runnerAssigned(job) {
  return Boolean(job.runner_id && job.runner_id !== 0) || Boolean(String(job.runner_name ?? '').trim());
}

export function classifyJob(job) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const duration_seconds = secondsBetween(job.started_at, job.completed_at);
  const base = {
    workflow: job.workflow_name ?? job.workflow ?? '<unknown>',
    job: job.name ?? '<unknown>',
    run_id: job.run_id ?? null,
    job_id: job.id ?? job.job_id ?? null,
    run_attempt: job.run_attempt ?? null,
    status: job.status ?? null,
    conclusion: job.conclusion ?? null,
    steps: steps.length,
    runner_assigned: runnerAssigned(job),
    duration_seconds
  };

  if (job.status === 'completed' && job.conclusion === 'failure' && steps.length === 0 && !runnerAssigned(job)) {
    return { ...base, class: 'PREEXECUTION_FAILURE', product_evidence: 'NOT_EVALUATED' };
  }
  if (job.status === 'completed' && job.conclusion === 'failure' && steps.length === 0 && runnerAssigned(job)) {
    return { ...base, class: 'RUNNER_BOOTSTRAP_OR_METADATA_FAILURE', product_evidence: 'NOT_EVALUATED' };
  }
  if (job.status === 'completed' && job.conclusion === 'failure' && steps.length > 0) {
    return { ...base, class: 'EXECUTED_FAILURE', product_evidence: 'AVAILABLE' };
  }
  if (job.status === 'completed' && job.conclusion === 'success' && steps.length > 0) {
    return { ...base, class: 'EXECUTED_SUCCESS', product_evidence: 'AVAILABLE' };
  }
  if (job.status === 'completed' && ['cancelled', 'skipped', 'neutral'].includes(job.conclusion)) {
    return { ...base, class: 'NON_EXECUTED_OTHER', product_evidence: 'NOT_EVALUATED' };
  }
  return { ...base, class: 'UNCLASSIFIED', product_evidence: 'UNKNOWN' };
}

export function classifyCiEvidence(input) {
  const classified = (input.jobs ?? []).map(classifyJob);
  const pre = classified.filter(j => j.class === 'PREEXECUTION_FAILURE');
  const uniqueWorkflows = new Set(pre.map(j => j.workflow));
  const attemptsByWorkflow = new Map();
  for (const j of pre) {
    const key = j.workflow;
    const attempts = attemptsByWorkflow.get(key) ?? new Set();
    if (j.run_attempt != null) attempts.add(j.run_attempt);
    attemptsByWorkflow.set(key, attempts);
  }
  const persistentWorkflowRetries = [...attemptsByWorkflow.entries()]
    .filter(([, attempts]) => attempts.size >= 2)
    .map(([workflow]) => workflow);
  const durations = pre.map(j => j.duration_seconds).filter(Number.isFinite);
  const meanPreexecutionSeconds = durations.length
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2))
    : null;
  const systemic = uniqueWorkflows.size >= 2;
  const persistent = persistentWorkflowRetries.length > 0;

  let classification = 'NO_PREEXECUTION_PATTERN';
  let cause = 'NOT_APPLICABLE';
  let release_gate = 'USE_NORMAL_CI_RESULT';
  let product_regression = 'EVALUATE_EXECUTED_EVIDENCE';
  if (pre.length === 1) {
    classification = 'ISOLATED_PREEXECUTION_FAILURE';
    cause = 'UNKNOWN_PREEXECUTION_CAUSE';
    release_gate = 'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE';
    product_regression = 'NOT_EVALUATED';
  }
  if (pre.length > 1) {
    classification = systemic ? 'SYSTEMIC_CI_PREEXECUTION_FAILURE' : 'REPEATED_PREEXECUTION_FAILURE';
    cause = systemic ? 'UNKNOWN_REPOSITORY_ACCOUNT_OR_PROVIDER_CONTROL_PLANE' : 'UNKNOWN_WORKFLOW_OR_CONTROL_PLANE';
    release_gate = 'FAIL_CLOSED_CI_EVIDENCE_UNAVAILABLE';
    product_regression = 'NOT_EVALUATED';
  }

  return {
    schema: 'wfm.ci-preexecution-classification.v1',
    classification,
    cause,
    release_gate,
    product_regression,
    systemic,
    persistent_retry_reproduction: persistent,
    affected_workflows: [...uniqueWorkflows].sort(),
    persistent_workflow_retries: persistentWorkflowRetries.sort(),
    metrics: {
      jobs_examined: classified.length,
      preexecution_failures: pre.length,
      unique_affected_workflows: uniqueWorkflows.size,
      mean_preexecution_detection_seconds: meanPreexecutionSeconds
    },
    prevention_coverage: {
      distinguishes_preexecution_from_executed_product_test_failure: true,
      correlates_across_unrelated_workflows: true,
      detects_retry_reproduction: true
    },
    recovery: pre.length ? {
      quality: 'UNVERIFIED',
      safe_rule: 'Do not infer product regression or release readiness from pre-execution failures. Keep release gates fail-closed until normal step execution resumes.',
      required_evidence: [
        'A previously affected critical workflow is assigned a runner and executes steps normally.',
        'A second unrelated critical workflow executes normally, ruling out a single-workflow recovery.',
        'Security and identity release gates complete on the candidate without bypass or weakened policy.'
      ]
    } : { quality: 'NOT_REQUIRED', required_evidence: [] },
    jobs: classified
  };
}

function runFixtures(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let failed = 0;
  for (const c of data.cases ?? []) {
    const result = classifyCiEvidence(c.input);
    const checks = [
      result.classification === c.expected.classification,
      c.expected.systemic == null || result.systemic === c.expected.systemic,
      c.expected.persistent_retry_reproduction == null || result.persistent_retry_reproduction === c.expected.persistent_retry_reproduction,
      !c.expected.release_gate || result.release_gate === c.expected.release_gate,
      !c.expected.product_regression || result.product_regression === c.expected.product_regression
    ];
    const ok = checks.every(Boolean);
    console.log(`CI_PREEXEC_FIXTURE=${c.name}|expected=${c.expected.classification}|actual=${result.classification}|systemic=${result.systemic}|persistent=${result.persistent_retry_reproduction}|${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`CI_PREEXEC_FIXTURES=FAIL|failed=${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`CI_PREEXEC_FIXTURES=PASS|cases=${data.cases.length}`);
  }
}

function runClassify(file) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(classifyCiEvidence(input), null, 2));
}

const args = process.argv.slice(2);
if (args[0] === '--fixtures' && args[1]) runFixtures(args[1]);
else if (args[0] === '--classify' && args[1]) runClassify(args[1]);
else {
  console.error('Usage: node scripts/classify-ci-preexecution.mjs --fixtures <json> | --classify <json>');
  process.exitCode = 2;
}
