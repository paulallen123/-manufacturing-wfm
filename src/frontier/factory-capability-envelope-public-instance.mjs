import {
  evaluateCapabilityRequirement,
  providedCapabilityEnvelopesFromGraph,
} from './factory-capability-envelope.mjs';

export const PUBLIC_INSTANCE_ENVELOPE_VERSION = 'factory-capability-envelope-public-instance-v0.1.0';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function categorical(value) {
  return typeof value === 'string' || typeof value === 'boolean';
}

function unit(item) {
  return {
    unit: item?.unit != null ? String(item.unit) : null,
    unitId: item?.unitId != null ? String(item.unitId) : null,
  };
}

function sameUnit(a, b) {
  const left = unit(a);
  const right = unit(b);
  if (left.unitId && right.unitId) return left.unitId === right.unitId;
  if (left.unit && right.unit) return left.unit === right.unit;
  return false;
}

function noUnits(a, b) {
  const left = unit(a);
  const right = unit(b);
  return !left.unit && !left.unitId && !right.unit && !right.unitId;
}

function extendedProperty(property) {
  return property?.kind === 'set' || (property?.kind === 'range' && (property?.min == null || property?.max == null));
}

function checkSet(actual, constraint) {
  if (constraint?.operator !== 'contains') return { status: 'unknown', reason: 'set_requires_contains_operator' };
  if (!Array.isArray(actual?.value) || actual.value.length === 0) return { status: 'unknown', reason: 'empty_or_invalid_set' };
  if (Array.isArray(constraint?.value)) return { status: 'unknown', reason: 'set_target_must_be_scalar' };

  const numericSet = actual.value.every(finite);
  const categoricalSet = actual.value.every(categorical);
  if (!numericSet && !categoricalSet) return { status: 'unknown', reason: 'mixed_discrete_value_types' };
  if (numericSet) {
    if (!finite(constraint.value)) return { status: 'unknown', reason: 'non_numeric_set_target' };
    if (!sameUnit(actual, constraint)) return { status: 'unknown', reason: 'unit_mismatch' };
  } else if (!categorical(constraint.value)) {
    return { status: 'unknown', reason: 'unsupported_set_target' };
  } else if (!noUnits(actual, constraint) && !sameUnit(actual, constraint)) {
    return { status: 'unknown', reason: 'unit_mismatch' };
  }

  return {
    status: actual.value.includes(constraint.value) ? 'pass' : 'fail',
    operator: 'contains',
    actual: [...actual.value],
    required: constraint.value,
    ...unit(actual),
  };
}

function checkOneSidedRange(actual, constraint) {
  if (constraint?.operator !== 'contains') return { status: 'unknown', reason: 'range_requires_contains_operator' };
  if (!finite(constraint?.value)) return { status: 'unknown', reason: 'non_numeric_range_target' };
  if (!sameUnit(actual, constraint)) return { status: 'unknown', reason: 'unit_mismatch' };

  const hasMin = finite(actual?.min);
  const hasMax = finite(actual?.max);
  if (!hasMin && !hasMax) return { status: 'unknown', reason: 'range_has_no_numeric_bound' };
  if (hasMin && hasMax && actual.min > actual.max) return { status: 'unknown', reason: 'invalid_property_range' };

  const aboveMin = !hasMin || constraint.value >= actual.min;
  const belowMax = !hasMax || constraint.value <= actual.max;
  return {
    status: aboveMin && belowMax ? 'pass' : 'fail',
    operator: 'contains',
    actual: { min: hasMin ? actual.min : null, max: hasMax ? actual.max : null },
    required: constraint.value,
    ...unit(actual),
  };
}

export function evaluatePublicInstanceCapabilityRequirement(providedRaw, requiredRaw, options = {}) {
  const properties = Array.isArray(providedRaw?.properties) ? providedRaw.properties : [];
  const extended = properties.filter(extendedProperty);
  if (extended.length === 0) return evaluateCapabilityRequirement(providedRaw, requiredRaw, options);

  const extendedIds = new Set(extended.map((item) => item?.semanticId).filter(Boolean));
  const baseProvided = { ...providedRaw, properties: properties.filter((item) => !extendedProperty(item)) };
  const baseRequired = {
    ...requiredRaw,
    constraints: (requiredRaw?.constraints ?? []).filter((item) => !extendedIds.has(item?.semanticId)),
  };
  const base = evaluateCapabilityRequirement(baseProvided, baseRequired, options);
  if (base.status === 'infeasible' && base.reason === 'capability_mismatch') return base;
  if (base.status === 'unknown' && base.reason !== 'insufficient_or_incompatible_evidence') return base;

  const checks = [...(base.checks ?? [])];
  const bySemantic = new Map(extended.map((item) => [item.semanticId, item]));
  for (const constraint of requiredRaw?.constraints ?? []) {
    const actual = bySemantic.get(constraint?.semanticId);
    if (!actual) continue;
    const result = actual.kind === 'set' ? checkSet(actual, constraint) : checkOneSidedRange(actual, constraint);
    checks.push({ semanticId: constraint.semanticId, ...result });
  }

  if (checks.some((item) => item.status === 'fail')) {
    return { status: 'infeasible', reason: 'constraint_failed', checks, capabilityMatch: base.capabilityMatch };
  }
  if (checks.some((item) => item.status === 'unknown')) {
    return { status: 'unknown', reason: 'insufficient_or_incompatible_evidence', checks, capabilityMatch: base.capabilityMatch };
  }
  return { status: 'feasible', reason: 'all_supported_constraints_pass', checks, capabilityMatch: base.capabilityMatch };
}

export function assessPublicInstanceProductionCapability({ providedCapabilities = [], requirement, workforceCoverage = null, capabilityHierarchy = [], maxHierarchyDepth = 16 } = {}) {
  const candidates = providedCapabilities.map((provided) => ({
    assetId: provided.assetId ?? null,
    ...evaluatePublicInstanceCapabilityRequirement(provided, requirement, { capabilityHierarchy, maxHierarchyDepth }),
  }));
  const feasible = candidates.filter((item) => item.status === 'feasible');
  const unknown = candidates.filter((item) => item.status === 'unknown');

  if (feasible.length === 0) {
    return {
      status: unknown.length ? 'review_required' : 'not_feasible',
      reason: unknown.length ? 'technical_evidence_incomplete' : 'no_asset_meets_requirement',
      candidates,
    };
  }
  if (workforceCoverage && workforceCoverage.status !== 'ready') {
    return {
      status: 'not_ready',
      reason: 'workforce_capability_gap',
      candidates,
      technicallyFeasibleAssets: feasible.map((item) => item.assetId),
    };
  }
  return {
    status: 'ready',
    reason: 'technical_and_workforce_requirements_met',
    candidates,
    technicallyFeasibleAssets: feasible.map((item) => item.assetId),
  };
}

export function assessGraphPublicInstanceCapability({ graph, requirement, workforceCoverage = null, capabilityHierarchy = [], maxHierarchyDepth = 16 } = {}) {
  const providedCapabilities = providedCapabilityEnvelopesFromGraph(graph, requirement?.capabilityId, capabilityHierarchy);
  return assessPublicInstanceProductionCapability({
    providedCapabilities,
    requirement,
    workforceCoverage,
    capabilityHierarchy,
    maxHierarchyDepth,
  });
}
