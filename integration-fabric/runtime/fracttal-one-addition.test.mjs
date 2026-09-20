import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

function assertReadOnly(c){
  assert.ok(c);
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.security.superAdminCredentialAllowed,false);
  assert.equal(c.security.oauthPasswordGrantEnabled,false);
  assert.equal(c.security.oauthImplicitGrantEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
}

test('Fracttal One reuses REST and remains read-only at spec verification',()=>{
  const c=connectorById('fracttal-one');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.ok(c.canonicalTargets.includes('asset'));
  assert.ok(c.canonicalTargets.includes('maintenance-work'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
  assert.ok(c.canonicalTargets.includes('labour-requirement'));
  assert.ok(c.canonicalTargets.includes('worker-activity-context'));
  assert.ok(c.canonicalTargets.includes('inventory-readiness'));
});

test('Fracttal One does not inherit a second protocol or write-capable adapter',()=>{
  const c=connectorById('fracttal-one');
  assertReadOnly(c);
  assert.equal(c.adapters.length,1);
  assert.equal(c.adapters[0].id,'rest-openapi');
  assert.equal(c.adapters.some(x=>['opcua','mqtt','modbus','scim'].includes(x.id)),false);
});
