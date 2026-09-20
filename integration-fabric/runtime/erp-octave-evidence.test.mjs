import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('Acumatica reuses supported API profiles while forcing the safe OAuth route',()=>{
  const c=connectorById('acumatica');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.authentication,'oauth2-authorization-code-pkce');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='odata'));
  assert.ok(c.adapters.some(x=>x.id==='soap'));
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('labour-cost'));
  assert.equal(c.security.oauthPasswordGrantEnabled,false);
  assert.equal(c.security.oauthImplicitGrantEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('SYSPRO uses the vendor-supported read-only OData plane, fails closed to edge, and blocks auth evidence until effective scope is proven',()=>{
  const c=connectorById('syspro');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.authentication,'dedicated-odata-operator-basic-over-tls');
  assert.ok(c.adapters.some(x=>x.id==='odata'));
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('labour-cost'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.writeEnabled,false);
  assert.ok(c.evidenceBlockers.some(x=>/bypasses the normal SYSPRO security framework/i.test(x)));
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
});

test('Octave Tempo formerly j5 stays discovery-only on a vendor-thin scaffold',()=>{
  const c=connectorById('octave-tempo-operations-management');
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.protocols,['connectors']);
  assert.ok(c.adapters.some(x=>x.id==='vendor-sdk'));
  assert.ok(c.canonicalTargets.includes('shift-outcome'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.equal(c.nextEvidenceGate,'spec-verification');
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
});
