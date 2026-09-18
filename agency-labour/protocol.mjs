const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function hoursUntil(shiftStart, now) {
  return (new Date(shiftStart).getTime() - new Date(now).getTime()) / 36e5;
}

function supplierOrder(a, b) {
  return (a.tier ?? 99) - (b.tier ?? 99)
    || (a.billRate ?? Number.MAX_SAFE_INTEGER) - (b.billRate ?? Number.MAX_SAFE_INTEGER)
    || (b.fillRate ?? 0.8) - (a.fillRate ?? 0.8)
    || (a.avgResponseMinutes ?? 30) - (b.avgResponseMinutes ?? 30);
}

/**
 * Builds a supplier release plan that gets more parallel as the shift approaches,
 * while keeping worker-specific offers separate from supplier capacity signalling.
 */
export function buildAdaptiveSupplierReleasePlan({ requirement, suppliers, now = new Date().toISOString(), supplierResponseMinutes = 10 }) {
  if (!requirement?.shiftStart || !Number.isFinite(requirement?.headcount) || requirement.headcount <= 0) {
    throw new Error('requirement.shiftStart and positive requirement.headcount are required');
  }

  const eligible = (suppliers ?? [])
    .filter(s => s.active !== false && (s.roles ?? []).includes(requirement.role))
    .map(s => ({
      ...s,
      tier: s.tier ?? 99,
      billRate: Number.isFinite(s.billRate) ? s.billRate : null,
      fillRate: clamp(s.fillRate ?? 0.8, 0, 1),
      avgResponseMinutes: s.avgResponseMinutes ?? 30,
      capacity: Math.max(0, s.capacity ?? requirement.headcount)
    }))
    .sort(supplierOrder);

  const leadHours = hoursUntil(requirement.shiftStart, now);
  const mode = leadHours <= 6
    ? 'URGENT_PARALLEL_CAPACITY'
    : leadHours <= 24
      ? 'DUAL_TRACK_CAPACITY'
      : 'SEQUENTIAL_CASCADE';

  const parallelWidth = mode === 'URGENT_PARALLEL_CAPACITY'
    ? eligible.length
    : mode === 'DUAL_TRACK_CAPACITY'
      ? Math.min(2, eligible.length)
      : 1;

  const responseWindowMinutes = mode === 'URGENT_PARALLEL_CAPACITY'
    ? Math.min(5, supplierResponseMinutes)
    : mode === 'DUAL_TRACK_CAPACITY'
      ? Math.min(7, supplierResponseMinutes)
      : supplierResponseMinutes;

  let remaining = requirement.headcount;
  let sequentialCursor = 0;
  const releases = [];
  const assignedSupplierIds = new Set();

  for (let i = 0; i < eligible.length && remaining > 0; i++) {
    const s = eligible[i];
    const requested = Math.min(remaining, s.capacity);
    if (requested <= 0) continue;

    const opensAtMinute = mode === 'SEQUENTIAL_CASCADE'
      ? sequentialCursor
      : (i < parallelWidth ? 0 : responseWindowMinutes);

    const responseDeadlineMinute = opensAtMinute + responseWindowMinutes;
    releases.push({
      supplierId: s.id,
      action: 'REQUEST_CAPACITY_HOLD',
      requestedHeadcount: requested,
      opensAtMinute,
      responseDeadlineMinute,
      workerNotificationAllowed: false,
      workerCommitmentCreated: false,
      rationale: mode === 'SEQUENTIAL_CASCADE'
        ? (i === 0 ? 'PREFERRED_SUPPLIER_FIRST' : 'CASCADE_ONLY_IF_SHORT')
        : (opensAtMinute === 0 ? 'PARALLELISE_TO_PROTECT_TIME_TO_COVER' : 'FAST_BACKUP_IF_INITIAL_HOLDS_SHORT'),
      expectedFilledHeadcount: Number((requested * s.fillRate).toFixed(2)),
      estimatedShiftCost: s.billRate == null ? null : Number((requested * requirement.shiftHours * s.billRate).toFixed(2))
    });
    assignedSupplierIds.add(s.id);
    remaining -= requested;
    if (mode === 'SEQUENTIAL_CASCADE') sequentialCursor += responseWindowMinutes;
  }

  // Give unassigned suppliers an API-level heads-up without asking them to contact a worker.
  // This means a failed hold can be promoted quickly without creating unnecessary worker offers.
  for (const s of eligible) {
    if (assignedSupplierIds.has(s.id)) continue;
    releases.push({
      supplierId: s.id,
      action: 'CAPACITY_SIGNAL_ONLY',
      requestedHeadcount: 0,
      opensAtMinute: mode === 'SEQUENTIAL_CASCADE' ? null : 0,
      responseDeadlineMinute: null,
      workerNotificationAllowed: false,
      workerCommitmentCreated: false,
      rationale: 'PRE_WARM_BACKUP_SUPPLIER_WITHOUT_OVER_OFFERING_WORKERS',
      expectedFilledHeadcount: 0,
      estimatedShiftCost: 0
    });
  }

  return {
    requirementId: requirement.id,
    leadHours: Number(leadHours.toFixed(2)),
    mode,
    responseWindowMinutes,
    releases,
    unallocatedHeadcount: remaining,
    safeguards: {
      capacityPhaseOnly: true,
      noWorkerSpecificOfferUntilSlotAllocation: true,
      supplierSignalDoesNotAuthoriseWorkerNotification: true
    }
  };
}

