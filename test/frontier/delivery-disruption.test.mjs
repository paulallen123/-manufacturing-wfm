import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManufacturingEventGraph } from '../../src/frontier/manufacturing-event-graph.mjs';
import { evaluateDeliveryDisruption } from '../../src/frontier/delivery-disruption.mjs';

const NOW = '2026-09-18T06:00:00.000Z';
const T = 'tenant-synthetic';
const S = 'site-synthetic';

function evt({ eventId, entityType, entityId, eventType, occurredAt = '2026-09-18T05:55:00.000Z', observedAt = occurredAt, revision = 1, confidence = 0.98, status = 'active', payload = {} }) {
  return { eventId, tenantId: T, siteId: S, source: 'synthetic', entityType, entityId, eventType, occurredAt, observedAt, revision, confidence, status, payload };
}

function baseInput() {
  return {
    now: NOW,
    tenantId: T,
    siteId: S,
    ids: { materialId: 'MAT-A', shipmentId: 'SHIP-1', productionOrderId: 'PO-1', lineId: 'LINE-4' },
    minimumDecisionConfidence: 0.6,
    minimumNetBenefit: 1,
    freshnessMinutes: { inventory: 60, production: 240, shipment: 30, economics: 1440 },
    events: [
      evt({ eventId: 'inv-1', entityType: 'material', entityId: 'MAT-A', eventType: 'inventory.snapshot', payload: { quantityOnHand: 2400, safetyStock: 0 } }),
      evt({ eventId: 'cons-1', entityType: 'production_order', entityId: 'PO-1', eventType: 'production.consumption_rate', payload: { quantityPerHour: 800, startsAt: '2026-09-18T06:30:00.000Z' } }),
      evt({ eventId: 'req-1', entityType: 'production_order', entityId: 'PO-1', eventType: 'production.material_requirement', payload: { requiredQuantity: 8000, requiredAt: '2026-09-18T06:00:00.000Z' } }),
      evt({ eventId: 'eta-1', entityType: 'shipment', entityId: 'SHIP-1', eventType: 'shipment.eta', revision: 1, payload: { eta: '2026-09-18T11:15:00.000Z' } }),
      evt({ eventId: 'econ-1', entityType: 'line', entityId: 'LINE-4', eventType: 'line.economics', payload: { lostContributionPerHour: 10000, idleLabourPerHour: 1000, recoveryOvertimePerHour: 1800, customerPenalty: 2500 } }),
    ],
    options: [
      { id: 'baseline', kind: 'do_nothing', confidence: 1, recoveredShortageHours: 0, costs: {} },
      { id: 'resequence', kind: 'resequence_order', confidence: 0.96, recoveredShortageHours: 1.75, lowerBoundAvoidedCost: 17000, upperBoundActionCost: 700, costs: { changeover: 410, labourPremium: 90 }, qualifiedStaffAvailable: true },
      { id: 'transfer', kind: 'inter_site_transfer', confidence: 0.9, recoveredShortageHours: 1.75, lowerBoundAvoidedCost: 17000, upperBoundActionCost: 1400, costs: { transport: 850, inventory: 100 }, transferQuantity: 3000, minimumTransferQuantity: 2500, qualifiedStaffAvailable: true },
    ],
  };
}

test('predicts a late-delivery stockout and ranks the strongest safe recovery', () => {
  const result = evaluateDeliveryDisruption(baseInput());
  assert.equal(result.status, 'recommend_recovery_options');
  assert.equal(result.disruptionDetected, true);
  assert.ok(result.state.shortageHours > 1.7 && result.state.shortageHours < 1.8);
  assert.equal(result.rankedOptions[0].id, 'resequence');
  assert.equal(result.rankedOptions[0].actionContract.type, 'workflow_handoff_only');
  assert.ok(result.rankedOptions[0].economics.conservativeNetBenefit > result.rankedOptions[1].economics.conservativeNetBenefit);
});

