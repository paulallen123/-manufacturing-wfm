'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessDemandPeakEvidence } = require('./demand-peak-evidence.cjs');

function fixture() {
  const tenantId = 'synthetic-tenant', siteId = 'site-a', meterId = 'meter-a', sourceRevision = 'meter-r2';
  const make = (start, end, kw, evidenceRef) => ({ tenantId, siteId, meterId, sourceRevision, start, end, kw,
    evidenceRef, evidenceDigest: `sha256:${evidenceRef}` });
  return {
    tenantId, siteId, asOf: '2026-10-23T11:00:00Z',
    period: { start: '2026-10-23T09:00:00Z', end: '2026-10-23T10:00:00Z' }, intervalMinutes: 30,
    meter: { tenantId, siteId, meterId, source: 'SITE_METER', revision: sourceRevision,
      digest: 'sha256:meter-snapshot', complete: true, observedAt: '2026-10-23T10:30:00Z' },
    tariff: { tenantId, siteId, tariffId: 'tariff-a', revision: 'tariff-r1', digest: 'sha256:tariff',
      observedAt: '2026-10-23T08:00:00Z', effectiveStart: '2026-10-23T00:00:00Z',
      effectiveEnd: '2026-10-24T00:00:00Z', thresholdKw: 100 },
    samples: [
      make('2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z', 95, 'sample-a'),
      make('2026-10-23T09:30:00Z', '2026-10-23T10:00:00Z', 125, 'sample-b')
    ]
  };
}

test('reports the declared exact-interval peak and evidence without cost or action authority', () => {
  const result = assessDemandPeakEvidence(fixture());
  assert.equal(result.status, 'DECLARED_PEAK_ABOVE_THRESHOLD');
  assert.equal(result.peakKw, 125);
  assert.equal(result.excessKw, 25);
  assert.equal(result.peakStart, '2026-10-23T09:30:00Z');
  assert.deepEqual(result.evidence.map(x => x.evidenceRef), ['sample-a', 'sample-b']);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.actionAuthority, false);
});

test('an at-threshold peak is not classified as excess', () => {
  const input = fixture(); input.samples[1].kw = 100;
  assert.equal(assessDemandPeakEvidence(input).status, 'NO_DECLARED_THRESHOLD_EXCESS');
});

test('rejects incomplete, foreign, inconsistent or coerced evidence', () => {
  const mutations = [
    x => { x.meter.complete = false; },
    x => { x.meter.siteId = 'other'; },
    x => { x.tariff.tenantId = 'other'; },
    x => { x.samples[0].tenantId = 'other'; },
    x => { x.samples[0].meterId = 'other'; },
    x => { x.samples[0].sourceRevision = 'old'; },
    x => { x.samples[0].evidenceDigest = x.samples[1].evidenceDigest; },
    x => { x.samples[0].kw = '95'; },
    x => { x.samples[1].kw = Infinity; },
    x => { x.tariff.thresholdKw = -1; },
    x => { x.tariff.thresholdKw = '100'; },
    x => { x.meter.observedAt = '2026-10-23T09:59:59Z'; },
    x => { x.tariff.observedAt = '2026-10-23T11:00:01Z'; },
    x => { x.tariff.effectiveEnd = '2026-10-23T09:30:00Z'; },
    x => { x.samples[1].start = '2026-10-23T09:15:00Z'; },
    x => { x.samples[1].end = '2026-10-23T10:15:00Z'; },
    x => { x.samples.pop(); },
    x => { x.period.end = '2026-02-30T10:00:00Z'; },
    x => { x.intervalMinutes = 20; }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => assessDemandPeakEvidence(input));
  }
});

test('rejects accessor fields and sparse sample arrays', () => {
  const accessor = fixture();
  Object.defineProperty(accessor.samples[0], 'kw', { get() { throw Error('accessor ran'); } });
  assert.throws(() => assessDemandPeakEvidence(accessor), /own data field/);
  const sparse = fixture(); delete sparse.samples[1];
  assert.throws(() => assessDemandPeakEvidence(sparse), /explicit data entries/);
});

