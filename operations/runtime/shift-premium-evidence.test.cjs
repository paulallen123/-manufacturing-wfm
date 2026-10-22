'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessShiftPremiumEvidence } = require('./shift-premium-evidence.cjs');

function input() {
  return {
    tenantId: 'synthetic-tenant', siteId: 'site-1', asOf: '2026-10-22T12:00:00Z',
    period: { start: '2026-10-22T08:00:00Z', end: '2026-10-22T11:00:00Z' },
    source: { name: 'WFM_SCHEDULE', revision: 'r7', digest: 'sha256:fixture',
      observedAt: '2026-10-22T11:30:00Z', complete: true },
    policyRevision: 'premium-policy-r3',
    segments: [
      { tenantId: 'synthetic-tenant', siteId: 'site-1', assignmentRef: 'assignment-a', evidenceRef: 'segment-a1',
        policyRevision: 'premium-policy-r3', premiumCode: 'NIGHT', start: '2026-10-22T08:00:00Z', end: '2026-10-22T09:00:00Z', hourlyRate: 20, multiplier: 1.25 },
      { tenantId: 'synthetic-tenant', siteId: 'site-1', assignmentRef: 'assignment-b', evidenceRef: 'segment-b1',
        policyRevision: 'premium-policy-r3', premiumCode: 'NIGHT', start: '2026-10-22T08:30:00Z', end: '2026-10-22T09:30:00Z', hourlyRate: 10, multiplier: 1.5 }
    ]
  };
}

test('uses shared pay rounding for separate assignments without claiming savings', () => {
  const result = assessShiftPremiumEvidence(input());
  assert.equal(result.status, 'SUPPLIED_PLANNED_PREMIUM');
  assert.equal(result.basePence, 3000);
  assert.equal(result.grossPence, 4000);
  assert.equal(result.premiumPence, 1000);
  assert.deepEqual(result.evidenceRefs, ['segment-a1', 'segment-b1']);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.actionAuthority, false);
});

test('rejects repeated, overlapping, foreign, stale and coerced evidence', () => {
  const mutations = [
    x => { x.source.complete = false; },
    x => { x.source.observedAt = '2026-10-22T12:30:00Z'; },
    x => { x.segments[1].siteId = 'other'; },
    x => { x.segments[1].evidenceRef = 'segment-a1'; },
    x => { x.segments[1].assignmentRef = 'assignment-a'; },
    x => { x.segments[0].policyRevision = 'old'; },
    x => { x.segments[0].hourlyRate = '20'; },
    x => { x.segments[0].multiplier = 0.9; },
    x => { x.segments[0].start = '2026-10-22T07:00:00Z'; },
    x => { x.segments[0].end = '2026-10-22T08:00:00Z'; },
    x => { x.segments[0].end = '2026-02-30T09:00:00Z'; }
  ];
  for (const mutate of mutations) { const value = input(); mutate(value); assert.throws(() => assessShiftPremiumEvidence(value)); }
});

test('a non-premium segment yields zero premium without a savings claim', () => {
  const value = input(); value.segments[0].multiplier = 1; value.segments[1].multiplier = 1;
  const result = assessShiftPremiumEvidence(value);
  assert.equal(result.status, 'NO_DECLARED_PREMIUM');
  assert.equal(result.premiumPence, 0);
});
