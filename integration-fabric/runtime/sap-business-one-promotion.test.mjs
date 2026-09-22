import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-21-0004-sap-business-one.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='sap-business-one')?.patch;

test('SAP Business One is promoted only to documentation-backed spec verification',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.deepEqual(patch.protocols,['Service Layer','OData','REST']);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('session identity and continuation contracts fail closed',()=>{
  assert.deepEqual(patch.sessionReadAuthority.sessionCookieNames,['B1SESSION']);
  assert.deepEqual(patch.sessionReadAuthority.affinityCookieNames,['ROUTEID']);
  assert.equal(patch.sessionReadAuthority.affinityEstablishesCompleteness,false);
  assert.equal(patch.sessionReadAuthority.crossCompanySessionReuseAllowed,false);
  assert.equal(patch.sessionReadAuthority.providerNextLinkMustPreserveQuery,true);
  assert.equal(patch.sessionReadAuthority.pageSizeZeroAllowed,false);
});

test('source and schema identity keep company databases separate',()=>{
  for(const dimension of ['serverInstance','company','apiVersion','dataset']){
    assert.ok(patch.sourceScope.sourceIdentityDimensions.includes(dimension),dimension);
  }
  assert.match(patch.customFields,/company database/i);
});

test('Business One maps production, people, inventory and finance without write authority',()=>{
  for(const object of ['employees','production-orders','items','inventory-movements','journal-entries']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  for(const target of ['person','production-order','sku','inventory-movement','finance-ledger-entry']){
    assert.ok(patch.valueReview.wfmObjects.includes(target),target);
  }
  assert.match(patch.nextBuildAction,/authorised SAP Business One test environment/i);
});
