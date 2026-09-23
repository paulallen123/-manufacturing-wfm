import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('SAP Fieldglass reuses current REST/SCIM/file profiles and stays read-only',()=>{
  const c=connectorById('sap-fieldglass');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST','SCIM','files']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='files-sftp'));
  assert.ok(c.adapters.some(x=>x.id==='scim'));
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
  assert.ok(c.canonicalTargets.includes('worker'));
  assert.ok(c.canonicalTargets.includes('external-worker'));
  assert.ok(c.canonicalTargets.includes('labour-cost'));
  assert.ok(c.canonicalTargets.includes('skill'));
});
