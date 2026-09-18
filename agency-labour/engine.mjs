const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const DEFAULT_POLICY = Object.freeze({
  supplierResponseMinutes: 10,
  reminderMinutesBeforeShift: 120,
  recheckMinutesBeforeShift: 45,
  notice: {
    shiftNoticePresumptionHours: null,
    cancellationNoticePresumptionHours: null,
    source: 'customer-configured-until-secondary-legislation-finalised'
  },
  matching: {
    minHistoryForHighConfidence: 5,
    staleHistoryDays: 180,
    maxSiteExperienceWeight: 0.15,
    humanReviewRequired: true
  }
});

export function hoursUntil(iso, now = new Date()) {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}

export function evaluateNoticeRisk({ shiftStart, changedAt, policy = DEFAULT_POLICY, emergencyReason = null }) {
  const h = hoursUntil(shiftStart, new Date(changedAt));
  const threshold = policy.notice?.shiftNoticePresumptionHours;
  const configured = Number.isFinite(threshold);
  return {
    hoursNotice: Number(h.toFixed(2)),
    configuredPresumptionHours: configured ? threshold : null,
    risk: configured && h < threshold ? 'HIGH' : (h < 24 ? 'ELEVATED' : 'NORMAL'),
    emergencyReason,
    ruleStatus: configured ? 'CONFIGURED_POLICY' : 'AWAITING_FINAL_SECONDARY_LEGISLATION',
    evidenceRequired: h < 24 || Boolean(emergencyReason)
  };
}

export function workerEligibility(worker, requirement, now = new Date()) {
  const reasons = [];
  const blocks = [];
  if (!worker.availableShiftIds?.includes(requirement.shiftId)) blocks.push('NOT_AVAILABLE');
  if (!worker.skills?.includes(requirement.role)) blocks.push('ROLE_SKILL_MISSING');
  for (const reqCert of requirement.requiredCertifications ?? []) {
    const cert = worker.certifications?.find(c => c.code === reqCert);
    if (!cert) blocks.push(`CERT_MISSING:${reqCert}`);
    else if (new Date(cert.validUntil) <= now) blocks.push(`CERT_EXPIRED:${reqCert}`);
  }
  if (worker.siteRestriction === 'DO_NOT_RETURN') blocks.push('SITE_RESTRICTION_REQUIRES_REVIEW');
  if (blocks.length === 0) reasons.push('COMPLIANT_AND_AVAILABLE');
  return { eligible: blocks.length === 0, blocks, reasons };
}

function recencyFactor(lastShiftAt, now) {
  if (!lastShiftAt) return 0.5;
  const days = (now - new Date(lastShiftAt)) / 86400000;
  if (days <= 30) return 1;
  if (days >= 180) return 0.25;
  return 1 - ((days - 30) / 150) * 0.75;
}

