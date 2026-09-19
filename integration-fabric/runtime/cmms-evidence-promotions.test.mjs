import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

const ids=['limble','upkeep'];

test('Limble and UpKeep promotions remain spec-only, cloud and read-only',()=>{
  for(const id of ids){
    const c=connectorById(id);
    assert.ok(c,id+' missing from effective registry');
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
    assert.equal(c.security.customerEdgeRequired,false,id);
    assert.equal(c.security.readOnlyDefault,true,id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.equal(c.security.crossHostRedirectAllowed,false,id);
    assert.equal(c.security.managementPlaneEnabled,false,id);
    assert.equal(c.security.remoteProvisioningEnabled,false,id);
    assert.equal(c.security.agentActionEnabled,false,id);
  }
});

test('Limble reuses REST SCIM and webhook components with provisioning disabled',()=>{
  const c=connectorById('limble');
  assert.deepEqual(c.protocols,['REST','SCIM 2.0','webhooks']);
  for(const profile of ['rest-openapi','scim','webhooks-events']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.remoteProvisioningEnabled,false);
  for(const target of ['site','asset','maintenance-work','maintenance-event','worker','skill-demand']) assert.ok(c.canonicalTargets.includes(target),target);
});

test('UpKeep reuses REST and webhooks while the write-capable API remains blocked',()=>{
  const c=connectorById('upkeep');
  assert.deepEqual(c.protocols,['REST','webhooks']);
  for(const profile of ['rest-openapi','webhooks-events']) assert.ok(c.adapters.some(x=>x.id===profile),profile);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  for(const target of ['site','asset','maintenance-work','maintenance-event','labour-cost','skill-demand']) assert.ok(c.canonicalTargets.includes(target),target);
});
