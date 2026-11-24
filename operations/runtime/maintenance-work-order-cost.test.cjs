'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const estimate = require('./maintenance-work-order-cost.cjs');

const input = () => ({
  scope: { tenantId: 't1', siteId: 's1', assetId: 'a1', workOrderId: 'wo1', currency: 'GBP', asOf: '2026-10-17T12:00:00Z' },
  workOrder: { tenantId: 't1', siteId: 's1', assetId: 'a1', id: 'wo1', status: 'OPEN', revision: 'rev1', evidenceRef: 'cmms:wo1:r1', observedAt: '2026-10-17T11:00:00Z', validUntil: '2026-10-18T00:00:00Z', start: '2026-10-18T08:00:00Z', end: '2026-10-18T12:00:00Z' },
  segments: [
    { id: 'internal', kind: 'INTERNAL', roleId: 'tech', start: '2026-10-18T08:00:00Z', end: '2026-10-18T10:00:00Z', rate: { tenantId: 't1', siteId: 's1', roleId: 'tech', sourceKind: 'INTERNAL_RATE_CARD', hourly: 20.01, currency: 'GBP', revision: 'rate1', evidenceRef: 'rate:1', observedAt: '2026-10-17T11:00:00Z', validFrom: '2026-10-17T00:00:00Z', validUntil: '2026-10-19T00:00:00Z' } },
    { id: 'contractor', kind: 'CONTRACTOR', roleId: 'vendor-tech', start: '2026-10-18T10:00:00Z', end: '2026-10-18T11:30:00Z', rate: { tenantId: 't1', siteId: 's1', roleId: 'vendor-tech', sourceKind: 'CONTRACTOR_RATE_CARD', hourly: 42.5, currency: 'GBP', revision: 'rate2', evidenceRef: 'rate:2', observedAt: '2026-10-17T11:00:00Z', validFrom: '2026-10-17T00:00:00Z', validUntil: '2026-10-19T00:00:00Z' } }
  ]
});

test('scoped read-only estimate separates internal and contractor cost', () => {
  const out = estimate(input());
  assert.equal(out.status, 'ESTIMATED');
  assert.deepEqual(out.costPence, { internal: 4002, contractor: 6375, total: 10377 });
  assert.equal(out.currency, 'GBP');
  assert.equal(out.sourceAuthenticated, false);
  assert.equal(out.executionAuthority, false);
  assert.deepEqual(out.evidenceRefs, ['cmms:wo1:r1', 'rate:1', 'rate:2']);
});

test('rejects scope, currency, stale and invalid rate evidence', () => {
  for (const change of [
    x => { x.workOrder.siteId = 'other'; },
    x => { x.segments[1].rate.currency = 'USD'; },
    x => { x.workOrder.validUntil = x.scope.asOf; },
    x => { x.segments[0].rate.validUntil = '2026-10-18T09:59:59Z'; },
    x => { x.segments[0].rate.tenantId = 'other'; },
    x => { x.segments[0].rate.roleId = 'other'; },
    x => { x.segments[1].rate.sourceKind = 'INTERNAL_RATE_CARD'; },
    x => { x.segments[1].rate.observedAt = '2026-10-17T13:00:00Z'; },
    x => { x.segments[0].rate.hourly = -1; },
    x => { x.workOrder.status = 'CLOSED'; },
    x => { x.segments[1].id = x.segments[0].id; },
    x => { x.segments[1].end = '2026-10-18T13:00:00Z'; }
  ]) {
    const x = input(); change(x);
    assert.equal(estimate(x).status, 'BLOCKED');
  }
});

test('does not accept missing source evidence or person-level identifiers', () => {
  const x = input(); delete x.segments[1].rate.evidenceRef;
  assert.equal(estimate(x).status, 'BLOCKED');
  const y = input(); y.segments[0].employeeId = 'person-1';
  assert.equal(estimate(y).status, 'BLOCKED');
});
