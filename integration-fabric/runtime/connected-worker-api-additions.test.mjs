import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('Parsable uses semantic read-via-POST RPC handling without granting mutation authority',()=>{
  const c=connectorById('parsable-connected-worker');
  assert.equal(c.evidenceLevel,'spec-verified');
  const rpc=c.adapters.find(x=>x.id==='http-rpc-json');
  assert.ok(rpc,'Parsable must use the reusable HTTP RPC/JSON adapter');
  assert.ok(rpc.supports.includes('read-via-post'));
  assert.ok(rpc.supports.includes('mutation-gated'));
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.ok(c.canonicalTargets.includes('worker'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});

test('Dozuki reuses REST with private tenant evidence and mutation boundaries preserved',()=>{
  const c=connectorById('dozuki');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.unauthenticatedDataSurfaceEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.ok(c.canonicalTargets.includes('worker'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
  assert.ok(c.canonicalTargets.includes('production-event'));
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
});
