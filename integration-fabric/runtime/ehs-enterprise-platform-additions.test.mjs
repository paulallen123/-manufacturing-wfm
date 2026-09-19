import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry,connectorById} from './connector-registry.mjs';

test('CorityOne reuses the REST fabric but stays spec-only and read-only',()=>{
  const c=connectorById('corityone');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.rawSensitiveHealthDataAllowed,false);
  for(const target of ['worker','site','safety-event','risk-signal','qualification-requirement','training-completion','worker-restriction']){
    assert.ok(c.canonicalTargets.includes(target),target);
  }
});

test('Enablon stays discovery-only on the vendor-thin scaffold until its outward API contract is authoritative',()=>{
  const c=connectorById('wolters-kluwer-enablon');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.protocols,['connectors']);
  assert.ok(c.adapters.some(x=>x.id==='vendor-sdk'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.equal(c.nextEvidenceGate,'spec-verification');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.rawSensitiveHealthDataAllowed,false);
  for(const target of ['worker','external-worker','site','safety-event','risk-signal','production-risk']){
    assert.ok(c.canonicalTargets.includes(target),target);
  }
});

test('Intelex evidence keeps custom EHS reads on REST with least-privilege and health-data guardrails',()=>{
  const c=connectorById('intelex');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.authentication,'basic-or-api-key-or-v6-oauth2-client-credentials');
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.rawSensitiveHealthDataAllowed,false);
  for(const target of ['worker','site','safety-event','risk-signal','training-completion','worker-restriction']){
    assert.ok(c.canonicalTargets.includes(target),target);
  }
});

test('every connector fails closed on raw sensitive health data',()=>{
  const registry=buildConnectorRegistry();
  for(const c of registry.connectors){
    assert.equal(c.security.rawSensitiveHealthDataAllowed,false,c.id);
  }
});
