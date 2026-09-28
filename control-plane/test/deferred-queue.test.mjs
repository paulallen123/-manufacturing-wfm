import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activationPackageReady,
  assessDeferredChange,
  assertNoFrozenCandidateMutation,
  customerProofComplete,
  validateDeferredChange,
} from '../lib/deferred-queue.js';

const frozenSha = '3030541675e41157405b933c30d82c8fd4b12927';

function change(overrides = {}) {
  return {
    id: 'pr-277',
    title: 'Frontier convergence',
    prNumber: 277,
    branch: 'frontier/all-findings-convergence-20260928',
    status: 'DEVELOPING_ISOLATED',
    readiness: 'NOT_READY',
    isolated: true,
    touchesFrozenCandidate: false,
    frozenBaseSha: frozenSha,
    activation: {
      maxMinutes: 60,
      strategy: 'cherry-pick-set',
      testCommand: 'npm test',
      rollback: 'revert activation commit and restore frozen deployment',
      migrationRisk: 'none',
      validatedAgainstFrozenSha: null,
      isolatedTestsPassed: false,
      rollbackVerified: false,
      deploymentRecipeReady: false,
    },
    ...overrides,
  };
}

function state(value = 'PASS') {
  const ids = [
    'pre_freeze',
    'hosted_runtime',
    'exact_source_binding',
    'golden_journey',
    'autonomous_implementation',
    'competency_training',
    'integrations',
    'security',
    'autopilot_execute',
    'autopilot_rollback',
    'persistence_restart',
    'stale_restore_tamper_recovery',
    'outcome_learning_runtime',
    'northstar_assault',
    'failure_domain_independence',
    'production_authority',
  ];
  return {
    gates: Object.fromEntries(ids.map((id) => [id, { id, state: id === 'production_authority' ? 'UNPROVEN' : value }])),
  };
}

test('deferred work must remain isolated from the frozen candidate', () => {
  assert.deepEqual(validateDeferredChange(change()), []);
  assert.throws(
    () => assertNoFrozenCandidateMutation([change({ touchesFrozenCandidate: true })]),
    /FROZEN_CANDIDATE_MUTATION_FORBIDDEN/,
  );
});

test('activation budget is capped at one hour', () => {
  assert.ok(validateDeferredChange(change({ activation: { ...change().activation, maxMinutes: 61 } }))
    .includes('ACTIVATION_SLO_MUST_BE_1_TO_60_MINUTES'));
});

test('customer proof completion ignores production authority but requires every customer-proof gate', () => {
  assert.equal(customerProofComplete(state()), true);
  const broken = state();
  broken.gates.integrations.state = 'BLOCKED';
  assert.equal(customerProofComplete(broken), false);
});

test('deferred work cannot promote before the live customer environment is proven', () => {
  const blocked = state();
  blocked.gates.security.state = 'UNPROVEN';
  const ready = change({
    status: 'ACTIVATION_READY',
    readiness: 'ACTIVATION_READY',
    activation: {
      ...change().activation,
      validatedAgainstFrozenSha: frozenSha,
      isolatedTestsPassed: true,
      rollbackVerified: true,
      deploymentRecipeReady: true,
    },
  });
  assert.equal(activationPackageReady(ready), true);
  const result = assessDeferredChange(ready, blocked);
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'HELD_UNTIL_CUSTOMER_PROOF');
});

test('a fully prepared isolated change becomes promotion-eligible only after customer proof', () => {
  const ready = change({
    status: 'ACTIVATION_READY',
    readiness: 'ACTIVATION_READY',
    activation: {
      ...change().activation,
      validatedAgainstFrozenSha: frozenSha,
      isolatedTestsPassed: true,
      rollbackVerified: true,
      deploymentRecipeReady: true,
    },
  });
  const result = assessDeferredChange(ready, state());
  assert.equal(result.eligible, true);
  assert.equal(result.state, 'PROMOTION_ELIGIBLE');
  assert.equal(result.maxActivationMinutes, 60);
});
