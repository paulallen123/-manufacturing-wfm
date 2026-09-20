import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

const ids=['mitti-safetyculture','augury-machine-health','evotix-ehs'];

test('new EHS and machine-health systems remain spec-only and read-only',()=>{
  for(const id of ids){
    const c=connectorById(id);
    assert.ok(c,id+' missing from effective registry');
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
    assert.equal(c.security.readOnlyDefault,true,id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.equal(c.security.crossHostRedirectAllowed,false,id);
    assert.equal(c.security.directPlantNetworkAccess,false,id);
    assert.equal(c.security.managementPlaneEnabled,false,id);
    assert.equal(c.security.remoteProvisioningEnabled,false,id);
    assert.equal(c.security.agentActionEnabled,false,id);
    assert.equal(c.security.crossScopeReadEnabled,false,id);
    assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false,id);
  }
});

test('Mitti reuses REST and webhooks while the SafetyCulture-to-Mitti host transition stays fail-closed',()=>{
  const c=connectorById('mitti-safetyculture');
  assert.deepEqual(c.protocols,['REST','webhooks']);
  for(const profile of ['rest-openapi','webhooks-events']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.crossHostRedirectAllowed,false);
  for(const target of ['worker','site','safety-event','risk-signal','asset','integration-event']) assert.ok(c.canonicalTargets.includes(target),target);
});

test('Augury uses the existing cloud REST path without inheriting closed-loop maintenance writes',()=>{
  const c=connectorById('augury-machine-health');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  for(const target of ['asset','machine-state','downtime-event','maintenance-event','production-risk']) assert.ok(c.canonicalTargets.includes(target),target);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
});

test('Evotix reuses SCIM file and vendor-thin routes without guessing a generic REST contract',()=>{
  const c=connectorById('evotix-ehs');
  assert.deepEqual(c.protocols,['SCIM 2.0','files','connectors']);
  for(const profile of ['scim','files-sftp','vendor-sdk']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'sample-file-and-schema-first');
  for(const target of ['worker','external-worker','site','safety-event','risk-signal','compliance-event']) assert.ok(c.canonicalTargets.includes(target),target);
  assert.equal(c.security.remoteProvisioningEnabled,false);
});

test('all connectors deny automatic cross-host redirects so vendor rebrands cannot silently move tenant traffic',()=>{
  const registry=buildConnectorRegistry();
  for(const c of registry.connectors){
    assert.equal(c.security.crossHostRedirectAllowed,false,c.id);
  }
});
