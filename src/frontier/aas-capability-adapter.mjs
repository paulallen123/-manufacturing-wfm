import { extractIdta02020CapabilityProfile, isIdta02020CapabilitySubmodel } from './idta-02020-capability-profile.mjs';

const CONTAINER_KEYS = ['submodelElements', 'value', 'statements', 'annotations'];

export const AAS_CAPABILITY_ADAPTER_VERSION = 'aas-capability-adapter-v0.3.0';

function canonicalReference(reference) {
  const keys = Array.isArray(reference?.keys) ? reference.keys.filter((key) => key?.value) : [];
  if (keys.length === 0) return null;
  if (keys.length === 1) return String(keys[0].value);
  return keys.map((key) => `${key.type ?? 'Key'}:${key.value}`).join('>');
}

function pushChildren(node, depth, stack) {
  for (const key of CONTAINER_KEYS) {
    const value = node?.[key];
    if (!Array.isArray(value)) continue;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const child = value[index];
      if (child && typeof child === 'object') stack.push({ node: child, depth: depth + 1 });
    }
  }
}

export function extractAasCapabilities(submodels = [], { maxElements = 10_000, maxDepth = 12, conceptDescriptions = [] } = {}) {
  const profile = extractIdta02020CapabilityProfile(submodels, { maxElements, maxDepth, conceptDescriptions });
  if (profile.status !== 'accepted') return { status: 'rejected', reason: profile.reason, capabilities: [] };

  const capabilities = [...profile.offered];
  const requiredCapabilities = [...profile.required];
  const reviewRequired = [
    ...profile.reviewRequired,
    ...profile.notAssigned.map((item) => ({ ...item, reason: 'capability_role_not_assigned' })),
  ];
  let visited = profile.visitedElements;

  for (const submodel of submodels) {
    if (isIdta02020CapabilitySubmodel(submodel)) continue;
    const stack = [];
    const roots = Array.isArray(submodel?.submodelElements) ? submodel.submodelElements : [];
    for (let index = roots.length - 1; index >= 0; index -= 1) stack.push({ node: roots[index], depth: 0 });

    while (stack.length) {
      const { node, depth } = stack.pop();
      visited += 1;
      if (visited > maxElements) return { status: 'rejected', reason: 'aas_element_limit_exceeded', capabilities: [] };
      if (depth > maxDepth) return { status: 'rejected', reason: 'aas_depth_limit_exceeded', capabilities: [] };

      if (node?.modelType === 'Capability') {
        capabilities.push({
          label: node.idShort ?? 'Unmapped AAS capability',
          semanticId: canonicalReference(node.semanticId),
          role: null,
          properties: [],
          technicalSkillRefs: [],
          source: 'aas',
          evidence: {
            adapterVersion: AAS_CAPABILITY_ADAPTER_VERSION,
            submodelId: submodel.id ?? null,
            submodelSemanticId: canonicalReference(submodel.semanticId),
            elementIdShort: node.idShort ?? null,
            supplementalSemanticIds: (node.supplementalSemanticIds ?? []).map(canonicalReference).filter(Boolean),
          },
        });
      }

      pushChildren(node, depth, stack);
    }
  }

  return {
    status: 'accepted',
    capabilities,
    requiredCapabilities,
    reviewRequired,
    visitedElements: visited,
    idta02020: {
      matchedSubmodels: profile.matchedSubmodels,
      offeredCount: profile.offered.length,
      requiredCount: profile.required.length,
      reviewRequiredCount: reviewRequired.length,
    },
  };
}

export function aasShellToCapabilityAsset({ tenantId, siteId, shell, submodels = [], conceptDescriptions = [], source, workCentreId = null, limits } = {}) {
  if (!tenantId || !siteId || !shell || !source) return { status: 'rejected', reason: 'missing_scope_shell_or_source' };
  const assetId = shell?.assetInformation?.globalAssetId ?? shell?.id ?? null;
  if (!assetId) return { status: 'rejected', reason: 'missing_aas_asset_identity' };

  const extracted = extractAasCapabilities(submodels, { ...(limits ?? {}), conceptDescriptions });
  if (extracted.status !== 'accepted') return extracted;

  return {
    status: 'accepted',
    asset: {
      tenantId,
      siteId,
      assetId,
      workCentreId,
      label: shell.idShort ?? assetId,
      assetClass: 'aas-asset',
      semanticModel: 'IDTA-AAS-3.x',
      source: { ...source, provider: source.provider ?? 'aas' },
      capabilities: extracted.capabilities,
      semanticEvidence: {
        shellId: shell.id ?? null,
        globalAssetId: shell?.assetInformation?.globalAssetId ?? null,
        discoveredCapabilityCount: extracted.capabilities.length,
        requiredCapabilityCount: extracted.requiredCapabilities.length,
        reviewRequiredCount: extracted.reviewRequired.length,
        visitedElements: extracted.visitedElements,
        adapterVersion: AAS_CAPABILITY_ADAPTER_VERSION,
        idta02020: extracted.idta02020,
      },
    },
  };
}
