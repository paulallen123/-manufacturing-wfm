import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

function erpnext(){
  const c=connectorById('erpnext-frappe');
  assert.ok(c);
  return c;
}

test('ERPNext reuses REST and signed-event fabric at spec evidence',()=>{
  const c=erpnext();
  assert.equal(c.evidenceLevel,'spec-verified');
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='webhooks-events'));
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.unauthenticatedWebhookAllowed,false);
  assert.equal(c.security.webhookAuthenticationRequired,true);
});

test('ERPNext requires role-scoped non-admin proof before authentication evidence advances',()=>{
  const c=erpnext();
  assert.equal(c.staticCredentialAuthority.steadyStateRoute,'role-scoped-rest-read');
  assert.equal(c.staticCredentialAuthority.rotationProofRequired,true);
  assert.equal(c.staticCredentialAuthority.revocationProofRequired,true);
  assert.equal(c.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.ok(c.evidenceBlockers.some(x=>x.includes('dedicated non-admin integration user')));
  assert.ok(c.evidenceBlockers.some(x=>x.includes('whitelisted methods')));
  assert.ok(c.evidenceBlockers.some(x=>x.includes('Query Reports')));
});

test('ERPNext maps workforce production inventory and finance into one cross-domain source',()=>{
  const c=erpnext();
  for(const target of [
    'person','shift','attendance','time-punch','site','legal-entity','work-centre','asset','production-order',
    'production-operation','production-demand','production-output','worker-activity-context','downtime-event','product',
    'inventory-item','warehouse','inventory-movement','supplier','purchase-order','maintenance-demand','payroll-evidence',
    'cost-centre','finance-dimension','integration-event'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});

test('all connectors expose fail-closed schema negotiation defaults',()=>{
  const c=erpnext();
  assert.equal(c.schemaNegotiation.fingerprintRequired,true);
  assert.equal(c.schemaNegotiation.preserveOptionalExtensions,true);
  assert.equal(c.schemaNegotiation.silentBreakingChangeAllowed,false);
  assert.equal(c.schemaNegotiation.credentialLikeExtensionsAllowed,false);
  assert.equal(c.schemaNegotiation.historicalFingerprintRetentionRequired,true);
});
