import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

function assertReadOnly(c){
  assert.ok(c);
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
  assert.equal(c.security.superAdminCredentialAllowed,false);
  assert.equal(c.security.oauthPasswordGrantEnabled,false);
  assert.equal(c.security.oauthImplicitGrantEnabled,false);
}

test('FactoryLogix reuses RPC/file profiles and remains customer-edge constrained',()=>{
  const c=connectorById('aegis-factorylogix');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['HTTP RPC/JSON','files']);
  assert.ok(c.adapters.some(x=>x.id==='http-rpc-json'));
  assert.ok(c.adapters.some(x=>x.id==='files-sftp'));
  assert.equal(c.adapters.some(x=>x.id==='rest-openapi'),false);
  assert.equal(c.security.customerEdgeRequired,true);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
  assert.ok(c.canonicalTargets.includes('production-demand'));
  assert.ok(c.canonicalTargets.includes('work-centre'));
  assert.ok(c.canonicalTargets.includes('labour-requirement'));
  assert.ok(c.canonicalTargets.includes('qualification-requirement'));
  assert.ok(c.canonicalTargets.includes('worker-activity-context'));
});

test('FactoryLogix authentication cannot advance until transport and method authority blockers are resolved',()=>{
  const c=connectorById('aegis-factorylogix');
  assertReadOnly(c);
  assert.ok(c.evidenceBlockers.length>=2);
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.ok(c.evidenceBlockers.some(x=>/cleartext HTTP|TLS-protected/i.test(x)));
  assert.ok(c.evidenceBlockers.some(x=>/read-only role|read-method allowlist|mutative/i.test(x)));
  assert.equal(c.adapters.some(x=>['opcua','mqtt','modbus','bacnet'].includes(x.id)),false);
});
