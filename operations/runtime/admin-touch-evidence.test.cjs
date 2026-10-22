'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./admin-touch-evidence.cjs');
const scope = { tenantId: 't1', siteId: 's1' };
function fixture() {
  const event = (actionId, workflow, start, end, hash) => ({ ...scope, actionId,
    workflow, sourceRevision: 'r1', startedAt: start, endedAt: end,
    observedAt: '2026-10-22T11:00:00.000Z', evidenceRef: `audit:${actionId}`,
    recordSha256: hash.repeat(64) });
  return { ...scope, windowStart: '2026-10-22T08:00:00.000Z',
    windowEnd: '2026-10-22T12:00:00.000Z', asOf: '2026-10-22T12:30:00.000Z',
    sourceKind: 'WORKFLOW_AUDIT', sourceId: 'audit1', sourceRevision: 'r1',
    evidenceRef: 'audit:window', complete: true, events: [
      event('a1','absence','2026-10-22T09:00:00.000Z','2026-10-22T09:10:00.000Z','a'),
      event('a2','time-review','2026-10-22T09:30:00.000Z','2026-10-22T09:35:00.000Z','b') ] };
}
test('counts declared manual touch time across existing workflow kinds with evidence, not savings', () => {
  const out = assess(fixture());
  assert.equal(out.status, 'REVIEW_DECLARED_EFFORT');
  assert.equal(out.declaredTouchMinutes, 15);
  assert.equal(out.distinctWorkflowCount, 2);
  assert.deepEqual(out.minutesByWorkflow, { absence: 10, 'time-review': 5, 'weekly-signoff': 0 });
  assert.equal(out.eventEvidence.length, 2);
  assert.deepEqual(out.eventEvidence[0], { workflow: 'absence', recordSha256: 'a'.repeat(64) });
  assert.equal(out.sourceAuthenticated, false);
  assert.equal(out.claimedSavingsPence, null);
});
test('complete empty window is zero evidence, not a saving', () => {
  const x=fixture(); x.events=[];
  assert.equal(assess(x).declaredTouchMinutes,0);
});
test('private, duplicate, foreign, incomplete, overlapping or malformed evidence blocks', () => {
  const changes = [
    x=>{x.complete=false;}, x=>{x.events[0].tenantId='other';},
    x=>{x.events[0].personId='private';}, x=>{x.events[1].actionId='a1';},
    x=>{x.events[1].recordSha256=x.events[0].recordSha256;},
    x=>{x.events[1].startedAt='2026-10-22T09:05:00.000Z';},
    x=>{x.events[0].caseId='private';},
    x=>{x.events[0].endedAt=x.events[0].startedAt;},
    x=>{x.events[0].workflow='payroll';},
    x=>{x.events[0].observedAt='2026-10-22T08:59:00.000Z';},
    x=>{x.events[0].startedAt='2026-10-22T07:59:00.000Z';},
    x=>{x.events[0].recordSha256='bad';}
  ];
  for(const change of changes){const x=fixture();change(x);assert.equal(assess(x).status,'BLOCKED');}
});