test('on-time arrival produces no disruption and no recommendation', () => {
  const input = baseInput();
  input.events.find(e => e.eventId === 'eta-1').payload.eta = '2026-09-18T08:30:00.000Z';
  const result = evaluateDeliveryDisruption(input);
  assert.equal(result.status, 'no_material_disruption_predicted');
  assert.equal(result.disruptionDetected, false);
  assert.equal(result.rankedOptions.length, 0);
});

test('idempotent replay is ignored, conflicting replay fails closed', () => {
  const input = baseInput();
  input.events.push(structuredClone(input.events[0]));
  let result = evaluateDeliveryDisruption(input);
  assert.deepEqual(result.graphDuplicates, ['inv-1']);
  assert.equal(result.status, 'recommend_recovery_options');

  const conflict = structuredClone(input.events[0]);
  conflict.payload.quantityOnHand = 999999;
  input.events.push(conflict);
  result = evaluateDeliveryDisruption(input);
  assert.equal(result.status, 'insufficient_or_conflicting_evidence');
  assert.ok(result.evidenceFailures.includes('event_id_conflict'));
});

test('out-of-order ETA revisions use the highest revision deterministically', () => {
  const input = baseInput();
  input.events.push(evt({ eventId: 'eta-3', entityType: 'shipment', entityId: 'SHIP-1', eventType: 'shipment.eta', occurredAt: '2026-09-18T05:40:00.000Z', observedAt: '2026-09-18T05:56:00.000Z', revision: 3, payload: { eta: '2026-09-18T12:00:00.000Z' } }));
  input.events.push(evt({ eventId: 'eta-2', entityType: 'shipment', entityId: 'SHIP-1', eventType: 'shipment.eta', occurredAt: '2026-09-18T05:59:00.000Z', revision: 2, payload: { eta: '2026-09-18T09:00:00.000Z' } }));
  const result = evaluateDeliveryDisruption(input);
  assert.equal(result.state.effectiveArrival, '2026-09-18T12:00:00.000Z');
});

test('cross-tenant or cross-site events are rejected', () => {
  const input = baseInput();
  input.events[0].tenantId = 'other-tenant';
  assert.throws(() => evaluateDeliveryDisruption(input), /event_tenant_mismatch/);
  const input2 = baseInput();
  input2.events[0].siteId = 'other-site';
  assert.throws(() => evaluateDeliveryDisruption(input2), /event_site_mismatch/);
});

test('stale shipment evidence blocks action recommendations', () => {
  const input = baseInput();
  const eta = input.events.find(e => e.eventId === 'eta-1');
  eta.observedAt = '2026-09-18T04:00:00.000Z';
  const result = evaluateDeliveryDisruption(input);
  assert.equal(result.status, 'insufficient_or_conflicting_evidence');
  assert.ok(result.evidenceFailures.includes('stale_etaEvent'));
  assert.equal(result.rankedOptions.length, 0);
});

test('unsafe or directly actuating recovery options are rejected', () => {
  const input = baseInput();
  input.options.push({
    id: 'unsafe-auto',
    kind: 'inter_site_transfer',
    confidence: 1,
    recoveredShortageHours: 1.75,
    costs: { transport: 1 },
    safetyRisk: 'unacceptable',
    controls: { directStockTransfer: true, directProductionScheduleChange: true },
  });
  const result = evaluateDeliveryDisruption(input);
  const rejected = result.rejectedOptions.find(x => x.id === 'unsafe-auto');
  assert.equal(rejected.executable, false);
  assert.ok(rejected.hardConstraintFailures.includes('unacceptable_safety_risk'));
  assert.ok(rejected.hardConstraintFailures.includes('direct_stock_transfer_forbidden'));
  assert.ok(rejected.hardConstraintFailures.includes('direct_production_schedule_change_forbidden'));
});

test('negative or malformed economics fail closed', () => {
  const input = baseInput();
  input.options[1].costs.changeover = -500;
  const result = evaluateDeliveryDisruption(input);
  const rejected = result.rejectedOptions.find(x => x.id === 'resequence');
  assert.equal(rejected.executable, false);
  assert.ok(rejected.hardConstraintFailures.includes('invalid_economics:changeover'));
});

