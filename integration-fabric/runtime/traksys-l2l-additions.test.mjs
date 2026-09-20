import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('TrakSYS reuses existing industrial and API adapters behind the safe read boundary',()=>{
  const c=connectorById('parsec-traksys');
  assert.ok(c,'TrakSYS connector must exist');
  assert.equal(c.evidenceLevel,'spec-verified');
  for(const profile of ['rest-openapi','opcua','mqtt','files-sftp']){
    assert.ok(c.adapters.some(x=>x.id===profile),'TrakSYS missing reusable profile: '+profile);
  }
  assert.equal(c.security.customerEdgeRequired,true,'Industrial TrakSYS access must default to the customer/site edge');
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('work-centre'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('L2L remains deliberately adapter-less until an authoritative integration contract is available',()=>{
  const c=connectorById('l2l-connected-manufacturing-operations');
  assert.ok(c,'L2L connector record must exist');
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.adapters,[],'L2L must not receive a guessed protocol adapter');
  assert.equal(c.discoveryStrategy,'vendor-specific-discovery');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-event'));
  assert.equal(c.nextEvidenceGate,'spec-verification');
});
