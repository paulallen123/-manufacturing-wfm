'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const compare = require('./payroll-release-variance.cjs');

const SCOPE = { tenantId: 't1', siteId: 's1', periodId: '2026-10-p1', batchId: 'b1', currency: 'GBP' };
function fixture() {
  const totals = { rowCount: 10, grossPence: 10000, oncostPence: 1200, totalPence: 11200 };
  return { ...SCOPE, asOf: '2026-10-20T12:00:00.000Z',
    approved: { ...SCOPE, sourceKind: 'APPROVAL_LEDGER', sourceId: 'workforce-approval', sourceRevision: 'a1',
      evidenceRef: 'approval:b1:a1', eventAt: '2026-10-20T09:55:00.000Z',
      observedAt: '2026-10-20T10:00:00.000Z', final: true, ...totals },
    released: { ...SCOPE, sourceKind: 'PAYROLL_EXPORT', sourceId: 'payroll-export', sourceRevision: 'e1',
      evidenceRef: 'export:b1:e1', eventAt: '2026-10-20T10:55:00.000Z',
      observedAt: '2026-10-20T11:00:00.000Z', final: true,
      exportSha256: 'a'.repeat(64), ...totals }
  };
}

test('exact independent aggregates match without claiming payroll authority', () => {
  const result = compare(fixture());
  assert.equal(result.status, 'MATCHED');
  assert.deepEqual(result.variancePence, { gross: 0, oncost: 0, total: 0 });
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.employeeDataIncluded, false);
  assert.equal(result.claimBoundary, 'AGGREGATE_VARIANCE_ONLY_NOT_PAYROLL_ACCURACY');
});

test('released excess and row-count mismatch require review rather than a savings claim', () => {
  const x = fixture(); x.released.grossPence += 201; x.released.totalPence += 201; x.released.rowCount++;
  const result = compare(x);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.variancePence.total, 201);
  assert.equal(result.rowCountDifference, 1);
  assert.equal(result.claimedSavingsPence, null);
});

test('foreign, same-source, malformed, unfinalised and private receipts block', () => {
  const changes = [
    x => { x.approved.tenantId = 't2'; },
    x => { x.released.siteId = 's2'; },
    x => { x.released.currency = 'USD'; },
    x => { x.released.sourceId = x.approved.sourceId; },
    x => { x.released.observedAt = '2026-10-20T09:00:00.000Z'; },
    x => { x.released.eventAt = '2026-10-20T09:00:00.000Z'; },
    x => { x.approved.eventAt = '2026-10-20T10:01:00.000Z'; },
    x => { x.approved.final = false; },
    x => { x.released.exportSha256 = 'invalid'; },
    x => { x.released.totalPence = -1; },
    x => { x.released.totalPence = 9999; },
    x => { x.approved.rowCount = 1.5; },
    x => { x.released.employeeId = 'private'; }
  ];
  for (const change of changes) { const x = fixture(); change(x); assert.equal(compare(x).status, 'BLOCKED'); }
});
