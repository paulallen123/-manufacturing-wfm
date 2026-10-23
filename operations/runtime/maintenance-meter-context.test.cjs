'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMeterContext } = require('./maintenance-meter-context.cjs');

function fixture() {
  return { scope: { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE' },
    source: { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE',
      sourceRef: 'synthetic:cmms:meter-4', sourceRevision: 'r8', observedAt: '2026-10-13T08:00:00.000Z', complete: true },
    readings: [
      { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE', at: '2026-10-12T08:00:00.000Z', value: 100 },
      { tenant: 'synthetic-tenant', site: 'tamworth', asset: 'press-4', meter: 'runtime-hours', unit: 'h', kind: 'CUMULATIVE', at: '2026-10-13T07:00:00.000Z', value: 109 }
    ], now: '2026-10-13T09:00:00.000Z', maxAgeMs: 129600000 };
}

test('computes a scoped cumulative change without an alert or maintenance authority', () => {
  const result = evaluateMeterContext(fixture());
  assert.equal(result.status, 'OBSERVED_CONTEXT');
  assert.equal(result.latestValue, 109);
  assert.equal(result.observedChange, 9);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.maintenanceDue, undefined);
});

test('a counter decrease needs source-owned reset evidence, not a negative usage claim', () => {
  const input = fixture(); input.readings[1].value = 4;
  const result = evaluateMeterContext(input);
  assert.equal(result.status, 'RESET_OR_ROLLOVER_UNVERIFIED');
  assert.equal(result.observedChange, undefined);
});

test('denies foreign, incomplete, stale, future and duplicate observations', () => {
  for (const change of [
    x => { x.readings[1].site = 'other'; },
    x => { x.source.asset = 'other'; },
    x => { x.source.kind = 'INSTANTANEOUS'; },
    x => { x.readings[1].kind = 'INSTANTANEOUS'; },
    x => { x.readings[0].at = '2026-10-01T08:00:00.000Z'; },
    x => { x.source.complete = false; },
    x => { x.source.observedAt = '2026-10-10T00:00:00.000Z'; },
    x => { x.readings[1].at = '2026-10-14T00:00:00.000Z'; },
    x => { x.readings[1].at = x.readings[0].at; }
  ]) { const input = fixture(); change(input); assert.throws(() => evaluateMeterContext(input)); }
});

test('instantaneous condition keeps a source value without treating it as usage or failure', () => {
  const input = fixture(); input.scope.kind = 'INSTANTANEOUS'; input.scope.meter = 'bearing-temperature'; input.scope.unit = 'C';
  for (const reading of input.readings) { reading.meter = 'bearing-temperature'; reading.unit = 'C'; reading.kind = 'INSTANTANEOUS'; }
  input.source.meter = 'bearing-temperature'; input.source.unit = 'C'; input.source.kind = 'INSTANTANEOUS';
  input.readings[0].value = -13; input.readings[1].value = -8;
  const result = evaluateMeterContext(input);
  assert.equal(result.status, 'OBSERVED_CONTEXT');
  assert.equal(result.latestValue, -8);
  assert.equal(result.observedChange, undefined);
  assert.equal(result.conditionState, undefined);
});

test('rejects caller-controlled reading iteration and ambient validation overrides', () => {
  const iteratorInput = fixture();
  const benign = iteratorInput.readings.map(row => ({ ...row }));
  iteratorInput.readings[1].tenant = 'foreign-tenant';
  Object.defineProperty(iteratorInput.readings, Symbol.iterator, {
    configurable: true,
    value: function * () { yield benign[0]; yield benign[1]; }
  });
  assert.throws(() => evaluateMeterContext(iteratorInput), /Invalid meter reading or scope/);

  const originalEvery = Array.prototype.every;
  const originalIncludes = Array.prototype.includes;
  try {
    const scopeInput = fixture();
    scopeInput.scope.tenant = 123;
    scopeInput.source.tenant = 'foreign-source';
    scopeInput.readings[0].tenant = 'foreign-a';
    scopeInput.readings[1].tenant = 'foreign-b';
    Array.prototype.every = function () { return true; };
    assert.throws(() => evaluateMeterContext(scopeInput), /Exact scoped complete meter source required/);

    const kindInput = fixture();
    for (const value of [kindInput.scope, kindInput.source, ...kindInput.readings]) value.kind = 'UNSUPPORTED';
    Array.prototype.includes = function () { return true; };
    assert.throws(() => evaluateMeterContext(kindInput), /Exact scoped complete meter source required/);
  } finally {
    Array.prototype.every = originalEvery;
    Array.prototype.includes = originalIncludes;
  }
});

test('rejects accessors instead of publishing values different from those validated', () => {
  for (const [target, field] of [
    ['scope', 'tenant'], ['source', 'sourceRef'], ['source', 'sourceRevision'],
    ['reading0', 'at'], ['reading1', 'value']
  ]) {
    const input = fixture();
    const object = target === 'scope' ? input.scope : target === 'source' ? input.source :
      target === 'reading0' ? input.readings[0] : input.readings[1];
    const original = object[field];
    Object.defineProperty(object, field, {
      enumerable: true,
      configurable: true,
      get() { return original; }
    });
    assert.throws(() => evaluateMeterContext(input));
  }
});

test('makes caller provenance and advisory authority explicit in an immutable receipt', () => {
  const result = evaluateMeterContext(fixture());
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.currentRevisionVerified, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.maintenanceDue, undefined);
  assert.equal(result.conditionState, undefined);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scope), true);
  assert.throws(() => { result.scope.tenant = 'foreign'; }, TypeError);
});

