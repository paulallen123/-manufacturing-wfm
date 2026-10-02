import { buildManufacturingEventGraph, eventFreshness, stableHash } from './manufacturing-event-graph.mjs';

export const DELIVERY_DISRUPTION_ENGINE_VERSION = 'delivery-disruption-shadow-v0.1.0';

const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = value => Math.max(0, Math.min(1, num(value)));

function nonNegative(value, label, failures, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    failures.push(`invalid_economics:${label}`);
    return fallback;
  }
  return parsed;
}

function latestPayload(graph, entityType, entityId, eventType) {
  return graph.getLatestEvent(entityType, entityId, eventType);
}

function deriveDeliveryState(input, graph) {
  const failures = [];
  const nowMs = ms(input.now);
  if (nowMs === null) throw new TypeError('input.now must be a valid timestamp');

  const ids = input.ids ?? {};
  for (const key of ['materialId', 'shipmentId', 'productionOrderId', 'lineId']) {
    if (typeof ids[key] !== 'string' || !ids[key]) throw new TypeError(`ids.${key} is required`);
  }

  const inventoryEvent = latestPayload(graph, 'material', ids.materialId, 'inventory.snapshot');
  const consumptionEvent = latestPayload(graph, 'production_order', ids.productionOrderId, 'production.consumption_rate');
  const requirementEvent = latestPayload(graph, 'production_order', ids.productionOrderId, 'production.material_requirement');
  const etaEvent = latestPayload(graph, 'shipment', ids.shipmentId, 'shipment.eta');
  const receiptEvent = latestPayload(graph, 'shipment', ids.shipmentId, 'goods_receipt.received');
  const economicsEvent = latestPayload(graph, 'line', ids.lineId, 'line.economics');

  const required = { inventoryEvent, consumptionEvent, requirementEvent, etaEvent, economicsEvent };
  for (const [name, event] of Object.entries(required)) if (!event) failures.push(`missing_${name}`);

  if (graph.conflicts.length) failures.push('event_id_conflict');
  if (failures.length) return { failures, state: null, evidence: required };

  const freshnessPolicy = {
    inventoryEvent: num(input.freshnessMinutes?.inventory, 60),
    consumptionEvent: num(input.freshnessMinutes?.production, 240),
    requirementEvent: num(input.freshnessMinutes?.production, 240),
    etaEvent: num(input.freshnessMinutes?.shipment, 30),
    economicsEvent: num(input.freshnessMinutes?.economics, 1440),
  };

  const freshness = {};
  for (const [name, event] of Object.entries(required)) {
    freshness[name] = eventFreshness(event, input.now, freshnessPolicy[name]);
    if (!freshness[name].fresh) failures.push(`stale_${name}`);
  }

  const onHand = num(inventoryEvent.payload.quantityOnHand, NaN);
  const safetyStock = num(inventoryEvent.payload.safetyStock, 0);
  const consumptionPerHour = num(consumptionEvent.payload.quantityPerHour, NaN);
  const productionStartsAt = ms(consumptionEvent.payload.startsAt);
  const requirementQty = num(requirementEvent.payload.requiredQuantity, NaN);
  const requiredAt = ms(requirementEvent.payload.requiredAt);
  const eta = ms(etaEvent.payload.eta);
  const receivedAt = receiptEvent ? ms(receiptEvent.payload.receivedAt ?? receiptEvent.occurredAt) : null;

  for (const [label, value] of Object.entries({ onHand, consumptionPerHour, requirementQty })) {
    if (!Number.isFinite(value) || value < 0) failures.push(`invalid_state:${label}`);
  }
  if (productionStartsAt === null) failures.push('invalid_state:productionStartsAt');
  if (requiredAt === null) failures.push('invalid_state:requiredAt');
  if (eta === null) failures.push('invalid_state:eta');
  if (consumptionPerHour <= 0) failures.push('invalid_state:consumptionPerHour');
  if (failures.some(f => f.startsWith('invalid_state:'))) return { failures, state: null, evidence: required, freshness };

  const usableInventory = Math.max(0, onHand - safetyStock);
  const hoursOfCover = consumptionPerHour > 0 ? usableInventory / consumptionPerHour : Infinity;
  const stockoutAt = productionStartsAt + hoursOfCover * 3600000;
  const effectiveArrival = receivedAt ?? eta;
  const shortageHours = Math.max(0, (effectiveArrival - stockoutAt) / 3600000);
  const shortageQuantity = Math.min(requirementQty, shortageHours * consumptionPerHour);
  const lateMinutesVsNeed = Math.max(0, (effectiveArrival - requiredAt) / 60000);

  const confidences = Object.values(required).map(event => clamp01(event?.confidence ?? 1));
  let confidence = Math.min(...confidences);
  if (Object.values(freshness).some(x => !x.fresh)) confidence = Math.min(confidence, 0.49);

  return {
    failures,
    freshness,
    evidence: required,
    state: {
      onHand,
      safetyStock,
      usableInventory,
      consumptionPerHour,
      requirementQty,
      productionStartsAt,
      requiredAt,
      eta,
      receivedAt,
      effectiveArrival,
      hoursOfCover,
      stockoutAt,
      shortageHours,
      shortageQuantity,
      lateMinutesVsNeed,
      confidence,
      economics: economicsEvent.payload,
    },
  };
}

