import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

test('all connectors reject unauthenticated production data surfaces by default',()=>{
  for(const c of buildConnectorRegistry().connectors){
    assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false,c.id);
  }
});

test('HighByte Intelligence Hub uses only reusable read profiles behind the customer edge',()=>{
  const c=connectorById('highbyte-intelligence-hub');
  assert.equal(c.evidenceLevel,'spec-verified');
  for(const id of ['rest-openapi','mqtt','opcua']) assert.ok(c.adapters.some(x=>x.id===id),id);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('FactoryTalk Optix exposes only OPC UA and MQTT read paths to WFM',()=>{
  const c=connectorById('rockwell-factorytalk-optix-view');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['OPC UA','MQTT']);
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.ok(c.adapters.some(x=>x.id==='mqtt'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('Timebase Historian uses authenticated REST only and keeps i3X and agent surfaces out of the connector',()=>{
  const c=connectorById('flow-timebase-historian');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST','OpenAPI']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.adapters.some(x=>x.id==='mqtt'),false);
  assert.equal(c.adapters.some(x=>x.id==='opcua'),false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('energy-event'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});
