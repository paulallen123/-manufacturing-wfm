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

test('coercive currency and export hashes fail closed without conversion', () => {
  for (const apply of [
    x => { x.currency = { toString() { throw new Error('currency coercion'); } }; },
    x => { x.released.exportSha256 = { employeeId: 'private', toString() { throw new Error('hash coercion'); } }; }
  ]) {
    const x = fixture();
    apply(x);
    assert.doesNotThrow(() => assert.equal(compare(x).status, 'BLOCKED'));
  }
});

test('accessors, hidden fields, symbols and custom prototypes fail closed without executing caller code', () => {
  let reads = 0;
  const accessor = fixture();
  Object.defineProperty(accessor.released, 'totalPence', { enumerable: true, get() { reads++; return 11200; } });
  assert.equal(compare(accessor).status, 'BLOCKED');
  assert.equal(reads, 0);

  const hidden = fixture();
  Object.defineProperty(hidden.released, 'employeeId', { value: 'private', enumerable: false });
  assert.equal(compare(hidden).status, 'BLOCKED');

  const symbol = fixture();
  symbol.approved[Symbol('private')] = 'employee';
  assert.equal(compare(symbol).status, 'BLOCKED');

  const inherited = fixture();
  Object.setPrototypeOf(inherited.released, { employeeId: 'private' });
  assert.equal(compare(inherited).status, 'BLOCKED');
});

test('active and revoked proxies fail closed without invoking traps', () => {
  let traps = 0;
  const root = fixture();
  root.approved = new Proxy(root.approved, { ownKeys() { traps++; throw new Error('trap'); } });
  assert.doesNotThrow(() => assert.equal(compare(root).status, 'BLOCKED'));
  assert.equal(traps, 0);

  const nested = fixture();
  const revoked = Proxy.revocable(nested.released, {});
  revoked.revoke();
  nested.released = revoked.proxy;
  assert.doesNotThrow(() => assert.equal(compare(nested).status, 'BLOCKED'));
});

test('published matched and blocked receipts are detached and recursively immutable', () => {
  const input = fixture();
  const result = compare(input);
  input.tenantId = 'foreign';
  input.released.exportSha256 = 'b'.repeat(64);
  assert.equal(result.tenantId, 't1');
  assert.equal(result.exportSha256, 'a'.repeat(64));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.variancePence));
  assert.ok(Object.isFrozen(result.evidenceRefs));
  assert.throws(() => { result.status = 'APPROVED'; }, TypeError);
  assert.throws(() => { result.variancePence.total = 1; }, TypeError);
  assert.throws(() => { result.evidenceRefs.push('forged'); }, TypeError);

  const blocked = compare({});
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(Object.isFrozen(blocked));
  assert.throws(() => { blocked.executionAuthority = true; }, TypeError);
});
