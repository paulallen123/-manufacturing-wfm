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
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
}

test('Siemens Opcenter reuses existing REST/MQTT/OPC UA/file profiles and stays edge-isolated',()=>{
  const c=connectorById('siemens-opcenter');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['REST','MQTT','OPC UA','files']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='mqtt'));
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.ok(c.adapters.some(x=>x.id==='files-sftp'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
});

test('Bosch Nexeed Data Publisher uses non-destructive Kafka/AMQP consumption and does not inherit machine protocols',()=>{
  const c=connectorById('bosch-nexeed-industrial-application-system');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['Kafka','AMQP 1.0']);
  assert.ok(c.adapters.some(x=>x.id==='kafka'));
  assert.ok(c.adapters.some(x=>x.id==='amqp'));
  assert.equal(c.adapters.some(x=>x.id==='opcua'),false);
  assert.equal(c.adapters.some(x=>x.id==='modbus'),false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.destructiveMessageDiscoveryAllowed,false);
  assert.equal(c.discoveryStrategy,'non-destructive-subscription-or-browse');
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
  assert.ok(c.canonicalTargets.includes('skill-evidence'));
});

test('ABB Genix exposes only the governed REST/GraphQL data plane to WFM',()=>{
  const c=connectorById('abb-genix');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['REST','GraphQL']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='graphql'));
  assert.equal(c.adapters.some(x=>x.id==='opcua'),false);
  assert.equal(c.adapters.some(x=>x.id==='mqtt'),false);
  assert.equal(c.adapters.some(x=>x.id==='modbus'),false);
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
  assert.ok(c.canonicalTargets.includes('energy-event'));
});
