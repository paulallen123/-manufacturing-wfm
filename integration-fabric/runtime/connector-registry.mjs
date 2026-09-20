import fs from 'node:fs';
import {loadCatalog} from '../scripts/load-catalog.mjs';

const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));
const opportunities=JSON.parse(fs.readFileSync(new URL('../opportunity-profiles.json',import.meta.url),'utf8'));

const EDGE_PROFILES=new Set(['opcua','mqtt','bacnet','modbus']);
const MESSAGE_PROFILES=new Set(['kafka','amqp','jms']);
const METADATA_PROFILES=new Set(['rest-openapi','odata','soap','graphql','scim','schema-registry','protobuf-rpc-http2','http-rpc-json']);

function unique(xs){return [...new Set(xs.filter(Boolean))];}

function profilesFor(system){
  return protocols.profiles
    .filter(profile=>system.protocols.some(protocol=>profile.matches.includes(protocol)))
    .map(profile=>({
      id:profile.id,
      adapter:profile.adapter,
      transport:profile.transport,
      supports:[...profile.supports]
    }));
}

function valueProfilesFor(system){
  return opportunities.profiles.filter(profile=>
    profile.categoryIncludes.some(token=>system.category.includes(token))
  );
}

function canonicalTargets(system){
  const valueProfiles=valueProfilesFor(system);
  const inline=system.valueReview||{};
  const central=opportunities.systemOverrides?.[system.id]||{};
  return unique([
    ...valueProfiles.flatMap(x=>x.wfmObjects||[]),
    ...(inline.wfmObjects||[]),
    ...(central.wfmObjects||[])
  ]);
}

function discoveryStrategy(profileIds,edgeRequired){
  if(edgeRequired) return 'customer-edge-config-required';
  if(profileIds.some(id=>MESSAGE_PROFILES.has(id))) return 'non-destructive-subscription-or-browse';
  if(profileIds.includes('files-sftp')) return 'sample-file-and-schema-first';
  if(profileIds.some(id=>METADATA_PROFILES.has(id))) return 'vendor-metadata-or-api-catalog-first';
  if(profileIds.includes('database')) return 'customer-read-view-or-replica-first';
  return 'vendor-specific-discovery';
}

function nextEvidence(level,evidenceBlockers=[]){
  if(evidenceBlockers.length) return 'resolve-security-evidence-blockers-before-authentication';
  switch(level){
    case 'discovery-queued': return 'spec-verification';
    case 'spec-verified': return 'sandbox-authentication';
    case 'public-surface-probed': return 'sandbox-authentication';
    case 'sandbox-authenticated': return 'read-roundtrip';
    case 'tenant-authenticated': return 'read-roundtrip';
    case 'read-roundtrip-proven': return 'controlled-write-roundtrip-if-required';
    case 'write-roundtrip-proven': return 'production-certification';
    case 'production-certified': return 'continuous-recertification';
    default: return 'evidence-review';
  }
}

function providerIdentityFor(system){
  const identity=system.providerIdentity||{};
  return {
    canonicalName:identity.canonicalName||system.name,
    aliases:unique(identity.aliases||[]),
    rebrandDate:identity.rebrandDate||null,
    canonicalApiHosts:unique(identity.canonicalApiHosts||[]),
    transitionalApiHosts:unique(identity.transitionalApiHosts||[]),
    regionalHostModel:identity.regionalHostModel||null,
    customerDomainMigration:identity.customerDomainMigration||null,
    crossHostRedirectApproved:identity.crossHostRedirectApproved===true
  };
}

function versionRoutingFor(system){
  const provider=system.apiVersionRouting||{};
  return {
    strategy:provider.preferredPolicy||'provider-recommended-per-resource',
    preferredVersion:provider.preferredVersion||null,
    fallbackVersion:provider.fallbackVersion||null,
    fallbackRequiresProviderDeclaration:provider.fallbackRequiresProviderDeclaration!==false,
    authFailureMayTriggerDowngrade:false,
    rateLimitMayTriggerDowngrade:false,
    checkpointNamespaceIncludesVersion:true,
    versionSwitchRequiresReconciliation:true,
    paginationByVersion:provider.paginationByVersion?structuredClone(provider.paginationByVersion):null
  };
}

function dataCoverageFor(system){
  return Array.isArray(system.datasetCoverage)
    ? system.datasetCoverage.map(entry=>structuredClone(entry))
    : [];
}

