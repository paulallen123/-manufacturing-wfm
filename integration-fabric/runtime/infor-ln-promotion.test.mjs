import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-27-0610-infor-ln.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='infor-ln')?.patch;

test('Infor LN overlay satisfies canonical catalogue admission shape',()=>{
  assert.equal(overlay.schemaVersion,1);
  assert.equal(Array.isArray(overlay.protocolFamilies),true);
  assert.equal(Array.isArray(overlay.overrides),true);
  assert.equal(Array.isArray(overlay.systems),true);
});

test('Infor LN remains documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/OAuth 2\.0|Client Credentials|ION API/i);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('Infor LN pins tenant company identity route activation language and schema',()=>{
  for(const dimension of [
    'wfm-tenant','connection','Infor-tenant','api-origin','api-version','company','API-identity',
    'route','method','service-activation','route-authorization','content-language','metadata','query','schema'
  ]) assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
});

test('Infor LN refuses default-company and unapproved identity-switch execution',()=>{
  assert.equal(patch.executionContextAuthority.explicitCompanyHeaderRequired,true);
  assert.equal(patch.executionContextAuthority.defaultCompanyAllowed,false);
  assert.equal(patch.executionContextAuthority.identitySwitchAllowed,false);
  assert.equal(patch.executionContextAuthority.explicitContentLanguageRequired,true);
  assert.equal(patch.executionContextAuthority.checkpointAdvanceAllowed,false);
});

test('Infor LN requires exact company-specific GET route authorization',()=>{
  assert.equal(patch.routeReadAuthority.exactGetRoutesRequired,true);
  assert.equal(patch.routeReadAuthority.allMethodsAllowed,false);
  assert.equal(patch.routeReadAuthority.allCompaniesAllowed,false);
  assert.equal(patch.routeReadAuthority.unreviewedCascadeAllowed,false);
  assert.equal(patch.routeReadAuthority.actionRoutesAllowed,false);
  assert.match(patch.permissions,/company|GET|route/i);
});

test('Infor LN covers production labour maintenance material quality and cost value',()=>{
  for(const object of [
    'production-orders-and-operations','work-centres-and-machine-operations','employee-and-machine-hours',
    'quantities-complete-and-scrap','service-and-maintenance-orders','materials-and-inventory',
    'purchase-orders-and-suppliers','quality-and-inspection','production-and-project-costs'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueOpportunities.join(' '),/overtime|agency/i);
  assert.match(patch.valueOpportunities.join(' '),/machine|material|maintenance|quality/i);
});

test('Infor LN separates cloud and customer-edge routes',()=>{
  assert.equal(patch.deploymentVariants['LN-multi-tenant-cloud'].customerEdgeRequired,false);
  assert.equal(patch.deploymentVariants['LN-single-tenant-cloud-or-on-premises'].customerEdgeRequired,true);
  assert.match(patch.regionalApiVersions,/regional|tenant|company/i);
});

test('Infor LN names live company isolation and denied mutation as the next proof step',()=>{
  assert.match(patch.nextBuildAction,/authorised Infor LN.*tenant/i);
  assert.match(patch.nextBuildAction,/default company|company isolation/i);
  assert.match(patch.nextBuildAction,/denied.*POST|PATCH|PUT|DELETE|mutation/i);
});
