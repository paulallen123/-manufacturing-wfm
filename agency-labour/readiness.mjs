import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function isPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function get(obj, path) {
  return path.split('.').reduce((value, key) => value?.[key], obj);
}

const REQUIRED_ASSIGNMENT_FIELDS = [
  'hirer.id',
  'hirer.name',
  'hirer.natureOfBusiness',
  'site.id',
  'site.name',
  'site.location',
  'requirement.id',
  'requirement.role',
  'requirement.responsibilities',
  'requirement.shiftStart',
  'requirement.shiftEnd',
  'requirement.expectedDuration',
  'requirement.requiredSkills',
  'safety.risks',
  'safety.controlMeasures',
  'safety.raiseConcernRoute'
];

/**
 * Produces a reusable, versioned assignment pack so agencies do not re-key the same
 * hirer/site/role/safety information for every booking. The pack is deliberately
 * evidence-focused and does not replace specialist legal or H&S review.
 */
export function buildAssignmentReadyPack(input) {
  const missing = REQUIRED_ASSIGNMENT_FIELDS.filter(path => !isPresent(get(input, path)));
  const canonical = {
    hirer: input.hirer ?? {},
    site: input.site ?? {},
    requirement: {
      id: input.requirement?.id,
      role: input.requirement?.role,
      responsibilities: input.requirement?.responsibilities ?? [],
      shiftStart: input.requirement?.shiftStart,
      shiftEnd: input.requirement?.shiftEnd,
      expectedDuration: input.requirement?.expectedDuration,
      requiredSkills: input.requirement?.requiredSkills ?? [],
      requiredCertifications: input.requirement?.requiredCertifications ?? [],
      hours: input.requirement?.hours ?? null,
      expenses: input.requirement?.expenses ?? []
    },
    safety: {
      risks: input.safety?.risks ?? [],
      controlMeasures: input.safety?.controlMeasures ?? [],
      ppe: input.safety?.ppe ?? [],
      requiredTraining: input.safety?.requiredTraining ?? [],
      raiseConcernRoute: input.safety?.raiseConcernRoute ?? null,
      emergencyInfo: input.safety?.emergencyInfo ?? null
    },
    workingConditions: input.workingConditions ?? {},
    versionedAt: input.versionedAt ?? new Date().toISOString()
  };

  const versionHash = sha256(canonical);
  const complete = missing.length === 0;
  const packId = `${input.hirer?.id ?? 'HIRER'}:${input.site?.id ?? 'SITE'}:${input.requirement?.role ?? 'ROLE'}`;

  return {
    packId,
    versionHash,
    complete,
    missing,
    touchlessReady: complete,
    canonical,
    agencyPayload: {
      packId,
      versionHash,
      hirer: canonical.hirer,
      site: canonical.site,
      role: canonical.requirement.role,
      responsibilities: canonical.requirement.responsibilities,
      shiftStart: canonical.requirement.shiftStart,
      shiftEnd: canonical.requirement.shiftEnd,
      expectedDuration: canonical.requirement.expectedDuration,
      requiredSkills: canonical.requirement.requiredSkills,
      requiredCertifications: canonical.requirement.requiredCertifications,
      expenses: canonical.requirement.expenses,
      safety: canonical.safety
    },
    workerPayload: {
      packId,
      versionHash,
      site: { id: canonical.site.id, name: canonical.site.name, location: canonical.site.location },
      role: canonical.requirement.role,
      responsibilities: canonical.requirement.responsibilities,
      shiftStart: canonical.requirement.shiftStart,
      shiftEnd: canonical.requirement.shiftEnd,
      safety: canonical.safety,
      expenses: canonical.requirement.expenses
    },
    principle: 'Reuse the approved pack and transmit only deltas when site/role/safety information changes.'
  };
}

