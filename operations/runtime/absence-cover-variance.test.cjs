'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./absence-cover-variance.cjs');
const scope = { tenantId: 't1', siteId: 's1', shiftId: 'shift1', slotId: 'slot1' };
const receipt = (kind, source, at, hash, more={}) => ({ ...scope, sourceKind: kind,
  windowStart: '2026-10-23T08:00:00.000Z', windowEnd: '2026-10-23T16:00:00.000Z',
  sourceId: source, sourceRevision: 'r1', recordSha256: hash.repeat(64),
  occurredAt: at, observedAt: '2026-10-23T11:00:00.000Z', minutes: 480, ...more });
function fixture() { return { ...scope, windowStart: '2026-10-23T08:00:00.000Z',
  windowEnd: '2026-10-23T16:00:00.000Z', asOf: '2026-10-23T12:00:00.000Z',
  planned: receipt('PUBLISHED_SCHEDULE','schedule','2026-10-22T12:00:00.000Z','a',
    { status:'PUBLISHED', costPence: 7000 }),
  absence: receipt('ABSENCE_APPROVAL','leave','2026-10-23T07:00:00.000Z','b',
    { status:'APPROVED', plannedRecordSha256: 'a'.repeat(64) }),
  cover: receipt('COVER_ASSIGNMENT','cover','2026-10-23T07:30:00.000Z','c',
    { status:'APPROVED', coverType:'OVERTIME', costPence: 9500,
      plannedRecordSha256: 'a'.repeat(64), absenceRecordSha256: 'b'.repeat(64) }) }; }
test('compares scoped declared cover with planned slot, without payroll or savings claim', () => {
  const out=assess(fixture());
  assert.equal(out.status,'REVIEW_DECLARED_COVER_VARIANCE');
  assert.equal(out.declaredCoverLessPlannedPence,2500);
  assert.equal(out.claimedSavingsPence,null);
  assert.equal(out.payrollAuthority,false);
  assert.equal(out.sourceAuthenticated,false);
  assert.deepEqual(out.recordSha256,['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]);
});
test('cheaper cover stays signed variance, not a saving', () => {
  const x=fixture();x.cover.costPence=6500;
  const out=assess(x);
  assert.equal(out.declaredCoverLessPlannedPence,-500);
  assert.equal(out.claimedSavingsPence,null);
});
test('foreign, incomplete, duplicate, private, wrong chronology and mismatched minutes block', () => {
  const changes=[
    x=>{x.cover.tenantId='other';},x=>{x.absence.siteId='other';},
    x=>{x.cover.slotId='slot2';},x=>{x.planned.slotId='slot2';},
    x=>{x.absence.windowStart='2026-10-23T09:00:00.000Z';},
    x=>{x.cover.minutes=400;},x=>{x.planned.minutes=400;},
    x=>{x.cover.recordSha256=x.absence.recordSha256;},
    x=>{x.absence.plannedRecordSha256='d'.repeat(64);},
    x=>{x.cover.absenceRecordSha256='d'.repeat(64);},
    x=>{x.cover.sourceId=x.absence.sourceId;},
    x=>{x.cover.status='PENDING';},x=>{x.cover.coverType='UNKNOWN';},
    x=>{x.cover.costPence=-1;},x=>{x.cover.workerId='private';},
    x=>{x.cover.occurredAt='2026-10-23T06:30:00.000Z';},
    x=>{x.planned.occurredAt='2026-10-23T08:15:00.000Z';},
    x=>{x.cover.occurredAt='2026-10-23T08:15:00.000Z';},
    x=>{x.absence.observedAt='2026-10-23T06:00:00.000Z';},
    x=>{x.cover.observedAt='2026-10-23T12:01:00.000Z';},
    x=>{x.planned.costPence=Number.MAX_SAFE_INTEGER+1;},
    x=>{x.windowEnd=x.windowStart;}
  ];
  for(const [index,change] of changes.entries()){const x=fixture();change(x);assert.equal(assess(x).status,'BLOCKED',`change ${index}`);}
});