/**
 * Allocates exactly the remaining vacancies to workers. Extra eligible workers are held
 * as a reserve shortlist and must not be notified as if they have been offered the shift.
 */
export function buildWorkerOfferProtocol({ requirement, recommendedWorkers = [], confirmedWorkerIds = [], offerWindowMinutes = 5 }) {
  const confirmed = new Set(confirmedWorkerIds);
  const remainingSlots = Math.max(0, requirement.headcount - confirmed.size);
  const candidates = recommendedWorkers.filter(w => !confirmed.has(w.workerId));

  const formal = candidates.slice(0, remainingSlots).map((w, index) => ({
    seatId: `${requirement.id || 'REQ'}-SEAT-${confirmed.size + index + 1}`,
    workerId: w.workerId,
    supplierId: w.supplierId,
    recommendationBand: w.recommendationBand,
    action: 'FORMAL_WORKER_OFFER_ALLOWED',
    workerNotificationAllowed: true,
    offerWindowMinutes,
    reasons: w.reasons ?? []
  }));

  const reserve = candidates.slice(remainingSlots).map(w => ({
    workerId: w.workerId,
    supplierId: w.supplierId,
    recommendationBand: w.recommendationBand,
    action: 'RESERVE_ONLY_DO_NOT_NOTIFY_WORKER',
    workerNotificationAllowed: false,
    reasons: w.reasons ?? []
  }));

  return {
    requirementId: requirement.id,
    headcount: requirement.headcount,
    alreadyConfirmed: confirmed.size,
    remainingSlots,
    maxConcurrentFormalOffers: remainingSlots,
    formalOffers: formal,
    reserveShortlist: reserve,
    shortageAfterCurrentCandidates: Math.max(0, remainingSlots - formal.length),
    safeguards: {
      oversubscriptionBlocked: true,
      reserveWorkersMustNotBeToldTheyHaveTheShift: true,
      promoteReserveOnlyAfterDeclineExpiryOrCancellation: true
    }
  };
}

export function validateAgencyNominations({ nominations = [], allocatedWorkerIds = [] }) {
  const allocated = new Set(allocatedWorkerIds);
  const violations = nominations
    .filter(n => n.workerNotified === true && !allocated.has(n.workerId))
    .map(n => ({
      workerId: n.workerId,
      type: 'WORKER_NOTIFIED_WITHOUT_ALLOCATED_SLOT',
      action: 'BLOCK_AND_RETURN_TO_RESERVE_ONLY'
    }));

  return {
    valid: violations.length === 0,
    violations,
    rule: 'An agency may nominate reserve candidates, but the platform must allocate a vacancy before the worker is notified as offered/confirmed.'
  };
}

