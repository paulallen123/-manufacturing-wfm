const COST_FIELDS = Object.freeze([
  'labour','agency','overtime','energy','downtime','missedOutput','maintenance','quality','other'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateMoneyBreakdown(costs, label) {
  assert(costs && typeof costs === 'object', `${label}.costs is required`);
  let total = 0;
  for (const field of COST_FIELDS) {
    const value = costs[field] ?? 0;
    assert(Number.isFinite(value) && value >= 0, `${label}.costs.${field} must be a non-negative number`);
    total += value;
  }
  return Math.round(total * 100) / 100;
}

function validateOption(option, label) {
  assert(option && typeof option === 'object', `${label} is required`);
  assert(typeof option.id === 'string' && option.id.length > 0, `${label}.id is required`);
  assert(typeof option.currency === 'string' && option.currency.length === 3, `${label}.currency must be an ISO-like 3-letter code`);
  const totalCost = validateMoneyBreakdown(option.costs, label);
  const constraintViolations = Array.isArray(option.constraintViolations) ? option.constraintViolations.filter(Boolean) : [];
  const evidenceRefs = Array.isArray(option.evidenceRefs) ? option.evidenceRefs.filter(Boolean) : [];
  return { ...option, totalCost, constraintViolations, evidenceRefs };
}

export function evaluateProjectedDecision({ baseline, alternatives, decisionContext = {} }) {
  const normalizedBaseline = validateOption(baseline, 'baseline');
  assert(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives are required');
  const normalizedAlternatives = alternatives.map((option, index) => validateOption(option, `alternative:${index}`));
  for (const option of normalizedAlternatives) {
    assert(option.currency === normalizedBaseline.currency, 'all options must use the baseline currency');
  }

  const eligible = normalizedAlternatives
    .filter((option) => option.constraintViolations.length === 0)
    .map((option) => ({
      ...option,
      projectedSaving: Math.round((normalizedBaseline.totalCost - option.totalCost) * 100) / 100
    }))
    .sort((a, b) => b.projectedSaving - a.projectedSaving || a.totalCost - b.totalCost || a.id.localeCompare(b.id));

  assert(eligible.length > 0, 'no safe alternative satisfies all constraints');
  const selected = eligible[0];

  return Object.freeze({
    status: 'projected',
    baseline: normalizedBaseline,
    rankedEligibleAlternatives: Object.freeze(eligible),
    rejectedAlternatives: Object.freeze(normalizedAlternatives.filter((option) => option.constraintViolations.length > 0)),
    selected,
    decisionContext: Object.freeze({ ...decisionContext }),
    claimBoundary: 'Projected savings only. Realised savings require post-action cost evidence.'
  });
}

export function recordRealisedOutcome(projectedDecision, { actualSelectedCost, evidenceRefs, attributionKey, observedAt }) {
  assert(projectedDecision?.status === 'projected', 'a projected decision is required');
  assert(Number.isFinite(actualSelectedCost) && actualSelectedCost >= 0, 'actualSelectedCost must be a non-negative number');
  assert(Array.isArray(evidenceRefs) && evidenceRefs.filter(Boolean).length > 0, 'realised outcome requires evidenceRefs');
  assert(typeof attributionKey === 'string' && attributionKey.length > 0, 'attributionKey is required to prevent double counting');
  assert(typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt)), 'observedAt must be ISO date-time');

  const realisedSaving = Math.round((projectedDecision.baseline.totalCost - actualSelectedCost) * 100) / 100;
  return Object.freeze({
    status: 'realised',
    currency: projectedDecision.baseline.currency,
    selectedOptionId: projectedDecision.selected.id,
    baselineCost: projectedDecision.baseline.totalCost,
    actualSelectedCost: Math.round(actualSelectedCost * 100) / 100,
    realisedSaving,
    attributionKey,
    evidenceRefs: Object.freeze(evidenceRefs.filter(Boolean)),
    observedAt
  });
}

export function createOutcomeLedger() {
  const outcomes = new Map();
  return Object.freeze({
    record(projectedDecision, actual) {
      const outcome = recordRealisedOutcome(projectedDecision, actual);
      assert(!outcomes.has(outcome.attributionKey), `duplicate attributionKey: ${outcome.attributionKey}`);
      outcomes.set(outcome.attributionKey, outcome);
      return outcome;
    },
    get(attributionKey) {
      return outcomes.get(attributionKey) ?? null;
    },
    entries() {
      return Object.freeze([...outcomes.values()]);
    }
  });
}
