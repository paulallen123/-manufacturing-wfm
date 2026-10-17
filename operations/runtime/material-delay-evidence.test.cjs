'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMaterialDelayEvidence } = require('./material-delay-evidence.cjs');

const scope = Object.freeze({
  tenantId: 'synthetic-tenant',
  siteId: 'synthetic-site',
  materialId: 'material-a',
  productionOrderId: 'order-17'
});

function fixture() {
  return {
    asOf: '2026-10-17T12:00:00.000Z',
    maxEvidenceAgeMs: 15 * 60 * 1000,
    requirement: {
      ...scope,
      requirementRevision: 'requirement-r4',
      requiredAt: '2026-10-17T14:00:00.000Z',
      requiredQuantity: 1200,
      unit: 'kg',
      sourceRef: 'erp-requirement-44'
    },
    supply: {
      ...scope,
      requirementRevision: 'requirement-r4',
      expectedAt: '2026-10-17T15:30:00.000Z',
      expectedQuantity: 1200,
      unit: 'kg',
      observedAt: '2026-10-17T11:55:00.000Z',
      lifecycle: 'ACTIVE',
      sourceRef: 'edi-status-91'
    }
  };
}

function blocked(input, reason) {
  const receipt = assessMaterialDelayEvidence(input);
  assert.equal(receipt.status, 'BLOCKED');
  assert.equal(receipt.planningAuthority, false);
  assert.equal(receipt.procurementAuthority, false);
  assert.equal(receipt.scheduleAuthority, false);
  assert.ok(receipt.reasons.includes(reason), JSON.stringify(receipt));
}

test('reports a scoped current material delay without granting action authority', () => {
  const input = fixture();
  const before = structuredClone(input);
  const receipt = assessMaterialDelayEvidence(input);

  assert.equal(receipt.status, 'DELAY_EVIDENCE_CURRENT');
  assert.equal(receipt.delayMinutes, 90);
  assert.deepEqual(receipt.scope, { ...scope, requirementRevision: 'requirement-r4' });
  assert.deepEqual(receipt.sourceRefs, {
    requirement: 'erp-requirement-44',
    supply: 'edi-status-91'
  });
  assert.equal(receipt.sourceAuthenticated, false);
  assert.equal(receipt.planningAuthority, false);
  assert.equal(receipt.procurementAuthority, false);
  assert.equal(receipt.scheduleAuthority, false);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.scope));
  assert.ok(Object.isFrozen(receipt.sourceRefs));
});

test('reports current on-time evidence without inventing a delay', () => {
  const input = fixture();
  input.supply.expectedAt = input.requirement.requiredAt;
  const receipt = assessMaterialDelayEvidence(input);
  assert.equal(receipt.status, 'ON_TIME_EVIDENCE_CURRENT');
  assert.equal(receipt.delayMinutes, 0);
});

test('blocks tenant, site, material, order and requirement revision drift', () => {
  for (const key of ['tenantId', 'siteId', 'materialId', 'productionOrderId', 'requirementRevision']) {
    const input = fixture();
    input.supply[key] = 'other';
    blocked(input, 'SCOPE_MISMATCH');
  }
});

test('blocks stale, future-observed and impossible chronology', () => {
  const stale = fixture();
  stale.supply.observedAt = '2026-10-17T11:44:59.999Z';
  blocked(stale, 'STALE_EVIDENCE');

  const future = fixture();
  future.supply.observedAt = '2026-10-17T12:00:00.001Z';
  blocked(future, 'FUTURE_EVIDENCE');

  const impossible = fixture();
  impossible.requirement.requiredAt = '2026-02-30T14:00:00.000Z';
  blocked(impossible, 'INVALID_REQUIREMENT');
});

test('blocks cancelled supply and incomplete or coercive quantities', () => {
  const cancelled = fixture();
  cancelled.supply.lifecycle = 'CANCELLED';
  blocked(cancelled, 'INACTIVE_SUPPLY');

  const short = fixture();
  short.supply.expectedQuantity = 1199;
  blocked(short, 'INSUFFICIENT_QUANTITY');

  const coercive = fixture();
  coercive.supply.expectedQuantity = '1200';
  blocked(coercive, 'INVALID_SUPPLY');
});

test('blocks missing source custody references and unit mismatch', () => {
  const missing = fixture();
  missing.supply.sourceRef = '';
  blocked(missing, 'INVALID_SUPPLY');

  const unit = fixture();
  unit.supply.unit = 'units';
  blocked(unit, 'UNIT_MISMATCH');
});

