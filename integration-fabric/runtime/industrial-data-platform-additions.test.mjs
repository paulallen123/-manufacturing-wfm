import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

const edgeIds=['litmus-edge','cybus-connectware','n3uron'];

test('all connectors keep privileged action planes disabled by default',()=>{
  for(const c of buildConnectorRegistry().connectors){
    assert.equal(c.security.managementPlaneEnabled,false,c.id);
    assert.equal(c.security.industrialControlEnabled,false,c.id);
    assert.equal(c.security.remoteProvisioningEnabled,false,c.id);
    assert.equal(c.security.agentActionEnabled,false,c.id);
  }
});

test('industrial data platforms stay spec-only, edge-routed and read-only',()=>{
  for(const id of edgeIds){
    const c=connectorById(id);
    assert.ok(c,id+' missing from effective registry');
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
    assert.equal(c.security.customerEdgeRequired,true,id);
    assert.equal(c.security.directPlantNetworkAccess,false,id);
    assert.equal(c.security.readOnlyDefault,true,id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.equal(c.security.managementPlaneEnabled,false,id);
    assert.equal(c.security.industrialControlEnabled,false,id);
    assert.equal(c.security.remoteProvisioningEnabled,false,id);
    assert.equal(c.security.agentActionEnabled,false,id);
    assert.ok(c.canonicalTargets.includes('machine-state'),id);
    assert.ok(c.canonicalTargets.includes('downtime-event'),id);
  }
});

test('Litmus Edge reuses REST GraphQL MQTT and OPC UA profiles',()=>{
  const c=connectorById('litmus-edge');
  assert.deepEqual(c.protocols,['REST','GraphQL','MQTT','OPC UA']);
  for(const profile of ['rest-openapi','graphql','mqtt','opcua']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
});

test('Cybus Connectware reuses REST MQTT and OPC UA profiles',()=>{
  const c=connectorById('cybus-connectware');
  assert.deepEqual(c.protocols,['REST','MQTT','OPC UA']);
  for(const profile of ['rest-openapi','mqtt','opcua']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
});

test('N3uron reuses REST MQTT Sparkplug and OPC UA profiles',()=>{
  const c=connectorById('n3uron');
  assert.deepEqual(c.protocols,['REST','MQTT','Sparkplug B','OPC UA']);
  for(const profile of ['rest-openapi','mqtt','opcua']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
});

test('coverage planning keeps industrial data platforms behind the site edge',()=>{
  const report=JSON.parse(fs.readFileSync(new URL('../reports/coverage-matrix.json',import.meta.url),'utf8'));
  for(const id of edgeIds){
    const system=report.systems.find(x=>x.id===id);
    assert.ok(system,id+' missing from coverage matrix');
    assert.equal(system.recommendedRoute,'site-edge-gateway',id);
  }
});