export function diffAssignmentPack(previousPack, nextPack) {
  if (!previousPack?.canonical || !nextPack?.canonical) throw new Error('previousPack and nextPack canonical data are required');
  const changes = [];
  const walk = (a, b, prefix = '') => {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const av = a?.[key];
      const bv = b?.[key];
      if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
        walk(av, bv, path);
      } else if (JSON.stringify(stable(av)) !== JSON.stringify(stable(bv))) {
        changes.push({ path, before: av ?? null, after: bv ?? null });
      }
    }
  };
  walk(previousPack.canonical, nextPack.canonical);
  return {
    changed: changes.length > 0,
    previousVersionHash: previousPack.versionHash,
    nextVersionHash: nextPack.versionHash,
    changes,
    requiresReacknowledgement: changes.some(c => c.path.startsWith('safety.') || c.path.startsWith('requirement.required') || c.path.startsWith('site.'))
  };
}

/**
 * Blocks touchless placement until the agency and worker have acknowledged the exact
 * current pack version and any role/site training gates have been met.
 */
export function assessAssignmentHandshake({ pack, supplierAcknowledgement, workerAcknowledgement, workerTraining = [], now = new Date().toISOString() }) {
  if (!pack?.versionHash) throw new Error('pack.versionHash is required');
  const gaps = [];
  if (!pack.complete) gaps.push('ASSIGNMENT_PACK_INCOMPLETE');
  if (supplierAcknowledgement?.versionHash !== pack.versionHash) gaps.push('SUPPLIER_HAS_NOT_ACKNOWLEDGED_CURRENT_PACK');
  if (workerAcknowledgement?.versionHash !== pack.versionHash) gaps.push('WORKER_HAS_NOT_ACKNOWLEDGED_CURRENT_PACK');

  const trainingByCode = new Map(workerTraining.map(t => [t.code, t]));
  for (const required of pack.canonical?.safety?.requiredTraining ?? []) {
    const code = required.code ?? required;
    const t = trainingByCode.get(code);
    if (!t) gaps.push(`TRAINING_MISSING:${code}`);
    else if (t.validUntil && new Date(t.validUntil) <= new Date(now)) gaps.push(`TRAINING_EXPIRED:${code}`);
  }

  return {
    touchlessAllowed: gaps.length === 0,
    gaps,
    action: gaps.length === 0 ? 'ALLOW_WORKER_OFFER' : 'HOLD_FOR_READINESS_COMPLETION',
    audit: {
      packId: pack.packId,
      versionHash: pack.versionHash,
      supplierAcknowledgedAt: supplierAcknowledgement?.acknowledgedAt ?? null,
      workerAcknowledgedAt: workerAcknowledgement?.acknowledgedAt ?? null
    }
  };
}

/**
 * Availability is worker-owned. Stale availability does not become an automatic decline;
 * it creates a one-tap refresh action so agencies avoid ring-arounds while workers remain in control.
 */
export function assessAvailabilityFreshness({ worker, requirement, now = new Date().toISOString() }) {
  if (!requirement?.shiftStart) throw new Error('requirement.shiftStart is required');
  const nowDate = new Date(now);
  const leadHours = (new Date(requirement.shiftStart) - nowDate) / 36e5;
  const shiftSpecific = worker?.availability?.shiftIds?.includes(requirement.shiftId) === true;
  const lastUpdatedAt = worker?.availability?.lastUpdatedAt ? new Date(worker.availability.lastUpdatedAt) : null;
  const ageHours = lastUpdatedAt ? (nowDate - lastUpdatedAt) / 36e5 : Number.POSITIVE_INFINITY;
  const maxAgeHours = leadHours <= 6 ? 2 : leadHours <= 24 ? 12 : 24;
  const fresh = shiftSpecific && ageHours <= maxAgeHours;

  return {
    workerId: worker?.id,
    shiftSpecificAvailability: shiftSpecific,
    availabilityAgeHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    maxAgeHours,
    fresh,
    action: fresh ? 'USE_AS_ACTIVE_CANDIDATE' : 'REQUEST_ONE_TAP_AVAILABILITY_REFRESH',
    workerNotificationAllowed: !fresh,
    supplierCallRequired: false,
    safeguard: 'An agency cannot mark a worker available on the worker’s behalf.'
  };
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function enumerateWeekKeys(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt ?? startAt);
  const keys = new Set();
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= stop) {
    keys.add(isoWeekKey(cursor));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return keys;
}

