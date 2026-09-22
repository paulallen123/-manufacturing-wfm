import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('SafetyChain remains spec-only until documented auth and scope blockers are resolved',()=>{
  const c=connectorById('safetychain-qms');
  assert.ok(c,'safetychain-qms missing from effective registry');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.oauthPasswordGrantEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.ok(c.evidenceBlockers.some(x=>/password/i.test(x)));
  assert.ok(c.evidenceBlockers.some(x=>/all records and resources|cross-scope/i.test(x)));
});

test('SafetyChain maps quality and production evidence without inheriting process writes',()=>{
  const c=connectorById('safetychain-qms');
  for(const target of ['site','production-event','production-risk','compliance-event','change-event','skill','qualification-requirement']) {
    assert.ok(c.canonicalTargets.includes(target),target+' canonical target missing');
  }
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.security.arbitraryEndpointAllowed,false);
});
