import fs from 'node:fs';
import {loadCatalog} from './load-catalog.mjs';

const catalog=loadCatalog();
const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));
const opportunities=JSON.parse(fs.readFileSync(new URL('../opportunity-profiles.json',import.meta.url),'utf8'));

function unique(values){return [...new Set(values.filter(Boolean))];}
function profilesFor(system){
  const out=[];
  for(const p of protocols.profiles){
    if(system.protocols.some(x=>p.matches.includes(x))) out.push(p.id);
  }
  return unique(out);
}
function routeFor(system,profiles){
  if(system.category==='ipaas') return 'northbound-openapi-and-events';
  if(profiles.some(x=>['opcua','mqtt','bacnet','modbus'].includes(x))) return 'site-edge-gateway';
  if(profiles.some(x=>['kafka','amqp','jms','schema-registry'].includes(x))) return 'event-stream-adapter';
  if(profiles.includes('files-sftp')) return 'batch-ingestion';
  if(profiles.some(x=>['rest-openapi','odata','soap','graphql','scim','webhooks-events','protobuf-rpc-http2','legacy-rpc'].includes(x))) return 'direct-cloud-adapter';
  return 'vendor-research-required';
}
function opportunityProfilesFor(system){
  return opportunities.profiles.filter(profile =>
    profile.categoryIncludes.some(token => system.category.includes(token))
  );
}
function mergeVendorReviews(inline={},registered={}){
  const out={...inline,...registered};
  for(const key of ['requiredPermissions','dataAvailableOrExpected','wfmObjects','writeBackAutomation','automationOpportunities','customerValue','savingsHypotheses','dataGaps','constraintsRisks']){
    out[key]=unique([...(inline[key]||[]),...(registered[key]||[])]);
  }
  return out;
}
function mergedField(profiles,override,key,fallback=[]){
  return unique([
    ...profiles.flatMap(profile=>profile[key]||[]),
    ...(override[key]||[]),
    ...fallback
  ]);
}
function nextActionFor(system,protocolProfiles,override){
  if(override.nextDevelopmentAction) return override.nextDevelopmentAction;
  if(override.nextAction) return override.nextAction;
  if(protocolProfiles.length===0) return 'Verify a current vendor-supported API/protocol or authorised file/middleware route before adapter development.';
  switch(system.testLevel){
    case 'discovery-queued': return 'Verify current vendor protocol, authentication, version matrix and accessible data objects; keep any adapter fixture-only until spec evidence exists.';
    case 'spec-verified': return 'Obtain an authorised vendor sandbox or customer test tenant and prove authentication plus a representative read without enabling writes.';
    case 'public-surface-probed': return 'Obtain an authorised sandbox credential and prove authenticated read behaviour, pagination, throttling and schema handling.';
    case 'sandbox-authenticated': return 'Prove representative read round-trip into canonical WFM objects, including duplicate/retry and custom-field cases.';
    case 'tenant-authenticated': return 'Prove representative tenant read round-trip into canonical WFM objects with data minimisation and audit evidence.';
    case 'read-roundtrip-proven': return 'Where a business case requires it, prove an idempotent controlled write/read-back in sandbox before any tenant write is considered.';
    case 'write-roundtrip-proven': return 'Complete operational, security, rollback, version-drift and production-certification gates.';
    case 'production-certified': return 'Continuously monitor API/version drift, reliability and customer-value evidence; recertify on material contract changes.';
    default: return 'Verify evidence level and define the next safe read-only proof.';
  }
}
function opportunityFor(system,protocolProfiles){
  const profiles=opportunityProfilesFor(system);
  const override=mergeVendorReviews(system.valueReview||{},opportunities.systemOverrides?.[system.id]||{});
  const profileIds=profiles.map(x=>x.id);
  const hasVendorDataEvidence=override.basis==='vendor-docs';
  return {
    profileIds,
    basis:override.basis||(profiles.length?'category-hypothesis-requires-vendor-verification':'generic-hypothesis-requires-vendor-verification'),
    dataConfidence:hasVendorDataEvidence?'system-specific-vendor-docs':system.testLevel,
    evidenceUrl:override.evidenceUrl||system.evidenceUrl||system.docsUrl||null,
    requiredPermissions:mergedField(profiles,override,'requiredPermissions',['least-privilege read-only scope; exact vendor scopes must be verified']),
    dataAvailableOrExpected:mergedField(profiles,override,'dataAvailableOrExpected'),
    wfmObjects:mergedField(profiles,override,'wfmObjects'),
    candidateWriteBackAutomation:mergedField(profiles,override,'writeBackAutomation',override.automationOpportunities||[]),
    customerValue:mergedField(profiles,override,'customerValue'),
    savingsHypotheses:mergedField(profiles,override,'savingsHypotheses'),
    knownDataGaps:mergedField(profiles,override,'dataGaps'),
    constraintsRisks:unique([...(opportunities.universalRisks||[]),...mergedField(profiles,override,'constraintsRisks')]),
    nextDevelopmentAction:nextActionFor(system,protocolProfiles,override)
  };
}

const systems=catalog.systems.map(s=>{
  const protocolProfiles=profilesFor(s);
  return {
    id:s.id,
    name:s.name,
    category:s.category,
    priority:s.priority,
    integrationEvidence:{
      level:s.testLevel,
      researchStatus:s.researchStatus||null,
      docsUrl:s.docsUrl||null,
      evidenceUrl:s.evidenceUrl||null,
      evidenceRef:s.evidenceRef||null,
      writeEnabled:s.writeEnabled
    },
    protocols:s.protocols,
    protocolProfiles,
    recommendedRoute:routeFor(s,protocolProfiles),
    authentication:s.auth||'vendor-specific',
    tenantCredentialsRequired:!['github','railway'].includes(s.id),
    safeDefault:'read-only',
    opportunityReview:opportunityFor(s,protocolProfiles)
  };
});

const report={
  schemaVersion:2,
  generatedAt:new Date().toISOString(),
  claimBoundary:'Planning output only. Recommended routes, category-derived data and savings are hypotheses, not provider certification or guaranteed savings. System-specific vendor-doc evidence is identified separately. Writes remain disabled unless the connector earns the required evidence and explicit customer authorisation.',
  catalogOverlay:catalog.researchOverlay||null,
  total:systems.length,
  coveredByReusableProfiles:systems.filter(x=>x.protocolProfiles.length>0).length,
  researchRequired:systems.filter(x=>x.protocolProfiles.length===0).length,
  opportunityProfiled:systems.filter(x=>x.opportunityReview.profileIds.length>0).length,
  vendorSpecificValueEvidence:systems.filter(x=>x.opportunityReview.basis==='vendor-docs').length,
  systems
};
fs.mkdirSync('integration-fabric/reports',{recursive:true});
fs.writeFileSync('integration-fabric/reports/coverage-matrix.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
  total:report.total,
  coveredByReusableProfiles:report.coveredByReusableProfiles,
  researchRequired:report.researchRequired,
  opportunityProfiled:report.opportunityProfiled,
  vendorSpecificValueEvidence:report.vendorSpecificValueEvidence,
  routes:Object.fromEntries([...new Set(systems.map(x=>x.recommendedRoute))].map(r=>[r,systems.filter(x=>x.recommendedRoute===r).length]))
},null,2));
