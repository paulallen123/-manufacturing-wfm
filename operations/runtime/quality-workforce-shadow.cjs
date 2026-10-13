'use strict';

/*
 * Pure issue #57 boundary: screenQualityWorkforceShadow(input) returns a deeply
 * frozen aggregate screening result plus a createDecisionEpisode SHADOW episode.
 * It never joins provider data, identifies a person, executes an option, stores
 * outcomes, infers causality, or grants scheduling/employment authority.
 *
 * The caller supplies an independent context: exact tenant/site/workCentre/
 * product/order/window, its context sourceRevision, observedAt, provenance,
 * and sourceRevisions keyed by each evidence producer. Quality, confounder,
 * aggregate workforce and scenario records must each carry that same scope,
 * contextRevision, their own sourceRevision, occurrence/observation times and
 * {source,recordHash} provenance. This boundary checks the supplied hash's
 * shape and binds it into the digest; the upstream adapter must verify its
 * source authenticity and immutable record semantics. Missing or inconsistent
 * records yield INVESTIGATE and no workforce option.
 *
 * Policy must explicitly supply version/provenance, maxEvidenceAgeMs,
 * metricLimits, allowedOptionKinds and Decision Episode objective. Both a
 * supplied do-nothing baseline and any workforce scenario/predictions are supplied
 * independently. Candidate refs must name current quality and aggregate skill
 * evidence. Only aggregate ADD_VERIFIED_SKILL_COVER and
 * AGGREGATE_TRAINING_REVIEW types are admitted; labels are fixed here.
 *
 * Integration requirement: an authorised caller must obtain current scoped
 * QMS/MES, confounder, skills and scenario evidence, authenticate producers,
 * enforce privacy/role access, save the complete policy and input snapshot for
 * replay, and show the result as advisory. For every card render, call
 * displayableWorkforceRecommendation(result, trustedCurrentUtc) with fresh
 * server time. Its expiry filter cannot detect a newer source revision: the
 * caller must rescreen when source, policy or scope changes. Shape checks and
 * supplied flags do not authenticate the baseline; the producer must do so.
 * The existing Decision Episode has
 * no work-centre/product/order/window fields, so its contextRevision is the
 * digest of this bound snapshot; consumers must retain this result alongside
 * the episode. Decision Episode drops option windows, so optionValidity and
 * evaluatedAt are retained here; they are advisory display limits, never
 * execution permission. No scheduler, outcome or live provider path is wired.
 * Predictions are nonnegative quantities/scores/costs; planAttainmentPct is
 * 0..100. No currency, risk scale or quality improvement is inferred. This
 * synthetic gate measures explicit blocker handling, not root-cause
 * discrimination, cost/throughput trade-offs, benefit double-counting or
 * customer value. Provider ingestion, outcome reconciliation and real policy
 * authorisation remain integration work.
 */
const { createDecisionEpisode, digest, stable } = require('./decision-episode.cjs');
const CONTRACT_VERSION = 'VECTOR_QUALITY_WORKFORCE_SHADOW_V1';
const REQUIRED_CONFOUNDERS = Object.freeze([
  'machine', 'toolingChangeover', 'material', 'product', 'process',
  'inspectionModel', 'inspectionSensor', 'environment', 'supplierQuality'
]);
const SCOPE_FIELDS = Object.freeze([
  'tenant', 'site', 'workCentre', 'product', 'order', 'windowStart', 'windowEnd'
]);
const OPTION_TYPES = Object.freeze({
  ADD_VERIFIED_SKILL_COVER: Object.freeze({
    id: 'verified-skill-cover', label: 'Review verified skill cover for bounded window'
  }),
  AGGREGATE_TRAINING_REVIEW: Object.freeze({
    id: 'aggregate-training-review', label: 'Review aggregate training need'
  })
});
const METRICS = new Set(['defectRate', 'reworkRate', 'scrapRate', 'firstPassYield']);
const PREDICTION_METRICS = new Set(['throughputUnits', 'planAttainmentPct',
  'labourCost', 'delayMinutes', 'riskScore', 'energyCost', 'qualityRisk']);
