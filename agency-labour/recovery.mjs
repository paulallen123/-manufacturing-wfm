const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function supplierOrder(a, b) {
  return (a.tier ?? 99) - (b.tier ?? 99)
    || (a.billRate ?? Number.MAX_SAFE_INTEGER) - (b.billRate ?? Number.MAX_SAFE_INTEGER)
    || (b.fillRate ?? 0.8) - (a.fillRate ?? 0.8)
    || (a.avgResponseMinutes ?? 30) - (b.avgResponseMinutes ?? 30);
}

/**
 * Immediately reallocates supplier shortfall without creating duplicate capacity requests.
 * Existing unanswered holds count as pending coverage; where useful they are topped up only
 * by their spare capacity. All recovery actions remain supplier-capacity only.
 */
export function buildShortfallRecoveryPlan({
  requirement,
  suppliers = [],
  supplierResponses = [],
  capacityHolds = [],
  responseMinutes = 5
}) {
  if (!Number.isFinite(requirement?.headcount) || requirement.headcount <= 0) {
    throw new Error('positive requirement.headcount is required');
  }

  const supplierMap = new Map(
    suppliers
      .filter(s => s.active !== false && (s.roles ?? []).includes(requirement.role))
      .map(s => [s.id, {
        ...s,
        tier: s.tier ?? 99,
        billRate: Number.isFinite(s.billRate) ? s.billRate : null,
        fillRate: clamp(s.fillRate ?? 0.8, 0, 1),
        avgResponseMinutes: s.avgResponseMinutes ?? 30,
        capacity: Math.max(0, s.capacity ?? requirement.headcount)
      }])
  );

  const responseBySupplier = new Map();
  let acceptedCapacityRaw = 0;
  for (const response of supplierResponses) {
    if (!response?.supplierId) continue;
    responseBySupplier.set(response.supplierId, response);
    if (response.status === 'ACCEPTED' || response.status === 'PARTIAL') {
      acceptedCapacityRaw += Math.max(0, Number(response.acceptedHeadcount) || 0);
    }
  }
  const acceptedCapacity = Math.min(requirement.headcount, acceptedCapacityRaw);

  const pendingBySupplier = new Map();
  for (const hold of capacityHolds) {
    if (!hold?.supplierId || !supplierMap.has(hold.supplierId)) continue;
    if (responseBySupplier.has(hold.supplierId)) continue;
    const requested = Math.max(0, Number(hold.requestedHeadcount) || 0);
    if (requested <= 0) continue;
    pendingBySupplier.set(
      hold.supplierId,
      (pendingBySupplier.get(hold.supplierId) || 0) + requested
    );
  }

  let pendingCapacity = 0;
  for (const [supplierId, requested] of pendingBySupplier) {
    const supplier = supplierMap.get(supplierId);
    pendingCapacity += Math.min(requested, supplier.capacity);
  }

  const shortfallBeforeRecovery = Math.max(0, requirement.headcount - acceptedCapacity);
  let uncoveredAfterExistingHolds = Math.max(0, requirement.headcount - acceptedCapacity - pendingCapacity);
  const recoveryActions = [];

  // First top up suppliers that are already working on an unanswered hold, avoiding a new handoff.
  const pendingSuppliers = [...pendingBySupplier.keys()]
    .map(id => supplierMap.get(id))
    .filter(Boolean)
    .sort(supplierOrder);

  for (const supplier of pendingSuppliers) {
    if (uncoveredAfterExistingHolds <= 0) break;
    const currentPending = pendingBySupplier.get(supplier.id) || 0;
    const spareCapacity = Math.max(0, supplier.capacity - currentPending);
    const requested = Math.min(uncoveredAfterExistingHolds, spareCapacity);
    if (requested <= 0) continue;
    recoveryActions.push({
      supplierId: supplier.id,
      action: 'TOP_UP_EXISTING_CAPACITY_HOLD',
      requestedHeadcount: requested,
      totalPendingHeadcountAfterAction: currentPending + requested,
      opensAtMinute: 0,
      responseDeadlineMinute: Math.min(responseMinutes, Math.max(1, supplier.avgResponseMinutes)),
      workerNotificationAllowed: false,
      workerCommitmentCreated: false,
      rationale: 'INCREASE_EXISTING_UNANSWERED_HOLD_WITHOUT_DUPLICATE_OR_EXCESS_CAPACITY_REQUEST'
    });
    pendingBySupplier.set(supplier.id, currentPending + requested);
    pendingCapacity += requested;
    uncoveredAfterExistingHolds -= requested;
  }

  // Then promote suppliers that have no response and no existing hold.
  const unused = [...supplierMap.values()]
    .filter(s => !responseBySupplier.has(s.id) && !pendingBySupplier.has(s.id))
    .sort(supplierOrder);

  for (const supplier of unused) {
    if (uncoveredAfterExistingHolds <= 0) break;
    const requested = Math.min(uncoveredAfterExistingHolds, supplier.capacity);
    if (requested <= 0) continue;
    recoveryActions.push({
      supplierId: supplier.id,
      action: 'PROMOTE_BACKUP_CAPACITY_NOW',
      requestedHeadcount: requested,
      totalPendingHeadcountAfterAction: requested,
      opensAtMinute: 0,
      responseDeadlineMinute: Math.min(responseMinutes, Math.max(1, supplier.avgResponseMinutes)),
      workerNotificationAllowed: false,
      workerCommitmentCreated: false,
      rationale: 'RECOVER_PARTIAL_OR_DECLINED_SUPPLIER_RESPONSE_WITHOUT_WAITING_FOR_NEXT_STATIC_CASCADE'
    });
    pendingBySupplier.set(supplier.id, requested);
    pendingCapacity += requested;
    uncoveredAfterExistingHolds -= requested;
  }

  const projectedCapacityCoverage = Math.min(requirement.headcount, acceptedCapacity + pendingCapacity);
  const unrecoveredShortfall = Math.max(0, requirement.headcount - projectedCapacityCoverage);

  return {
    requirementId: requirement.id,
    acceptedCapacity,
    pendingCapacity,
    shortfallBeforeRecovery,
    projectedCapacityCoverage,
    recoveryActions,
    unrecoveredShortfall,
    touchlessCanContinue: unrecoveredShortfall === 0,
    safeguards: {
      capacityOnly: true,
      duplicateSupplierRequestsPrevented: true,
      totalProjectedCapacityCappedToRequirement: true,
      workerOffersStillRequireAllocatedVacancies: true
    }
  };
}
