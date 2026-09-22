import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('L2L uses only the evidenced cloud application REST path and stays read-only',()=>{
  const c=connectorById('l2l-connected-manufacturing-operations');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.adapters.some(x=>['opcua','mqtt','modbus','bacnet'].includes(x.id)),false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('training-completion'));
});

test('Sepasoft MES reuses REST and SOAP behind the customer edge without inheriting MES control',()=>{
  const c=connectorById('sepasoft-mes');
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST','SOAP']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='soap'));
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('work-centre'));
  assert.ok(c.canonicalTargets.includes('downtime-event'));
  assert.ok(c.canonicalTargets.includes('quality-event'));
});
