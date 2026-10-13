'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOpenShift, createSchedulingPlan } = require('./manufacturing-scheduling-engine.cjs');

const requirement = {
  id: 'synthetic-line-shift', site: 'tamworth', line: 'line-4', role: 'welder',
  start: '2026-10-20T06:00:00Z', end: '2026-10-20T14:00:00Z', headcount: 1,
  requiredSkills: ['welding-l3'], requiredCertifications: ['weld-cert'], tags: ['DAY'],
  evidenceRefs: ['synthetic:mes:1']
};
function worker(id, extra = {}) {
  return {
    id, type: 'EMPLOYEE', status: 'ACTIVE', homeSite: 'tamworth', eligibleSites: ['tamworth'],
    skills: ['welding-l3'], certifications: [{ name: 'weld-cert', expiresAt: '2027-01-01T00:00:00Z' }],
    availability: [{ start: '2026-10-20T00:00:00Z', end: '2026-10-20T23:00:00Z' }],
    hoursWorkedWeek: 8, contractedHours: 40, hourlyCost: 20,
    preferences: {}, fairness: {}, evidenceRefs: [`synthetic:hr:${id}`], ...extra
  };
}
function rank(workers, policy = {}) {
  return evaluateOpenShift({ requirement, workers, policy });
}

test('stated site and shift preferences change an otherwise equal advisory ranking', () => {
  const preferred = worker('z-preferred', { preferences: { preferredSites: ['tamworth'], preferredLines: ['line-4'], preferredTags: ['DAY'] } });
  const avoided = worker('a-avoided', { preferences: { preferredSites: ['other-site'], preferredLines: ['other-line'], avoidedTags: ['DAY'] } });
  const result = rank([avoided, preferred]);
  assert.equal(result.executionPermitted, false);
  assert.deepEqual(result.ranked.map(x => x.workerId), ['z-preferred', 'a-avoided']);
  assert.equal(result.ranked[0].experience.preferencePenalty, 0);
  assert.equal(result.ranked[1].experience.preferencePenalty, 3.5);
  assert.ok(result.ranked[0].score < result.ranked[1].score);
});

test('historical overtime and undesirable shifts change an equal-cost advisory ranking', () => {
  const lessExposed = worker('z-less-exposed', { fairness: { overtimeHours: 0, undesirableShifts: 0 } });
  const moreExposed = worker('a-more-exposed', { fairness: { overtimeHours: 10, undesirableShifts: 5 } });
  const result = rank([moreExposed, lessExposed]);
  assert.deepEqual(result.ranked.map(x => x.workerId), ['z-less-exposed', 'a-more-exposed']);
  assert.equal(result.ranked[0].experience.fairnessPenalty, 0);
  assert.equal(result.ranked[1].experience.fairnessPenalty, 1.3);
});

test('worker preference never overrides a missing qualification', () => {
  const ineligible = worker('a-ineligible', { skills: [], preferences: { preferredSites: ['tamworth'], preferredTags: ['DAY'] } });
  const eligible = worker('z-eligible', { preferences: { avoidedTags: ['DAY'] } });
  const result = rank([ineligible, eligible]);
  assert.equal(result.ranked[0].workerId, 'z-eligible');
  assert.equal(result.ranked[1].eligible, false);
  assert.ok(result.ranked[1].failures.includes('MISSING_SKILL:welding-l3'));
});

test('plan retains preference and fairness explanation without execution authority', () => {
  const workers = [worker('a', { fairness: { overtimeHours: 8 } }), worker('b', { preferences: { preferredTags: ['DAY'] } })];
  const plan = createSchedulingPlan({
    tenant: 'synthetic-tenant', contextRevision: 'synthetic:twin:1', createdAt: '2026-10-19T12:00:00Z',
    sourceEvidence: ['synthetic:mes:1', 'synthetic:hr:a', 'synthetic:hr:b'], workers,
    requirements: [requirement], policy: { ruleVersion: 'synthetic-policy-1' }
  });
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.executionPermitted, false);
  assert.equal(plan.assignments[0].workerId, 'b');
  assert.equal(plan.assignments[0].experience.preferencePenalty, 0);
  assert.equal(plan.assignments[0].experience.fairnessPenalty, 0);
});
