function asEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return Date.parse(value);
}

function worst(a, b) {
  const rank = { healthy: 0, degraded: 1, blocked: 2 };
  return rank[b] > rank[a] ? b : a;
}

function actionFor(reasons) {
  if (reasons.some((r) => r.code === 'authority_conflict')) return 'Resolve data ownership conflict before accepting more records.';
  if (reasons.some((r) => r.code === 'reconciliation_failed')) return 'Reconcile staged and source records before resuming normal operation.';
  if (reasons.some((r) => r.code === 'recovery_exhausted' || r.code === 'quarantined')) return 'Review the failed item, correct the cause, then use the controlled replay path.';
  if (reasons.some((r) => r.code === 'freshness_breached')) return 'Check provider reachability and recovery; keep the connection marked stale until a successful refresh completes.';
  if (reasons.some((r) => r.code === 'latency_breached')) return 'Check transport backlog and provider response time before widening the latency target.';
  if (reasons.some((r) => r.code === 'retrying' || r.code === 'recent_failure')) return 'Allow bounded recovery to continue and confirm reconciliation after success.';
  return 'No action required.';
}

export function evaluateConnectionRuntimeHealth(profile, runtime, now = Date.now()) {
  const reasons = [];
  let state = 'healthy';
  const freshnessSeconds = profile?.monitoring?.freshnessSeconds;
  const latencyBudgetMs = profile?.monitoring?.latencyBudgetMs;

  if (typeof freshnessSeconds !== 'number' || !Number.isFinite(freshnessSeconds) || freshnessSeconds <= 0) {
    return {
      state: 'blocked',
      reasons: [{ code: 'invalid_monitoring_policy', message: 'Freshness monitoring is not configured safely.' }],
      nextAction: 'Configure a positive freshness target before relying on runtime health.',
      metrics: { freshnessAgeMs: null, observedLagMs: null }
    };
  }

  if (latencyBudgetMs !== undefined && (typeof latencyBudgetMs !== 'number' || !Number.isFinite(latencyBudgetMs) || latencyBudgetMs <= 0)) {
    reasons.push({ code: 'invalid_latency_budget', message: 'Latency budget must be a positive number when configured.' });
    state = 'blocked';
  }

  const lastSuccess = asEpoch(runtime?.lastSuccessfulSyncAt);
  const nowEpoch = asEpoch(now);
  let freshnessAgeMs = null;
  if (!Number.isFinite(lastSuccess) || !Number.isFinite(nowEpoch) || lastSuccess > nowEpoch) {
    reasons.push({ code: 'invalid_freshness_evidence', message: 'Last successful refresh time is missing or invalid.' });
    state = 'blocked';
  } else {
    freshnessAgeMs = nowEpoch - lastSuccess;
    if (freshnessAgeMs > freshnessSeconds * 1000) {
      reasons.push({ code: 'freshness_breached', message: 'Connection data is older than the approved freshness target.' });
      state = worst(state, 'degraded');
    }
  }

  const observedLagMs = runtime?.observedEndToEndLagMs;
  if (observedLagMs !== undefined && (typeof observedLagMs !== 'number' || !Number.isFinite(observedLagMs) || observedLagMs < 0)) {
    reasons.push({ code: 'invalid_latency_evidence', message: 'Observed end-to-end lag is invalid.' });
    state = 'blocked';
  } else if (latencyBudgetMs !== undefined && observedLagMs !== undefined && observedLagMs > latencyBudgetMs) {
    reasons.push({ code: 'latency_breached', message: 'Observed connection lag is above the approved latency target.' });
    state = worst(state, 'degraded');
  }

  const recoveryState = runtime?.recovery?.state || 'idle';
  if (recoveryState === 'retrying') {
    reasons.push({ code: 'retrying', message: 'A bounded recovery attempt is in progress.' });
    state = worst(state, 'degraded');
  } else if (recoveryState === 'exhausted') {
    reasons.push({ code: 'recovery_exhausted', message: 'Bounded recovery attempts are exhausted.' });
    state = 'blocked';
  } else if (recoveryState === 'quarantined') {
    reasons.push({ code: 'quarantined', message: 'A failed item is quarantined and requires controlled review.' });
    state = 'blocked';
  } else if (!['idle', 'recovered'].includes(recoveryState)) {
    reasons.push({ code: 'invalid_recovery_state', message: 'Recovery state is not recognised.' });
    state = 'blocked';
  }

  const attempts = runtime?.recovery?.attempts;
  const maxAttempts = profile?.recovery?.maxAttempts;
  if (attempts !== undefined) {
    if (!Number.isInteger(attempts) || attempts < 0) {
      reasons.push({ code: 'invalid_recovery_attempts', message: 'Recovery attempt evidence is invalid.' });
      state = 'blocked';
    } else if (Number.isInteger(maxAttempts) && attempts > maxAttempts) {
      reasons.push({ code: 'recovery_policy_breached', message: 'Observed recovery attempts exceed the approved retry limit.' });
      state = 'blocked';
    }
  }

  const reconciliationStatus = runtime?.reconciliation?.status;
  if (reconciliationStatus && reconciliationStatus !== 'passed') {
    reasons.push({ code: 'reconciliation_failed', message: 'Source and staged records have not reconciled cleanly.' });
    state = 'blocked';
  }

  if ((runtime?.authorityConflicts || 0) > 0) {
    reasons.push({ code: 'authority_conflict', message: 'Two systems are attempting to own the same entity state.' });
    state = 'blocked';
  }

  if ((runtime?.consecutiveFailures || 0) > 0 && state !== 'blocked') {
    reasons.push({ code: 'recent_failure', message: 'Recent connection failures are still being watched.' });
    state = worst(state, 'degraded');
  }

  return {
    state,
    reasons,
    summary: state === 'healthy'
      ? 'Connection is current, reconciled and operating inside its approved recovery policy.'
      : state === 'degraded'
        ? 'Connection is still controlled but needs attention before health can return to normal.'
        : 'Connection is blocked from being treated as healthy until the stated control issue is resolved.',
    nextAction: actionFor(reasons),
    metrics: {
      freshnessAgeMs,
      observedLagMs: observedLagMs ?? null,
      latencyBudgetMs: latencyBudgetMs ?? null
    }
  };
}
