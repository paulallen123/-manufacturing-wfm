import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {evaluateStaticCredentialAuthority} from './static-credential-authority.mjs';

function evocon(){
  const c=connectorById('evocon-oee');
  assert.ok(c);
  return c;
}

test('Evocon reuses the REST fabric and remains read-only at spec evidence',()=>{
  const c=evocon();
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.deepEqual(c.protocols,['REST']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.providerIdentity.canonicalApiHosts[0],'api.evocon.com');
});

test('Evocon records the read-only all-stations versus narrower write-capable authority trade-off',()=>{
  const c=evocon();
  assert.equal(c.staticCredentialAuthority.steadyStateRoute,'custom-reports-read-only');
  assert.equal(c.staticCredentialAuthority.resourceCoverage,'all-stations');
  assert.equal(c.staticCredentialAuthority.broadReadScopeRequiresCustomerApproval,true);
  assert.equal(c.staticCredentialAuthority.narrowerUserRightsRouteMayCarryWriteAuthority,true);
  assert.equal(c.staticCredentialAuthority.userRightsKeyAllowedAtRuntime,false);
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
});

test('static credential guard blocks unapproved all-stations visibility and write-capable station credentials',()=>{
  const broad=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['reports:read'],resourceCoverage:'all-stations',
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true
  });
  assert.equal(broad.allowed,false);
  assert.ok(broad.reasons.includes('broad-resource-scope-not-approved'));

  const narrowerButWritable=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['reports:read','production-orders:write'],resourceCoverage:'station-42',
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true
  });
  assert.equal(narrowerButWritable.allowed,false);
  assert.ok(narrowerButWritable.reasons.includes('write-or-admin-authority-present'));
});

test('Evocon maps production and loss evidence into cross-domain WFM targets',()=>{
  const c=evocon();
  for(const target of [
    'site','line','work-centre','asset','shift','production-order','product','production-demand','production-output',
    'downtime-event','quality-event','maintenance-demand','worker-activity-context','shift-outcome','cost-driver','integration-event'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});
