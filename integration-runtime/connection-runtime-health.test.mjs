import assert from 'node:assert/strict';
import { evaluateConnectionRuntimeHealth } from './connection-runtime-health.mjs';

const profile = {
  monitoring: { freshnessSeconds: 300, latencyBudgetMs: 5000 },
  recovery: { maxAttempts: 3 }
};
const now = Date.parse('2026-09-18T22:45:00Z');

function healthyRuntime() {
  return {
    lastSuccessfulSyncAt: '2026-09-18T22:44:30Z',
    observedEndToEndLagMs: 900,
    recovery: { state: 'idle', attempts: 0 },
    reconciliation: { status: 'passed' },
    authorityConflicts: 0,
    consecutiveFailures: 0
  };
}

assert.equal(evaluateConnectionRuntimeHealth(profile, healthyRuntime(), now).state, 'healthy');

const stale = healthyRuntime();
stale.lastSuccessfulSyncAt = '2026-09-18T22:30:00Z';
assert.equal(evaluateConnectionRuntimeHealth(profile, stale, now).state, 'degraded');
assert.match(evaluateConnectionRuntimeHealth(profile, stale, now).nextAction, /provider reachability/i);

const slow = healthyRuntime();
slow.observedEndToEndLagMs = 12000;
assert.equal(evaluateConnectionRuntimeHealth(profile, slow, now).state, 'degraded');

const retrying = healthyRuntime();
retrying.recovery = { state: 'retrying', attempts: 2 };
assert.equal(evaluateConnectionRuntimeHealth(profile, retrying, now).state, 'degraded');

const exhausted = healthyRuntime();
exhausted.recovery = { state: 'exhausted', attempts: 3 };
assert.equal(evaluateConnectionRuntimeHealth(profile, exhausted, now).state, 'blocked');

const breachedRetryLimit = healthyRuntime();
breachedRetryLimit.recovery = { state: 'retrying', attempts: 4 };
assert.equal(evaluateConnectionRuntimeHealth(profile, breachedRetryLimit, now).state, 'blocked');

const mismatch = healthyRuntime();
mismatch.reconciliation.status = 'failed';
assert.equal(evaluateConnectionRuntimeHealth(profile, mismatch, now).state, 'blocked');

const authorityConflict = healthyRuntime();
authorityConflict.authorityConflicts = 1;
assert.equal(evaluateConnectionRuntimeHealth(profile, authorityConflict, now).state, 'blocked');

const invalidFutureEvidence = healthyRuntime();
invalidFutureEvidence.lastSuccessfulSyncAt = '2026-09-18T22:46:00Z';
assert.equal(evaluateConnectionRuntimeHealth(profile, invalidFutureEvidence, now).state, 'blocked');

const badPolicy = structuredClone(profile);
badPolicy.monitoring.latencyBudgetMs = -1;
assert.equal(evaluateConnectionRuntimeHealth(badPolicy, healthyRuntime(), now).state, 'blocked');

console.log('connection runtime health tests passed');
