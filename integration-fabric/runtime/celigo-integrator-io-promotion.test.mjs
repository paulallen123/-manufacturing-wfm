import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-26-1010-celigo-integrator-io.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='celigo-integrator-io')?.patch;

test('Celigo is promoted only to documentation-backed spec verification',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.ok(patch.protocols.includes('REST'));
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('Celigo authority is custom scoped to exact exports and denies managed mutations',()=>{
  assert.equal(patch.managedExportAuthority.customScopedTokenRequired,true);
  assert.equal(patch.managedExportAuthority.fullAccessTokenAllowed,false);
  assert.deepEqual(patch.managedExportAuthority.allowedResourceKinds,['export']);
  for(const denied of ['imports','flows','connections','error-resolution','topics','api-management']){
    assert.ok(patch.managedExportAuthority.deniedAuthorities.includes(denied),denied);
  }
});

test('Celigo scope and reconciliation preserve environment, export and source identity',()=>{
  for(const dimension of ['account','environment','integration','export','exportRevision','dataset']){
    assert.ok(patch.sourceScope.sourceIdentityDimensions.includes(dimension),dimension);
  }
  assert.match(patch.reconciliation,/successful complete|error-free/i);
  assert.match(patch.retriesReconnect,/checkpoint/i);
});

test('Celigo maps source-system exports into cross-domain WFM value without write authority',()=>{
  for(const object of ['workers','time-and-attendance','production-orders','inventory','finance-and-cost-centres']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  for(const target of ['person','time-event','production-order','inventory','cost-centre']){
    assert.ok(patch.valueReview.wfmObjects.includes(target),target);
  }
  assert.match(patch.nextBuildAction,/authorised Celigo/i);
});
