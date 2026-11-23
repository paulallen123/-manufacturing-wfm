// Deliberately RED owner-handoff regressions; no runtime repair is included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const head = 'b6446b13bc52cc261db815b00903ffb75b20e6ee';
const source = execFileSync('git', ['show', head + ':operations/runtime/payroll-release-variance.cjs'], {encoding:'utf8'});
const module = {exports:{}};
vm.runInThisContext('(function(module,exports,require){' + source + '\n})')(module, module.exports, createRequire(import.meta.url));
const compare = module.exports;
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


test('valid synthetic receipt remains MATCHED', () => assert.equal(compare(fixture()).status, 'MATCHED'));
const mutations = {
  'coercive hash with synthetic private data': x => { x.released.exportSha256 = {employeeId:'synthetic-private', toString:()=> 'a'.repeat(64)}; },
  'coercive currency': x => { const c = {toString:()=> 'GBP'}; x.currency=x.approved.currency=x.released.currency=c; },
  'hidden private field': x => Object.defineProperty(x.released, 'employeeId', {value:'synthetic-private'}),
  'symbol private field': x => { x.released[Symbol('private')] = 'synthetic-private'; },
  'tenant changes after validation': x => { let reads=0; Object.defineProperty(x,'tenantId',{enumerable:true,get(){ return ++reads <= 3 ? 't1' : 'foreign'; }}); },
  'total becomes NaN after validation': x => { let reads=0; Object.defineProperty(x.released,'totalPence',{enumerable:true,get(){ return ++reads <= 2 ? 11200 : NaN; }}); },
  'getter throws': x => Object.defineProperty(x,'tenantId',{enumerable:true,get(){throw Error('synthetic getter');}}),
  'proxy throws': x => { x.released = new Proxy(x.released,{ownKeys(){throw Error('synthetic proxy');}}); }
};
for (const [name, mutate] of Object.entries(mutations)) test(name + ' must BLOCK', () => {
 const x=fixture(); mutate(x); const result=compare(x);
 assert.equal(result.status, 'BLOCKED', JSON.stringify(result));
});
test('published nested receipt is immutable', () => {
 const r=compare(fixture()); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.variancePence) && Object.isFrozen(r.evidenceRefs));
});
