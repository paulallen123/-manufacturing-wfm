'use strict';

const { createHash } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessShiftPremiumEvidence } = require('./shift-premium-evidence.cjs');

const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
function rateEvidence({ ref, currency, hourlyRate }) {
  const evidence = { ref, validFrom: '2026-10-01T00:00:00Z', validTo: '2026-11-01T00:00:00Z', currency, hourlyRate };
  evidence.digest = digest(['VECTOR_RATE_EVIDENCE_V1', 'synthetic-tenant', 'site-1', evidence.ref,
    evidence.validFrom, evidence.validTo, evidence.currency, evidence.hourlyRate]);
  return evidence;
}
function policyEvidence({ ref, currency, premiumCode, multiplier }) {
  const evidence = { ref, validFrom: '2026-10-01T00:00:00Z', validTo: '2026-11-01T00:00:00Z', currency,
    policyRevision: 'premium-policy-r3', premiumCode, multiplier };
  evidence.digest = digest(['VECTOR_PREMIUM_POLICY_EVIDENCE_V1', 'synthetic-tenant', 'site-1', evidence.ref,
    evidence.validFrom, evidence.validTo, evidence.currency, evidence.policyRevision, evidence.premiumCode, evidence.multiplier]);
  return evidence;
}
function segment(assignmentRef, evidenceRef, hourlyRate, multiplier) {
  return { tenantId: 'synthetic-tenant', siteId: 'site-1', assignmentRef, evidenceRef,
    policyRevision: 'premium-policy-r3', premiumCode: 'NIGHT', hourlyRate, multiplier,
    start: assignmentRef === 'assignment-a' ? '2026-10-22T08:00:00Z' : '2026-10-22T08:30:00Z',
    end: assignmentRef === 'assignment-a' ? '2026-10-22T09:00:00Z' : '2026-10-22T09:30:00Z',
    rateEvidence: rateEvidence({ ref: `rate-${assignmentRef}`, currency: 'GBP', hourlyRate }),
    premiumEvidence: policyEvidence({ ref: `premium-${assignmentRef}`, currency: 'GBP', premiumCode: 'NIGHT', multiplier }) };
}
function input() {
  return {
    tenantId: 'synthetic-tenant', siteId: 'site-1', currency: 'GBP', asOf: '2026-10-22T12:00:00Z',
    period: { start: '2026-10-22T08:00:00Z', end: '2026-10-22T11:00:00Z' },
    source: { tenantId: 'synthetic-tenant', siteId: 'site-1', name: 'WFM_SCHEDULE', revision: 'r7', digest: 'sha256:fixture',
      observedAt: '2026-10-22T11:30:00Z', complete: true },
    policyRevision: 'premium-policy-r3',
    segments: [segment('assignment-a', 'segment-a1', 20, 1.25), segment('assignment-b', 'segment-b1', 10, 1.5)]
  };
}

test('binds emitted pence to one currency and immutable rate and policy evidence', () => {
  const result = assessShiftPremiumEvidence(input());
  assert.equal(result.status, 'SUPPLIED_PLANNED_PREMIUM');
  assert.equal(result.currency, 'GBP');
  assert.equal(result.basePence, 3000);
  assert.equal(result.grossPence, 4000);
  assert.equal(result.premiumPence, 1000);
  assert.deepEqual(result.evidenceRefs, ['segment-a1', 'segment-b1']);
  assert.deepEqual(result.rateEvidenceRefs, ['rate-assignment-a', 'rate-assignment-b']);
  assert.deepEqual(result.policyEvidenceRefs, ['premium-assignment-a', 'premium-assignment-b']);
  assert.deepEqual(result.rateEvidence, input().segments.map(item => ({ ref: item.rateEvidence.ref, digest: item.rateEvidence.digest })));
  assert.deepEqual(result.premiumPolicyEvidence, input().segments.map(item => ({ ref: item.premiumEvidence.ref, digest: item.premiumEvidence.digest })));
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.actionAuthority, false);
});

test('fails closed on missing or mixed currency and unchanged-identity monetary mutations', () => {
  const mutations = [
    x => { delete x.currency; },
    x => { x.currency = 'gbp'; },
    x => { x.segments[0].rateEvidence.currency = 'EUR'; },
    x => { x.segments[0].premiumEvidence.currency = 'EUR'; },
    x => { x.segments[0].rateEvidence.hourlyRate = 200; },
    x => { x.segments[0].premiumEvidence.multiplier = 2; },
    x => { x.segments[0].rateEvidence.validTo = '2026-10-21T00:00:00Z'; },
    x => { x.segments[0].premiumEvidence.validFrom = '2026-10-23T00:00:00Z'; },
    x => { delete x.segments[0].rateEvidence; },
    x => { delete x.segments[0].premiumEvidence; }
  ];
  for (const mutate of mutations) { const value = input(); mutate(value); assert.throws(() => assessShiftPremiumEvidence(value)); }
});

test('rejects repeated, overlapping, foreign, stale and coerced evidence', () => {
  const mutations = [
    x => { x.source.complete = false; },
    x => { x.source.tenantId = 'other-tenant'; },
    x => { x.source.siteId = 'other-site'; },
    x => { x.source.observedAt = '2026-10-22T12:30:00Z'; },
    x => { x.segments[1].siteId = 'other'; },
    x => { x.segments[1].evidenceRef = 'segment-a1'; },
    x => { x.segments[1].assignmentRef = 'assignment-a'; },
    x => { x.segments[0].premiumEvidence.policyRevision = 'old'; },
    x => { x.segments[0].rateEvidence.hourlyRate = '20'; },
    x => { x.segments[0].premiumEvidence.multiplier = 0.9; },
    x => { x.segments[0].start = '2026-10-22T07:00:00Z'; },
    x => { x.segments[0].end = '2026-10-22T08:00:00Z'; },
    x => { x.segments[0].end = '2026-02-30T09:00:00Z'; }
  ];
  for (const mutate of mutations) { const value = input(); mutate(value); assert.throws(() => assessShiftPremiumEvidence(value)); }
});

test('a non-premium segment yields zero premium without a savings claim', () => {
  const value = input();
  for (const item of value.segments) {
    item.multiplier = 1;
    item.premiumEvidence = policyEvidence({ ref: item.premiumEvidence.ref, currency: 'GBP', premiumCode: 'NIGHT', multiplier: 1 });
  }
  const result = assessShiftPremiumEvidence(value);
  assert.equal(result.status, 'NO_DECLARED_PREMIUM');
  assert.equal(result.premiumPence, 0);
});
