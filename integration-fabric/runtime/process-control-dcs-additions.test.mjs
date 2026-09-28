import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

function assertSafeDcsReadBoundary(c){
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
}

test('Emerson DeltaV Edge reuses REST and OPC UA without inheriting DCS execution/control authority',()=>{
  const c=connectorById('emerson-deltav');
  assert.ok(c);
  assertSafeDcsReadBoundary(c);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
});

test('Yokogawa CENTUM VP / Exaopc stays OPC UA read-subscription only behind the customer edge',()=>{
  const c=connectorById('yokogawa-centum-vp');
  assert.ok(c);
  assertSafeDcsReadBoundary(c);
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
});

test('Honeywell Experion stays OPC UA read-subscription only with plant/control authority denied',()=>{
  const c=connectorById('honeywell-experion-pks');
  assert.ok(c);
  assertSafeDcsReadBoundary(c);
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
});
