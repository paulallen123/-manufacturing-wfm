import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('Siemens WinCC uses the existing OPC UA edge path without control authority',()=>{
  const c=connectorById('siemens-wincc');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['OPC UA']);
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.ok(c.canonicalTargets.includes('machine-state'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('MaintainX reuses REST plus signed-event paths and stays cloud/read-only by default',()=>{
  const c=connectorById('maintainx');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.ok(c.canonicalTargets.includes('asset'));
  assert.ok(c.canonicalTargets.includes('maintenance-work'));
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('Fiix is not misclassified as REST and uses the existing vendor-thin custom API path',()=>{
  const c=connectorById('fiix');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['SDK']);
  assert.ok(c.adapters.some(x=>x.id==='vendor-sdk'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.ok(c.canonicalTargets.includes('asset'));
  assert.ok(c.canonicalTargets.includes('maintenance-work'));
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});
