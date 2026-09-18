import fs from 'node:fs';

const catalog=JSON.parse(fs.readFileSync(new URL('../systems.json',import.meta.url),'utf8'));
const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));

function profilesFor(system){
  const out=[];
  for(const p of protocols.profiles){
    if(system.protocols.some(x=>p.matches.includes(x))) out.push(p.id);
  }
  return [...new Set(out)];
}
function routeFor(system,profiles){
  if(system.category==='ipaas') return 'northbound-openapi-and-events';
  if(profiles.some(x=>['opcua','mqtt','bacnet','modbus'].includes(x))) return 'site-edge-gateway';
  if(profiles.includes('files-sftp')) return 'batch-ingestion';
  if(profiles.some(x=>['rest-openapi','odata','soap','graphql','scim','webhooks-events'].includes(x))) return 'direct-cloud-adapter';
  return 'vendor-research-required';
}

const systems=catalog.systems.map(s=>{
  const profiles=profilesFor(s);
  return {
    id:s.id,name:s.name,category:s.category,priority:s.priority,
    evidence:s.testLevel,protocolProfiles:profiles,
    recommendedRoute:routeFor(s,profiles),
    tenantCredentialsRequired:!['github','railway'].includes(s.id),
    safeDefault:'read-only'
  };
});

const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  claimBoundary:'Planning output only; a recommended route is not provider certification.',
  total:systems.length,
  coveredByReusableProfiles:systems.filter(x=>x.protocolProfiles.length>0).length,
  researchRequired:systems.filter(x=>x.protocolProfiles.length===0).length,
  systems
};
fs.mkdirSync('integration-fabric/reports',{recursive:true});
fs.writeFileSync('integration-fabric/reports/coverage-matrix.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
  total:report.total,
  coveredByReusableProfiles:report.coveredByReusableProfiles,
  researchRequired:report.researchRequired,
  routes:Object.fromEntries([...new Set(systems.map(x=>x.recommendedRoute))].map(r=>[r,systems.filter(x=>x.recommendedRoute===r).length]))
},null,2));