/**
 * Conservative AWR continuity guard. It aggregates qualifying calendar weeks across agencies
 * for the same hirer/role and only resets history when an explicit evidenced reset has been
 * recorded. This avoids falsely resetting service simply because the supplying agency changed.
 */
export function assessAwrContinuity({ workerId, hirerId, roleKey, assignments = [], continuityEvents = [] }) {
  if (!workerId || !hirerId || !roleKey) throw new Error('workerId, hirerId and roleKey are required');

  const resets = continuityEvents
    .filter(e => e.workerId === workerId && e.hirerId === hirerId && e.roleKey === roleKey && e.decision === 'RESET')
    .filter(e => ['NEW_HIRER', 'SUBSTANTIVELY_DIFFERENT_ROLE', 'QUALIFYING_BREAK_CONFIRMED'].includes(e.reason))
    .sort((a, b) => new Date(a.effectiveAt) - new Date(b.effectiveAt));
  const lastReset = resets.at(-1) ?? null;
  const boundary = lastReset ? new Date(lastReset.effectiveAt) : null;

  const relevant = assignments
    .filter(a => a.workerId === workerId && a.hirerId === hirerId && a.roleKey === roleKey)
    .filter(a => !boundary || new Date(a.endAt ?? a.startAt) >= boundary)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  const weeks = new Set();
  const suppliers = new Set();
  for (const a of relevant) {
    suppliers.add(a.supplierId ?? 'UNKNOWN');
    for (const key of enumerateWeekKeys(a.startAt, a.endAt)) weeks.add(key);
  }

  const qualifyingWeeks = weeks.size;
  const thresholdWeeks = 12;
  let status = 'BELOW_THRESHOLD';
  if (qualifyingWeeks >= 12) status = 'QUALIFIED_EQUAL_TREATMENT';
  else if (qualifyingWeeks >= 10) status = 'APPROACHING_THRESHOLD';

  const requiredActions = [];
  if (qualifyingWeeks >= 10 && qualifyingWeeks < 12) requiredActions.push('OBTAIN_OR_REFRESH_COMPARATOR_PAY_AND_WORKING_CONDITIONS');
  if (qualifyingWeeks >= 12) requiredActions.push('ENFORCE_EQUAL_TREATMENT_FOR_PAY_AND_BASIC_WORKING_CONDITIONS');
  if (suppliers.size > 1) requiredActions.push('SHARE_CONTINUITY_STATUS_ACROSS_SUPPLIERS_WITH_MINIMUM_NECESSARY_DATA');

  return {
    workerId,
    hirerId,
    roleKey,
    qualifyingWeeks,
    weeksRemaining: Math.max(0, thresholdWeeks - qualifyingWeeks),
    status,
    suppliedByMultipleAgencies: suppliers.size > 1,
    supplierCount: suppliers.size,
    lastReset: lastReset ? {
      effectiveAt: lastReset.effectiveAt,
      reason: lastReset.reason,
      evidenceRef: lastReset.evidenceRef ?? null
    } : null,
    requiredActions,
    touchlessRisk: qualifyingWeeks >= 10 && requiredActions.length > 0 ? 'REVIEW_PAY_AND_WORKING_CONDITIONS' : 'NORMAL',
    safeguards: {
      agencyChangeDoesNotResetClock: true,
      noAutomaticResetFromUnknownBreak: true,
      substantiveRoleResetRequiresExplicitEvidence: true
    },
    note: 'Operational continuity control only. Statutory pauses/continuations and substantive-role questions can be fact-specific and should follow current AWR guidance.'
  };
}