test('same authoritative input has the same reproducibility hash', () => {
  const input = baseInput();
  const a = evaluateDeliveryDisruption(input);
  const b = evaluateDeliveryDisruption(structuredClone(input));
  assert.equal(a.reproducibilityHash, b.reproducibilityHash);
  const c = structuredClone(input);
  c.options[1].costs.changeover += 1;
  assert.notEqual(a.reproducibilityHash, evaluateDeliveryDisruption(c).reproducibilityHash);
});

test('event graph records duplicate replay in evidence hash without changing logical event count', () => {
  const input = baseInput();
  const graphA = buildManufacturingEventGraph(input.events, { tenantId: T, siteId: S });
  const eventsWithReplay = [...input.events, structuredClone(input.events[0])];
  const graphB = buildManufacturingEventGraph(eventsWithReplay, { tenantId: T, siteId: S });
  assert.notEqual(graphA.reproducibilityHash, graphB.reproducibilityHash);
  assert.deepEqual(graphB.duplicates, ['inv-1']);
  assert.equal(graphA.events.length, graphB.events.length);
});

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32);
}

test('2,000 scenario benchmark finds safe valuable recoveries without direct actuation', () => {
  const rnd = lcg(0xdecafbad);
  let disruptions = 0;
  let knownValuable = 0;
  let foundValuable = 0;
  let unsafeRecommended = 0;
  let directActuation = 0;
  let staleRecommended = 0;

  for (let i = 0; i < 2000; i++) {
    const input = baseInput();
    const etaHours = 2 + rnd() * 8;
    const eta = new Date(Date.parse('2026-09-18T06:00:00.000Z') + etaHours * 3600000).toISOString();
    input.events.find(e => e.eventId === 'eta-1').payload.eta = eta;
    const stale = rnd() < 0.06;
    if (stale) input.events.find(e => e.eventId === 'eta-1').observedAt = '2026-09-18T04:00:00.000Z';

    const safe = rnd() > 0.12;
    const direct = rnd() < 0.04;
    const recovered = rnd() * 3;
    const upperCost = 200 + rnd() * 3000;
    input.options[1] = {
      id: 'candidate',
      kind: 'resequence_order',
      confidence: 0.8 + rnd() * 0.2,
      recoveredShortageHours: recovered,
      lowerBoundAvoidedCost: recovered * 9000,
      upperBoundActionCost: upperCost,
      costs: { changeover: Math.min(upperCost, 600) },
      safetyRisk: safe ? 'acceptable' : 'unacceptable',
      controls: { directProductionScheduleChange: direct },
    };
    input.options = [input.options[0], input.options[1]];

    const result = evaluateDeliveryDisruption(input);
    if (result.disruptionDetected) disruptions++;
    const expectedValuable = result.disruptionDetected && !stale && safe && !direct && recovered > 0 && recovered * 9000 - upperCost > 1;
    if (expectedValuable) knownValuable++;
    if (result.rankedOptions.length) foundValuable++;
    if (result.rankedOptions.some(o => o.hardConstraintFailures.length)) unsafeRecommended++;
    if (result.rankedOptions.some(o => o.actionContract?.type !== 'workflow_handoff_only')) directActuation++;
    if (stale && result.rankedOptions.length) staleRecommended++;
  }

  const discovery = knownValuable ? foundValuable / knownValuable : 1;
  console.log('DELIVERY_DISRUPTION_BENCHMARK=' + JSON.stringify({ disruptions, knownValuable, foundValuable, discovery, unsafeRecommended, directActuation, staleRecommended }));
  assert.ok(disruptions > 500);
  assert.ok(knownValuable > 200);
  assert.ok(discovery >= 0.95);
  assert.equal(unsafeRecommended, 0);
  assert.equal(directActuation, 0);
  assert.equal(staleRecommended, 0);
});
