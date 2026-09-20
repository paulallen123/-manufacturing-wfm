import {loadCatalog} from '../scripts/load-catalog.mjs';

export function buildGovernedReadProjectionRegistry(){
  return loadCatalog().systems
    .filter(system=>system.governedReadProjection&&typeof system.governedReadProjection==='object')
    .map(system=>({
      providerId:system.id,
      evidenceLevel:system.testLevel,
      preferredSurface:system.governedReadProjection.preferredSurface||null,
      requireExactProjectionAllowlist:system.governedReadProjection.requireExactProjectionAllowlist!==false,
      providerReadOnlySemanticsRequired:system.governedReadProjection.providerReadOnlySemanticsRequired!==false,
      arbitraryQueryAllowed:false,
      directSqlAllowed:false,
      mutationProjectionAllowed:false,
      parameterAllowlistRequired:system.governedReadProjection.parameterAllowlistRequired!==false,
      fieldAllowlistRequired:system.governedReadProjection.fieldAllowlistRequired!==false,
      stableIdsRequired:system.governedReadProjection.stableIdsRequired!==false,
      scopeFieldsRequired:system.governedReadProjection.scopeFieldsRequired!==false,
      schemaFingerprintRequired:system.governedReadProjection.schemaFingerprintRequired!==false,
      pageContinuityRequired:system.governedReadProjection.pageContinuityRequired!==false,
      coverageSemanticsRequired:system.governedReadProjection.coverageSemanticsRequired!==false
    }));
}

export function governedReadProjectionProfile(providerId){
  return buildGovernedReadProjectionRegistry().find(x=>x.providerId===providerId)||null;
}
