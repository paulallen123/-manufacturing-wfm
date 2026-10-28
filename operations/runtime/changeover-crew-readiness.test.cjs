'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessChangeoverCrew } = require('./changeover-crew-readiness.cjs');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture() {
  const scope = { tenantId: 'tenant-a', siteId: 'site-a', lineId: 'line-1', changeoverId: 'change-1',
    start: '2026-11-01T08:00:00.000Z', end: '2026-11-01T10:00:00.000Z' };
  const evidence = { ...scope, eventAt: '2026-10-31T08:00:00.000Z', observedAt: '2026-10-31T08:01:00.000Z' };
  const changeoverPlan = { ...evidence, source: 'mes', recordId: 'plan-1', revision: '2', recordSha256: A,
    state: 'APPROVED', requiredHeadcount: 2, requiredSkills: [{ skillId: 'setup', minimumQualified: 1 }, { skillId: 'safety', minimumQualified: 2 }] };
  const member = workerRef => ({ workerRef, start: scope.start, end: scope.end,
    skills: [{ skillId: 'setup', status: 'VERIFIED', expiresAt: '2026-12-01T00:00:00.000Z' },
      { skillId: 'safety', status: 'VERIFIED', expiresAt: '2026-12-01T00:00:00.000Z' }] });
  const crewSnapshot = { ...evidence, source: 'workforce', recordId: 'crew-1', revision: '1', recordSha256: B,
    state: 'PUBLISHED', complete: true, assignments: [member('opaque-1'), member('opaque-2')] };
  return { ...scope, asOf: '2026-10-31T09:00:00.000Z', changeoverPlan, crewSnapshot };
}
test('declared complete changeover crew covers required count and skill mix without action authority', () => {
  const r = assessChangeoverCrew(fixture());
  assert.equal(r.status, 'NO_DECLARED_GAP');
  assert.equal(r.headcountGap, 0);
  assert.deepEqual(r.skillGaps, []);
  assert.equal(JSON.stringify(r).includes('opaque-'), false);
  for (const key of ['sourceAuthenticated', 'qualificationAuthority', 'scheduleAuthority', 'payrollAuthority', 'executionAuthority']) assert.equal(r[key], false);
});
test('headcount and skill shortfalls remain visible without worker scoring', () => {
  const x = fixture();
  x.crewSnapshot.assignments.pop();
  const r = assessChangeoverCrew(x);
  assert.equal(r.status, 'DECLARED_GAP');
  assert.equal(r.headcountGap, 1);
  assert.deepEqual(r.skillGaps, [{ skillId: 'safety', required: 2, declaredQualified: 1 }]);
});
test('foreign, incomplete, duplicate and expired evidence rejects', () => {
  const x = fixture();
  for (const key of ['tenantId', 'siteId', 'lineId', 'changeoverId', 'start', 'end'])
    assert.throws(() => assessChangeoverCrew({ ...x, crewSnapshot: { ...x.crewSnapshot, [key]: 'foreign' } }));
  for (const change of [{ complete: false }, { state: 'DRAFT' }, { source: 'mes' }, { recordSha256: A },
    { observedAt: '2026-11-01T09:00:00.000Z' }])
    assert.throws(() => assessChangeoverCrew({ ...x, crewSnapshot: { ...x.crewSnapshot, ...change } }));
  assert.throws(() => assessChangeoverCrew({ ...x, crewSnapshot: { ...x.crewSnapshot, assignments: [x.crewSnapshot.assignments[0], x.crewSnapshot.assignments[0]] } }));
  const expired = { ...x.crewSnapshot.assignments[0], skills: [{ skillId: 'setup', status: 'VERIFIED', expiresAt: x.start }] };
  assert.throws(() => assessChangeoverCrew({ ...x, crewSnapshot: { ...x.crewSnapshot, assignments: [expired, x.crewSnapshot.assignments[1]] } }));
});
