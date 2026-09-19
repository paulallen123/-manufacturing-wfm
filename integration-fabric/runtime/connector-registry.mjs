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
      discoveryStrategy:discoveryStrategy(profileIds,edgeRequired),
      nextEvidenceGate:nextEvidence(system.testLevel,evidenceBlockers),
      evidenceBlockers,
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
        unauthenticatedDataSurfaceEnabled:false,
        superAdminCredentialAllowed:false,
        oauthPasswordGrantEnabled:false,
        oauthImplicitGrantEnabled:false
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
