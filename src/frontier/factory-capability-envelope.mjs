import { resolveCapabilitySubsumption } from './factory-capability-hierarchy.mjs';

export const CAPABILITY_ENVELOPE_VERSION = 'factory-capability-envelope-v0.4.0';

const OPS = new Set(['lte','gte','eq','in','contains']);

function keyOf(item) {
  return item?.semanticId ? String(item.semanticId) : null;
}

function validFinite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedUnit(item) {
  return {
    unit: item?.unit != null ? String(item.unit) : null,
    unitId: item?.unitId != null ? String(item.unitId) : null,
  };
}

function sameUnit(actual, constraint) {
  const a = normalizedUnit(actual);
  const r = normalizedUnit(constraint);
  if (a.unitId && r.unitId) return a.unitId === r.unitId;
  if (a.unit && r.unit) return a.unit === r.unit;
  return false;
}

export function normalizeCapabilityEnvelope(raw = {}) {
  if (!raw.capabilityId || !Array.isArray(raw.properties)) {
    return { status: 'rejected', reason: 'missing_capability_or_properties' };
  }

  const properties = [];
  for (const property of raw.properties) {
    const semanticId = keyOf(property);
    if (!semanticId) return { status: 'rejected', reason: 'missing_property_semantic_id' };
    if (!property.unit && !property.unitId) return { status: 'rejected', reason: 'missing_property_unit', semanticId };

    const unit = normalizedUnit(property);
    const kind = property.kind ?? (property.min != null || property.max != null ? 'range' : 'scalar');
    if (kind === 'range') {
      if (!validFinite(property.min) || !validFinite(property.max) || property.min > property.max) {
        return { status: 'rejected', reason: 'invalid_property_range', semanticId };
      }
      properties.push({ semanticId, kind: 'range', min: property.min, max: property.max, ...unit });
      continue;
    }

    if (!validFinite(property.value) && typeof property.value !== 'string' && typeof property.value !== 'boolean') {
      return { status: 'rejected', reason: 'unsupported_property_value', semanticId };
    }
    properties.push({ semanticId, kind: 'scalar', value: property.value, ...unit });
  }

  return {
    status: 'accepted',
    envelope: {
      capabilityId: String(raw.capabilityId),
      properties,
      source: raw.source ?? null,
      standardProfile: raw.standardProfile ?? null,
    },
  };
}

export function evaluateCapabilityRequirement(providedRaw, requiredRaw, { capabilityHierarchy = [], maxHierarchyDepth = 16 } = {}) {
  const provided = normalizeCapabilityEnvelope(providedRaw);
  if (provided.status !== 'accepted') return { status: 'unknown', reason: provided.reason, checks: [] };
  if (!requiredRaw?.capabilityId || !Array.isArray(requiredRaw.constraints)) {
    return { status: 'unknown', reason: 'invalid_requirement', checks: [] };
  }

  const identity = resolveCapabilitySubsumption(
    provided.envelope.capabilityId,
    String(requiredRaw.capabilityId),
    capabilityHierarchy,
    { maxDepth: maxHierarchyDepth },
  );
  if (identity.status === 'review_required') {
    return { status: 'unknown', reason: identity.reason, checks: [], capabilityMatch: identity };
  }
  if (identity.status !== 'match') {
    return { status: 'infeasible', reason: 'capability_mismatch', checks: [], capabilityMatch: identity };
  }

  const bySemanticId = new Map(provided.envelope.properties.map((item) => [item.semanticId, item]));
  const checks = [];

  for (const constraint of requiredRaw.constraints) {
    const semanticId = keyOf(constraint);
    if (!semanticId || !OPS.has(constraint.operator)) {
      return { status: 'unknown', reason: 'unsupported_constraint', checks, capabilityMatch: identity };
    }
    const actual = bySemanticId.get(semanticId);
    if (!actual) {
      checks.push({ semanticId, status: 'unknown', reason: 'property_missing' });
      continue;
    }
    if (!sameUnit(actual, constraint)) {
      checks.push({
        semanticId,
        status: 'unknown',
        reason: 'unit_mismatch',
        providedUnit: actual.unit,
        providedUnitId: actual.unitId,
        requiredUnit: constraint.unit ?? null,
        requiredUnitId: constraint.unitId ?? null,
      });
      continue;
    }

    if (actual.kind === 'range') {
      if (constraint.operator !== 'contains') {
        checks.push({ semanticId, status: 'unknown', reason: 'range_requires_contains_operator' });
        continue;
      }
      if (!validFinite(constraint.value)) {
        checks.push({ semanticId, status: 'unknown', reason: 'non_numeric_range_target' });
        continue;
      }
      const pass = constraint.value >= actual.min && constraint.value <= actual.max;
      checks.push({
        semanticId,
        status: pass ? 'pass' : 'fail',
        operator: 'contains',
        actual: { min: actual.min, max: actual.max },
        required: constraint.value,
        unit: actual.unit,
        unitId: actual.unitId,
      });
      continue;
    }

    if (constraint.operator === 'contains') {
      checks.push({ semanticId, status: 'unknown', reason: 'scalar_cannot_satisfy_contains' });
      continue;
    }

    let pass = false;
    if (constraint.operator === 'lte' || constraint.operator === 'gte') {
      if (!validFinite(actual.value) || !validFinite(constraint.value)) {
        checks.push({ semanticId, status: 'unknown', reason: 'non_numeric_range' });
        continue;
      }
      pass = constraint.operator === 'lte' ? actual.value <= constraint.value : actual.value >= constraint.value;
    } else if (constraint.operator === 'eq') {
      pass = actual.value === constraint.value;
    } else if (constraint.operator === 'in') {
      if (!Array.isArray(constraint.value)) {
        checks.push({ semanticId, status: 'unknown', reason: 'invalid_allowed_values' });
        continue;
      }
      pass = constraint.value.includes(actual.value);
    }

    checks.push({
      semanticId,
      status: pass ? 'pass' : 'fail',
      operator: constraint.operator,
      actual: actual.value,
      required: constraint.value,
      unit: actual.unit,
      unitId: actual.unitId,
    });
  }

  if (checks.some((check) => check.status === 'fail')) return { status: 'infeasible', reason: 'constraint_failed', checks, capabilityMatch: identity };
  if (checks.some((check) => check.status === 'unknown')) return { status: 'unknown', reason: 'insufficient_or_incompatible_evidence', checks, capabilityMatch: identity };
  return { status: 'feasible', reason: 'all_supported_constraints_pass', checks, capabilityMatch: identity };
}

