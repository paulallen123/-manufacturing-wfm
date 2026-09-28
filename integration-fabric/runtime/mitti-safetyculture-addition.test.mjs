import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {evaluatePrivilegedBootstrap} from './privileged-bootstrap-guard.mjs';

function mitti(){
  const c=connectorById('mitti-safetyculture');
  assert.ok(c);
  return c;
}

test('Mitti reuses REST and webhook fabric without write authority',()=>{
  const c=mitti();
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST','webhooks']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.remoteProvisioningEnabled,false);
  assert.equal(c.security.superAdminCredentialAllowed,false);
  assert.equal(c.security.bootstrapCredentialRetentionAllowed,false);
  assert.equal(c.security.bootstrapCredentialReuseAtRuntimeAllowed,false);
});

test('Mitti records the SafetyCulture rebrand as one canonical provider identity',()=>{
  const c=mitti();
  assert.equal(c.providerIdentity.canonicalName,'Mitti');
  assert.ok(c.providerIdentity.aliases.includes('SafetyCulture'));
  assert.ok(c.providerIdentity.aliases.includes('iAuditor'));
  assert.deepEqual(c.providerIdentity.canonicalApiHosts,['api.mitti.com']);
  assert.deepEqual(c.providerIdentity.transitionalApiHosts,['api.safetyculture.io']);
  assert.equal(c.providerIdentity.crossHostRedirectApproved,false);
  assert.equal(c.security.crossHostRedirectAllowed,false);
});

test('Mitti authentication cannot advance without proving an effectively read-only service user',()=>{
  const c=mitti();
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.ok(c.evidenceBlockers.some(x=>/dedicated Mitti service-user token/i.test(x)));
  assert.ok(c.evidenceBlockers.some(x=>/all permissions selected/i.test(x)));
});

test('Mitti privileged webhook bootstrap is separated from steady-state runtime',()=>{
  const c=mitti();
  assert.equal(c.bootstrapAuthority.surfaces.webhooks.elevatedSetupRequired,true);
  assert.equal(c.bootstrapAuthority.runtimeCredentialReuseAllowed,false);
  const blocked=evaluatePrivilegedBootstrap({
    surface:'mitti-webhooks',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['override-permissions:manage-all-data'],
    runtimeCapabilities:['override-permissions:manage-all-data']
  });
  assert.equal(blocked.allowed,false);
  const preProvisioned=evaluatePrivilegedBootstrap({
    surface:'mitti-webhooks',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['override-permissions:manage-all-data'],
    runtimeCapabilities:['read-only','verify-hmac'],
    customerPreProvisioned:true,
    runtimeCanOperateWithoutBootstrapCredential:true,
    verificationMaterialSeparated:true
  });
  assert.equal(preProvisioned.allowed,true);
  assert.equal(preProvisioned.mode,'customer-preprovisioned-separated-bootstrap');
});

test('Mitti maps quality, compliance, training, assets and corrective demand into canonical WFM objects',()=>{
  const c=mitti();
  for(const target of [
    'worker','team','site','asset','skill','qualification','qualification-requirement',
    'training-assignment','training-completion','compliance-event','quality-event','safety-event',
    'maintenance-demand','production-demand','worker-activity-context','corrective-action','shift-outcome','integration-event'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});