/**
 * Uses a two-stage pre-shift assurance process. A late non-response triggers a supplier
 * standby-capacity request, not an immediate offer to another worker, preventing duplicate commitments.
 */
export function buildPreShiftAssurancePlan({ confirmations = [], shiftStart, now = new Date().toISOString(), reminderMinutesBeforeShift = 120, recheckMinutesBeforeShift = 45 }) {
  const minutesToShift = (new Date(shiftStart).getTime() - new Date(now).getTime()) / 60000;
  const actions = [];

  for (const c of confirmations) {
    if (c.status && c.status !== 'CONFIRMED') continue;
    const reconfirmed = Boolean(c.reconfirmedAt);

    if (minutesToShift <= reminderMinutesBeforeShift && minutesToShift > recheckMinutesBeforeShift && !reconfirmed) {
      actions.push({
        workerId: c.workerId,
        supplierId: c.supplierId,
        action: 'SEND_WORKER_RECONFIRMATION',
        workerNotificationAllowed: true
      });
    }

    if (minutesToShift <= recheckMinutesBeforeShift && !reconfirmed) {
      actions.push({
        workerId: c.workerId,
        supplierId: c.supplierId,
        action: 'REQUEST_SUPPLIER_STANDBY_CAPACITY',
        workerNotificationAllowed: false,
        reason: 'NO_RECENT_RECONFIRMATION_CLOSE_TO_SHIFT'
      });
    }
  }

  return {
    shiftStart,
    minutesToShift: Number(minutesToShift.toFixed(1)),
    actions,
    safeguard: 'Standby capacity is not permission to offer a duplicate shift to another worker.'
  };
}

/**
 * Operational assurance gate for labour supply chains that may include umbrella companies.
 * It is intentionally a risk/control workflow, not a legal determination.
 */
export function assessSupplyChainAssurance({ supplier, now = new Date().toISOString(), maxAssuranceAgeDays = 90 }) {
  if (!supplier?.id) throw new Error('supplier.id is required');
  const gaps = [];
  const reviewFlags = [];

  if (supplier.usesUmbrellaCompany === true) {
    if (!supplier.umbrellaCompanyName) gaps.push('UMBRELLA_IDENTITY_MISSING');
    if (!supplier.supplyChainEntitiesKnown) gaps.push('SUPPLY_CHAIN_ENTITIES_NOT_CONFIRMED');
    if (!supplier.payeAssuranceLastCheckedAt) {
      gaps.push('PAYE_ASSURANCE_NOT_RECORDED');
    } else {
      const ageDays = (new Date(now) - new Date(supplier.payeAssuranceLastCheckedAt)) / 86400000;
      if (ageDays > maxAssuranceAgeDays) gaps.push('PAYE_ASSURANCE_STALE');
    }
  }

  if (supplier.agencyCountry && supplier.agencyCountry !== 'UK') reviewFlags.push('NON_UK_AGENCY_SPECIALIST_REVIEW');
  if (supplier.connectedToUmbrellaCompany === true) reviewFlags.push('CONNECTED_AGENCY_UMBRELLA_SPECIALIST_REVIEW');

  const touchlessAllowed = gaps.length === 0 && reviewFlags.length === 0;
  return {
    supplierId: supplier.id,
    touchlessAllowed,
    gaps,
    reviewFlags,
    action: touchlessAllowed ? 'ALLOW_TOUCHLESS_FULFILMENT' : 'REQUIRE_SUPPLY_CHAIN_ASSURANCE_REVIEW',
    note: 'Operational control only; final PAYE/legal responsibility depends on the actual labour supply chain and current law.'
  };
}
