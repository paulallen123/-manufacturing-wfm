const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function supplierOrder(a, b) {
  return (a.tier ?? 99) - (b.tier ?? 99)
    || (a.billRate ?? Number.MAX_SAFE_INTEGER) - (b.billRate ?? Number.MAX_SAFE_INTEGER)
    || (b.fillRate ?? 0.8) - (a.fillRate ?? 0.8)
    || (a.avgResponseMinutes ?? 30) - (b.avgResponseMinutes ?? 30);
}

/**
 * Immediately reallocates an unfilled supplier capacity response to the next usable
 * suppliers. Recovery remains capacity-only, so a partial/declined supplier response
 * cannot cause duplicate worker commitments.
 */
export function buildShortfallRecoveryPlan({ requirement, suppliers = [], supplierResponses = [], responseMinutes = 5 }) {
  if (!Number.isFinite(requirement?.headcount) || requirement.headcount <= 0) {
    throw new Error('positive requirement.headcount is required');
  }

  const responded = new Set();
  let acceptedCapacityRaw = 0;
  for (const response of supplierResponses) {
    if (!response?.supplierId) continue;
    responded.add(response.supplierId);
    if (response.status === 'ACCEPTED' || response.status === 'PARTIAL') {
      acceptedCapacityRaw += Math.max(0, Number(response.acceptedHeadcount) || 0);
    }
  }

  const acceptedCapacity = Math.min(requirement.headcount, acceptedCapacityRaw);
  const shortfallBeforeRecovery = Math.max(0, requirement.headcount - acceptedCapacity);
  let remaining = shortfallBeforeRecovery;

  const backups = suppliers
    .filter(s => s.active !== false && (s.roles ?? []).includes(requirement.role) && !responded.has(s.id))
    .map(s => ({
      ...s,
      tier: s.tier ?? 99,
      billRate: Number.isFinite(s.billRate) ? s.billRate : null,
      fillRate: clamp(s.fillRate ?? 0.8, 0, 1),
      avgResponseMinutes: s.avgResponseMinutes ?? 30,
      capacity: Math.max(0, s.capacity ?? requirement.headcount)
    }))
    .sort(supplierOrder);

  const recoveryActions = [];
  for (const supplier of backups) {
    if (remaining <= 0) break;
    const requested = Math.min(remaining, supplier.capacity);
    if (requested <= 0) continue;
    recoveryActions.push({
      supplierId: supplier.id,
      action: 'PROMOTE_BACKUP_CAPACITY_NOW',
      requestedHeadcount: requested,
      opensAtMinute: 0,
      responseDeadlineMinute: Math.min(responseMinutes, Math.max(1, supplier.avgResponseMinutes)),
      workerNotificationAllowed: false,
      workerCommitmentCreated: false,
      rationale: 'RECOVER_PARTIAL_OR_DECLINED_SUPPLIER_RESPONSE_WITHOUT_WAITING_FOR_NEXT_STATIC_CASCADE'
    });
    remaining -= requested;
  }

  return {
    requirementId: requirement.id,
    acceptedCapacity,
    shortfallBeforeRecovery,
    recoveryActions,
    unrecoveredShortfall: remaining,
    touchlessCanContinue: remaining === 0,
    safeguard: 'Recovery authorises supplier capacity holds only; worker offers still require allocated vacancies.'
  };
}
