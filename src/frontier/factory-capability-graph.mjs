import crypto from 'node:crypto';

export const CAPABILITY_GRAPH_VERSION = 'factory-capability-graph-v0.2.0';

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const nowMs = (now) => new Date(now).getTime();
const asSet = (items = []) => new Set(items);

function sameScope(a, b) {
  return a?.tenantId && b?.tenantId && a.tenantId === b.tenantId && a.siteId && b?.siteId && a.siteId === b.siteId;
}

function validateSource(source, now) {
  if (!source?.provider || !source?.observedAt || !source?.revision) return { trusted: false, reason: 'missing_provenance' };
  const observed = new Date(source.observedAt).getTime();
  if (!Number.isFinite(observed)) return { trusted: false, reason: 'invalid_observed_at' };
  const staleAfterMinutes = Number(source.staleAfterMinutes ?? 1440);
  if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) return { trusted: false, reason: 'invalid_freshness_policy' };
  if (nowMs(now) - observed > staleAfterMinutes * 60_000) return { trusted: false, reason: 'stale_source' };
  return { trusted: true };
}

export function normalizeAsset(raw, { now = new Date().toISOString() } = {}) {
  if (!raw?.tenantId || !raw?.siteId || !raw?.assetId) return { status: 'rejected', reason: 'missing_scope_or_identity' };
  const sourceState = validateSource(raw.source, now);
  if (!sourceState.trusted) return { status: 'quarantined', reason: sourceState.reason, assetId: raw.assetId };

  const capabilities = (raw.capabilities ?? []).map((capability) => ({
    capabilityId: capability.capabilityId ?? null,
    label: capability.label ?? capability.browseName ?? 'Unmapped capability',
    semanticId: capability.semanticId ?? null,
    mappingStatus: capability.mappingStatus ?? (capability.capabilityId ? 'mapped' : 'unmapped'),
    mappingId: capability.mappingId ?? null,
    source: capability.source ?? raw.source.provider,
  }));

  return {
    status: 'accepted',
    asset: {
      tenantId: raw.tenantId,
      siteId: raw.siteId,
      assetId: raw.assetId,
      workCentreId: raw.workCentreId ?? null,
      label: raw.label ?? raw.assetId,
      assetClass: raw.assetClass ?? 'unknown',
      semanticModel: raw.semanticModel ?? 'generic',
      capabilities,
      source: raw.source,
      provenanceHash: hash(raw),
    },
  };
}


export function applyApprovedSemanticMappings(rawAsset, semanticMappings = []) {
  if (!rawAsset?.tenantId || !rawAsset?.siteId) return rawAsset;
  const capabilities = (rawAsset.capabilities ?? []).map((capability) => {
    if (capability.capabilityId || !capability.semanticId) return capability;
    const candidates = semanticMappings.filter((mapping) =>
      mapping?.approvalStatus === 'approved' &&
      mapping.tenantId === rawAsset.tenantId &&
      mapping.semanticId === capability.semanticId &&
      (mapping.scope === 'tenant' || (mapping.scope === 'site' && mapping.siteId === rawAsset.siteId))
    );
    const unique = [...new Set(candidates.map((mapping) => mapping.capabilityId).filter(Boolean))];
    if (unique.length !== 1) {
      return { ...capability, mappingStatus: unique.length > 1 ? 'conflict' : 'unmapped' };
    }
    const selected = candidates.find((mapping) => mapping.capabilityId === unique[0]);
    return { ...capability, capabilityId: unique[0], mappingStatus: 'reused_approved_semantic', mappingId: selected?.mappingId ?? null };
  });
  return { ...rawAsset, capabilities };
}

export function measureConfigurationReuse({ assets = [], semanticMappings = [] }) {
  let manualBaselineDecisions = 0;
  let autoMapped = 0;
  let reviewRequired = 0;
  for (const asset of assets) {
    for (const capability of asset.capabilities ?? []) {
      if (capability.capabilityId) continue;
      manualBaselineDecisions += 1;
    }
    const mappedAsset = applyApprovedSemanticMappings(asset, semanticMappings);
    for (const capability of mappedAsset.capabilities ?? []) {
      if (capability.mappingStatus === 'reused_approved_semantic') autoMapped += 1;
      else if (!capability.capabilityId) reviewRequired += 1;
    }
  }
  return {
    manualBaselineDecisions,
    autoMapped,
    reviewRequired,
    repeatedConfigurationReductionPct: manualBaselineDecisions === 0 ? 0 : 1 - (reviewRequired / manualBaselineDecisions),
  };
}

