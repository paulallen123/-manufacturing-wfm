import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './load-catalog.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const opportunities=JSON.parse(fs.readFileSync(path.join(root,'opportunity-profiles.json'),'utf8'));
const catalog=loadCatalog();

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function opportunityReview(system){
  const inline=system.valueReview&&typeof system.valueReview==='object'?system.valueReview:null;
  const central=opportunities.systemOverrides?.[system.id]||null;
  if(inline?.basis==='vendor-docs') return clone(inline);
  if(central?.basis==='vendor-docs') return clone(central);
  return clone(inline||central||{basis:'category-profile-only'});
}
function route(system){
  if(system.customerEdgeRequired===true) return 'site-edge-gateway';
  if(Array.isArray(system.protocols)&&system.protocols.length>0) return 'direct-cloud-adapter';
  return 'vendor-specific-discovery';
}

const report={
  schemaVersion:1,
  generatedFrom:'effective-integration-catalog',
  systems:catalog.systems.map(system=>({
    id:system.id,
    name:system.name,
    category:system.category,
    priority:system.priority,
    recommendedRoute:route(system),
    integrationEvidence:{
      level:system.testLevel,
      researchStatus:system.researchStatus||null,
      docsUrl:system.docsUrl||null,
      evidenceUrl:system.evidenceUrl||null,
      securityEvidenceBlockers:[...(system.securityEvidenceBlockers||[])]
    },
    opportunityReview:opportunityReview(system)
  }))
};
const dir=path.join(root,'reports');
fs.mkdirSync(dir,{recursive:true});
const target=path.join(dir,'coverage-matrix.json');
fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log('INTEGRATION_COVERAGE_MATRIX=PASS|systems='+report.systems.length+'|path='+target);
