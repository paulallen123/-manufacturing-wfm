import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

test('effective catalogue compiles safely and preserves explicit interface gaps',()=>{
  const registry=buildConnectorRegistry();
  assert.equal(registry.connectors.length,168);
  assert.deepEqual(registry.connectors.filter(x=>x.adapters.length===0).map(x=>x.id),['schneider-resource-advisor']);
  for(const c of registry.connectors){
    assert.equal(c.security.readOnlyDefault,true,c.id);
    assert.equal(c.security.writeEnabled,false,c.id);
    assert.equal(c.security.credentialInjection,'executor-boundary-only',c.id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,c.id);
    assert.equal(c.security.destructiveMessageDiscoveryAllowed,false,c.id);
    assert.ok(c.canonicalTargets.length>0,'No canonical WFM targets: '+c.id);
  }
});

test('ADP WorkForce Suite compiles REST SOAP and file routes',()=>{
  const c=connectorById('adp-workforce-suite');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='soap'));
  assert.ok(c.adapters.some(x=>x.id==='files-sftp'));
});

test('Siemens Insights Hub stays on the proven read-only REST route',()=>{
  const c=connectorById('siemens-insights-hub');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.adapters.some(x=>x.id==='webhooks-events'),false);
  assert.equal(c.adapters.some(x=>x.id==='files-sftp'),false);
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
});

test('Resource Advisor is an explicit value source with no invented connector route',()=>{
  const c=connectorById('schneider-resource-advisor');
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.protocols,[]);
  assert.deepEqual(c.adapters,[]);
  assert.equal(c.discoveryStrategy,'vendor-specific-discovery');
  assert.equal(c.nextEvidenceGate,'spec-verification');
  assert.ok(c.canonicalTargets.includes('energy-event'));
  assert.ok(c.canonicalTargets.includes('cost-driver'));
  assert.equal(c.security.writeEnabled,false);
});

test('external-workforce VMS integrations reuse REST safely and populate contingent labour objects',()=>{
  for(const id of ['beeline-enterprise','magnit-vms']){
    const c=connectorById(id);
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.ok(c.adapters.some(x=>x.id==='rest-openapi'),id);
    assert.ok(c.canonicalTargets.includes('external-worker'),id);
    assert.ok(c.canonicalTargets.includes('labour-cost'),id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
  }
  const beeline=connectorById('beeline-enterprise');
  assert.ok(beeline.adapters.some(x=>x.id==='webhooks-events'));
  assert.ok(beeline.adapters.some(x=>x.id==='files-sftp'));
  const magnit=connectorById('magnit-vms');
  assert.deepEqual(magnit.protocols,['REST']);
});

test('FactoryTalk DataMosaix uses the reusable API path without inheriting plant-control access',()=>{
  const c=connectorById('rockwell-factorytalk-datamosaix');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST','OpenAPI']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('AspenTech Inmation reuses industrial profiles behind the customer edge and remains read-only',()=>{
  const c=connectorById('aspentech-inmation');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.ok(c.adapters.some(x=>x.id==='mqtt'));
  assert.ok(c.adapters.some(x=>x.id==='kafka'));
  assert.ok(c.adapters.some(x=>x.id==='database'));
  assert.ok(c.adapters.some(x=>x.id==='files-sftp'));
  assert.ok(c.adapters.some(x=>x.id==='modbus'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.writeEnabled,false);
});

test('Körber PAS-X compiles to REST plus a thin industrial adapter with operational mappings only',()=>{
  const c=connectorById('korber-werum-pas-x');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='vendor-sdk'));
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('legacy Oracle manufacturing estates use published service routes',()=>{
  const jde=connectorById('oracle-jd-edwards-enterpriseone');
  const ebs=connectorById('oracle-ebusiness-suite');
  assert.ok(jde.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(ebs.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(ebs.adapters.some(x=>x.id==='soap'));
  assert.ok(jde.canonicalTargets.includes('production-demand'));
  assert.ok(ebs.canonicalTargets.includes('labour-cost'));
});

test('learning systems land on qualification and training canonical objects',()=>{
  for(const id of ['cornerstone-ondemand','docebo','moodle','sap-successfactors']){
    const c=connectorById(id);
    assert.ok(c.canonicalTargets.some(x=>['qualification','training-completion','skill','competency'].includes(x)),id);
  }
});

test('EHS integration is data-minimised and produces restriction/risk targets',()=>{
  const c=connectorById('intelex');
  assert.ok(c.canonicalTargets.includes('safety-event')||c.canonicalTargets.includes('risk-signal'));
  assert.ok(c.canonicalTargets.includes('worker-restriction')||c.canonicalTargets.includes('qualification'));
  assert.equal(c.security.writeEnabled,false);
});

test('industrial protocols require a customer edge and prohibit direct plant access',()=>{
  for(const id of ['beckhoff-twincat-opcua','inductive-automation-ignition','highbyte-intelligence-hub','aspentech-inmation']){
    const c=connectorById(id);
    assert.equal(c.security.customerEdgeRequired,true,id);
    assert.equal(c.security.directPlantNetworkAccess,false,id);
  }
});

test('message buses default to non-destructive discovery',()=>{
  for(const id of ['ibm-mq','azure-service-bus','confluent-cloud']){
    const c=connectorById(id);
    assert.equal(c.discoveryStrategy,'non-destructive-subscription-or-browse',id);
    assert.equal(c.security.destructiveMessageDiscoveryAllowed,false,id);
  }
});