function baselineEconomics(state, input) {
  const failures = [];
  const e = state.economics ?? {};
  const lostContributionPerHour = nonNegative(e.lostContributionPerHour, 'lostContributionPerHour', failures);
  const idleLabourPerHour = nonNegative(e.idleLabourPerHour, 'idleLabourPerHour', failures);
  const recoveryOvertimePerHour = nonNegative(e.recoveryOvertimePerHour, 'recoveryOvertimePerHour', failures);
  const customerPenalty = nonNegative(e.customerPenalty, 'customerPenalty', failures);
  const overtimeHours = Math.max(0, Math.min(state.shortageHours, num(input.assumedRecoveryOvertimeHours, state.shortageHours)));
  const lostProductionCost = state.shortageHours * lostContributionPerHour;
  const idleLabourCost = state.shortageHours * idleLabourPerHour;
  const recoveryOvertimeCost = overtimeHours * recoveryOvertimePerHour;
  const servicePenalty = state.shortageHours > 0 ? customerPenalty : 0;
  const total = lostProductionCost + idleLabourCost + recoveryOvertimeCost + servicePenalty;
  return { failures, lostProductionCost, idleLabourCost, recoveryOvertimeCost, servicePenalty, total };
}

function optionFailures(option) {
  const reasons = [];
  if (option.safetyRisk === 'unacceptable') reasons.push('unacceptable_safety_risk');
  if (option.qualityRisk === 'unacceptable') reasons.push('unacceptable_quality_risk');
  if (option.legalOrContractBreach === true) reasons.push('legal_or_contract_breach');
  if (option.hardCustomerBreach === true) reasons.push('hard_customer_breach');
  if (option.requiresQualifiedStaff && option.qualifiedStaffAvailable !== true) reasons.push('qualified_staff_unavailable');
  if (option.transferQuantity !== undefined && num(option.transferQuantity) < num(option.minimumTransferQuantity, 0)) reasons.push('insufficient_transfer_quantity');
  const c = option.controls ?? {};
  if (c.directPurchaseOrderChange) reasons.push('direct_purchase_order_change_forbidden');
  if (c.directProductionScheduleChange) reasons.push('direct_production_schedule_change_forbidden');
  if (c.directStockTransfer) reasons.push('direct_stock_transfer_forbidden');
  if (c.directCarrierBooking) reasons.push('direct_carrier_booking_forbidden');
  return reasons;
}

