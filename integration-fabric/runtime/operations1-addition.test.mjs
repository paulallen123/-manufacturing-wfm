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
  assert.equal(c.nextEvidenceGate,'sandbox-authentication');
}

test('Operations1 reuses REST and stays read-only at spec verification',()=>{
  const c=connectorById('operations1-connected-worker');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['REST']);
  assert.equal(c.adapters.length,1);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(c.adapters.some(x=>x.id==='webhooks-events'),false);
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  for(const target of [
    'worker',
    'team',
    'skill',
    'qualification',
    'qualification-requirement',
    'training-completion',
    'production-demand',
    'maintenance-demand',
    'worker-activity-context'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});

test('Operations1 cannot silently inherit webhook or agent/plant authority',()=>{
  const c=connectorById('operations1-connected-worker');
  assertReadOnly(c);
  assert.equal(c.security.unauthenticatedWebhookAllowed,false);
  assert.equal(c.security.webhookAuthenticationRequired,true);
  assert.equal(c.security.webhookReplayProtectionRequired,true);
  assert.equal(c.security.webhookSchemaVersionPinRequired,true);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.directPlantNetworkAccess,false);
});
