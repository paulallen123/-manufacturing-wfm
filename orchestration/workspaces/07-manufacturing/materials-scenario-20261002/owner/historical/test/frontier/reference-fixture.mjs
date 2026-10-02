// Test-derived fixture only; not original source or shipping code.
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

export {baseInput,evt};