function evaluateOption(option, baseline, state, input) {
  const failures = optionFailures(option);
  const costs = option.costs ?? {};
  const actionCost = [
    ['transport', costs.transport],
    ['premiumFreight', costs.premiumFreight],
    ['changeover', costs.changeover],
    ['labourPremium', costs.labourPremium],
    ['quality', costs.quality],
    ['inventory', costs.inventory],
    ['other', costs.other],
  ].reduce((sum, [label, value]) => sum + nonNegative(value, label, failures), 0);

  const upperBoundActionCost = Math.max(
    actionCost,
    nonNegative(option.upperBoundActionCost, 'upperBoundActionCost', failures, actionCost),
  );

  const recoveredHours = Math.max(0, Math.min(state.shortageHours, nonNegative(option.recoveredShortageHours, 'recoveredShortageHours', failures)));
  const recoveredFraction = state.shortageHours > 0 ? recoveredHours / state.shortageHours : 0;
  const pointAvoidedCost = baseline.total * recoveredFraction;
  const lowerBoundAvoidedCost = Math.min(
    pointAvoidedCost,
    nonNegative(option.lowerBoundAvoidedCost, 'lowerBoundAvoidedCost', failures, pointAvoidedCost),
  );
  const pointNetBenefit = pointAvoidedCost - actionCost;
  const conservativeNetBenefit = lowerBoundAvoidedCost - upperBoundActionCost;
  const confidence = Math.min(state.confidence, clamp01(option.confidence ?? 1));
  if (confidence < num(input.minimumDecisionConfidence, 0.6)) failures.push('insufficient_data_confidence');

  const executable = failures.length === 0;
  const valuable = executable && option.kind !== 'do_nothing' && conservativeNetBenefit > num(input.minimumNetBenefit, 0);

  return {
    id: option.id,
    kind: option.kind,
    executable,
    valuable,
    confidence,
    hardConstraintFailures: failures,
    recoveredShortageHours: recoveredHours,
    economics: {
      actionCost,
      upperBoundActionCost,
      pointAvoidedCost,
      lowerBoundAvoidedCost,
      pointNetBenefit,
      conservativeNetBenefit,
    },
    actionContract: executable && option.kind !== 'do_nothing'
      ? {
          type: 'workflow_handoff_only',
          optionId: option.id,
          requiresApproval: true,
          forbiddenDirectActuation: [
            'purchase_order_change',
            'production_schedule_change',
            'stock_transfer',
            'carrier_booking',
          ],
        }
      : null,
  };
}

export function evaluateDeliveryDisruption(input) {
  if (!input?.tenantId || !input?.siteId) throw new TypeError('tenantId and siteId are required');
  const graph = buildManufacturingEventGraph(input.events, { tenantId: input.tenantId, siteId: input.siteId });
  const derived = deriveDeliveryState(input, graph);

  if (!derived.state) {
    const result = {
      engineVersion: DELIVERY_DISRUPTION_ENGINE_VERSION,
      status: 'insufficient_or_conflicting_evidence',
      disruptionDetected: false,
      graphConflicts: graph.conflicts,
      graphDuplicates: graph.duplicates,
      evidenceFailures: derived.failures,
      rankedOptions: [],
      rejectedOptions: [],
      authorityBoundary: 'planning_and_workflow_handoff_only_no_direct_actuation',
    };
    result.reproducibilityHash = stableHash({ engineVersion: DELIVERY_DISRUPTION_ENGINE_VERSION, input, result });
    return result;
  }

  const baseline = baselineEconomics(derived.state, input);
  const evidenceFailures = [...derived.failures, ...baseline.failures];
  const disruptionDetected = derived.state.shortageHours > 0.0001;
  const options = Array.isArray(input.options) ? input.options : [];
  const evaluated = options.map((option, index) => evaluateOption({ id: option.id ?? `option-${index}`, ...option }, baseline, derived.state, input));
  const rankedOptions = evaluated
    .filter(option => option.valuable && disruptionDetected && evidenceFailures.length === 0)
    .sort((a, b) => b.economics.conservativeNetBenefit - a.economics.conservativeNetBenefit || a.id.localeCompare(b.id));

  const rejectedOptions = evaluated.filter(option => !rankedOptions.some(x => x.id === option.id));
  const status = evidenceFailures.length
    ? 'insufficient_or_conflicting_evidence'
    : !disruptionDetected
      ? 'no_material_disruption_predicted'
      : rankedOptions.length
        ? 'recommend_recovery_options'
        : 'disruption_detected_no_safe_valuable_recovery';

  const result = {
    engineVersion: DELIVERY_DISRUPTION_ENGINE_VERSION,
    status,
    disruptionDetected,
    graphConflicts: graph.conflicts,
    graphDuplicates: graph.duplicates,
    evidenceFailures,
    state: {
      confidence: derived.state.confidence,
      stockoutAt: new Date(derived.state.stockoutAt).toISOString(),
      effectiveArrival: new Date(derived.state.effectiveArrival).toISOString(),
      shortageHours: derived.state.shortageHours,
      shortageQuantity: derived.state.shortageQuantity,
      lateMinutesVsNeed: derived.state.lateMinutesVsNeed,
      hoursOfCover: derived.state.hoursOfCover,
    },
    baselineEconomics: baseline,
    rankedOptions,
    rejectedOptions,
    authorityBoundary: 'planning_and_workflow_handoff_only_no_direct_actuation',
  };

  result.reproducibilityHash = stableHash({
    engineVersion: DELIVERY_DISRUPTION_ENGINE_VERSION,
    input,
    graphHash: graph.reproducibilityHash,
    result: { ...result, reproducibilityHash: undefined },
  });
  return result;
}
