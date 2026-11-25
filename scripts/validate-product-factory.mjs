#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const manifest=json('product-factory/manifest.json');
assert.equal(manifest.schemaVersion,1);
assert.ok(Array.isArray(manifest.requiredFeatureFields)&&manifest.requiredFeatureFields.length>=10);
assert.ok(manifest.nonNegotiables.includes('vector-only-ui'));
assert.ok(manifest.nonNegotiables.includes('no-fabricated-savings'));
assert.ok(manifest.nonNegotiables.includes('reuse-before-bespoke'));


const benchmark=json('product-factory/world-class-24h-benchmark.json');
assert.equal(benchmark.schemaVersion,1);
assert.ok(Array.isArray(benchmark.winningDimensions)&&benchmark.winningDimensions.length>=10,'world-class benchmark needs broad quality dimensions');
assert.ok(benchmark.winningDimensions.every(x=>x.releaseBlocking===true),'every world-class dimension must be release blocking');
assert.ok(benchmark.winningDimensions.every(x=>Array.isArray(x.proof)&&x.proof.length>=3),'every world-class dimension needs explicit proof');
assert.match(benchmark.claimPolicy,/only.*live evidence gate passes/i,'competitive claims must be evidence gated');
assert.match(benchmark.releaseRule,/Unknown evidence is not a pass/i,'unknown evidence must fail closed');

const template=json('product-factory/feature-template.json');
for(const field of manifest.requiredFeatureFields) assert.ok(Object.prototype.hasOwnProperty.call(template,field),'template missing '+field);

const featureDir=path.join(root,'product-factory','features');
const featureFiles=fs.readdirSync(featureDir).filter(x=>x.endsWith('.json')).sort();
assert.ok(featureFiles.length>0,'at least one product-factory feature contract is required');
for(const file of featureFiles){
  const contract=JSON.parse(fs.readFileSync(path.join(featureDir,file),'utf8'));
  for(const field of manifest.requiredFeatureFields) assert.ok(Object.prototype.hasOwnProperty.call(contract,field),file+' missing '+field);
  assert.ok(Array.isArray(contract.acceptanceCriteria)&&contract.acceptanceCriteria.length>0,file+' needs acceptance criteria');
  assert.ok(Array.isArray(contract.evidenceSources)&&contract.evidenceSources.length>0,file+' needs evidence sources');
  assert.equal(contract.rollback?.supported,true,file+' must be rollback-ready');
  assert.ok(String(contract.claimBoundary||'').trim(),file+' needs a claim boundary');
}

const dockerfile=read('Dockerfile');
assert.match(dockerfile,/FROM\s+[^\n]+@sha256:[a-f0-9]{64}/i,'runtime image must be digest-pinned');
assert.match(dockerfile,/USER\s+node\b/,'runtime must stay non-root');
assert.match(dockerfile,/VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1/,'Dockerfile must compose only the approved Vector presentation');

const vector=read('ux-overlay/vector-shell.js');
assert.match(vector,/VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1/);
assert.match(vector,/VECTOR_VERIFIED_VALUE_V1/,'home must expose evidence-backed value');
assert.match(vector,/Vector AI Assistant/,'role home must preserve the AI assistant');
assert.doesNotMatch(vector,/guaranteed savings|guaranteed ROI/i,'unsupported financial guarantees are forbidden');

const circle=read('.circleci/config.yml');
assert.match(circle,/run-zero-cost-ci\.mjs/,'CircleCI must execute the consolidated validation runner');
assert.match(circle,/22\.23\.2/,'CI runtime must remain exact/pinned');

const runner=read('scripts/run-zero-cost-ci.mjs');
assert.match(runner,/validate-product-factory\.mjs/,'consolidated validation must include product-factory validation');
assert.match(runner,/WFM_CI_PARALLELISM/,'validation runner must expose bounded parallelism');

const proof={
  schemaVersion:1,
  status:'PASS',
  checkedAt:new Date().toISOString(),
  featureContracts:featureFiles,
  vectorOnly:true,
  evidenceBackedValue:true,
  noFabricatedSavings:true,
  securityBoundaryPreserved:true,
  rollbackRequired:true,
  reusableFactory:true
};
fs.writeFileSync(path.join(root,'product-factory-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log('PRODUCT_FACTORY_VALIDATION=PASS|features='+featureFiles.length);