const FINDINGS = new Set(['ABSENT', 'PRESENT', 'DOMINANT', 'UNKNOWN']);
function validRateLimit(metric, limit) {
  if (!limit || typeof limit !== 'object') return false;
  const direction = metric === 'firstPassYield' ? 'min' : 'max';
  const opposite = direction === 'min' ? 'max' : 'min';
  return Number.isFinite(limit[direction]) && limit[direction] >= 0 &&
    limit[direction] <= 1 && limit[opposite] == null;
}

function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
    return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const normalized = new Date(ms).toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null;
}
function nonempty(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 180;
}
function hasProvenance(value) {
  return value && nonempty(value.source) &&
    typeof value.recordHash === 'string' && /^[a-f0-9]{64}$/i.test(value.recordHash);
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function sameScope(candidate, expected) {
  return candidate && SCOPE_FIELDS.every(field => candidate[field] === expected[field]);
}
function completePrediction(raw, policy) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  // Values are nonnegative quantities/scores/costs; only attainment is a
  // 0..100 percentage. No currency or upper risk scale is inferred here.
  for (const metric of PREDICTION_METRICS) {
    if (!Object.hasOwn(raw, metric) || raw[metric] == null) continue;
    const value = raw[metric];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (metric === 'planAttainmentPct' && value > 100)) return false;
  }
  return Object.entries(policy.objective).every(([metric, weight]) =>
    metric === 'uncertaintyPenalty' || weight <= 0 ||
      (PREDICTION_METRICS.has(metric) &&
        typeof raw[metric] === 'number' && Number.isFinite(raw[metric])));
}
function validUncertainty(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function normaliseEvidence(raw, context, asOf, maxAge, reasons, kind) {
  if (!raw || !nonempty(raw.id) || !nonempty(raw.sourceRevision) ||
      !hasProvenance(raw.provenance) || !utc(raw.observedAt) || !utc(raw.occurredAt)) {
    reasons.add('INVALID_EVIDENCE');
    return null;
  }
  const evidence = {
    id: raw.id, sourceRevision: raw.sourceRevision,
    contextRevision: raw.contextRevision,
    scope: Object.fromEntries(SCOPE_FIELDS.map(field => [field, raw.scope?.[field]])),
    occurredAt: utc(raw.occurredAt), observedAt: utc(raw.observedAt),
    provenance: { source: raw.provenance.source, recordHash: raw.provenance.recordHash.toLowerCase() }
  };
  if (!sameScope(evidence.scope, context.scope) ||
      Date.parse(evidence.occurredAt) < Date.parse(context.scope.windowStart) ||
      Date.parse(evidence.occurredAt) >= Date.parse(context.scope.windowEnd))
    reasons.add('EVIDENCE_SCOPE_MISMATCH');
  if (evidence.contextRevision !== context.sourceRevision ||
      context.sourceRevisions[evidence.provenance.source] !== evidence.sourceRevision)
    reasons.add('EVIDENCE_REVISION_MISMATCH');
  const observed = Date.parse(evidence.observedAt);
  if (observed > asOf || observed < Date.parse(evidence.occurredAt))
    reasons.add('FUTURE_EVIDENCE');
  else if (asOf - observed >= maxAge)
    reasons.add('STALE_EVIDENCE');
  if (kind === 'quality') {
    evidence.metric = raw.metric;
    evidence.value = raw.value;
    if (!METRICS.has(raw.metric) || typeof raw.value !== 'number' ||
        !Number.isFinite(raw.value) || raw.value < 0 || raw.value > 1)
      reasons.add('INVALID_EVIDENCE');
  } else if (kind === 'confounder') {
    evidence.category = raw.category;
    evidence.finding = raw.finding;
    if (!REQUIRED_CONFOUNDERS.includes(raw.category) || !FINDINGS.has(raw.finding))
      reasons.add('INVALID_EVIDENCE');
  } else if (kind === 'workforce') {
    evidence.finding = raw.finding;
    if (!['AGGREGATE_SKILL_GAP', 'NO_AGGREGATE_GAP', 'UNKNOWN'].includes(raw.finding))
      reasons.add('INVALID_EVIDENCE');
  }
  return evidence;
}
function normaliseList(raw, context, asOf, maxAge, reasons, kind) {
  const byId = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const evidence = normaliseEvidence(item, context, asOf, maxAge, reasons, kind);
    if (!evidence) continue;
    const previous = byId.get(evidence.id);
    if (previous && stable(previous) !== stable(evidence))
      reasons.add('CONFLICTING_DUPLICATE');
    else byId.set(evidence.id, evidence);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function usableOption(raw, context, policy, asOf, reasons, evidenceIds, qualityIds, workforceIds) {
  const bound = normaliseEvidence(raw, context, asOf, policy.maxEvidenceAgeMs, reasons, 'option');
  if (!bound) return null;
  const scope = context.scope;
  const type = OPTION_TYPES[raw?.kind];
  if (!type || raw.id !== type.id || !policy.allowedOptionKinds.includes(raw.kind) ||
      raw.feasible !== true || raw.policyAllowed !== true ||
      raw.hardConstraintsPassed !== true || !validUncertainty(raw.uncertainty) ||
      !completePrediction(raw.prediction, policy)) return null;
  const from = utc(raw.validFrom);
  const until = utc(raw.validUntil);
  if (!from || !until || Date.parse(until) <= asOf ||
      Date.parse(from) < Date.parse(scope.windowStart) ||
      Date.parse(until) > Date.parse(scope.windowEnd) ||
      Date.parse(from) >= Date.parse(until)) return null;
  if (!Array.isArray(raw.evidenceRefs) || !raw.evidenceRefs.length ||
      raw.evidenceRefs.some(ref => !nonempty(ref))) return null;
  if (raw.evidenceRefs.some(ref => !evidenceIds.has(ref))) {
    reasons.add('UNBOUND_OPTION_EVIDENCE');
    return null;
  }
  if (!raw.evidenceRefs.some(ref => qualityIds.has(ref)) ||
      !raw.evidenceRefs.some(ref => workforceIds.has(ref))) {
    reasons.add('INCOMPLETE_OPTION_EVIDENCE');
    return null;
  }
  return {
    id: type.id, label: type.label, feasible: true, policyAllowed: true,
    hardConstraintsPassed: true, uncertainty: raw.uncertainty,
    prediction: raw.prediction, validFrom: from, validUntil: until,
    scenarioObservedAt: bound.observedAt,
    evidenceRefs: ['sha256:' + digest({ bound, validFrom: from, validUntil: until }),
      ...raw.evidenceRefs.map(ref => 'sha256:' + digest(ref))],
    reasonCodes: ['AGGREGATE_ONLY', 'CAUSALITY_UNPROVEN', 'BOUNDED_SHADOW_OPTION']
  };
}
function screenQualityWorkforceShadow(input = {}) {
  const { context, policy } = input;
  const asOfIso = utc(input.asOf);
  const scope = context?.scope;
  if (!asOfIso || !scope || !SCOPE_FIELDS.every(field => nonempty(scope[field])) ||
      !utc(scope.windowStart) || !utc(scope.windowEnd) ||
      Date.parse(scope.windowStart) >= Date.parse(scope.windowEnd) ||
      !nonempty(context.sourceRevision) || !context.sourceRevisions ||
      typeof context.sourceRevisions !== 'object' || Array.isArray(context.sourceRevisions) ||
      !utc(context.observedAt) ||
      !hasProvenance(context.provenance))
    throw new Error('Complete independently supplied context and evaluation time required.');
  if (!policy || !nonempty(policy.version) || !nonempty(policy.provenance) ||
      !Number.isSafeInteger(policy.maxEvidenceAgeMs) || policy.maxEvidenceAgeMs < 0 ||
      !policy.metricLimits || !Array.isArray(policy.allowedOptionKinds) ||
      !policy.objective || typeof policy.objective !== 'object' ||
      !validUncertainty(policy.objective.uncertaintyPenalty) ||
      !Object.entries(policy.objective).every(([metric, value]) =>
        metric === 'uncertaintyPenalty' ||
        (PREDICTION_METRICS.has(metric) && typeof value === 'number' &&
          Number.isFinite(value) && value >= 0)) ||
      !Object.entries(policy.objective).some(([metric, value]) =>
        metric !== 'uncertaintyPenalty' && value > 0))
    throw new Error('Explicit versioned screening policy, limits, freshness and objective required.');
  const baselineOptions = input.options?.filter(option => option?.id === 'do-nothing') || [];
  const doNothing = baselineOptions[0];
  if (baselineOptions.length !== 1 || !doNothing || doNothing.kind !== 'DO_NOTHING' ||
      doNothing.feasible !== true || doNothing.policyAllowed !== true ||
      doNothing.hardConstraintsPassed !== true || !validUncertainty(doNothing.uncertainty) ||
      !doNothing.prediction ||
      !completePrediction(doNothing.prediction, policy) ||
      !Array.isArray(doNothing.evidenceRefs) || !doNothing.evidenceRefs.length ||
      doNothing.evidenceRefs.some(ref => !nonempty(ref)))
    throw new Error('A complete, independently supplied do-nothing option is required.');
  const asOf = Date.parse(asOfIso);
  const reasons = new Set();
  if (asOf >= Date.parse(scope.windowEnd)) reasons.add('WINDOW_NOT_ACTIONABLE');
  const contextObserved = Date.parse(context.observedAt);
  if (contextObserved > asOf) reasons.add('FUTURE_EVIDENCE');
  else if (asOf - contextObserved >= policy.maxEvidenceAgeMs) reasons.add('STALE_EVIDENCE');
  const quality = normaliseList(input.qualityEvents, context, asOf,
    policy.maxEvidenceAgeMs, reasons, 'quality');
  if (!quality.length) reasons.add('QUALITY_SOURCE_OUTAGE');
  const confounders = normaliseList(input.confounders, context, asOf,
    policy.maxEvidenceAgeMs, reasons, 'confounder');
  const workforce = normaliseList(input.workforceEvidence ? [input.workforceEvidence] : [],
    context, asOf, policy.maxEvidenceAgeMs, reasons, 'workforce');
  const baselineReasons = new Set();
  const baselineBound = normaliseEvidence(doNothing, context, asOf,
    policy.maxEvidenceAgeMs, baselineReasons, 'option');
  if (!baselineBound || [...baselineReasons].some(reason =>
    ['INVALID_EVIDENCE', 'EVIDENCE_SCOPE_MISMATCH'].includes(reason)))
    throw new Error('A scoped, current and provenanced do-nothing option is required.');
  for (const reason of baselineReasons) reasons.add(reason);
  const evidenceIds = new Set([...quality, ...confounders, ...workforce].map(item => item.id));
  if (evidenceIds.size !== quality.length + confounders.length + workforce.length)
    reasons.add('CONFLICTING_DUPLICATE');
  const qualityIds = new Set(quality.map(item => item.id));
  const workforceIds = new Set(workforce.map(item => item.id));
  if (doNothing.evidenceRefs.some(ref => !evidenceIds.has(ref)))
    reasons.add('UNBOUND_BASELINE_EVIDENCE');
  if (!workforce.length) reasons.add('MISSING_AGGREGATE_WORKFORCE_EVIDENCE');
  for (const category of REQUIRED_CONFOUNDERS) {
    const findings = confounders.filter(item => item.category === category).map(item => item.finding);
    if (!findings.length) reasons.add('MISSING_CONFOUNDER');
    if (findings.some(finding => finding !== 'ABSENT'))
      reasons.add('NON_WORKFORCE_EVIDENCE');
    if (new Set(findings).size > 1) reasons.add('CONTRADICTORY_CONFOUNDER');
  }
  const qualityFindings = [];
  for (const event of quality) {
    const limit = policy.metricLimits[event.metric];
    if (!validRateLimit(event.metric, limit)) {
      reasons.add('MISSING_POLICY_LIMIT');
      continue;
    }
    qualityFindings.push(Number.isFinite(limit.max)
      ? event.value > limit.max : event.value < limit.min);
  }
  if (qualityFindings.includes(true) && qualityFindings.includes(false))
    reasons.add('CONTRADICTORY_QUALITY_EVENTS');
  if (!workforce.some(evidence => evidence.finding === 'AGGREGATE_SKILL_GAP'))
    reasons.add('NO_AGGREGATE_SKILL_GAP');
  const seenOptionIds = new Set();
  for (const option of Array.isArray(input.options) ? input.options : []) {
    if (seenOptionIds.has(option?.id)) reasons.add('CONFLICTING_OPTION');
    seenOptionIds.add(option?.id);
  }
  const candidateOptions = (Array.isArray(input.options) ? input.options : [])
    .filter(option => option?.id !== 'do-nothing')
    .map(option => usableOption(option, context, policy, asOf, reasons,
      evidenceIds, qualityIds, workforceIds))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!candidateOptions.length) reasons.add('NO_ELIGIBLE_WORKFORCE_OPTION');
  const alert = qualityFindings.length > 0 && qualityFindings.every(Boolean);
  const clear = reasons.size === 0 && alert;
  const onlyNoAlertReasons = [...reasons].every(reason =>
    ['NO_AGGREGATE_SKILL_GAP', 'NO_ELIGIBLE_WORKFORCE_OPTION'].includes(reason));
  const status = clear ? 'REVIEW_WORKFORCE_OPTIONS'
    : !alert && !qualityFindings.includes(true) && onlyNoAlertReasons
      ? 'NO_QUALITY_ALERT' : 'INVESTIGATE';
  const policyDigest = digest({
    version: policy.version, provenance: policy.provenance,
    maxEvidenceAgeMs: policy.maxEvidenceAgeMs, metricLimits: policy.metricLimits,
    allowedOptionKinds: [...policy.allowedOptionKinds].sort(), objective: policy.objective
  });
  const bound = {
    scope: Object.fromEntries(SCOPE_FIELDS.map(field => [field, scope[field]])),
    contextRevision: context.sourceRevision,
    contextObservedAt: utc(context.observedAt),
    sourceRevisions: Object.fromEntries(Object.entries(context.sourceRevisions).sort(([a], [b]) => a.localeCompare(b))),
    contextProvenance: {
      source: context.provenance.source,
      recordHash: context.provenance.recordHash.toLowerCase()
    },
    quality, confounders, workforce, policyVersion: policy.version,
    policyProvenance: policy.provenance, policyDigest, asOf: asOfIso
  };
  const evidenceDigest = digest(bound);
  const evidenceValidUntil = new Date(Math.min(
    Date.parse(scope.windowEnd),
    ...[context.observedAt, ...quality.map(item => item.observedAt),
      ...confounders.map(item => item.observedAt),
      ...workforce.map(item => item.observedAt), baselineBound.observedAt,
      ...candidateOptions.map(item => item.scenarioObservedAt)]
      .map(observedAt => Date.parse(observedAt) + policy.maxEvidenceAgeMs)
  )).toISOString();
  const optionValidity = clear ? candidateOptions.map(option => ({
    optionId: option.id, validFrom: option.validFrom, validUntil: option.validUntil
  })) : [];
  const options = [
    { id: 'do-nothing', label: 'Maintain current aggregate crew plan',
      feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: doNothing.uncertainty, prediction: doNothing.prediction,
      evidenceRefs: ['sha256:' + digest(baselineBound),
        ...doNothing.evidenceRefs.map(ref => 'sha256:' + digest(ref))],
      reasonCodes: ['SUPPLIED_BASELINE', 'UPSTREAM_AUTHENTICITY_REQUIRED',
        'NO_EXECUTION_AUTHORITY'] },
    ...(clear ? candidateOptions : [{
      id: 'investigate', label: 'Investigate aggregate quality evidence',
      feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: 1, prediction: {},
      evidenceRefs: ['sha256:' + evidenceDigest],
      reasonCodes: ['UNKNOWN_CAUSE', 'NO_WORKFORCE_ACTION']
    }])
  ];
  const episode = createDecisionEpisode({
    tenant: scope.tenant, site: scope.site, decisionType: 'aggregate-quality-review',
    triggerId: 'quality:' + digest(quality), triggeredAt: asOfIso,
    contextRevision: evidenceDigest, mode: 'SHADOW',
    sourceEvidence: ['sha256:' + evidenceDigest], objective: policy.objective, options
  });
  return deepFreeze({
    contractVersion: CONTRACT_VERSION, scope: bound.scope,
    sourceRevision: context.sourceRevision, observedAt: context.observedAt,
    evaluatedAt: asOfIso, evidenceValidUntil, optionValidity,
    policyVersion: policy.version, policyDigest, evidenceDigest, status,
    workforceContribution: clear ? 'UNPROVEN' : 'UNKNOWN',
    reasons: [...reasons].sort(), advisoryOnly: true, executionPermitted: false,
    episode
  });
}

function displayableWorkforceRecommendation(screening, currentTime) {
  const currentIso = utc(currentTime);
  if (!currentIso) throw new Error('A trusted current time is required for advisory display.');
  if (!screening || screening.contractVersion !== CONTRACT_VERSION ||
      screening.status !== 'REVIEW_WORKFORCE_OPTIONS' ||
      screening.episode?.mode !== 'SHADOW' ||
      screening.episode?.contextRevision !== screening.evidenceDigest ||
      screening.episode?.recommendation?.authorityRequired !== 'NO_EXECUTION' ||
      screening.episode?.recommendation?.executionPermitted !== false ||
      screening.advisoryOnly !== true || screening.executionPermitted !== false) return null;
  const optionId = screening.episode.recommendation?.optionId;
  const option = screening.episode.options?.find(item => item.id === optionId);
  if (!option || option.feasible !== true || option.policyAllowed !== true ||
      option.hardConstraintsPassed !== true) return null;
  const validity = screening.optionValidity?.find(item => item.optionId === optionId);
  if (!validity) return null;
  const evaluatedAt = utc(screening.evaluatedAt);
  const evidenceValidUntil = utc(screening.evidenceValidUntil);
  const validFrom = utc(validity.validFrom);
  const validUntil = utc(validity.validUntil);
  const windowEnd = utc(screening.scope?.windowEnd);
  if (!evaluatedAt || !evidenceValidUntil || !validFrom || !validUntil || !windowEnd)
    return null;
  const now = Date.parse(currentIso);
  if (now < Date.parse(evaluatedAt) ||
      now < Date.parse(validFrom) || now >= Date.parse(validUntil) ||
      now >= Date.parse(evidenceValidUntil) ||
      now >= Date.parse(windowEnd)) return null;
  return deepFreeze({ optionId, validFrom: validity.validFrom,
    validUntil: validity.validUntil, evaluatedAt: screening.evaluatedAt,
    advisoryOnly: true, executionPermitted: false });
}

module.exports = Object.freeze({
  CONTRACT_VERSION, REQUIRED_CONFOUNDERS, screenQualityWorkforceShadow,
  displayableWorkforceRecommendation
});

