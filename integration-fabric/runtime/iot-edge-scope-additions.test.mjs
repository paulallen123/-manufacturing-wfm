import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

test('all connectors keep cross-scope read channels disabled by default',()=>{
  for(const c of buildConnectorRegistry().connectors){
    assert.equal(c.security.crossScopeReadEnabled,false,c.id);
  }
});

test('EMQX Neuron reuses existing edge protocols without device-control authority',()=>{
  const c=connectorById('emqx-neuron');
  assert.equal(c.evidenceLevel,'spec-verified');
  for(const id of ['rest-openapi','mqtt','opcua','kafka']) assert.ok(c.adapters.some(x=>x.id===id),id);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('HiveMQ Edge stays on REST GET and MQTT subscription paths behind the customer edge',()=>{
  const c=connectorById('hivemq-edge');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='mqtt'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('work-centre'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.writeEnabled,false);
});

test('Cumulocity cloud and Edge keep separate network boundaries and scope gates',()=>{
  const cloud=connectorById('cumulocity-platform');
  const edge=connectorById('cumulocity-edge');
  for(const c of [cloud,edge]){
    assert.equal(c.evidenceLevel,'spec-verified',c.id);
    assert.ok(c.adapters.some(x=>x.id==='rest-openapi'),c.id);
    assert.ok(c.adapters.some(x=>x.id==='mqtt'),c.id);
    assert.ok(c.canonicalTargets.includes('machine-state'),c.id);
    assert.ok(c.canonicalTargets.includes('energy-event'),c.id);
    assert.equal(c.security.crossScopeReadEnabled,false,c.id);
    assert.equal(c.security.writeEnabled,false,c.id);
    assert.equal(c.security.managementPlaneEnabled,false,c.id);
    assert.equal(c.security.remoteProvisioningEnabled,false,c.id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',c.id);
  }
  assert.equal(cloud.security.customerEdgeRequired,false);
  assert.equal(cloud.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(edge.security.customerEdgeRequired,true);
  assert.equal(edge.discoveryStrategy,'customer-edge-config-required');
  assert.ok(edge.adapters.some(x=>x.id==='opcua'));
});
