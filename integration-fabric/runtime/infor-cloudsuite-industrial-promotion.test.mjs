import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-27-0409-infor-cloudsuite-industrial.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='infor-cloudsuite-industrial')?.patch;

test('Infor CSI is promoted only to documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
  assert.match(patch.auth,/OAuth 2\.0|Mongoose security token/i);
});

test('Infor CSI pins tenant configuration site IDO projection and schema',()=>{
  for(const dimension of ['wfm-tenant','connection','Infor-tenant','Mongoose-configuration','site','api-origin','api-version','IDO-collection','query','schema']){
    assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  }
  assert.equal(patch.cappedProjectionChainAuthority.configurationIsolationRequired,true);
  assert.equal(patch.cappedProjectionChainAuthority.siteIsolationRequired,true);
});

test('Infor CSI allows LoadCollection reads but denies generic methods and mutations',()=>{
  assert.equal(patch.idoReadAuthority.loadCollectionAllowed,true);
  assert.equal(patch.idoReadAuthority.updateCollectionAllowed,false);
  assert.equal(patch.idoReadAuthority.invokeIDOMethodAllowed,false);
  assert.equal(patch.idoReadAuthority.wildcardPropertiesAllowed,false);
  assert.match(patch.permissions,/IDO-level|property-level/i);
});

test('Infor CSI preserves record-cap and bookmark completeness semantics',()=>{
  assert.equal(patch.cappedProjectionChainAuthority.moreRowsExistRequired,true);
  assert.equal(patch.cappedProjectionChainAuthority.bookmarkContinuityRequired,true);
  assert.equal(patch.cappedProjectionChainAuthority.recordCountProvesCompleteness,false);
  assert.equal(patch.cappedProjectionChainAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.cappedProjectionChainAuthority.deletionAuthority,false);
});

test('Infor CSI covers manufacturing constraints and labour-cost outcomes',()=>{
  for(const object of [
    'jobs-and-operations','work-centres-and-resources','employees-and-teams','job-labour-transactions',
    'quantities-complete-and-scrap','materials-and-inventory','purchase-orders-and-suppliers',
    'quality-and-nonconformance','WIP-and-job-cost'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueOpportunities.join(' '),/overtime|agency/i);
  assert.match(patch.valueOpportunities.join(' '),/idle|constraint/i);
});

test('Infor CSI separates cloud gateway and customer-edge routes',()=>{
  assert.equal(patch.deploymentVariants['Infor-OS-cloud'].customerEdgeRequired,false);
  assert.equal(patch.deploymentVariants['direct-or-on-premises-Mongoose'].customerEdgeRequired,true);
  assert.match(patch.regionalApiVersions,/regional|tenant|configuration/i);
});

test('Infor CSI names a real tenant and denied mutation proof as the next step',()=>{
  assert.match(patch.nextBuildAction,/authorised Infor.*tenant/i);
  assert.match(patch.nextBuildAction,/denied.*UpdateCollection|Invoke/i);
});