test('captures validation intrinsics before post-load ambient poisoning', () => {
  const util = require('node:util');
  const originalIsProxy = util.types.isProxy;
  const originalCreate = Object.create;
  const originalTest = RegExp.prototype.test;
  let createCalls = 0;
  try {
    util.types.isProxy = () => false;
    Object.create = () => { createCalls += 1; throw new Error('poisoned create'); };
    RegExp.prototype.test = () => true;

    const proxied = fixture();
    proxied.scope = new Proxy(proxied.scope, {});
    assert.throws(() => evaluateMeterContext(proxied));

    const invalid = fixture();
    invalid.scope.tenant = '';
    invalid.source.tenant = '';
    invalid.readings[0].tenant = '';
    invalid.readings[1].tenant = '';
    assert.throws(() => evaluateMeterContext(invalid));

    const result = evaluateMeterContext(fixture());
    assert.equal(result.latestValue, 109);
    assert.equal(createCalls, 0);
  } finally {
    util.types.isProxy = originalIsProxy;
    Object.create = originalCreate;
    RegExp.prototype.test = originalTest;
  }
});

test('receipt cannot inherit fabricated due or condition claims after publication', () => {
  const result = evaluateMeterContext(fixture());
  Object.defineProperty(Object.prototype, 'maintenanceDue', { value: true, configurable: true });
  Object.defineProperty(Object.prototype, 'conditionState', { value: 'FAILED', configurable: true });
  try {
    assert.equal(result.maintenanceDue, undefined);
    assert.equal(result.conditionState, undefined);
    assert.equal(Object.getPrototypeOf(result), null);
  } finally {
    delete Object.prototype.maintenanceDue;
    delete Object.prototype.conditionState;
  }
});

test('exact two-reading snapshots do not consult global String or Array prototype slots', () => {
  const input = fixture();
  const forged = { ...input.readings[1], value: 777 };
  input.readings[1].tenant = 'foreign';
  input.readings[1].value = -999;
  const originalString = globalThis.String;
  let stringCalls = 0;
  Object.defineProperty(Array.prototype, '1', { value: forged, configurable: true });
  globalThis.String = value => { stringCalls += 1; return originalString(value); };
  let error;
  try {
    evaluateMeterContext(input);
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.String = originalString;
    delete Array.prototype[1];
  }
  assert(error);
  assert.equal(stringCalls, 0);
});
