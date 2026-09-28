import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

test('global connector auth safety rejects super-admin and legacy OAuth grants',()=>{
  for(const c of buildConnectorRegistry().connectors){
    assert.equal(c.security.superAdminCredentialAllowed,false,c.id);
    assert.equal(c.security.oauthPasswordGrantEnabled,false,c.id);
    assert.equal(c.security.oauthImplicitGrantEnabled,false,c.id);
  }
});

test('Critical Manufacturing MES reuses REST OData and MQTT behind a fail-closed site edge',()=>{
  const c=connectorById('critical-manufacturing-mes');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='odata'));
  assert.ok(c.adapters.some(x=>x.id==='mqtt'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.superAdminCredentialAllowed,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('quality-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-event'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('FORCAM reuses industrial read profiles at the customer edge',()=>{
  const c=connectorById('forcam');
  assert.equal(c.evidenceLevel,'spec-verified');
  for(const id of ['rest-openapi','mqtt','opcua','kafka']){
    assert.ok(c.adapters.some(x=>x.id===id),'Missing '+id);
  }
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('energy-event'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('QAD Redzone is a spec-only connected-workforce route with action authority disabled',()=>{
  const c=connectorById('qad-redzone');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
  assert.ok(c.canonicalTargets.includes('skill'));
  assert.ok(c.canonicalTargets.includes('qualification'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});
