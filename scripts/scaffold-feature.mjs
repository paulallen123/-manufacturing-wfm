#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [, , slugArg, ...rest] = process.argv;
const slug=String(slugArg||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
if(!slug){
  console.error('Usage: node scripts/scaffold-feature.mjs <slug> [--outcome "..."] [--role "..."] [--value "..."]');
  process.exit(2);
}
const readFlag=(name,fallback)=>{
  const i=rest.indexOf(name);
  return i>=0 && rest[i+1] ? rest[i+1] : fallback;
};
const outcome=readFlag('--outcome','Define a measurable user outcome before implementation.');
const role=readFlag('--role','manager');
const value=readFlag('--value','Define how this change creates or protects measurable customer value.');

const root=process.cwd();
const contractPath=path.join(root,'product-factory','features',slug+'.json');
const testPath=path.join(root,'tests','factory',slug+'.acceptance.mjs');
for(const p of [contractPath,testPath]){
  if(fs.existsSync(p)){
    console.error('Refusing to overwrite existing scaffold: '+path.relative(root,p));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(p),{recursive:true});
}
const contract={
  schemaVersion:1,
  slug,
  outcome,
  primaryRoles:[role],
  valueHypothesis:value,
  valueMetric:{name:'define-metric',unit:'define-unit',baselineSource:'define-source',resultSource:'define-source'},
  evidenceSources:['define-authoritative-source'],
  acceptanceCriteria:['replace-with-machine-checkable-criterion'],
  securityControls:['least-privilege','tenant-isolation','audit-evidence'],
  observability:{signals:['success','failure','latency'],dashboard:'define-proof'},
  rollback:{supported:true,method:'define-rollback'},
  reusePlan:'State what becomes reusable after this feature.',
  automationPlan:'State which manual step disappears next time.',
  claimBoundary:'State what this feature does not prove.'
};
fs.writeFileSync(contractPath,JSON.stringify(contract,null,2)+'\n');
fs.writeFileSync(testPath,`import assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst contract=JSON.parse(fs.readFileSync('${path.relative(root,contractPath).replaceAll('\\\\','/')}', 'utf8'));\nassert.equal(contract.slug, '${slug}');\nassert.ok(contract.acceptanceCriteria.length>0);\nconsole.log('FEATURE_ACCEPTANCE_CONTRACT=PASS|${slug}');\n`);
console.log(JSON.stringify({status:'CREATED',contract:path.relative(root,contractPath),acceptanceTest:path.relative(root,testPath)},null,2));
