'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./quality-loss-cost-evidence.cjs');

const scope = { tenantId: 't1', siteId: 's1', workCentreId: 'wc1', productId: 'p1', orderId: 'o1' };
function fixture() {
  return { ...scope, windowStart: '2026-10-20T08:00:00.000Z', windowEnd: '2026-10-20T09:00:00.000Z',
    asOf: '2026-10-20T10:00:00.000Z', sourceKind: 'QMS', sourceId: 'qms1', sourceRevision: 'r1',
    complete: true, evidenceRef: 'qms:window:r1',
    events: [
      { ...scope, eventId: 'e1', kind: 'REWORK', sourceRevision: 'r1',
        occurredAt: '2026-10-20T08:15:00.000Z', observedAt: '2026-10-20T08:16:00.000Z',
        evidenceRef: 'qms:e1', recordSha256: 'a'.repeat(64), declaredCostPence: 1200 },
      { ...scope, eventId: 'e2', kind: 'SCRAP', sourceRevision: 'r1',
        occurredAt: '2026-10-20T08:30:00.000Z', observedAt: '2026-10-20T08:31:00.000Z',
        evidenceRef: 'qms:e2', recordSha256: 'b'.repeat(64), declaredCostPence: 300 }
    ] };
}

test('totals independently declared scoped QMS loss without asserting savings or source authentication', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'REVIEW_DECLARED_COST');
  assert.deepEqual(result.declaredCostPence, { rework: 1200, scrap: 300, total: 1500 });
  assert.equal(result.eventCount, 2);
  assert.deepEqual(result.eventEvidence.map(row => row.eventId), ['e1', 'e2']);
  assert.equal(result.eventEvidence[0].recordSha256, 'a'.repeat(64));
  assert.equal(result.sourceId, 'qms1');
  assert.equal(result.asOf, '2026-10-20T10:00:00.000Z');
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.claimedSavingsPence, null);
  assert.equal(result.executionAuthority, false);
});

test('complete empty window carries zero declared cost but no quality or savings claim', () => {
  const input = fixture(); input.events = [];
  const result = assess(input);
  assert.deepEqual(result.declaredCostPence, { rework: 0, scrap: 0, total: 0 });
  assert.equal(result.claimBoundary, 'SUPPLIED_QMS_AGGREGATE_ONLY');
});

test('foreign, incomplete, duplicate, private, malformed and future QMS records block', () => {
  const changes = [
    x => { x.complete = false; }, x => { x.events[0].tenantId = 'other'; },
    x => { x.events[0].orderId = 'other'; }, x => { x.events[0].sourceRevision = 'r2'; },
    x => { x.events[1].eventId = 'e1'; }, x => { x.events[1].evidenceRef = 'qms:e1'; },
    x => { x.events[1].recordSha256 = x.events[0].recordSha256; },
    x => { x.events[0].kind = 'DEFECT'; }, x => { x.events[0].employeeId = 'person'; },
    x => { x.events[0].declaredCostPence = -1; }, x => { x.events[0].declaredCostPence = 1.5; },
    x => { x.events[0].recordSha256 = 'bad'; },
    x => { x.events[0].occurredAt = x.windowEnd; },
    x => { x.events[0].observedAt = '2026-10-20T08:14:00.000Z'; },
    x => { x.events[0].observedAt = '2026-10-20T10:01:00.000Z'; },
    x => { x.windowEnd = '2026-10-20T08:00:00.000Z'; },
    x => { x.events[0].declaredCostPence = Number.MAX_SAFE_INTEGER; }
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.equal(assess(input).status, 'BLOCKED'); }
});

test('hidden and Symbol event fields cannot bypass the exact QMS evidence schema', () => {
  const hidden = fixture();
  Object.defineProperty(hidden.events[0], 'employeeId', { value: 'person-1', enumerable: false });
  assert.equal(assess(hidden).status, 'BLOCKED');

  const symbol = fixture();
  symbol.events[0][Symbol('private-worker')] = 'person-1';
  assert.equal(assess(symbol).status, 'BLOCKED');
});

test('active cost accessors cannot publish a different aggregate from the validated event evidence', () => {
  const input = fixture();
  let reads = 0;
  Object.defineProperty(input.events[0], 'declaredCostPence', { enumerable: true, get() {
    reads += 1;
    return reads < 4 ? 100 : 1000;
  }});
  assert.equal(assess(input).status, 'BLOCKED');
  assert.equal(reads, 0);
});

