import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-27-0508-infor-m3.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='infor-m3')?.patch;

test('Infor M3 overlay satisfies canonical catalogue admission shape',()=>{
  assert.equal(overlay.schemaVersion,1);
  assert.equal(Array.isArray(overlay.protocolFamilies),true);
  assert.equal(Array.isArray(overlay.overrides),true);
  assert.equal(Array.isArray(overlay.systems),true);
});

test('Infor M3 remains documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
  assert.match(patch.auth,/OAuth 2\.0|ION API/i);
});

test('Infor M3 pins tenant company division facility program transaction and metadata',()=>{
  for(const dimension of ['wfm-tenant','connection','Infor-tenant','company','division','facility','api-origin','api-version','MI-program','MI-transaction','metadata','query','schema']){
    assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  }
});

test('Infor M3 allows exact list transactions but denies generic and update authority',()=>{
  assert.equal(patch.miReadAuthority.exactReadTransactionsRequired,true);
  assert.equal(patch.miReadAuthority.genericProgramAuthority,false);
  assert.equal(patch.miReadAuthority.updateTransactionAuthority,false);
  assert.equal(patch.miReadAuthority.httpVerbProvesReadSafety,false);
  assert.match(patch.permissions,/transaction|role/i);
});

test('Infor M3 preserves the 100-row and variable-pagination contract',()=>{
  assert.equal(patch.pagedReadAuthority.maximumPageSize,100);
  assert.equal(patch.pagedReadAuthority.paginationSupportMustBeProvenPerTransaction,true);
  assert.equal(patch.pagedReadAuthority.recordCountProvesCompleteness,false);
  assert.equal(patch.pagedReadAuthority.checkpointAdvanceAllowed,false);
  assert.match(patch.paginationDelta,/not supported for all|100/i);
});

test('Infor M3 covers production labour maintenance material quality and cost value',()=>{
  for(const object of [
    'manufacturing-orders-and-operations','work-centres-and-capacity','employee-operation-time',
    'quantities-complete-and-scrap','maintenance-work-orders','materials-and-inventory',
    'purchase-orders-and-suppliers','quality-and-inspection','job-and-work-centre-costs'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueOpportunities.join(' '),/overtime|agency/i);
  assert.match(patch.valueOpportunities.join(' '),/idle|constraint/i);
});

test('Infor M3 separates cloud and customer-edge routes',()=>{
  assert.equal(patch.deploymentVariants['M3-CloudSuite'].customerEdgeRequired,false);
  assert.equal(patch.deploymentVariants['M3-on-premises-or-private'].customerEdgeRequired,true);
  assert.match(patch.regionalApiVersions,/regional|tenant|company|division/i);
});

test('Infor M3 names live pagination and denied mutations as the next proof step',()=>{
  assert.match(patch.nextBuildAction,/authorised Infor M3.*tenant/i);
  assert.match(patch.nextBuildAction,/denied.*update|mutation/i);
  assert.match(patch.nextBuildAction,/pagination|100/i);
});