export function assessProductionCapability({ providedCapabilities = [], requirement, workforceCoverage = null, capabilityHierarchy = [], maxHierarchyDepth = 16 } = {}) {
  const candidates = providedCapabilities.map((provided) => ({
    assetId: provided.assetId ?? null,
    ...evaluateCapabilityRequirement(provided, requirement, { capabilityHierarchy, maxHierarchyDepth }),
  }));

  const technicallyFeasible = candidates.filter((candidate) => candidate.status === 'feasible');
  const technicalUnknown = candidates.filter((candidate) => candidate.status === 'unknown');
  const workforceReady = workforceCoverage?.status === 'ready';

  if (technicallyFeasible.length === 0) {
    return {
      status: technicalUnknown.length ? 'review_required' : 'not_feasible',
      reason: technicalUnknown.length ? 'technical_evidence_incomplete' : 'no_asset_meets_requirement',
      candidates,
    };
  }

  if (workforceCoverage && !workforceReady) {
    return {
      status: 'not_ready',
      reason: 'workforce_capability_gap',
      candidates,
      technicallyFeasibleAssets: technicallyFeasible.map((item) => item.assetId),
    };
  }

  return {
    status: 'ready',
    reason: 'technical_and_workforce_requirements_met',
    candidates,
    technicallyFeasibleAssets: technicallyFeasible.map((item) => item.assetId),
  };
}

export function providedCapabilityEnvelopesFromGraph(graph, capabilityId, capabilityHierarchy = []) {
  const provided = [];
  for (const asset of graph?.assets ?? []) {
    for (const capability of asset?.capabilities ?? []) {
      if (capability?.role === 'required' || !capability?.capabilityId) continue;
      const match = resolveCapabilitySubsumption(capability.capabilityId, capabilityId, capabilityHierarchy);
      if (match.status !== 'match') continue;
      provided.push({
        assetId: asset.assetId,
        capabilityId: capability.capabilityId,
        properties: capability.properties ?? [],
        source: capability.source ?? asset?.source?.provider ?? null,
        standardProfile: capability?.evidence?.profileVersion ?? asset?.semanticModel ?? null,
      });
    }
  }
  return provided;
}

export function assessGraphProductionCapability({ graph, requirement, workforceCoverage = null, capabilityHierarchy = [], maxHierarchyDepth = 16 } = {}) {
  const providedCapabilities = providedCapabilityEnvelopesFromGraph(graph, requirement?.capabilityId, capabilityHierarchy);
  return assessProductionCapability({ providedCapabilities, requirement, workforceCoverage, capabilityHierarchy, maxHierarchyDepth });
}
