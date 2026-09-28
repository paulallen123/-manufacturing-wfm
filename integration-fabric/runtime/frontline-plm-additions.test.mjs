import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('Arena PLM reuses REST and events without inheriting PLM/QMS mutation authority',()=>{
  const c=connectorById('arena-plm');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.ok(c.canonicalTargets.includes('qualification-requirement'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
  assert.ok(c.canonicalTargets.includes('production-risk'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('VKS is fail-closed through the customer edge while reusing REST and event adapters',()=>{
  const c=connectorById('vks');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('quality-event'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('Augmentir reuses OData and vendor-thin connectors while AI agent actions remain disabled',()=>{
  const c=connectorById('augmentir');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='odata'));
  assert.ok(c.adapters.some(x=>x.id==='vendor-sdk'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.rawSensitiveHealthDataAllowed,false);
  assert.ok(c.canonicalTargets.includes('worker'));
  assert.ok(c.canonicalTargets.includes('skill'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
  assert.ok(c.canonicalTargets.includes('maintenance-demand'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});
