import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateControlledEnvironmentPlan, compareControlledEnvironmentPlans } from './controlled-environment-flow.mjs';

// Held-out regressions for Trust/Proof comment 5752901536. Synthetic only.
const fixture = () => ({
  now: '2026-09-21T09:00:00Z',
  policy: {
    authoritative: true, siteId: 'S1', version: 'v1', ref: 'synthetic:qms:1',
    observedAt: '2026-09-21T08:55:00Z', maxAgeMinutes: 30, defaultOutsideZone: 'OUT',
    zones: { B: { maxPersonnel: 1 }, C: { maxPersonnel: 2 } },
    transitions: [
      { from: 'OUT', to: 'B', allowed: true, gowningCycle: true, controlMinutes: 5, controlCost: 2 },
      { from: 'B', to: 'C', allowed: true, gowningCycle: false, controlMinutes: 2, controlCost: 0 }
    ]
  },
  workers: [{ id: 'W1', siteId: 'S1', skills: ['fill', 'inspect'], qualifiedZones: ['B', 'C'], currentZone: 'OUT' }],
  tasks: [{ id: 'T1', siteId: 'S1', slot: 1, zone: 'B', skill: 'fill', requiredHeadcount: 1 }],
  plan: { id: 'P1', assignments: [{ workerId: 'W1', taskId: 'T1' }] }
});
const reject = (input, reason) => {
  const result = evaluateControlledEnvironmentPlan(input);
  assert.notEqual(result.status, 'safe_candidate');
  assert.equal(result.reason, reason);
  assert.notEqual(result.metrics?.taskCoverageComplete, true);
};

test('unambiguous supplied plan still passes the existing comparator', () => {
  const input = fixture(), before = structuredClone(input);
  assert.equal(evaluateControlledEnvironmentPlan(input).status, 'safe_candidate');
  assert.deepEqual(input, before, 'read-only comparator must not mutate input');
});
for (const reverse of [false, true]) {
  test(`two distinct required tasks sharing one ID cannot collapse (reverse=${reverse})`, () => {
    const input = fixture();
    input.tasks.push({ ...input.tasks[0], slot: 2, zone: 'C', skill: 'inspect' });
    if (reverse) input.tasks.reverse();
    reject(input, 'duplicate_task_id');
  });
  test(`a duplicate worker cannot overwrite qualifications (reverse=${reverse})`, () => {
    const input = fixture();
    input.workers.unshift({ ...input.workers[0], skills: [] });
    if (reverse) input.workers.reverse();
    reject(input, 'duplicate_worker_id');
  });
  test(`conflicting transition definitions never become an approval (reverse=${reverse})`, () => {
    const input = fixture();
    input.policy.transitions.unshift({ from: 'OUT', to: 'B', allowed: false });
    if (reverse) input.policy.transitions.reverse();
    reject(input, 'duplicate_transition_rule');
  });
}
test('identical duplicate task records also require upstream reconciliation', () => {
  const input = fixture(); input.tasks.push(structuredClone(input.tasks[0]));
  reject(input, 'duplicate_task_id');
});
test('identical duplicate transition rules are not silently de-duplicated', () => {
  const input = fixture(); input.policy.transitions.push(structuredClone(input.policy.transitions[0]));
  reject(input, 'duplicate_transition_rule');
});
for (const invalid of [undefined, '', ' T1 ', 1]) {
  test(`invalid task identity is not coerced into a lookup key: ${JSON.stringify(invalid)}`, () => {
    const input = fixture(); input.tasks[0].id = invalid; input.plan.assignments[0].taskId = invalid;
    reject(input, 'task_id_invalid');
  });
}
for (const invalid of [undefined, '', ' W1 ', 1]) {
  test(`invalid worker identity is not coerced into a lookup key: ${JSON.stringify(invalid)}`, () => {
    const input = fixture(); input.workers[0].id = invalid; input.plan.assignments[0].workerId = invalid;
    reject(input, 'worker_id_invalid');
  });
}
test('non-array input is rejected instead of throwing', () => {
  const input = fixture(); input.workers = {};
  reject(input, 'workers_invalid');
});
test('malformed transition rows cannot be ignored', () => {
  const input = fixture(); input.policy.transitions.push({ from: '', to: 'B', allowed: true });
  reject(input, 'transition_rule_invalid');
});
test('missing transition list cannot make stationary work look fully checked', () => {
  const input = fixture(); input.workers[0].currentZone = 'B'; delete input.policy.transitions;
  reject(input, 'transition_rules_invalid');
});
test('ambiguous delimiter in zone names cannot alias an approved route', () => {
  const input = fixture();
  input.workers[0].currentZone = 'OUT>B';
  input.tasks[0].zone = 'C';
  input.policy.transitions = [{ from: 'OUT', to: 'B>C', allowed: true }];
  reject(input, 'transition_not_approved');
});
test('occupancy limit for a zone containing @ is enforced exactly', () => {
  const input = fixture();
  input.policy.zones = { 'B@east': { maxPersonnel: 1 } };
  input.policy.transitions = [{ from: 'OUT', to: 'B@east', allowed: true }];
  input.workers[0].qualifiedZones = ['B@east'];
  input.workers.push({ ...input.workers[0], id: 'W2' });
  input.tasks[0].zone = 'B@east'; input.tasks[0].requiredHeadcount = 2;
  input.plan.assignments.push({ workerId: 'W2', taskId: 'T1' });
  reject(input, 'zone_occupancy_exceeded');
});
test('valid distinct transition pairs can contain delimiters and Unicode', () => {
  const input = fixture();
  input.workers[0].id = '工人>α'; input.workers[0].currentZone = 'OUT>B';
  input.tasks[0].zone = 'C'; input.plan.assignments[0].workerId = '工人>α';
  input.policy.transitions = [
    { from: 'OUT', to: 'B>C', allowed: false },
    { from: 'OUT>B', to: 'C', allowed: true, controlMinutes: 1, controlCost: 0 }
  ];
  assert.equal(evaluateControlledEnvironmentPlan(input).status, 'safe_candidate');
});
test('comparison does not rank an ambiguous input as the preferred plan', () => {
  const input = fixture(); input.tasks.push({ ...input.tasks[0], slot: 2 });
  const result = compareControlledEnvironmentPlans({ ...input, plans: [input.plan] });
  assert.equal(result.status, 'no_safe_candidate');
  assert.equal(result.preferred, null);
});