export function explainWorkerFit(worker, requirement, policy = DEFAULT_POLICY, now = new Date()) {
  const eligibility = workerEligibility(worker, requirement, now);
  if (!eligibility.eligible) return { workerId: worker.id, eligible: false, ...eligibility };

  const history = worker.siteRoleHistory?.find(h => h.siteId === requirement.siteId && h.role === requirement.role);
  const completed = history?.completedShifts ?? 0;
  const attendance = clamp(worker.attendanceRate ?? 0.95, 0, 1);
  const punctuality = clamp(worker.punctualityRate ?? 0.95, 0, 1);
  const quality = clamp(history?.qualityIndex ?? 0.85, 0, 1);
  const siteExp = clamp(Math.log1p(completed) / Math.log(21), 0, 1);
  const recency = recencyFactor(history?.lastShiftAt, now);

  const historyConfidence = completed >= policy.matching.minHistoryForHighConfidence ? 'HIGH' : (completed >= 2 ? 'MEDIUM' : 'LOW');
  const newcomerNeutral = completed === 0 ? 0.70 : siteExp;
  const composite = (
    0.35 * 1 +
    policy.matching.maxSiteExperienceWeight * newcomerNeutral +
    0.20 * attendance +
    0.10 * punctuality +
    0.10 * quality +
    0.10 * recency
  );

  let band = 'SUITABLE';
  if (composite >= 0.88 && historyConfidence !== 'LOW') band = 'PREFERRED';
  if (completed === 0) band = 'ELIGIBLE_NEW';

  const reasons = ['ROLE_SKILL_VERIFIED'];
  if (completed > 0) reasons.push(`${completed}_PRIOR_SITE_ROLE_SHIFTS`);
  else reasons.push('NO_SITE_HISTORY_NEUTRAL_START');
  if (attendance >= 0.97) reasons.push('STRONG_ATTENDANCE');
  if (punctuality >= 0.97) reasons.push('STRONG_PUNCTUALITY');
  if (quality >= 0.9 && completed >= 3) reasons.push('STRONG_ROLE_QUALITY_HISTORY');
  if (recency >= 0.8 && completed > 0) reasons.push('RECENT_SITE_EXPERIENCE');

  return {
    workerId: worker.id,
    supplierId: worker.supplierId,
    eligible: true,
    recommendationBand: band,
    confidence: historyConfidence,
    reasons,
    evidence: {
      completedComparableShifts: completed,
      attendanceRate: attendance,
      punctualityRate: punctuality,
      comparableQualityIndex: completed >= 3 ? quality : null,
      recentComparableExperience: completed > 0 ? Number(recency.toFixed(2)) : null
    },
    safeguards: {
      protectedCharacteristicsUsed: false,
      healthDataUsed: false,
      siteExperienceWeightCapped: true,
      newWorkerNeutralBaseline: completed === 0,
      humanReviewRequired: policy.matching.humanReviewRequired
    },
    internalOrderingValue: Number(composite.toFixed(4))
  };
}

export function buildSupplierCascade(requirement, suppliers, policy = DEFAULT_POLICY) {
  const active = suppliers
    .filter(s => s.active !== false && (s.roles ?? []).includes(requirement.role))
    .map(s => ({
      supplierId: s.id,
      tier: s.tier ?? 99,
      billRate: s.billRate,
      fillRate: clamp(s.fillRate ?? 0.8, 0, 1),
      avgResponseMinutes: s.avgResponseMinutes ?? 30,
      capacity: s.capacity ?? requirement.headcount
    }))
    .sort((a, b) => a.tier - b.tier || a.billRate - b.billRate || b.fillRate - a.fillRate || a.avgResponseMinutes - b.avgResponseMinutes);

  let remaining = requirement.headcount;
  let cursor = 0;
  return active.map((s, index) => {
    const requested = Math.min(remaining, s.capacity);
    remaining -= requested;
    const opensAtMinute = cursor;
    cursor += policy.supplierResponseMinutes;
    return {
      sequence: index + 1,
      supplierId: s.supplierId,
      requestedHeadcount: requested,
      opensAtMinute,
      responseDeadlineMinute: cursor,
      estimatedShiftCost: Number((requested * requirement.shiftHours * s.billRate).toFixed(2)),
      rationale: index === 0 ? 'PREFERRED_SUPPLIER_FIRST' : 'AUTOMATIC_CASCADE_IF_UNFILLED',
      stopWhenFilled: true
    };
  }).filter(x => x.requestedHeadcount > 0);
}

