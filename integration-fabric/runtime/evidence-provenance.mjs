const SPEC_LEVELS = new Set([
  'spec-verified',
  'public-surface-probed',
  'sandbox-authenticated',
  'tenant-authenticated',
  'read-roundtrip-proven',
  'write-roundtrip-proven',
  'production-certified'
]);

const AUTHORITATIVE_KINDS = new Set([
  'vendor-docs',
  'vendor-api-docs',
  'vendor-openapi',
  'vendor-security-docs',
  'vendor-support-contract',
  'authorised-sandbox',
  'authorised-tenant'
]);

export function evaluateEvidenceProvenance({claimedLevel='discovery-queued', sources=[]}={}) {
  const normalised = Array.isArray(sources) ? sources.filter(Boolean).map(source=>({
    kind:String(source.kind||'').trim(),
    url:String(source.url||'').trim(),
    confirmsIntegrationSurface:source.confirmsIntegrationSurface===true,
    providerOwned:source.providerOwned===true,
    authorisedObservation:source.authorisedObservation===true
  })) : [];

  const authoritative = normalised.filter(source=>
    AUTHORITATIVE_KINDS.has(source.kind) &&
    (source.providerOwned || source.authorisedObservation) &&
    source.confirmsIntegrationSurface
  );

  const thirdPartyOnly = normalised.length>0 && authoritative.length===0;
  const requiresSpecEvidence = SPEC_LEVELS.has(claimedLevel);
  const canClaimLevel = !requiresSpecEvidence || authoritative.length>0;

  return {
    canClaimLevel,
    claimedLevel,
    authoritativeSources:authoritative.length,
    thirdPartyOnly,
    maxSafeLevel:authoritative.length>0 ? claimedLevel : 'discovery-queued',
    reason:canClaimLevel
      ? 'authoritative-integration-evidence-present-or-not-required'
      : 'spec-or-higher-evidence-requires-provider-owned-or-authorised-integration-surface-evidence'
  };
}
