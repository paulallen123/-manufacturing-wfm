import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-26-2137-quinyx.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='quinyx')?.patch;

test('Quinyx remains documentation-only and mutation-denying',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
  assert.match(patch.auth,/OAuth/i);
});

test('Quinyx v3 uses scoped regional credentials and opaque page-chain admission',()=>{
  assert.equal(patch.opaquePageChain.nextPageTokenIsOpaque,true);
  assert.equal(patch.opaquePageChain.checkpointAdvanceAllowed,false);
  assert.equal(patch.opaquePageChain.deletionAuthority,false);
  assert.ok(patch.opaquePageChain.exactScopeDimensions.includes('providerAccountId'));
  assert.ok(patch.opaquePageChain.exactScopeDimensions.includes('apiOrigin'));
  assert.ok(patch.opaquePageChain.exactScopeDimensions.includes('resource'));
  assert.ok(patch.opaquePageChain.exactScopeDimensions.includes('queryFingerprint'));
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/nextPageToken/i);
});

test('Quinyx version routes do not silently mix v3 REST and legacy SOAP scope',()=>{
  assert.match(patch.regionalApiVersions,/v3/i);
  assert.match(patch.regionalApiVersions,/v1.*SOAP/i);
  assert.match(patch.regionalApiVersions,/checkpoint namespace/i);
  assert.match(patch.reconciliation,/overlap/i);
});

test('Quinyx maps workforce truth without claiming payroll authority',()=>{
  for(const object of ['employees','organisation-groups','role-assignments','schedules-and-shifts','attendance-and-time','leave-and-absence']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  assert.match(patch.valueReview.customerValue.join(' '),/overtime|labour-cost/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/payroll/i);
  assert.match(patch.nextBuildAction,/authorised Quinyx/i);
});
