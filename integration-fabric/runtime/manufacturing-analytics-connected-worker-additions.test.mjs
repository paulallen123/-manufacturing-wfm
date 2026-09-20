import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

const ids=['machinemetrics','sight-machine','poka-connected-worker'];

test('new manufacturing analytics and connected-worker systems remain spec-only and read-only',()=>{
  for(const id of ids){
    const c=connectorById(id);
    assert.ok(c,id+' missing from effective registry');
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
    assert.equal(c.security.readOnlyDefault,true,id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.equal(c.security.directPlantNetworkAccess,false,id);
    assert.equal(c.security.managementPlaneEnabled,false,id);
    assert.equal(c.security.industrialControlEnabled,false,id);
    assert.equal(c.security.remoteProvisioningEnabled,false,id);
    assert.equal(c.security.agentActionEnabled,false,id);
    assert.equal(c.security.crossScopeReadEnabled,false,id);
    assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false,id);
  }
});

test('MachineMetrics prefers reusable cloud read/event profiles without edge or action authority',()=>{
  const c=connectorById('machinemetrics');
  assert.deepEqual(c.protocols,['REST','GraphQL','webhooks']);
  for(const profile of ['rest-openapi','graphql','webhooks-events']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  for(const target of ['machine-state','production-event','production-demand','downtime-event','shift-outcome']) assert.ok(c.canonicalTargets.includes(target),target);
});

test('Sight Machine uses cloud REST/database read models and keeps FactoryTX outside WFM authority',()=>{
  const c=connectorById('sight-machine');
  assert.deepEqual(c.protocols,['REST','JDBC/ODBC']);
  for(const profile of ['rest-openapi','database']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  for(const target of ['machine-state','production-event','downtime-event','quality-event','shift-outcome']) assert.ok(c.canonicalTargets.includes(target),target);
});

test('Poka reuses REST SCIM and webhook paths while provisioning and agent actions stay gated',()=>{
  const c=connectorById('poka-connected-worker');
  assert.deepEqual(c.protocols,['REST','SCIM 2.0','webhooks']);
  for(const profile of ['rest-openapi','scim','webhooks-events']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  for(const target of ['worker','skill','qualification','training-completion','site']) assert.ok(c.canonicalTargets.includes(target),target);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
});

test('coverage planning keeps all three on reusable non-plant routes with vendor-specific value evidence',()=>{
  const report=JSON.parse(fs.readFileSync(new URL('../reports/coverage-matrix.json',import.meta.url),'utf8'));
  for(const id of ids){
    const system=report.systems.find(x=>x.id===id);
    assert.ok(system,id+' missing from coverage matrix');
    assert.equal(system.recommendedRoute,'direct-cloud-adapter',id);
    assert.equal(system.opportunityReview.basis,'vendor-docs',id);
    assert.equal(system.integrationEvidence.level,'spec-verified',id);
  }
});
