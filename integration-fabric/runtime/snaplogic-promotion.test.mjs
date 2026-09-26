import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-26-1810-snaplogic.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='snaplogic')?.patch;

test('SnapLogic remains documentation-only and read-only',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
  assert.ok(patch.protocols.includes('REST'));
});

test('SnapLogic task authority is exact, header-authenticated and mutation-denying',()=>{
  assert.equal(patch.managedTaskIngressAuthority.headerAuthenticationRequired,true);
  assert.equal(patch.managedTaskIngressAuthority.queryCredentialAllowed,false);
  assert.equal(patch.managedTaskIngressAuthority.mutationAuthorityAllowed,false);
  for(const dimension of ['wfmTenant','connection','environment','controlPlaneHost','taskPath','taskRevision','pipelineRevision','schemaFingerprint']){
    assert.ok(patch.managedTaskIngressAuthority.exactScopeDimensions.includes(dimension),dimension);
  }
});

test('SnapLogic duplicate handling quarantines identity conflicts',()=>{
  assert.match(patch.reconciliation,/exact replays/i);
  assert.match(patch.reconciliation,/conflicting duplicate/i);
  assert.match(patch.failureModes.join(' '),/duplicate/i);
});

test('SnapLogic preserves regional, on-premise and cross-domain value scope',()=>{
  assert.equal(patch.deploymentVariants.groundplex.customerEdgeRequired,true);
  assert.match(patch.regionalApiVersions,/US|EU|EMEA/i);
  for(const object of ['workers','time-and-attendance','production-orders','inventory','finance-and-cost-centres']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  assert.match(patch.nextBuildAction,/authorised SnapLogic/i);
});