test('root and collection proxies, accessors and inherited fields fail closed before QMS aggregation', () => {
  assert.equal(assess(new Proxy(fixture(), {})).status, 'BLOCKED');

  const proxiedEvents = fixture();
  proxiedEvents.events = new Proxy(proxiedEvents.events, {});
  assert.equal(assess(proxiedEvents).status, 'BLOCKED');

  const activeEvents = fixture();
  let reads = 0;
  const original = activeEvents.events;
  const substituted = original.map(row => ({ ...row, declaredCostPence: 9000 }));
  Object.defineProperty(activeEvents, 'events', { enumerable: true, get() {
    return reads++ === 0 ? original : substituted;
  }});
  assert.equal(assess(activeEvents).status, 'BLOCKED');
  assert.equal(reads, 0);

  const inherited = fixture();
  const event = Object.assign(Object.create({ tenantId: inherited.events[0].tenantId }), inherited.events[0]);
  delete event.tenantId;
  inherited.events[0] = event;
  assert.equal(assess(inherited).status, 'BLOCKED');
});

test('revoked proxies fail closed at every structural layer', () => {
  const root = Proxy.revocable(fixture(), {}); root.revoke();
  assert.equal(assess(root.proxy).status, 'BLOCKED');

  const collectionInput = fixture();
  const collection = Proxy.revocable(collectionInput.events, {}); collection.revoke();
  collectionInput.events = collection.proxy;
  assert.equal(assess(collectionInput).status, 'BLOCKED');

  const eventInput = fixture();
  const event = Proxy.revocable(eventInput.events[0], {}); event.revoke();
  eventInput.events[0] = event.proxy;
  assert.equal(assess(eventInput).status, 'BLOCKED');
});

test('record hashes must be primitive strings without invoking caller coercion', () => {
  const objectHash = fixture();
  let coercions = 0;
  objectHash.events[0].recordSha256 = { toString() { coercions += 1; return 'a'.repeat(64); } };
  assert.equal(assess(objectHash).status, 'BLOCKED');
  assert.equal(coercions, 0);

  const symbolHash = fixture();
  symbolHash.events[0].recordSha256 = Symbol('hash');
  assert.equal(assess(symbolHash).status, 'BLOCKED');

  const duplicateText = fixture();
  duplicateText.events[0].recordSha256 = { toString() { return 'c'.repeat(64); } };
  duplicateText.events[1].recordSha256 = { toString() { return 'c'.repeat(64); } };
  assert.equal(assess(duplicateText).status, 'BLOCKED');
});

test('oversized event collections block before key enumeration or element copying', () => {
  const input = fixture();
  input.events = Array.from({ length: 10001 }, () => input.events[0]);
  const ownKeys = Reflect.ownKeys;
  let oversizedEnumerations = 0;
  Reflect.ownKeys = value => {
    if (value === input.events) {
      oversizedEnumerations += 1;
      throw new Error('oversized events must be rejected before enumeration');
    }
    return ownKeys(value);
  };
  try {
    assert.equal(assess(input).status, 'BLOCKED');
    assert.equal(oversizedEnumerations, 0);
  } finally {
    Reflect.ownKeys = ownKeys;
  }
});

test('prototype pollution cannot intercept or replace inert snapshot fields', () => {
  let writes = 0;
  Object.defineProperty(Object.prototype, 'tenantId', {
    configurable: true,
    get() { return 'attacker'; },
    set() { writes += 1; }
  });
  try {
    const result = assess(fixture());
    assert.equal(result.status, 'REVIEW_DECLARED_COST');
    assert.equal(result.tenantId, 't1');
    assert.equal(writes, 0);
  } finally {
    delete Object.prototype.tenantId;
  }
});

test('array prototype pollution cannot replace snapshotted events or published evidence rows', () => {
  const input = fixture();
  const replacement = { ...input.events[0], eventId: 'poison', evidenceRef: 'qms:poison',
    recordSha256: 'c'.repeat(64), declaredCostPence: 999 };
  let reads = 0, writes = 0, result;
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    get() { reads += 1; return replacement; },
    set() { writes += 1; }
  });
  try {
    result = assess(input);
  } finally {
    delete Array.prototype[0];
  }
  assert.equal(result.status, 'REVIEW_DECLARED_COST');
  assert.deepEqual(result.declaredCostPence, { rework: 1200, scrap: 300, total: 1500 });
  assert.deepEqual(result.eventEvidence.map(row => row.eventId), ['e1', 'e2']);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('collection accessors, hidden keys, Symbols and sparse indexes block without executing getters', () => {
  const accessor = fixture();
  let reads = 0;
  Object.defineProperty(accessor.events, '0', { enumerable: true, get() { reads += 1; return fixture().events[0]; } });
  assert.equal(assess(accessor).status, 'BLOCKED');
  assert.equal(reads, 0);

  const hiddenRoot = fixture();
  Object.defineProperty(hiddenRoot, 'private', { value: true, enumerable: false });
  assert.equal(assess(hiddenRoot).status, 'BLOCKED');

  const symbolCollection = fixture();
  symbolCollection.events[Symbol('private')] = true;
  assert.equal(assess(symbolCollection).status, 'BLOCKED');

  const sparse = fixture();
  sparse.events = [sparse.events[0], , sparse.events[1]];
  assert.equal(assess(sparse).status, 'BLOCKED');
});
