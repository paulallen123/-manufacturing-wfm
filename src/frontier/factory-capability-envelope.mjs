export const CAPABILITY_ENVELOPE_VERSION = 'factory-capability-envelope-v0.2.0';

const OPS = new Set(['lte','gte','eq','in']);

function keyOf(item) {
  return item?.semanticId ? String(item.semanticId) : null;
}

function validFinite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeCapabilityEnvelope(raw = {}) {
  if (!raw.capabilityId || !Array.isArray(raw.properties)) {
    return { status: 'rejected', reason: 'missing_capability_or_properties' };
  }

  const properties = [];
  for (const property of raw.properties) {
    const semanticId = keyOf(property);
    if (!semanticId) return { status: 'rejected', reason: 'missing_property_semantic_id' };
    if (!property.unit) return { status: 'rejected', reason: 'missing_property_unit', semanticId };
    if (!validFinite(property.value) && typeof property.value !== 'string' && typeof property.value !== 'boolean') {
      return { status: 'rejected', reason: 'unsupported_property_value', semanticId };
    }
    properties.push({ semanticId, value: property.value, unit: String(property.unit) });
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

export function evaluateCapabilityRequirement(providedRaw, requiredRaw) {
  const provided = normalizeCapabilityEnvelope(providedRaw);
  if (provided.status !== 'accepted') return { status: 'unknown', reason: provided.reason, checks: [] };
  if (!requiredRaw?.capabilityId || !Array.isArray(requiredRaw.constraints)) {
    return { status: 'unknown', reason: 'invalid_requirement', checks: [] };
  }
  if (String(requiredRaw.capabilityId) !== provided.envelope.capabilityId) {
    return { status: 'infeasible', reason: 'capability_mismatch', checks: [] };
  }

  const bySemanticId = new Map(provided.envelope.properties.map((item) => [item.semanticId, item]));
  const checks = [];

  for (const constraint of requiredRaw.constraints) {
    const semanticId = keyOf(constraint);
    if (!semanticId || !OPS.has(constraint.operator)) {
      return { status: 'unknown', reason: 'unsupported_constraint', checks };
    }
    const actual = bySemanticId.get(semanticId);
    if (!actual) {
      checks.push({ semanticId, status: 'unknown', reason: 'property_missing' });
      continue;
    }
    if (!constraint.unit || String(constraint.unit) !== actual.unit) {
      checks.push({ semanticId, status: 'unknown', reason: 'unit_mismatch', providedUnit: actual.unit, requiredUnit: constraint.unit ?? null });
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

    checks.push({ semanticId, status: pass ? 'pass' : 'fail', operator: constraint.operator, actual: actual.value, required: constraint.value, unit: actual.unit });
  }

  if (checks.some((check) => check.status === 'fail')) return { status: 'infeasible', reason: 'constraint_failed', checks };
  if (checks.some((check) => check.status === 'unknown')) return { status: 'unknown', reason: 'insufficient_or_incompatible_evidence', checks };
  return { status: 'feasible', reason: 'all_supported_constraints_pass', checks };
}

export function assessProductionCapability({ providedCapabilities = [], requirement, workforceCoverage = null } = {}) {
  const candidates = providedCapabilities.map((provided) => ({
    assetId: provided.assetId ?? null,
    ...evaluateCapabilityRequirement(provided, requirement),
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

export function providedCapabilityEnvelopesFromGraph(graph, capabilityId) {
  const provided = [];
  for (const asset of graph?.assets ?? []) {
    for (const capability of asset?.capabilities ?? []) {
      if (capability?.capabilityId !== capabilityId || capability?.role === 'required') continue;
      provided.push({
        assetId: asset.assetId,
        capabilityId,
        properties: capability.properties ?? [],
        source: capability.source ?? asset?.source?.provider ?? null,
        standardProfile: capability?.evidence?.profileVersion ?? asset?.semanticModel ?? null,
      });
    }
  }
  return provided;
}

export function assessGraphProductionCapability({ graph, requirement, workforceCoverage = null } = {}) {
  const providedCapabilities = providedCapabilityEnvelopesFromGraph(graph, requirement?.capabilityId);
  return assessProductionCapability({ providedCapabilities, requirement, workforceCoverage });
}
