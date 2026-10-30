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

// V029 bounded fairness-input admission; original owner proof above is unchanged.
{
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const engine = require(process.env.V029_ENGINE || path.join(__dirname, 'manufacturing-scheduling-engine.cjs'));
const fields = ['overtimeHours', 'nightShifts', 'weekendShifts', 'undesirableShifts'];
const zeros = { overtimeHours: 0, nightShifts: 0, weekendShifts: 0, undesirableShifts: 0 };
const normalize = fairness => engine.normaliseWorker({ id: 'synthetic-worker', fairness }).fairness;

test('omitted fairness, null container and absent fields retain owned zero defaults', () => {
  assert.deepEqual(engine.normaliseWorker({ id: 'synthetic-worker' }).fairness, zeros);
  assert.deepEqual(normalize(undefined), zeros);
  assert.deepEqual(normalize(null), zeros);
  assert.deepEqual(normalize({}), zeros);
});

for (const field of fields) {
  test(field + ' retains explicit zero and finite nonnegative primitive values', () => {
    for (const value of [0, 0.5, 12]) {
      assert.deepEqual(normalize({ [field]: value }), { ...zeros, [field]: value });
    }
  });
  test(field + ' rejects explicit malformed evidence instead of coercing to zero', () => {
    for (const value of [NaN, Infinity, -Infinity, -1, '12', '', null, undefined, false, [], {}]) {
      assert.throws(() => normalize({ [field]: value }), /fairness/i, String(value));
    }
  });
}

test('a fairness field accessor is rejected without invocation', () => {
  let reads = 0;
  const fairness = {};
  Object.defineProperty(fairness, 'overtimeHours', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => normalize(fairness), /fairness/i);
  assert.equal(reads, 0);
});

test('a fairness container accessor is rejected without invocation', () => {
  let reads = 0;
  const worker = { id: 'synthetic-worker' };
  Object.defineProperty(worker, 'fairness', { enumerable: true, get() { reads++; return {}; } });
  assert.throws(() => engine.normaliseWorker(worker), /fairness/i);
  assert.equal(reads, 0);
});

test('inherited fairness fields and inherited container cannot supply exposure evidence', () => {
  assert.throws(() => normalize(Object.create({ overtimeHours: 4 })), /fairness/i);
  const worker = Object.assign(Object.create({ fairness: { overtimeHours: 4 } }), { id: 'synthetic-worker' });
  assert.throws(() => engine.normaliseWorker(worker), /fairness/i);
});

test('a Proxy fairness record is rejected without running its traps', () => {
  let traps = 0;
  const fairness = new Proxy({}, {
    get() { traps++; return 0; },
    ownKeys() { traps++; return []; },
    getOwnPropertyDescriptor() { traps++; return undefined; },
    getPrototypeOf() { traps++; return Object.prototype; }
  });
  assert.throws(() => normalize(fairness), /fairness/i);
  assert.equal(traps, 0);
});

test('a Proxy worker is refused before any worker property or descriptor access', () => {
  let traps = 0;
  const worker = new Proxy({ id: 'synthetic-worker', fairness: {} }, {
    get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); },
    getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); },
    has(target, key) { traps++; return Reflect.has(target, key); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); }
  });
  assert.throws(() => engine.normaliseWorker(worker), /inert|fairness/i);
  assert.equal(traps, 0);
});

test('inert null-prototype own data is copied without freezing caller input', () => {
  const fairness = Object.assign(Object.create(null), { overtimeHours: 3, undesirableShifts: 2 });
  const result = normalize(fairness);
  assert.deepEqual(result, { ...zeros, overtimeHours: 3, undesirableShifts: 2 });
  fairness.overtimeHours = 99;
  assert.equal(result.overtimeHours, 3);
  assert.equal(Object.isFrozen(fairness), false);
});
}

// Separate compatibility and inert-evidence heldouts.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const engine = require(process.env.V029_ENGINE || path.join(__dirname, 'manufacturing-scheduling-engine.cjs'));
const fields = ['overtimeHours', 'nightShifts', 'weekendShifts', 'undesirableShifts'];
const worker = fairness => ({ id: 'heldout-worker', fairness });

test('heldout: fairness coercion hooks are never invoked', () => {
  let calls = 0;
  const value = { [Symbol.toPrimitive]() { calls++; return 2; }, valueOf() { calls++; return 2; } };
  for (const field of fields) assert.throws(() => engine.normaliseWorker(worker({ [field]: value })), /fairness/i);
  assert.equal(calls, 0);
});

test('heldout: hidden fairness values cannot supply evidence', () => {
  for (const field of fields) {
    const fairness = {};
    Object.defineProperty(fairness, field, { value: 2, enumerable: false });
    assert.throws(() => engine.normaliseWorker(worker(fairness)), /fairness/i);
  }
});

test('heldout: revoked record and worker proxies are rejected at their boundaries', () => {
  const record = Proxy.revocable({}, {}); record.revoke();
  assert.throws(() => engine.normaliseWorker(worker(record.proxy)), /fairness|inert/i);
  const outer = Proxy.revocable({ id: 'heldout-worker' }, {}); outer.revoke();
  assert.throws(() => engine.normaliseWorker(outer.proxy), /inert/i);
});

test('heldout: invalid container cannot run a field accessor', () => {
  let reads = 0;
  const fairness = [];
  Object.defineProperty(fairness, 'overtimeHours', { get() { reads++; return 2; } });
  assert.throws(() => engine.normaliseWorker(worker(fairness)), /fairness/i);
  assert.equal(reads, 0);
});

test('heldout: ordinary explicit values retain their amounts and omission defaults', () => {
  const fairness = { overtimeHours: 1.25, nightShifts: 2, weekendShifts: 3, undesirableShifts: 0 };
  assert.deepEqual(engine.normaliseWorker(worker(fairness)).fairness, fairness);
  assert.equal(Object.isFrozen(fairness), false);
});

test('heldout: unrelated unconsumed metadata is not evaluated', () => {
  let reads = 0;
  const fairness = { overtimeHours: 3 };
  Object.defineProperty(fairness, 'unrelated', { enumerable: true, get() { reads++; throw new Error('not evidence'); } });
  assert.equal(engine.normaliseWorker(worker(fairness)).fairness.overtimeHours, 3);
  assert.equal(reads, 0);
});

test('heldout: explicit negative zero retains the owned canonical zero behavior', () => {
  for (const field of fields) {
    const actual = engine.normaliseWorker(worker({ [field]: -0 })).fairness[field];
    assert.equal(Object.is(actual, 0), true);
  }
});
}