export function buildCapabilityGraph({ tenantId, siteId, assets = [], capabilityRequirements = [], people = [], semanticMappings = [], now = new Date().toISOString() }) {
  const scope = { tenantId, siteId };
  if (!tenantId || !siteId) throw new TypeError('tenantId and siteId are required');

  const acceptedAssets = [];
  const quarantined = [];
  for (const raw of assets) {
    if (!sameScope(scope, raw)) {
      quarantined.push({ assetId: raw?.assetId ?? null, reason: 'scope_mismatch' });
      continue;
    }
    const normalized = normalizeAsset(applyApprovedSemanticMappings(raw, semanticMappings), { now });
    if (normalized.status === 'accepted') acceptedAssets.push(normalized.asset);
    else quarantined.push({ assetId: raw.assetId ?? null, reason: normalized.reason });
  }

  const requirements = capabilityRequirements.filter((requirement) => sameScope(scope, requirement));
  const scopedPeople = people.filter((person) => sameScope(scope, person));
  const capabilityIndex = new Map(requirements.map((requirement) => [requirement.capabilityId, requirement]));
  const capabilityNodes = new Map();
  const edges = [];

  for (const asset of acceptedAssets) {
    for (const capability of asset.capabilities) {
      if (!capability.capabilityId) continue;
      if (!capabilityNodes.has(capability.capabilityId)) {
        capabilityNodes.set(
          capability.capabilityId,
          capabilityIndex.get(capability.capabilityId) ?? { capabilityId: capability.capabilityId, label: capability.label },
        );
      }
      edges.push({ from: `asset:${asset.assetId}`, to: `capability:${capability.capabilityId}`, type: 'provides' });
    }
  }

  for (const requirement of requirements) {
    for (const skillId of requirement.requiredSkills ?? []) {
      edges.push({ from: `capability:${requirement.capabilityId}`, to: `skill:${skillId}`, type: 'requires' });
    }
  }

  for (const person of scopedPeople) {
    for (const qualification of person.qualifications ?? []) {
      if (qualification.status !== 'valid' || !qualification.authoritative) continue;
      edges.push({ from: `person:${person.personId}`, to: `skill:${qualification.skillId}`, type: 'qualified_for' });
    }
  }

  return {
    version: CAPABILITY_GRAPH_VERSION,
    scope,
    assets: acceptedAssets,
    capabilities: [...capabilityNodes.values()],
    people: scopedPeople,
    requirements,
    edges,
    quarantined,
    unmappedCapabilities: acceptedAssets.flatMap((asset) =>
      asset.capabilities
        .filter((capability) => !capability.capabilityId)
        .map((capability) => ({ assetId: asset.assetId, label: capability.label, semanticId: capability.semanticId })),
    ),
    graphHash: hash({ scope, acceptedAssets, requirements, scopedPeople, edges }),
  };
}

export function assessCapabilityCoverage(graph, { demand = [] } = {}) {
  const demandByCapability = new Map(
    demand.filter((item) => sameScope(graph.scope, item)).map((item) => [item.capabilityId, item]),
  );

  const results = graph.requirements.map((requirement) => {
    const assetCount = graph.assets.filter((asset) =>
      asset.capabilities.some((capability) => capability.capabilityId === requirement.capabilityId),
    ).length;
    const requiredSkills = requirement.requiredSkills ?? [];
    const qualifiedPeople = graph.people.filter((person) => {
      if (person.availableNow === false) return false;
      const valid = asSet(
        (person.qualifications ?? [])
          .filter((qualification) => qualification.status === 'valid' && qualification.authoritative)
          .map((qualification) => qualification.skillId),
      );
      return requiredSkills.every((skillId) => valid.has(skillId));
    });
    const demandItem = demandByCapability.get(requirement.capabilityId);
    const minimum = Number(demandItem?.minimumQualifiedPeople ?? requirement.minimumQualifiedPeople ?? 1);
    const gap = Math.max(0, minimum - qualifiedPeople.length);
    const status = assetCount === 0 ? 'unavailable' : gap > 0 ? 'at_risk' : 'ready';

    return {
      capabilityId: requirement.capabilityId,
      label: requirement.label ?? requirement.capabilityId,
      assetCount,
      qualifiedAvailable: qualifiedPeople.length,
      minimumQualifiedPeople: minimum,
      gap,
      status,
      people: qualifiedPeople.map((person) => ({ personId: person.personId, displayName: person.displayName ?? person.personId })),
    };
  });

  const order = { at_risk: 0, unavailable: 1, ready: 2 };
  return results.sort((a, b) => order[a.status] - order[b.status] || b.gap - a.gap || a.label.localeCompare(b.label));
}

export function findTrainingCandidates(graph, capabilityId) {
  const requirement = graph.requirements.find((item) => item.capabilityId === capabilityId);
  if (!requirement) return [];
  const required = asSet(requirement.requiredSkills ?? []);

  return graph.people
    .filter((person) => person.availableNow !== false)
    .map((person) => {
      const valid = asSet(
        (person.qualifications ?? [])
          .filter((qualification) => qualification.status === 'valid' && qualification.authoritative)
          .map((qualification) => qualification.skillId),
      );
      const missing = [...required].filter((skillId) => !valid.has(skillId));
      return {
        personId: person.personId,
        displayName: person.displayName ?? person.personId,
        missingSkills: missing,
        readinessDistance: missing.length,
      };
    })
    .filter((candidate) => candidate.readinessDistance > 0)
    .sort((a, b) => a.readinessDistance - b.readinessDistance || a.displayName.localeCompare(b.displayName));
}

export function summarizeCapabilityHome(graph, coverage) {
  const mappedCapabilityCount = graph.assets.reduce(
    (sum, asset) => sum + asset.capabilities.filter((capability) => capability.capabilityId).length,
    0,
  );
  const discoveredCapabilityCount = graph.assets.reduce((sum, asset) => sum + asset.capabilities.length, 0);
  const ready = coverage.filter((item) => item.status === 'ready').length;
  const atRisk = coverage.filter((item) => item.status === 'at_risk' || item.status === 'unavailable').length;

  return {
    siteId: graph.scope.siteId,
    assetsUnderstood: graph.assets.length,
    capabilityMappingPct: discoveredCapabilityCount === 0 ? 0 : mappedCapabilityCount / discoveredCapabilityCount,
    capabilityReadyPct: coverage.length === 0 ? 0 : ready / coverage.length,
    atRiskCount: atRisk,
    needsReviewCount: graph.unmappedCapabilities.length + graph.quarantined.length,
    claimBoundary: 'Discovered machine meaning may suggest capability mappings. Workforce qualification is authoritative only when supplied by an approved workforce/credential source.',
  };
}
