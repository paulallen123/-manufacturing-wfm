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

test('Dozuki reuses REST and signed webhook profiles without granting write authority',()=>{
  const c=connectorById('dozuki-connected-worker');
  assertReadOnly(c);
  assert.deepEqual(c.protocols,['REST','webhooks']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.customerEdgeRequired,false);
  assert.equal(c.security.unauthenticatedWebhookAllowed,false);
  assert.equal(c.security.webhookAuthenticationRequired,true);
  assert.equal(c.security.webhookReplayProtectionRequired,true);
  assert.equal(c.security.webhookSchemaVersionPinRequired,true);
});

test('Dozuki blocks auth evidence until a constrained non-admin token path is proven',()=>{
  const c=connectorById('dozuki-connected-worker');
  assertReadOnly(c);
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.ok(c.evidenceBlockers.length>0);
  assert.ok(c.evidenceBlockers.some(x=>/dedicated non-admin integration identity/i.test(x)));
  assert.equal(c.security.superAdminCredentialAllowed,false);
});

test('Dozuki maps training, execution, compliance and readiness into canonical WFM objects',()=>{
  const c=connectorById('dozuki-connected-worker');
  for(const target of [
    'worker',
    'team',
    'skill',
    'qualification',
    'qualification-requirement',
    'training-assignment',
    'training-completion',
    'production-demand',
    'maintenance-demand',
    'worker-activity-context',
    'quality-event',
    'compliance-event',
    'inventory-readiness'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});