test('rejects active root and nested proxies without invoking traps', () => {
  for (const path of ['root', 'period', 'meter', 'tariff', 'samples', 'sample']) {
    const input = fixture();
    let traps = 0;
    const handler = {
      get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); },
      getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
      ownKeys(target) { traps++; return Reflect.ownKeys(target); },
      getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); }
    };
    if (path === 'root') assert.throws(() => assessDemandPeakEvidence(new Proxy(input, handler)));
    else if (path === 'sample') {
      input.samples[0] = new Proxy(input.samples[0], handler);
      assert.throws(() => assessDemandPeakEvidence(input));
    } else {
      input[path] = new Proxy(input[path], handler);
      assert.throws(() => assessDemandPeakEvidence(input));
    }
    assert.equal(traps, 0, `${path} proxy trap executed`);
  }
});

test('rejects revoked root and nested proxies with a controlled contract error', () => {
  for (const path of ['root', 'period', 'meter', 'tariff', 'samples', 'sample']) {
    const input = fixture();
    const target = path === 'root' ? input : path === 'sample' ? input.samples[0] : input[path];
    const { proxy, revoke } = Proxy.revocable(target, {});
    if (path === 'sample') input.samples[0] = proxy;
    else if (path !== 'root') input[path] = proxy;
    revoke();
    assert.throws(() => assessDemandPeakEvidence(path === 'root' ? proxy : input),
      /evidence object|meter interval list|explicit data entry/i);
  }
});

test('keeps validated output immutable after ambient intrinsic substitution', () => {
  const originals = {
    descriptor: Object.getOwnPropertyDescriptor, hasOwn: Object.hasOwn, freeze: Object.freeze,
    isArray: Array.isArray, includes: Array.prototype.includes,
    regexTest: RegExp.prototype.test, replace: String.prototype.replace,
    parse: Date.parse, finite: Number.isFinite, max: Math.max, Set: global.Set
  };
  let calls = 0;
  try {
    Object.getOwnPropertyDescriptor = () => { calls++; throw Error('ambient descriptor called'); };
    Object.hasOwn = () => { calls++; throw Error('ambient hasOwn called'); };
    Object.freeze = value => { calls++; return value; };
    Array.isArray = () => { calls++; throw Error('ambient isArray called'); };
    Array.prototype.includes = () => { calls++; return true; };
    RegExp.prototype.test = () => { calls++; throw Error('ambient regex test called'); };
    String.prototype.replace = () => { calls++; throw Error('ambient replace called'); };
    Date.parse = () => { calls++; throw Error('ambient parse called'); };
    Number.isFinite = () => { calls++; throw Error('ambient finite called'); };
    Math.max = () => { calls++; throw Error('ambient max called'); };
    global.Set = function FakeSet() { calls++; throw Error('ambient Set called'); };
    const result = assessDemandPeakEvidence(fixture());
    const unsupported = fixture();
    unsupported.intervalMinutes = 20;
    unsupported.samples = [
      { ...unsupported.samples[0], end: '2026-10-23T09:20:00Z' },
      { ...unsupported.samples[1], start: '2026-10-23T09:20:00Z', end: '2026-10-23T09:40:00Z' },
      { ...unsupported.samples[1], start: '2026-10-23T09:40:00Z', evidenceRef: 'sample-c', evidenceDigest: 'sha256:sample-c' }
    ];
    let unsupportedAccepted = false;
    try { assessDemandPeakEvidence(unsupported); unsupportedAccepted = true; } catch {}
    if (unsupportedAccepted) throw Error('unsupported interval accepted after ambient substitution');
    assert.equal(result.peakKw, 125);
    assert.equal(result.claimedSavingsPence, null);
    assert.equal(result.sourceAuthenticated, false);
    assert.equal(result.actionAuthority, false);
    assert.equal(originals.freeze === Object.freeze, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.period), true);
    assert.equal(Object.isFrozen(result.meter), true);
    assert.equal(Object.isFrozen(result.tariff), true);
    assert.equal(Object.isFrozen(result.evidence), true);
    assert.equal(Object.isFrozen(result.evidence[0]), true);
    assert.equal(calls, 0);
  } finally {
    Object.getOwnPropertyDescriptor = originals.descriptor;
    Object.hasOwn = originals.hasOwn;
    Object.freeze = originals.freeze;
    Array.isArray = originals.isArray;
    Array.prototype.includes = originals.includes;
    RegExp.prototype.test = originals.regexTest;
    String.prototype.replace = originals.replace;
    Date.parse = originals.parse;
    Number.isFinite = originals.finite;
    Math.max = originals.max;
    global.Set = originals.Set;
  }
});