export function createRequirementPlan({ requirement, suppliers, workers, policy = DEFAULT_POLICY, now = new Date().toISOString() }) {
  const noticeRisk = evaluateNoticeRisk({ shiftStart: requirement.shiftStart, changedAt: now, policy, emergencyReason: requirement.emergencyReason ?? null });
  const cascade = buildSupplierCascade(requirement, suppliers, policy);
  const workerFits = workers
    .map(w => explainWorkerFit(w, requirement, policy, new Date(now)))
    .filter(x => x.eligible)
    .sort((a, b) => {
      const band = { PREFERRED: 0, SUITABLE: 1, ELIGIBLE_NEW: 2 };
      return (band[a.recommendationBand] - band[b.recommendationBand]) || b.internalOrderingValue - a.internalOrderingValue;
    });

  return {
    requirementId: requirement.id,
    commitmentLadder: [
      { state: 'FORECAST', workerCommitment: false, description: 'Capacity signal only; no worker-specific offer.' },
      { state: 'SUPPLIER_RESERVED', workerCommitment: false, description: 'Supplier reserves capacity; no named worker promise.' },
      { state: 'WORKER_OFFERED', workerCommitment: true, description: 'Named worker receives shift request with full notice timestamps.' },
      { state: 'WORKER_CONFIRMED', workerCommitment: true, description: 'Worker has accepted; cancellation/change evidence must be retained.' }
    ],
    antiEvasionGuard: 'Do not use forecast/reservation states to disguise a worker-specific shift request or evade statutory rights.',
    noticeRisk,
    supplierCascade: cascade,
    recommendedWorkers: workerFits.map(({ internalOrderingValue, ...safe }) => safe),
    touchlessEligible: cascade.length > 0 && workerFits.length >= requirement.headcount,
    humanReviewRequiredForWorkerChoice: policy.matching.humanReviewRequired
  };
}

export function clockingExceptions({ confirmations, clockings, toleranceMinutes = 7 }) {
  const byWorker = new Map(clockings.map(c => [c.workerId, c]));
  const exceptions = [];
  for (const c of confirmations) {
    const actual = byWorker.get(c.workerId);
    if (!actual) {
      exceptions.push({ workerId: c.workerId, type: 'NO_SHOW', action: 'TRIGGER_REPLACEMENT_AND_NOTIFY_SUPPLIER' });
      continue;
    }
    const delta = (new Date(actual.clockIn) - new Date(c.shiftStart)) / 60000;
    if (delta > toleranceMinutes) exceptions.push({ workerId: c.workerId, type: 'LATE_ARRIVAL', minutes: Math.round(delta) });
  }
  return exceptions;
}

export function reconcileInvoice({ approved, invoice }) {
  const approvedMap = new Map(approved.map(x => [x.workerId, x]));
  const exceptions = [];
  let approvedValue = 0;
  let invoicedValue = 0;
  for (const row of invoice) {
    const a = approvedMap.get(row.workerId);
    const invValue = row.hours * row.billRate;
    invoicedValue += invValue;
    if (!a) {
      exceptions.push({ workerId: row.workerId, type: 'UNAPPROVED_WORKER', invoicedValue: Number(invValue.toFixed(2)) });
      continue;
    }
    approvedValue += a.hours * a.billRate;
    if (Math.abs(row.hours - a.hours) > 0.01) exceptions.push({ workerId: row.workerId, type: 'HOURS_MISMATCH', approvedHours: a.hours, invoicedHours: row.hours });
    if (Math.abs(row.billRate - a.billRate) > 0.001) exceptions.push({ workerId: row.workerId, type: 'RATE_MISMATCH', approvedRate: a.billRate, invoicedRate: row.billRate });
  }
  return {
    approvedValue: Number(approvedValue.toFixed(2)),
    invoicedValue: Number(invoicedValue.toFixed(2)),
    variance: Number((invoicedValue - approvedValue).toFixed(2)),
    exceptions,
    autoApprove: exceptions.length === 0
  };
}

export function estimateTouchlessSavings({ requirementsPerWeek, minutesPerManualRequirement, touchlessRate, managerHourlyCost, agencyMinutesSavedPerRequirement = 0, agencyHourlyCost = 0 }) {
  const touchless = requirementsPerWeek * clamp(touchlessRate, 0, 1);
  const managerHours = touchless * minutesPerManualRequirement / 60;
  const agencyHours = touchless * agencyMinutesSavedPerRequirement / 60;
  return {
    managerHoursSavedPerWeek: Number(managerHours.toFixed(2)),
    manufacturerAdminSavingPerWeek: Number((managerHours * managerHourlyCost).toFixed(2)),
    agencyHoursSavedPerWeek: Number(agencyHours.toFixed(2)),
    agencyCostToServeSavingPerWeek: Number((agencyHours * agencyHourlyCost).toFixed(2)),
    note: 'Illustrative only; populate with observed baseline values during pilot.'
  };
}