function sourceScopeFor(system){
  const source=system.sourceScope||{};
  const byVariant=source.requiredDimensionsByVariant&&typeof source.requiredDimensionsByVariant==='object'
    ? Object.fromEntries(Object.entries(source.requiredDimensionsByVariant).map(([variant,dimensions])=>[
        variant,
        unique(Array.isArray(dimensions)?dimensions:[])
      ]))
    : null;
  return {
    namespaceVersion:1,
    requiredDimensions:unique(source.requiredDimensions||[]),
    requiredDimensionsByVariant:byVariant,
    sourceIdentityDimensions:unique(source.sourceIdentityDimensions||[]),
    checkpointIncludes:unique([
      'providerId','connectionId','resource','apiVersion','dataset',
      ...(source.requiredDimensions||[]),
      ...Object.values(byVariant||{}).flat()
    ]),
    crossScopeCheckpointReuseAllowed:false,
    crossEntityIdAssumptionAllowed:false,
    missingRequiredDimension:'fail-closed',
    scopeChangeRecovery:'new-checkpoint-namespace-and-overlap-replay'
  };
}

function deploymentVariantsFor(system){
  if(!system.deploymentVariants||typeof system.deploymentVariants!=='object'||Array.isArray(system.deploymentVariants)) return null;
  return structuredClone(system.deploymentVariants);
}

export function buildConnectorRegistry(){
  const catalog=loadCatalog();
  const connectors=catalog.systems.map(system=>{
    const adapters=profilesFor(system);
    const profileIds=adapters.map(x=>x.id);
    const evidenceBlockers=Array.isArray(system.securityEvidenceBlockers)?[...system.securityEvidenceBlockers]:[];
    // Vendor/system evidence can explicitly require an edge for protected on-prem services or explicitly waive
    // protocol inference for vendor-managed cloud endpoints (for example cloud MQTT). Only infer when unset.
    const edgeRequired=typeof system.customerEdgeRequired==='boolean'
      ? system.customerEdgeRequired
      : profileIds.some(id=>EDGE_PROFILES.has(id));
    return {
      id:system.id,
      name:system.name,
      category:system.category,
      priority:system.priority,
      evidenceLevel:system.testLevel,
      authentication:system.auth||'vendor-specific',
      protocols:[...system.protocols],
      adapters,
      canonicalTargets:canonicalTargets(system),
      providerIdentity:providerIdentityFor(system),
      deploymentVariants:deploymentVariantsFor(system),
      sourceScope:sourceScopeFor(system),
      bootstrapAuthority:system.bootstrapAuthority?structuredClone(system.bootstrapAuthority):null,
      staticCredentialAuthority:system.staticCredentialAuthority?structuredClone(system.staticCredentialAuthority):null,
      versionRouting:versionRoutingFor(system),
      dataCoverage:dataCoverageFor(system),
      discoveryStrategy:discoveryStrategy(profileIds,edgeRequired),
      nextEvidenceGate:nextEvidence(system.testLevel,evidenceBlockers),
      evidenceBlockers,
      schemaNegotiation:{
        fingerprintRequired:true,
        preserveOptionalExtensions:true,
        silentBreakingChangeAllowed:false,
        credentialLikeExtensionsAllowed:false,
        historicalFingerprintRetentionRequired:true,
        coverageSemanticsRequiredForDeletion:true,
        sourceScopeLineageRequired:true
      },
      security:{
        readOnlyDefault:true,
        writeEnabled:false,
        credentialInjection:'executor-boundary-only',
        arbitraryEndpointAllowed:false,
        crossHostRedirectAllowed:false,
        directPlantNetworkAccess:false,
        customerEdgeRequired:edgeRequired,
        destructiveMessageDiscoveryAllowed:false,
        managementPlaneEnabled:false,
        industrialControlEnabled:false,
        remoteProvisioningEnabled:false,
        agentActionEnabled:false,
        crossScopeReadEnabled:false,
        crossScopeCheckpointReuseAllowed:false,
        unauthenticatedDataSurfaceEnabled:false,
        unauthenticatedWebhookAllowed:false,
        webhookAuthenticationRequired:true,
        webhookReplayProtectionRequired:true,
        webhookSchemaVersionPinRequired:true,
        rawSensitiveHealthDataAllowed:false,
        superAdminCredentialAllowed:false,
        oauthPasswordGrantEnabled:false,
        oauthImplicitGrantEnabled:false,
        bootstrapCredentialRetentionAllowed:false,
        bootstrapCredentialReuseAtRuntimeAllowed:false,
        customerControlledBootstrapAllowed:true,
        missingRecordDeletionRequiresAuthoritativeCoverage:true,
        partialDatasetMayInferDeletion:false
      }
    };
  });
  return {
    schemaVersion:1,
    generatedFrom:catalog.researchOverlay?.sources||[],
    connectors
  };
}

export function connectorById(id){
  return buildConnectorRegistry().connectors.find(x=>x.id===id)||null;
}