test('rejects active, inherited, sparse and cyclic packets without invoking accessors', () => {
  const active = fixture();
  let reads = 0;
  Object.defineProperty(active.supply, 'expectedAt', {
    enumerable: true,
    get() { reads += 1; return '2026-10-17T15:30:00.000Z'; }
  });
  blocked(active, 'INVALID_JSON');
  assert.equal(reads, 0);

  const inherited = fixture();
  inherited.supply = Object.assign(Object.create({ hidden: true }), inherited.supply);
  blocked(inherited, 'INVALID_JSON');

  const sparse = fixture();
  sparse.extra = new Array(2);
  sparse.extra[1] = 'x';
  blocked(sparse, 'INVALID_JSON');

  const cyclic = fixture();
  cyclic.self = cyclic;
  blocked(cyclic, 'INVALID_JSON');
});

test('does not infer causality, savings, customer readiness or machine authority', () => {
  const receipt = assessMaterialDelayEvidence(fixture());
  assert.equal(receipt.cause, null);
  assert.equal(receipt.savings, null);
  assert.equal(receipt.customerReady, false);
  assert.equal(receipt.machineAuthority, false);
});

test('rejects primitive top-level packets without consulting polluted prototypes', () => {
  const prior = Object.getOwnPropertyDescriptor(String.prototype, 'asOf');
  let reads = 0;
  Object.defineProperty(String.prototype, 'asOf', {
    configurable: true,
    get() { reads += 1; throw new Error('polluted getter ran'); }
  });
  try {
    blocked('not-a-packet', 'INVALID_JSON');
    assert.equal(reads, 0);
  } finally {
    if (prior) Object.defineProperty(String.prototype, 'asOf', prior);
    else delete String.prototype.asOf;
  }
});

test('captured primordials preserve identity, chronology, finite delay and reason output', () => {
  const originalTrim = String.prototype.trim;
  const originalIso = Date.prototype.toISOString;
  const originalMax = Math.max;
  const originalString = global.String;
  try {
    String.prototype.trim = () => 'admitted';
    const whitespace = fixture();
    whitespace.requirement.sourceRef = '   ';
    whitespace.supply.sourceRef = '   ';
    blocked(whitespace, 'INVALID_REQUIREMENT');

    Date.prototype.toISOString = () => '2026-02-30T14:00:00.000Z';
    const impossible = fixture();
    impossible.requirement.requiredAt = '2026-02-30T14:00:00.000Z';
    blocked(impossible, 'INVALID_REQUIREMENT');

    Math.max = () => Infinity;
    const receipt = assessMaterialDelayEvidence(fixture());
    assert.equal(receipt.status, 'DELAY_EVIDENCE_CURRENT');
    assert.equal(receipt.delayMinutes, 90);
    assert.equal(Number.isFinite(receipt.delayMinutes), true);

    global.String = () => '0';
    const cancelled = fixture();
    cancelled.supply.lifecycle = 'CANCELLED';
    blocked(cancelled, 'INACTIVE_SUPPLY');
  } finally {
    global.String = originalString;
    String.prototype.trim = originalTrim;
    Date.prototype.toISOString = originalIso;
    Math.max = originalMax;
  }
});

test('post-import Object and Array replacement cannot redefine inert prototypes', () => {
  const OriginalObject = global.Object;
  const OriginalArray = global.Array;
  try {
    const objectPrototype = { inheritedMarker: true };
    const withCustomObject = fixture();
    withCustomObject.supply = Object.assign(Object.create(objectPrototype), withCustomObject.supply);
    blocked(withCustomObject, 'INVALID_JSON');

    function ReplacementObject() {}
    ReplacementObject.prototype = objectPrototype;
    global.Object = ReplacementObject;
    blocked(withCustomObject, 'INVALID_JSON');
    global.Object = OriginalObject;

    const arrayPrototype = { inheritedMarker: true };
    const withCustomArray = fixture();
    withCustomArray.extra = [];
    OriginalObject.setPrototypeOf(withCustomArray.extra, arrayPrototype);
    blocked(withCustomArray, 'INVALID_JSON');

    function ReplacementArray() {}
    ReplacementArray.prototype = arrayPrototype;
    global.Array = ReplacementArray;
    blocked(withCustomArray, 'INVALID_JSON');
  } finally {
    global.Object = OriginalObject;
    global.Array = OriginalArray;
  }
});
