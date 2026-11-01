'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOrderMaterialAvailability } = require('./order-material-availability.cjs');

function fixture() {
  const scope = { tenantId: 'synthetic-tenant', siteId: 'site-a', orderId: 'order-a' };
  return {
    ...scope, asOf: '2026-10-26T12:00:00Z',
    bom: { ...scope, source: 'MES_BOM', revision: 'bom-r3', digest: 'sha256:bom-r3', complete: true,
      observedAt: '2026-10-26T10:00:00Z', effectiveStart: '2026-10-26T00:00:00Z', effectiveEnd: '2026-10-27T00:00:00Z',
      components: [
        { ...scope, componentId: 'part-a', unit: 'EA', requiredMilliunits: 2500, evidenceRef: 'bom-line-a', evidenceDigest: 'sha256:bom-a' },
        { ...scope, componentId: 'part-b', unit: 'KG', requiredMilliunits: 3000, evidenceRef: 'bom-line-b', evidenceDigest: 'sha256:bom-b' }
      ] },
    inventory: { ...scope, source: 'ERP_ALLOCATABLE_STOCK', revision: 'inv-r7', digest: 'sha256:inv-r7', complete: true,
      bomRevision: 'bom-r3', bomDigest: 'sha256:bom-r3', observedAt: '2026-10-26T11:55:00Z',
      balances: [
        { ...scope, componentId: 'part-a', unit: 'EA', allocatableMilliunits: 3000, evidenceRef: 'stock-a', evidenceDigest: 'sha256:stock-a' },
        { ...scope, componentId: 'part-b', unit: 'KG', allocatableMilliunits: 1000, evidenceRef: 'stock-b', evidenceDigest: 'sha256:stock-b' }
      ] }
  };
}

test('reports one exact-order declared shortage without quantities summed across units or purchase authority', () => {
  const result = assessOrderMaterialAvailability(fixture());
  assert.equal(result.status, 'DECLARED_MATERIAL_SHORTFALL');
  assert.equal(result.componentCount, 2);
  assert.equal(result.shortfallCount, 1);
  assert.deepEqual(result.shortfalls, [{ componentId: 'part-b', unit: 'KG', missingMilliunits: 2000,
    bomEvidenceRef: 'bom-line-b', bomEvidenceDigest: 'sha256:bom-b',
    inventoryEvidenceRef: 'stock-b', inventoryEvidenceDigest: 'sha256:stock-b' }]);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
  assert.equal(result.claimedSavingsPence, null);
});

test('full declared coverage remains a source claim', () => {
  const input = fixture(); input.inventory.balances[1].allocatableMilliunits = 3000;
  const result = assessOrderMaterialAvailability(input);
  assert.equal(result.status, 'NO_DECLARED_MATERIAL_SHORTFALL');
  assert.deepEqual(result.shortfalls, []);
  assert.equal(result.sourceAuthenticated, false);
});

test('rejects incomplete, stale, foreign, contradictory and coerced records', () => {
  const mutations = [
    x => { x.bom.complete = false; },
    x => { x.inventory.complete = false; },
    x => { x.bom.orderId = 'other'; },
    x => { x.inventory.siteId = 'other'; },
    x => { x.bom.components[0].tenantId = 'other'; },
    x => { x.inventory.balances[0].orderId = 'other'; },
    x => { x.inventory.bomRevision = 'old'; },
    x => { x.inventory.bomDigest = 'sha256:old'; },
    x => { x.inventory.observedAt = '2026-10-26T11:30:00Z'; },
    x => { x.inventory.observedAt = '2026-10-26T12:00:01Z'; },
    x => { x.bom.effectiveEnd = '2026-10-26T11:00:00Z'; },
    x => { x.bom.components[1].componentId = 'part-a'; },
    x => { x.inventory.balances[1].componentId = 'part-a'; },
    x => { x.inventory.balances.pop(); },
    x => { x.inventory.balances.push(structuredClone(x.inventory.balances[0])); },
    x => { x.inventory.balances[0].unit = 'KG'; },
    x => { x.bom.components[0].requiredMilliunits = '2500'; },
    x => { x.inventory.balances[0].allocatableMilliunits = -1; },
    x => { x.inventory.balances[0].allocatableMilliunits = 1.5; },
    x => { x.inventory.balances[0].evidenceRef = 'bom-line-a'; },
    x => { x.asOf = '2026-02-30T12:00:00Z'; }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => assessOrderMaterialAvailability(input));
  }
});

test('rejects accessor-backed and sparse source arrays', () => {
  const accessor = fixture();
  Object.defineProperty(accessor.inventory.balances[0], 'allocatableMilliunits', { get() { throw Error('accessor ran'); } });
  assert.throws(() => assessOrderMaterialAvailability(accessor), /own data field/);
  const sparse = fixture(); delete sparse.bom.components[1];
  assert.throws(() => assessOrderMaterialAvailability(sparse), /explicit data entries/);
});

test('rejects proxy evidence objects that could change fields after validation', () => {
  const disagree = (object, property) => new Proxy(object, {
    get(target, key, receiver) { return key === property ? '2020-01-01T00:00:00Z' : Reflect.get(target, key, receiver); }
  });
  const input = fixture();
  assert.throws(() => assessOrderMaterialAvailability(disagree(input, 'asOf')), /proxy/i);
  input.bom = disagree(input.bom, 'observedAt');
  assert.throws(() => assessOrderMaterialAvailability(input), /proxy/i);
  input.bom = fixture().bom;
  input.inventory = disagree(input.inventory, 'observedAt');
  assert.throws(() => assessOrderMaterialAvailability(input), /proxy/i);
});

test('rejects proxied collections with changing length before a shortfall can disappear', () => {
  for (const field of ['components', 'balances']) {
    const input = fixture();
    const owner = field === 'components' ? input.bom : input.inventory;
    let reads = 0;
    owner[field] = new Proxy(owner[field], {
      get(target, key, receiver) {
        if (key === 'length') return ++reads <= 2 ? 2 : 1;
        return Reflect.get(target, key, receiver);
      }
    });
    assert.throws(() => assessOrderMaterialAvailability(input), /proxy/i);
  }
});
